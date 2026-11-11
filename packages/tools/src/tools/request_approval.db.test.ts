import { withSystem, type ApprovalOutcome } from "@deskvoice/core";
import { afterAll, describe, expect, it } from "vitest";
import { openTestDbs } from "../../../core/test/helpers";
import { createFixture, createUser, eventsOf, notificationsOf, putWhatsAppConnector, t0, type FakeContext } from "../../test/helpers";
import { runTool } from "../run-tool";
import requestApproval from "./request_approval";

const { app, owner } = openTestDbs();
afterAll(async () => {
  await app.close();
  await owner.close();
});

const args = { question: "Posso dar 10% de desconto no plano anual?", context: "Cliente há 3 anos, ameaça cancelar.", default_on_timeout: "denied", timeout_seconds: 45 };

const approvalRow = (id: string): Promise<{ status: string; question: string; context: unknown; default_on_timeout: string; expires_at: Date; decided_at: Date | null } | null> =>
  withSystem(app, (q) => q.one("select status, question, context, default_on_timeout, expires_at, decided_at from approvals where id = $1", [id]));

/** Um humano decide pelo painel enquanto a ferramenta espera. */
const humanDecides = (decision: "approved" | "denied") => async (approvalId: string, ctx: FakeContext): Promise<ApprovalOutcome> => {
  ctx.advance(20_000);
  await withSystem(app, (q) => q.exec("update approvals set status = $2, decided_at = $3 where id = $1", [approvalId, decision, ctx.clock.now()]));
  return decision;
};
/** Ninguém responde: o prazo passa. */
const nobodyAnswers = async (_approvalId: string, ctx: FakeContext): Promise<ApprovalOutcome> => {
  ctx.advance(45_000);
  return "expired";
};

describe("request_approval", () => {
  it("cria a aprovação visível antes de esperar, avisa os humanos e quem está na linha, e devolve a aprovação", async () => {
    let seenWhileWaiting: Awaited<ReturnType<typeof approvalRow>> = null;
    const ctx = await createFixture(app, "approval approved", {
      onWait: async (approvalId, fixture) => {
        seenWhileWaiting = await approvalRow(approvalId);
        expect(fixture.said).toEqual([expect.stringMatching(/conferir/)]);
        return humanDecides("approved")(approvalId, fixture);
      },
    });
    await putWhatsAppConnector(app, ctx.organizationId);
    await createUser(app, ctx.organizationId, "+5531988887777");

    const result = await runTool(requestApproval, args, ctx);

    expect(result).toMatchObject({ ok: true, data: { outcome: "approved", decision: "approved" } });
    expect(result.message).toMatch(/APROVOU/);
    expect(ctx.waits).toEqual([{ approvalId: expect.any(String), timeoutMs: 45_000 }]);
    // Confirmada no banco enquanto a ferramenta ainda esperava: é o que deixa o painel decidir.
    expect(seenWhileWaiting).toEqual({
      status: "pending",
      question: args.question,
      context: { text: args.context },
      default_on_timeout: "denied",
      expires_at: new Date(t0.getTime() + 45_000),
      decided_at: null,
    });
    expect((await notificationsOf(app, ctx.organizationId)).map(({ channel, target }) => ({ channel, target }))).toEqual([
      { channel: "panel", target: null },
      { channel: "whatsapp", target: "+5531988887777" },
    ]);

    const events = await eventsOf(app, ctx.callId);
    expect(events.map((event) => event.kind)).toEqual(["tool_called", "approval_requested", "approval_decided", "tool_result"]);
    const approvalId = ctx.waits[0]?.approvalId;
    expect(events[1]).toEqual({
      kind: "approval_requested",
      at: t0,
      payload: { approvalId, question: args.question, context: args.context, defaultOnTimeout: "denied", expiresAt: "2030-05-10T12:00:45.000Z" },
    });
    expect(events[2]).toEqual({ kind: "approval_decided", at: new Date(t0.getTime() + 20_000), payload: { approvalId, outcome: "approved", decision: "approved" } });
  });

  it("devolve a negação com instrução de não prosseguir", async () => {
    const ctx = await createFixture(app, "approval denied", { onWait: humanDecides("denied") });
    const result = await runTool(requestApproval, { ...args, default_on_timeout: "approved" }, ctx);
    expect(result).toMatchObject({ ok: true, data: { outcome: "denied", decision: "denied" } });
    expect(result.message).toMatch(/NEGOU/);
    expect(result.message).toMatch(/NÃO prossiga/);
  });

  it.each([
    ["denied", /tratar como NEGADO/, /NÃO prossiga/],
    ["approved", /tratar como APROVADO/, /Prossiga/],
  ] as const)("sem resposta no prazo, grava expired e aplica o padrão %s", async (defaultOnTimeout, rule, instruction) => {
    const ctx = await createFixture(app, `approval expired ${defaultOnTimeout}`, { onWait: nobodyAnswers });
    const result = await runTool(requestApproval, { ...args, default_on_timeout: defaultOnTimeout }, ctx);

    expect(result).toMatchObject({ ok: true, data: { outcome: "expired", decision: defaultOnTimeout } });
    expect(result.message).toMatch(/Ninguém respondeu no prazo/);
    expect(result.message).toMatch(rule);
    expect(result.message).toMatch(instruction);
    const approvalId = ctx.waits[0]?.approvalId ?? "";
    expect(await approvalRow(approvalId)).toMatchObject({ status: "expired", decided_at: new Date(t0.getTime() + 45_000) });
    expect((await eventsOf(app, ctx.callId)).at(-2)?.payload).toEqual({ approvalId, outcome: "expired", decision: defaultOnTimeout });
  });

  it("se a rotina expire_approvals já venceu a linha, o resultado é o mesmo e a linha não é regravada", async () => {
    const routineAt = new Date(t0.getTime() + 46_000);
    const ctx = await createFixture(app, "approval expired by routine", {
      onWait: async (approvalId, fixture) => {
        fixture.advance(50_000);
        await withSystem(app, (q) => q.exec("update approvals set status = 'expired', decided_at = $2 where id = $1", [approvalId, routineAt]));
        return "expired";
      },
    });
    const result = await runTool(requestApproval, args, ctx);
    expect(result).toMatchObject({ ok: true, data: { outcome: "expired", decision: "denied" } });
    expect(await approvalRow(ctx.waits[0]?.approvalId ?? "")).toMatchObject({ status: "expired", decided_at: routineAt });
  });

  it("decisão humana no último instante vence o prazo estourado", async () => {
    const ctx = await createFixture(app, "approval last second", {
      onWait: async (approvalId, fixture) => {
        await humanDecides("approved")(approvalId, fixture);
        return "expired";
      },
    });
    const result = await runTool(requestApproval, args, ctx);
    expect(result).toMatchObject({ ok: true, data: { outcome: "approved", decision: "approved" } });
    expect(await approvalRow(ctx.waits[0]?.approvalId ?? "")).toMatchObject({ status: "approved" });
  });

  it.each([14, 301, 60.5])("recusa prazo de %s segundos, fora de 15 a 300", async (timeoutSeconds) => {
    const ctx = await createFixture(app, `approval timeout ${timeoutSeconds}`);
    const result = await runTool(requestApproval, { ...args, timeout_seconds: timeoutSeconds }, ctx);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("timeout_seconds");
    expect(ctx.waits).toEqual([]);
  });
});
