// As ferramentas MCP na sessão (Vapi · item 8 · fatia 8a2, seção 5.4 de
// docs/specs/2026-11-22-ferramentas-de-fora-mcp.md): o `enabledToolsFor` junta às da pasta as MCP da
// organização da ligação que o operador marcou no servidor e no agente, pelo nome
// `<servidor>__<ferramenta>`. A que mudou depois da marca fica fora até nova marca.
import { defineTool, mcpToolFingerprint, type McpToolSnapshot, type RegisteredMcpServer, type Tool } from "@deskvoice/tools";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { tool } from "../../../packages/tools/test/mcp-server";
import type { Logger } from "./log";
import { enabledToolsFor, sessionConfig, type SessionAgent } from "./session-config";

const snapshot = (name: string, extra: Partial<McpToolSnapshot> = {}): McpToolSnapshot => {
  const base = tool(name);
  return { name, description: base.description, inputSchema: base.inputSchema, fingerprint: mcpToolFingerprint(base), allowed: true, writes: false, needsApproval: false, supported: true, ...extra };
};

const server = (slug: string, tools: McpToolSnapshot[]): RegisteredMcpServer => ({
  slug,
  label: `Servidor ${slug}`,
  url: `https://${slug}.example.com/mcp`,
  fetchedAt: "2030-05-10T12:00:00.000Z",
  tools,
});

const endCall = defineTool<Record<string, never>>({
  name: "end_call",
  description: "Encerra a ligação.",
  inputSchema: z.object({}),
  async run() {
    return { ok: true, message: "ok" };
  },
});
const installed = new Map<string, Tool>([["end_call", endCall as Tool]]);

const AGENT: SessionAgent = { voice_id: null, language: "pt-BR", vocabulary: [], listening_environment: "normal" };

function enabled(names: string[], mcpServers: readonly RegisteredMcpServer[]) {
  const logged: { message: string; fields?: Record<string, unknown> }[] = [];
  const log: Logger = (level, message, fields) => {
    if (level === "error") logged.push({ message, fields });
  };
  const tools = enabledToolsFor({ installed, names, targets: [], canTransfer: true, returned: false, mcpServers, log });
  // O que o motor recebe: as especificações da configuração da sessão.
  const engine = sessionConfig(AGENT, "Você é a Lia.", undefined, tools).tools.map((spec) => spec.name);
  return { tools, engine, logged };
}

describe("enabledToolsFor com as ferramentas MCP", () => {
  it("a ferramenta MCP marcada no servidor e no agente vai ao motor, com o nome <servidor>__<ferramenta>", () => {
    const { engine, tools } = enabled(["end_call", "erp__consultar_pedido"], [server("erp", [snapshot("consultar_pedido")])]);
    expect(engine).toEqual(["end_call", "erp__consultar_pedido"]);
    expect(tools.get("erp__consultar_pedido")?.description).toBe('Ferramenta externa "Servidor erp" (não é do DeskVoice). Descrição de consultar_pedido');
  });

  it("a marcada no servidor mas não no agente fica fora", () => {
    const { engine } = enabled(["end_call"], [server("erp", [snapshot("consultar_pedido")])]);
    expect(engine).toEqual(["end_call"]);
  });

  it("a marcada no agente mas não no servidor (allowed: false) fica fora, com o log de sempre", () => {
    const { engine, logged } = enabled(["end_call", "erp__consultar_pedido"], [server("erp", [snapshot("consultar_pedido", { allowed: false })])]);
    expect(engine).toEqual(["end_call"]);
    expect(logged).toEqual([{ message: "agent enables a tool that is not installed; ignoring it", fields: { tool: "erp__consultar_pedido" } }]);
  });

  it("a supported: false fica fora, mesmo marcada no agente", () => {
    // O retrato gravado por fora da tela não passa no `loadMcpServers` com `allowed: true` e
    // `supported: false`; aqui a lista chega pronta, e a sessão confere de novo.
    const { engine } = enabled(["end_call", "erp__consultar_pedido"], [server("erp", [snapshot("consultar_pedido", { supported: false })])]);
    expect(engine).toEqual(["end_call"]);
  });

  it("a de outra organização fica fora: só contam os servidores da organização da ligação", () => {
    // A organização B tem o servidor `crm` com a ferramenta marcada; a ligação é da A, que só tem o
    // `erp`. O nome `crm__abrir_chamado` marcado no agente da A não acha ferramenta.
    const orgB = [server("crm", [snapshot("abrir_chamado")])];
    const orgA = [server("erp", [snapshot("consultar_pedido")])];
    expect(enabled(["crm__abrir_chamado"], orgB).engine).toEqual(["crm__abrir_chamado"]);
    const { engine, logged } = enabled(["erp__consultar_pedido", "crm__abrir_chamado"], orgA);
    expect(engine).toEqual(["erp__consultar_pedido"]);
    expect(logged.map((line) => line.fields?.tool)).toEqual(["crm__abrir_chamado"]);
  });

  it("sem servidores, a sessão recebe o mesmo de antes", () => {
    const before = enabledToolsFor({ installed, names: ["end_call", "erp__consultar_pedido"], targets: [], canTransfer: true, returned: false, log: () => undefined });
    expect([...before.keys()]).toEqual(["end_call"]);
  });

  describe("esquema mudado no servidor depois da marca", () => {
    const changed = (extra: Partial<McpToolSnapshot>) => snapshot("consultar_pedido", { ...extra, fingerprint: mcpToolFingerprint(tool("consultar_pedido")) });

    it.each([
      ["o esquema", { inputSchema: { type: "object", properties: { pedido: { type: "integer" } }, required: ["pedido"] } }],
      ["a descrição", { description: "Apaga o pedido." }],
    ])("%s difere do que foi marcado: a ferramenta fica fora, com log", (_what, extra) => {
      const { engine, logged } = enabled(["end_call", "erp__consultar_pedido"], [server("erp", [changed(extra)])]);
      expect(engine).toEqual(["end_call"]);
      expect(logged[0]).toEqual({ message: "MCP tool changed since the operator marked it; ignoring it", fields: { server: "erp", tool: "consultar_pedido" } });
    });

    it("marcada de novo (a impressão digital do retrato novo), volta ao motor", () => {
      const inputSchema = { type: "object", properties: { pedido: { type: "integer" } }, required: ["pedido"] };
      const remarked = snapshot("consultar_pedido", { inputSchema, fingerprint: mcpToolFingerprint({ ...tool("consultar_pedido"), inputSchema }) });
      expect(enabled(["erp__consultar_pedido"], [server("erp", [remarked])]).engine).toEqual(["erp__consultar_pedido"]);
    });
  });
});
