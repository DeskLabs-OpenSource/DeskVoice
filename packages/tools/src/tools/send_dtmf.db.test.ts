import { afterAll, describe, expect, it } from "vitest";
import { openTestDbs } from "../../../core/test/helpers";
import { createFixture, eventsOf } from "../../test/helpers";
import { runTool } from "../run-tool";
import sendDtmf from "./send_dtmf";

const { app, owner } = openTestDbs();
afterAll(async () => {
  await app.close();
  await owner.close();
});

describe("send_dtmf", () => {
  it("aperta as teclas e deixa o rastro na chamada", async () => {
    const ctx = await createFixture(app, "dtmf envia");
    const enviados: string[] = [];
    ctx.telephony = { ...ctx.telephony, sendDtmf: async (digits) => void enviados.push(digits) };

    const result = await runTool(sendDtmf, { digits: "1" }, ctx);

    expect(result).toMatchObject({ ok: true, data: { digits: "1" } });
    expect(enviados).toEqual(["1"]);
    expect((await eventsOf(app, ctx.callId)).filter((event) => event.kind === "dtmf_sent")).toEqual([
      { kind: "dtmf_sent", payload: { digits: "1" }, at: expect.any(Date) },
    ]);
  });

  it("sem telefonia que aceite tecla, recusa e diz o que fazer em vez de fingir que apertou", async () => {
    const ctx = await createFixture(app, "dtmf sem telefonia");

    const result = await runTool(sendDtmf, { digits: "2" }, ctx);

    expect(result).toMatchObject({ ok: false });
    expect((result as { message?: string }).message).toContain("não tem como apertar teclas");
    expect((await eventsOf(app, ctx.callId)).filter((event) => event.kind === "dtmf_sent")).toEqual([]);
  });

  it("recusa tecla que não existe no telefone", () => {
    expect(sendDtmf.inputSchema.safeParse({ digits: "12x" }).success).toBe(false);
    expect(sendDtmf.inputSchema.safeParse({ digits: "" }).success).toBe(false);
    expect(sendDtmf.inputSchema.safeParse({ digits: "012345678" }).success).toBe(false);
    expect(sendDtmf.inputSchema.safeParse({ digits: "#" }).success).toBe(true);
  });
});
