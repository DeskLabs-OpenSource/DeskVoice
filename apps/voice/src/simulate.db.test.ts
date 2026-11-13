// A chamada simulada do painel, de ponta a ponta: motor simulado, transporte simulado e banco.
import { withOrg } from "@deskvoice/core";
import type { SimulatedScript } from "@deskvoice/voice-engine";
import { afterAll, describe, expect, it } from "vitest";
import { openTestDbs } from "../../../packages/core/test/helpers";
import { startSimulatedCall } from "./simulate";
import { createAgent, createOrganization, kindsOf, sessionHarness, simulatedSpeechMs } from "./testing/db";
import { manualTime, waitFor } from "./testing/helpers";

const { app, owner } = openTestDbs();
afterAll(async () => {
  await app.close();
  await owner.close();
});

describe("chamada simulada no ritmo de uma ligação (issue #111)", { timeout: 120_000 }, () => {
  it("quem ligou só fala depois de ouvir a fala do agente, e a chamada termina e solta o transporte", async () => {
    const organizationId = await createOrganization(app, "simulate-pace");
    const agentId = await createAgent(app, organizationId);
    const harness = await sessionHarness(app);
    const time = manualTime();
    const script: SimulatedScript = [
      { say: "Clínica Bem Viver, bom dia. Como posso ajudar?" },
      { expectUserAudio: 200, text: "Quero remarcar." },
      { say: "Claro, vou anotar o pedido." },
      { end: true },
    ];
    const call = await startSimulatedCall(harness.deps, { organizationId, agentId }, { script, tools: [], transportSchedule: time.schedule });
    if ("code" in call) throw new Error(call.message);
    let done = false;
    void call.session.done.then(() => (done = true));
    // A partida passa pelo banco: o relógio só anda com a chamada atendida.
    await waitFor(async () => (await kindsOf(app, call.callId)).includes("call_answered"), "the call to be answered");
    // O relógio da chamada e o do transporte andam juntos, de 20 em 20 ms. `setTimeout` cede à E/S
    // a cada volta: o fim da chamada (`finish`) espera o banco antes de chamar `hangup`, e o relógio
    // não pode passar dele. O teto de voltas é só a rede de segurança; o prazo é o do teste.
    for (let turn = 0; !done && turn < 100_000; turn += 1) {
      time.advance(20);
      harness.clock.advance(20);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(done).toBe(true);

    const rows = await withOrg(app, organizationId, (q) =>
      q.many<{ at: Date; kind: string; payload: { text?: string } }>(
        "select at, kind, payload from call_events where call_id = $1 and kind in ('transcript_agent', 'transcript_user') order by at, id",
        [call.callId],
      ),
    );
    const userIndex = rows.findIndex((row) => row.kind === "transcript_user");
    const before = rows.slice(0, userIndex);
    const first = before[0];
    const user = rows[userIndex];
    if (!first || !user) throw new Error(`transcripts: ${JSON.stringify(rows.map((row) => row.kind))}`);
    // Tudo o que o agente disse antes (aviso de gravação e saudação) toca inteiro, e só então
    // correm os 200 ms de quem ligou. Antes do conserto, eram só os 200 ms.
    const heardMs = before.reduce((total, row) => total + simulatedSpeechMs(row.payload.text ?? ""), 0);
    const gap = user.at.getTime() - first.at.getTime();
    expect(gap).toBeGreaterThanOrEqual(heardMs + 200);
    expect(gap).toBeLessThan(heardMs + 200 + 100);
    expect(call.transport.ended).toBe(true);
    await harness.approvals.close();
  });
});
