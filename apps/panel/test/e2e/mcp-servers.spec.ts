import { expect, test, type Page, type Route } from "@playwright/test";
import agents from "../../src/i18n/pt-BR/agents";
import common from "../../src/i18n/pt-BR/common";
import { fill } from "../../src/i18n/locales";
import mcp from "../../src/i18n/pt-BR/mcp";
import { signIn, unique } from "./session";

// Servidores de ferramentas (MCP) em Configurações → Integrações, e as caixas deles na tela do agente
// (item 8, fatia 8b, spec 2026-11-22 seção 5.6).
//
// O servidor MCP é falso, e fica na frente das rotas `mcp-servers/**` do navegador: a instalação de
// verdade não alcança um servidor de teste local, porque a `safeFetch` recusa endereço que não é
// público (e essa guarda não se afrouxa para o teste). A busca no servidor, a impressão digital e o
// segredo têm prova nas rotas, em `mcp-servers.db.test.ts`. Aqui a prova é a tela: descobrir,
// marcar, salvar e ver as caixas no agente, que grava de verdade.

const fingerprint = (seed: string): string => seed.repeat(64).slice(0, 64);
const LOOKUP = {
  omitted: 0,
  incomplete: false,
  tools: [
    { name: "consultar_pedido", description: "Consulta um pedido pelo número", inputSchema: { type: "object" }, fingerprint: fingerprint("a"), supported: true, readOnlyHint: true },
    { name: "cancelar_pedido", description: "Cancela um pedido", inputSchema: { type: "object" }, fingerprint: fingerprint("b"), supported: true },
    { name: "estranha", description: "Campos que o DeskVoice não entende", inputSchema: { type: "object" }, fingerprint: fingerprint("c"), supported: false },
  ],
};

interface SavedBody {
  label: string;
  url: string;
  secret?: string;
  tools: Array<{ name: string; fingerprint: string; allowed: boolean; writes: boolean }>;
}

/** O servidor falso: a descoberta devolve o retrato, e o `PUT` guarda o que a tela mandou. */
async function fakeServer(page: Page, slug: string) {
  const state: { saved: SavedBody | null; discovered: unknown[] } = { saved: null, discovered: [] };
  const ok = (route: Route, data: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, data }) });
  const view = (body: SavedBody) => ({
    slug,
    label: body.label,
    url: body.url,
    headerName: "Authorization",
    secret: { configured: body.secret !== undefined },
    timeoutSeconds: 10,
    fetchedAt: "2026-11-23T12:00:00.000Z",
    tools: LOOKUP.tools.map((tool) => {
      const mark = body.tools.find((item) => item.name === tool.name);
      return { ...tool, allowed: mark?.allowed === true, writes: mark?.writes ?? true, needsApproval: false };
    }),
    agents: [],
  });
  await page.route("**/api/v1/mcp-servers", (route) => (route.request().method() === "GET" ? ok(route, state.saved ? [view(state.saved)] : []) : route.fallback()));
  await page.route("**/api/v1/mcp-servers/discover", (route) => {
    state.discovered.push(route.request().postDataJSON());
    return ok(route, LOOKUP);
  });
  await page.route(`**/api/v1/mcp-servers/${slug}`, (route) => {
    if (route.request().method() !== "PUT") return route.fallback();
    state.saved = route.request().postDataJSON() as SavedBody;
    return ok(route, view(state.saved));
  });
  return state;
}

