import { encryptSecret, withSystem, type ApprovalOutcome } from "@deskvoice/core";
import { afterAll, describe, expect, it } from "vitest";
import { openTestDbs } from "../../../core/test/helpers";
import { createFixture, eventsOf, fakeLookup, putSetting, secretKey, type FakeContext } from "../../test/helpers";
import { fakeMcp, tool } from "../../test/mcp-server";
import { APPROVAL_DEFAULT_KEY } from "../approval";
import { runTool } from "../run-tool";
import type { Tool } from "../types";
import { mcpToolFingerprint } from "./client";
import { loadMcpServers, MCP_SERVERS_KEY, type McpToolSnapshot } from "./servers";
import { MAX_MCP_WRITES_PER_CALL, MCP_APPROVAL_TIMEOUT_SECONDS, MCP_APPROVAL_WAIT_LINES, mcpTools } from "./tool";

// Fatia 8c do item 8: a aprovação humana opcional por ferramenta MCP (spec 2026-11-22, 5.5).

const { app, owner } = openTestDbs();
afterAll(async () => {
  await app.close();
  await owner.close();
});

const snapshot = (name: string, extra: Partial<McpToolSnapshot> = {}): McpToolSnapshot => {
  const base = tool(name);
  return { name, description: base.description, inputSchema: base.inputSchema, fingerprint: mcpToolFingerprint(base), allowed: true, writes: true, needsApproval: false, supported: true, ...extra };
};

const server = {
  slug: "erp",
  label: "ERP da loja",
  url: "https://mcp.example.com/mcp?key=na-url",
  secret: encryptSecret("Bearer s3cret", secretKey),
  fetchedAt: "2030-05-10T12:00:00.000Z",
  tools: [
    snapshot("abrir_chamado", { needsApproval: true }),
    snapshot("consultar_pedido"),
    snapshot("ver_estoque", { writes: false, needsApproval: true }),
    // Um servidor pode ter um campo com o mesmo nome do ajuste: o modelo o preenche, e ele chega ao `run`.
    snapshot("agendar", {
      needsApproval: true,
      inputSchema: { type: "object", properties: { pedido: { type: "string" }, default_on_timeout: { type: "string" }, defaultOnTimeout: { type: "string" } }, required: ["pedido"] },
    }),
  ],
};

type Wait = (approvalId: string, ctx: FakeContext) => Promise<ApprovalOutcome>;

/** Um humano decide pelo painel enquanto a ferramenta espera. */
const humanDecides =
  (decision: "approved" | "denied"): Wait =>
  async (approvalId, ctx) => {
    ctx.advance(20_000);
    await withSystem(app, (q) => q.exec("update approvals set status = $2, decided_at = $3 where id = $1", [approvalId, decision, ctx.clock.now()]));
    return decision;
  };
/** Ninguém responde: o prazo passa. */
const nobodyAnswers: Wait = async (_approvalId, ctx) => {
  ctx.advance(MCP_APPROVAL_TIMEOUT_SECONDS * 1000);
  return "expired";
};

async function setup(label: string, onWait: Wait | undefined, operatorDefault?: unknown, language = "pt-BR") {
  const ctx = await createFixture(app, label, onWait ? { onWait } : {});
  ctx.language = language;
  await putSetting(app, ctx.organizationId, MCP_SERVERS_KEY, [server]);
  if (operatorDefault !== undefined) await putSetting(app, ctx.organizationId, APPROVAL_DEFAULT_KEY, operatorDefault, false);
  const fake = fakeMcp({ call: () => ({ content: [{ type: "text", text: "Chamado 77 aberto" }] }) });
  const servers = await loadMcpServers(ctx.q, secretKey);
  const tools = new Map<string, Tool>(servers.flatMap((item) => mcpTools(item, { fetch: fake.fetch, lookup: fakeLookup() })).map((item) => [item.name, item]));
  const get = (name: string): Tool => {
    const found = tools.get(name);
    if (!found) throw new Error(`no tool ${name}`);
    return found;
  };
  return { ctx, fake, get };
}

const calls = (fake: ReturnType<typeof fakeMcp>): number => fake.requests.filter((request) => request.rpc.method === "tools/call").length;

