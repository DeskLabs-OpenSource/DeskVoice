import { encryptSecret, withOrg, withSystem } from "@deskvoice/core";
import { MCP_SERVERS_KEY } from "@deskvoice/tools";
import { afterAll, describe, expect, it } from "vitest";
import { call, createOrganization, createUser, startPanel } from "../../../../test/kit";
import { GET as getSetting, PUT as putSetting } from "./settings/[key]/route";

/**
 * Os servidores MCP moram em `settings`, mas fora do mapa genérico (fatia 8a): a rota genérica não
 * grava a lista nem devolve o segredo dela. As rotas próprias são da fatia 8b.
 */
const panel = startPanel();
afterAll(() => panel.close());

const refusal = (result: { status: number; code: string | undefined }) => [result.status, result.code];

describe("mcp.servers pela rota genérica de configurações", () => {
  it("não grava, não apaga e não devolve a lista nem o segredo", async () => {
    const org = await createOrganization(panel.app, "mcp generic route");
    const owner = await createUser(panel.app, org, "owner");
    const params = { key: MCP_SERVERS_KEY };

    expect(refusal(await call(putSetting, { method: "PUT", cookie: owner.cookie, params, body: { value: [] } }))).toEqual([400, "unknown_setting"]);
    expect(await withOrg(panel.app, org, (q) => q.many("select key from settings where key = $1", [MCP_SERVERS_KEY]))).toEqual([]);

    const stored = [{ slug: "erp", label: "ERP", url: "https://mcp.example.com/mcp", secret: encryptSecret("Bearer s3cret", panel.deps.secretKey), fetchedAt: "2030-05-10T12:00:00.000Z", tools: [] }];
    await withSystem(panel.app, (q) => q.exec("insert into settings (organization_id, key, value, secret) values ($1, $2, $3, true)", [org, MCP_SERVERS_KEY, JSON.stringify(stored)]));
    const read = await call(getSetting, { cookie: owner.cookie, params });
    expect(refusal(read)).toEqual([400, "unknown_setting"]);
    expect(JSON.stringify(read.data ?? null)).not.toContain(stored[0]?.secret);
    expect(refusal(await call(putSetting, { method: "PUT", cookie: owner.cookie, params, body: { value: null } }))).toEqual([400, "unknown_setting"]);
    expect(await withOrg(panel.app, org, (q) => q.many("select key from settings where key = $1", [MCP_SERVERS_KEY]))).toEqual([{ key: MCP_SERVERS_KEY }]);
  });
});