test("MCP: a dona descobre as ferramentas, marca, salva, e o agente vê as caixas desmarcadas, agrupadas pelo servidor", async ({ page }) => {
  await signIn(page);
  const suffix = unique();
  const slug = `erp${suffix.replace(/[^a-z0-9]/g, "").slice(0, 6)}`;
  const label = `ERP ${suffix}`;
  const server = await fakeServer(page, slug);

  await page.goto("/settings/integrations");
  const section = page.getByTestId("mcp-servers");
  await expect(page.getByRole("heading", { name: mcp.title, exact: true })).toBeVisible();
  await expect(section.getByText(mcp.empty, { exact: true })).toBeVisible();
  await section.getByRole("button", { name: mcp.add, exact: true }).click();
  await section.getByLabel(mcp.slug).fill(slug);
  await section.getByLabel(mcp.label, { exact: true }).fill(label);
  await section.getByLabel(mcp.url).fill("https://mcp.example.com/mcp");
  await section.getByLabel(mcp.secret, { exact: true }).fill("Bearer s3cret");
  await section.getByRole("button", { name: mcp.look, exact: true }).click();
  expect(server.discovered).toEqual([{ url: "https://mcp.example.com/mcp", headerName: "Authorization", secret: "Bearer s3cret", timeoutSeconds: 10, slug }]);

  // Nada vem liberado; "escreve" vem marcado; a dica do servidor só aparece como dica.
  const consult = section.getByTestId("mcp-tool-consultar_pedido");
  await expect(consult.getByRole("checkbox", { name: mcp.allowed })).not.toBeChecked();
  await expect(consult.getByRole("checkbox", { name: mcp.writes })).toBeChecked();
  await expect(consult.getByText(mcp.readOnlyHint)).toBeVisible();
  // A ferramenta fora do subconjunto não tem caixa para marcar.
  const weird = section.getByTestId("mcp-tool-estranha");
  await expect(weird.getByText(mcp.unsupported)).toBeVisible();
  await expect(weird.getByRole("checkbox")).toHaveCount(0);

  await consult.getByRole("checkbox", { name: mcp.allowed }).check();
  await consult.getByRole("checkbox", { name: mcp.writes }).uncheck();
  await section.getByTestId("mcp-tool-cancelar_pedido").getByRole("checkbox", { name: mcp.allowed }).check();
  await section.getByRole("button", { name: mcp.save, exact: true }).click();
  await expect(section.getByText(label, { exact: true })).toBeVisible();
  expect(server.saved?.tools).toEqual([
    { name: "consultar_pedido", fingerprint: fingerprint("a"), allowed: true, writes: false },
    { name: "cancelar_pedido", fingerprint: fingerprint("b"), allowed: true, writes: true },
    { name: "estranha", fingerprint: fingerprint("c"), allowed: false, writes: true },
  ]);

  // A tela do agente: as duas liberadas, sob o nome do servidor, nenhuma marcada.
  const created = await page.request.post("/api/v1/agents", { data: { engine: "simulated", name: `Recepção ${suffix}` } });
  expect(created.status()).toBe(200);
  const agentId = ((await created.json()) as { data: { id: string } }).data.id;
  await page.goto(`/agents/${agentId}`);
  await page.getByRole("tab", { name: agents.tabs.ferramentas }).click();
  const groupName = fill(mcp.agentGroup, { label });
  const group = page.getByRole("group", { name: groupName });
  await expect(group.getByRole("checkbox")).toHaveCount(2);
  for (const box of await group.getByRole("checkbox").all()) await expect(box).not.toBeChecked();
  await expect(group.getByText("estranha")).toHaveCount(0);

  // Marcar e salvar grava o nome `<slug>__<ferramenta>` no agente, de verdade.
  await group.getByRole("checkbox", { name: /consultar_pedido/ }).check();
  const patch = page.waitForRequest((request) => request.method() === "PATCH" && request.url().endsWith(`/api/v1/agents/${agentId}`));
  await page.getByRole("button", { name: common.actions.save, exact: true }).click();
  expect(((await patch).postDataJSON() as { tools: string[] }).tools).toContain(`${slug}__consultar_pedido`);
  await expect(page.getByRole("status").filter({ hasText: common.actions.saved })).toHaveText(common.actions.saved);
  await page.reload();
  await page.getByRole("tab", { name: agents.tabs.ferramentas }).click();
  await expect(page.getByRole("group", { name: groupName }).getByRole("checkbox", { name: /consultar_pedido/ })).toBeChecked();
  await expect(page.getByRole("group", { name: groupName }).getByRole("checkbox", { name: /cancelar_pedido/ })).not.toBeChecked();
});