async function lastResult(ctx: FakeContext): Promise<Record<string, unknown>> {
  return (await eventsOf(app, ctx.callId)).filter((event) => event.kind === "tool_result").at(-1)?.payload ?? {};
}

const approvalRow = (id: string) =>
  withSystem(app, (q) => q.one<{ status: string; question: string; default_on_timeout: string; expires_at: Date }>("select status, question, default_on_timeout, expires_at from approvals where id = $1", [id]));

describe("ferramenta MCP com aprovação ligada", () => {
  it("negada: noEffect, a vaga volta, o servidor não recebe tools/call e há frase para quem está na linha", async () => {
    const { ctx, fake, get } = await setup("mcp aprov negada", humanDecides("denied"));
    const result = await runTool(get("erp__abrir_chamado"), { pedido: "1234" }, ctx);

    expect(result).toMatchObject({ ok: false, noEffect: true, data: { outcome: "denied", decision: "denied" } });
    expect(result.message).toMatch(/O responsável NEGOU/);
    expect(result.message).toMatch(/NÃO foi chamado/);
    expect(result.message).toMatch(/Diga à pessoa/);
    expect(calls(fake)).toBe(0);
    expect(fake.requests).toHaveLength(0);
    expect(await lastResult(ctx)).toMatchObject({ name: "erp__abrir_chamado", ok: false, budget: "mcp:erp" });
    expect(await lastResult(ctx)).not.toHaveProperty("spent");
    // Enquanto espera, a linha não fica muda.
    expect(ctx.said).toEqual([MCP_APPROVAL_WAIT_LINES["pt-BR"]]);
  });

  it("o pedido nomeia a ferramenta como <slug>__<nome>, mostra os dados e não leva o endereço do servidor", async () => {
    const { ctx, get } = await setup("mcp aprov pedido", humanDecides("denied"));
    await runTool(get("erp__abrir_chamado"), { pedido: "1234" }, ctx);

    const requested = (await eventsOf(app, ctx.callId)).find((event) => event.kind === "approval_requested");
    expect(requested?.payload).toMatchObject({ tool: "erp__abrir_chamado" });
    const row = await approvalRow(ctx.waits[0]?.approvalId ?? "");
    expect(row?.question).toContain('"abrir_chamado"');
    expect(row?.question).toContain('"ERP da loja"');
    expect(row?.question).toContain('{"pedido":"1234"}');
    expect(JSON.stringify(requested?.payload)).not.toContain("na-url");
    expect(row?.question).not.toContain("na-url");
    expect(ctx.waits[0]?.timeoutMs).toBe(MCP_APPROVAL_TIMEOUT_SECONDS * 1000);
  });

  it("aprovada: o servidor recebe o tools/call e a vaga é gasta", async () => {
    const { ctx, fake, get } = await setup("mcp aprov aprovada", humanDecides("approved"));
    const result = await runTool(get("erp__abrir_chamado"), { pedido: "1234" }, ctx);

    expect(result).toMatchObject({ ok: true, data: { text: "Chamado 77 aberto" } });
    expect(calls(fake)).toBe(1);
    expect(await lastResult(ctx)).toMatchObject({ ok: true, spent: true, budget: "mcp:erp" });
  });

  it("vencida sem ajuste do operador: vale negar, noEffect, e o servidor não recebe tools/call", async () => {
    const { ctx, fake, get } = await setup("mcp aprov vencida sem ajuste", nobodyAnswers);
    const result = await runTool(get("erp__abrir_chamado"), { pedido: "1234" }, ctx);

    expect(result).toMatchObject({ ok: false, noEffect: true, data: { outcome: "expired", decision: "denied" } });
    expect(result.message).toMatch(/Ninguém respondeu a tempo/);
    expect(result.message).toMatch(/NÃO foi chamado/);
    expect(calls(fake)).toBe(0);
    expect(await lastResult(ctx)).not.toHaveProperty("spent");
    expect(await approvalRow(ctx.waits[0]?.approvalId ?? "")).toMatchObject({ status: "expired", default_on_timeout: "denied" });
  });

  // A fonte do padrão é o `approvals.default_on_timeout` do operador. Os dois sentidos juntos quebram
  // com qualquer outra fonte: um valor fixo erra um deles.
  it.each([
    ["denied", "denied", 0],
    ["approved", "approved", 1],
  ] as const)("vencida com o operador em %s: vale %s", async (operatorDefault, decision, served) => {
    const { ctx, fake, get } = await setup(`mcp aprov vencida operador ${operatorDefault}`, nobodyAnswers, operatorDefault);
    const result = await runTool(get("erp__abrir_chamado"), { pedido: "1234" }, ctx);

    const decided = (await eventsOf(app, ctx.callId)).find((event) => event.kind === "approval_decided");
    expect(decided?.payload).toMatchObject({ outcome: "expired", decision });
    expect(calls(fake)).toBe(served);
    expect(result.ok).toBe(decision === "approved");
    expect(result.noEffect).toBe(decision === "denied" ? true : undefined);
    expect(await approvalRow(ctx.waits[0]?.approvalId ?? "")).toMatchObject({ status: "expired", default_on_timeout: operatorDefault });
  });

  it("o modelo não escolhe o padrão: um argumento pedindo aprovar não muda o negar do operador", async () => {
    const { ctx, fake, get } = await setup("mcp aprov modelo", nobodyAnswers, "denied");
    const result = await runTool(get("erp__agendar"), { pedido: "1234", default_on_timeout: "approved", defaultOnTimeout: "approved" }, ctx);

    expect(result).toMatchObject({ ok: false, noEffect: true, data: { decision: "denied" } });
    expect(calls(fake)).toBe(0);
  });

  it("negar não gasta o teto: depois de negadas além do teto, as aprovadas ainda chegam ao servidor", async () => {
    let decision: "approved" | "denied" = "denied";
    const { ctx, fake, get } = await setup("mcp aprov teto", (approvalId, current) => humanDecides(decision)(approvalId, current));
    for (let i = 0; i < MAX_MCP_WRITES_PER_CALL + 1; i += 1) expect(await runTool(get("erp__abrir_chamado"), { pedido: String(i) }, ctx)).toMatchObject({ noEffect: true });
    decision = "approved";
    for (let i = 0; i < MAX_MCP_WRITES_PER_CALL; i += 1) expect(await runTool(get("erp__abrir_chamado"), { pedido: String(i) }, ctx)).toMatchObject({ ok: true });
    expect(calls(fake)).toBe(MAX_MCP_WRITES_PER_CALL);
  });

  it("vale também para a que só lê", async () => {
    const { ctx, fake, get } = await setup("mcp aprov leitura", humanDecides("denied"));
    expect(await runTool(get("erp__ver_estoque"), { pedido: "1" }, ctx)).toMatchObject({ ok: false, noEffect: true });
    expect(calls(fake)).toBe(0);
    expect(await lastResult(ctx)).toMatchObject({ budget: "mcp:erp:leitura" });
    expect(await lastResult(ctx)).not.toHaveProperty("spent");
  });

  it.each([
    ["en-US", "en"],
    ["es", "es"],
  ] as const)("a frase de espera sai no idioma do agente (%s)", async (language, spoken) => {
    const { ctx, get } = await setup(`mcp aprov idioma ${language}`, humanDecides("denied"), undefined, language);
    await runTool(get("erp__abrir_chamado"), { pedido: "1" }, ctx);
    expect(ctx.said).toEqual([MCP_APPROVAL_WAIT_LINES[spoken]]);
  });
});

describe("ferramenta MCP com aprovação desligada", () => {
  it("needsApproval: false não pergunta a ninguém e chama o servidor, como na 8a", async () => {
    // Sem `onWait`, o contexto falso lança se alguém esperar aprovação.
    const { ctx, fake, get } = await setup("mcp sem aprov", undefined, "denied");
    const result = await runTool(get("erp__consultar_pedido"), { pedido: "1234" }, ctx);

    expect(result).toMatchObject({ ok: true, data: { text: "Chamado 77 aberto" } });
    expect(calls(fake)).toBe(1);
    expect(ctx.waits).toHaveLength(0);
    expect(ctx.said).toEqual([]);
    expect((await eventsOf(app, ctx.callId)).some((event) => event.kind === "approval_requested")).toBe(false);
  });
});
