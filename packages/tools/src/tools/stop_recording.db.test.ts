import { afterAll, describe, expect, it } from "vitest";
import { openTestDbs } from "../../../core/test/helpers";
import { createFixture, eventsOf } from "../../test/helpers";
import type { RecordingStop } from "../types";
import { runTool } from "../run-tool";
import stopRecording from "./stop_recording";

const { app, owner } = openTestDbs();
afterAll(async () => {
  await app.close();
  await owner.close();
});

const PEDIDO = "Por favor, não quero que essa conversa fique gravada.";

async function withRecording(label: string, outcome: RecordingStop) {
  const ctx = await createFixture(app, label);
  const pedidos: string[] = [];
  ctx.telephony = { ...ctx.telephony, pauseRecording: async (reason) => (pedidos.push(reason), outcome) };
  return { ctx, pedidos };
}

describe("stop_recording", () => {
  it("para a gravação com o motivo dito pela pessoa, e o motivo não vai para os argumentos da linha do tempo", async () => {
    const { ctx, pedidos } = await withRecording("parar gravacao", "stopped");

    const result = await runTool(stopRecording, { reason: PEDIDO }, ctx);

    expect(result).toMatchObject({ ok: true, data: { recording: "stopped" } });
    expect(result.message).toContain("pedido ficou registrado");
    expect(pedidos).toEqual([PEDIDO]);
    const called = (await eventsOf(app, ctx.callId)).find((event) => event.kind === "tool_called");
    expect(called?.payload).toEqual({ name: "stop_recording", args: { omitted: "personal_text" } });
    expect(JSON.stringify(await eventsOf(app, ctx.callId))).not.toContain(PEDIDO);
  });

  it("sem gravação em curso, diz que a ligação não está sendo gravada e não afirma registro", async () => {
    const { ctx } = await withRecording("parar gravacao sem gravar", "not_recording");

    const result = await runTool(stopRecording, { reason: PEDIDO }, ctx);

    expect(result).toMatchObject({ ok: true, data: { recording: "not_recording" } });
    expect(result.message).toContain("não está sendo gravada");
    expect(result.message).not.toContain("ficou registrado");
  });

  it("pedido repetido na mesma ligação: diz que já tinha parado", async () => {
    const { ctx } = await withRecording("parar gravacao de novo", "already_stopped");

    const result = await runTool(stopRecording, { reason: PEDIDO }, ctx);

    expect(result).toMatchObject({ ok: true, data: { recording: "already_stopped" } });
    expect(result.message).toContain("já tinha parado");
  });

  it("exige o motivo, porque é ele que fica como prova do pedido; sem ele, nada é parado", async () => {
    const { ctx, pedidos } = await withRecording("parar gravacao sem motivo", "stopped");

    expect(await runTool(stopRecording, { reason: "  " }, ctx)).toMatchObject({ ok: false });
    expect(await runTool(stopRecording, {}, ctx)).toMatchObject({ ok: false });
    expect(pedidos).toEqual([]);
  });

  it("falha ao parar vira ok: false, sem prometer nada", async () => {
    const ctx = await createFixture(app, "parar gravacao falha");
    ctx.telephony = { ...ctx.telephony, pauseRecording: async () => Promise.reject(new Error("disco sumiu")) };

    const result = await runTool(stopRecording, { reason: PEDIDO }, ctx);

    expect(result.ok).toBe(false);
    expect(result.message).not.toContain("parou");
  });
});
