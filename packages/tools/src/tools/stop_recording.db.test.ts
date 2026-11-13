import { afterAll, describe, expect, it } from "vitest";
import { openTestDbs } from "../../../core/test/helpers";
import { createFixture } from "../../test/helpers";
import { runTool } from "../run-tool";
import stopRecording from "./stop_recording";

const { app, owner } = openTestDbs();
afterAll(async () => {
  await app.close();
  await owner.close();
});

const PEDIDO = "Por favor, não quero que essa conversa fique gravada.";

describe("stop_recording", () => {
  it("para a gravação com o motivo dito pela pessoa", async () => {
    const ctx = await createFixture(app, "parar gravacao");
    const pedidos: string[] = [];
    ctx.telephony = { ...ctx.telephony, pauseRecording: async (reason) => void pedidos.push(reason) };

    const result = await runTool(stopRecording, { reason: PEDIDO }, ctx);

    expect(result).toMatchObject({ ok: true, data: { recording: "stopped" } });
    expect(pedidos).toEqual([PEDIDO]);
    expect((result as { message?: string }).message).toContain("pedido ficou registrado");
  });

  it("sem gravação que se possa parar, recusa e manda dizer a verdade", async () => {
    const ctx = await createFixture(app, "parar gravacao sem telefonia");

    const result = await runTool(stopRecording, { reason: PEDIDO }, ctx);

    expect(result).toMatchObject({ ok: false });
    expect((result as { message?: string }).message).toContain("conversa não está sendo gravada");
  });

  it("exige o motivo, porque é ele que fica como prova do pedido", () => {
    expect(stopRecording.inputSchema.safeParse({ reason: "" }).success).toBe(false);
    expect(stopRecording.inputSchema.safeParse({}).success).toBe(false);
    expect(stopRecording.inputSchema.safeParse({ reason: PEDIDO }).success).toBe(true);
  });
});
