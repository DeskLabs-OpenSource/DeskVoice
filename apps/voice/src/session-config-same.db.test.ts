// A cerca da configuração igual (fatia 7b, seção 5.4 de docs/specs/2026-11-21-testes-do-agente.md):
// para o mesmo agente, a sessão que a ligação recebida abre e a que o teste do agente abre só diferem
// em `mode`. As duas montam por `session-config.ts`; se uma das pontas passar a montar diferente (uma
// ferramenta a mais, a abertura sem o aviso, a voz de outro lugar), o teste do agente deixa de provar
// o que a ligação faz, e este teste quebra.
//
// Teto: a ligação recebida pelo telefone, no começo, sem memória do número (o teste não tem número;
// com a chave da memória ligada, a ligação ganha o bloco lembrado e o teste não). A ligação feita por
// nós (sem saudação), a religação e o trecho depois de uma passagem ou de uma transferência que voltou
// montam de outro jeito, e ficam fora.
import { withOrg } from "@deskvoice/core";
import type { VoiceEngine, VoiceSessionConfig } from "@deskvoice/voice-engine";
import { afterAll, describe, expect, it } from "vitest";
import { openTestDbs } from "../../../packages/core/test/helpers";
import { putSetting } from "../../../packages/tools/test/helpers";
import { startAgentTest } from "./agent-test";
import { startCallSession } from "./call-session";
import { RECORDING_NOTICE_SETTING } from "./session-config";
import { createAgent, createCall, createOrganization, kindsOf, manualEngine, manualTransport, sessionHarness, setHandoffTargets } from "./testing/db";
import { waitFor } from "./testing/helpers";

const { app, owner } = openTestDbs();
afterAll(async () => {
  await app.close();
  await owner.close();
});

const ENGINE = "manual";

async function lia(label: string, notice?: string) {
  const organizationId = await createOrganization(app, label);
  const agentId = await createAgent(app, organizationId, {
    name: "Lia",
    engine: ENGINE,
    instructions: "Você é a Lia, da recepção da Clínica Bem Viver.",
    greeting: "  Clínica Bem Viver, bom dia. Aqui é a Lia.  ",
    // `transfer_to_human` entra nas duas: a ligação pelo telefone transfere, e o teste oferece a
    // ferramenta para registrar o pedido. `no_such_tool` não está instalada e some nas duas.
    tools: ["create_task", "notify_human", "transfer_to_human", "end_call", "no_such_tool"],
    transferTo: "+5511999990000",
    vocabulary: ["limpeza de pele", "Bem Viver"],
    listeningEnvironment: "noisy",
    language: "pt-BR",
  });
  await withOrg(app, organizationId, (q) => q.exec("update agents set voice_id = 'marin' where id = $1", [agentId]));
  if (notice !== undefined) await putSetting(app, organizationId, RECORDING_NOTICE_SETTING, notice, false);
  const test = await withOrg(app, organizationId, (q) =>
    q.one<{ id: string }>("insert into agent_tests (organization_id, agent_id, name, turns) values ($1, $2, 'Teste', $3) returning id", [
      organizationId,
      agentId,
      JSON.stringify([{ user: "Oi.", expect: { tools: [], says: [] } }]),
    ]),
  );
  if (!test) throw new Error("test not created");
  return { organizationId, agentId, testId: test.id };
}

/** A configuração que a ligação recebida entrega ao motor. */
async function callConfig(organizationId: string, agentId: string): Promise<VoiceSessionConfig> {
  const manual = manualEngine({ id: ENGINE, keyless: true });
  const harness = await sessionHarness(app, [manual.engine]);
  const callId = await createCall(app, organizationId, agentId, harness.clock.now(), "inbound");
  const transport = manualTransport();
  const session = startCallSession(harness.deps, { organizationId, callId, agentId, transport });
  await waitFor(async () => (await kindsOf(app, callId)).includes("call_answered"), "the call to be answered");
  transport.callerHangup();
  await session.done;
  await harness.approvals.close();
  const config = manual.configs[0];
  if (!config) throw new Error("the call did not open the engine");
  return config;
}

/** A configuração que o teste do agente entrega ao motor. O motor recusa logo depois de guardá-la. */
async function testConfig(organizationId: string, testId: string): Promise<VoiceSessionConfig> {
  const manual = manualEngine({ id: ENGINE, keyless: true, connectError: "guardou a configuração" });
  const engine: VoiceEngine = { ...manual.engine, textMode: true };
  const harness = await sessionHarness(app, [engine]);
  const started = await startAgentTest({ db: app, clock: harness.clock, engines: new Map([[ENGINE, engine]]), tools: harness.deps.tools, schedule: harness.timers.schedule }, { organizationId, testId });
  if (!("runId" in started)) throw new Error(`${started.code}: ${started.message}`);
  await started.done;
  await harness.approvals.close();
  const config = manual.configs[0];
  if (!config) throw new Error("the test did not open the engine");
  return config;
}

describe("a ligação e o teste do mesmo agente abrem a mesma sessão", { timeout: 60_000 }, () => {
  it("só diferem em `mode`: as mesmas instruções, a mesma abertura com o aviso padrão, as mesmas ferramentas, voz, língua, vocabulário e ambiente", async () => {
    const { organizationId, agentId, testId } = await lia("session-config-same-default");
    const call = await callConfig(organizationId, agentId);
    const test = await testConfig(organizationId, testId);
    expect(call.mode).toBeUndefined();
    expect(test).toEqual({ ...call, mode: "text" });
    // O que se compara não é vazio: o aviso abre, e as ferramentas e o resto chegaram.
    expect(call.greeting).toBe("Esta ligação é atendida por uma assistente virtual e a conversa fica registrada. Clínica Bem Viver, bom dia. Aqui é a Lia.");
    expect(call.tools.map((tool) => tool.name)).toEqual(["create_task", "notify_human", "transfer_to_human", "end_call"]);
    expect(call).toMatchObject({ voiceId: "marin", language: "pt-BR", vocabulary: ["limpeza de pele", "Bem Viver"], listeningEnvironment: "noisy" });
  });

  it("com destino de passagem, as duas têm a lista nas instruções e `transfer_to_agent`", async () => {
    const { organizationId, agentId, testId } = await lia("session-config-same-handoff");
    const scheduling = await createAgent(app, organizationId, { name: "Agendamento", roleLabel: "marca e remarca horários", engine: ENGINE });
    expect(await setHandoffTargets(app, agentId, [scheduling])).toBe(1);
    const call = await callConfig(organizationId, agentId);
    const test = await testConfig(organizationId, testId);
    expect(test).toEqual({ ...call, mode: "text" });
    expect(call.instructions).toContain("- Agendamento (marca e remarca horários)");
    expect(call.tools.map((tool) => tool.name)).toContain("transfer_to_agent");
  });

  it("com o aviso que o operador escreveu, as duas abrem com ele", async () => {
    const { organizationId, agentId, testId } = await lia("session-config-same-notice", "  Ligação gravada pela Clínica Bem Viver.  ");
    const call = await callConfig(organizationId, agentId);
    const test = await testConfig(organizationId, testId);
    expect(test).toEqual({ ...call, mode: "text" });
    expect(call.greeting).toBe("Ligação gravada pela Clínica Bem Viver. Clínica Bem Viver, bom dia. Aqui é a Lia.");
  });
});
