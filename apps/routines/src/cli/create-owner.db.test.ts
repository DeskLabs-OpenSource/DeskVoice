import { randomUUID } from "node:crypto";
import { FOUNDING_ORGANIZATION_KEY, findLoginAccount, isInstallationAdmin, organizationLimits, verifyPassword, withOrg, withSystem } from "@deskvoice/core";
import { afterAll, describe, expect, it } from "vitest";
import { clearInstallationState, openTestDbs, tasksOf } from "../../test/helpers";
import { createOwner } from "./create-owner";

const { app, owner } = openTestDbs();
afterAll(async () => {
  await clearInstallationState(owner);
  await app.close();
  await owner.close();
});

const input = () => ({ email: `dono-${randomUUID()}@example.com`, name: "Rafa", organization: "Clínica Aurora", password: "senha-bem-longa" });
const countUsers = async (email: string): Promise<number> => (await withSystem(app, (q) => q.many("select 1 from users where email = $1", [email]))).length;

describe("createOwner", () => {
  it("cria organização, dono, política de saída desligada e o agente de exemplo com as ferramentas da fundação", async () => {
    const data = input();
    const result = await createOwner(app, data);
    if (!result.created) throw new Error("expected the owner to be created");

    const row = await withSystem(app, (q) =>
      q.one<Record<string, unknown>>(
        `select o.name as organization, u.id as user_id, u.name, u.role, u.kind, acc.email::text as account_email, acc.password_hash, acc.installation_admin_at, p.enabled as outbound_enabled,
                a.id as agent_id, a.name as agent, a.engine, a.language, a.greeting, a.instructions, a.tools, a.enabled as agent_enabled
           from organizations o
           join users u on u.organization_id = o.id
           join accounts acc on acc.id = u.account_id
           join outbound_policy p on p.organization_id = o.id
           join agents a on a.organization_id = o.id
          where o.id = $1`,
        [result.organizationId],
      ),
    );
    expect(row).toMatchObject({
      organization: "Clínica Aurora",
      user_id: result.userId,
      name: "Rafa",
      role: "owner",
      kind: "member",
      account_email: data.email,
      // A marca fica nula: quem administra é a regra da fundadora (seção 3.2), e não uma marca dada aqui.
      installation_admin_at: null,
      outbound_enabled: false,
      agent_id: result.agentId,
      agent: "Recepção",
      engine: "simulated",
      language: "pt-BR",
      agent_enabled: true,
      tools: ["call_webhook", "create_task", "end_call", "notify_human", "request_approval", "send_dtmf", "send_whatsapp", "stop_recording", "transfer_to_human"],
    });
    expect(row?.greeting).toMatch(/Olá/);
    expect(row?.instructions).toMatch(/português do Brasil/);
    expect(row?.password_hash).not.toContain(data.password);
    expect(await verifyPassword(data.password, String(row?.password_hash))).toBe(true);
    // Organização nova não nasce com tarefa nenhuma: não existe mais rotina recorrente.
    expect(await tasksOf(app, result.organizationId)).toEqual([]);
  });

  it("é idempotente: e-mail já cadastrado não cria nada, nem com outra caixa de letras", async () => {
    const data = input();
    await createOwner(app, data);
    const organizationsBefore = (await withSystem(app, (q) => q.many("select 1 from organizations"))).length;

    expect(await createOwner(app, { ...data, organization: "Outra", email: data.email.toUpperCase() })).toEqual({ created: false, reason: "email_exists" });
    expect(await countUsers(data.email)).toBe(1);
    expect((await withSystem(app, (q) => q.many("select 1 from organizations"))).length).toBe(organizationsBefore);
  });

  it("recusa senha com menos de 10 caracteres, sem criar nada", async () => {
    const data = { ...input(), password: "123456789" };
    await expect(createOwner(app, data)).rejects.toThrow(/pelo menos 10 caracteres/);
    expect(await countUsers(data.email)).toBe(0);
    expect((await createOwner(app, { ...data, password: "1234567890" })).created).toBe(true);
  });

  it("garante que a instalação tem fundadora, e uma organização criada depois não muda quem administra", async () => {
    const founding = (): Promise<unknown> => withSystem(app, async (q) => (await q.one<{ value: unknown }>("select value from installation_settings where key = $1", [FOUNDING_ORGANIZATION_KEY]))?.value);
    const first = input();
    const created = await createOwner(app, first);
    if (!created.created) throw new Error("expected the owner to be created");
    // Num banco sem fundadora, é esta; se outro arquivo já criou uma, ela fica (o teste de
    // `recordFoundingOrganization`, em packages/core, prova as duas pontas).
    const before = await founding();
    expect(typeof before).toBe("string");

    const second = input();
    const again = await createOwner(app, second);
    if (!again.created) throw new Error("expected the owner to be created");
    expect(await founding()).toBe(before);
    const administers = async (email: string): Promise<boolean> => isInstallationAdmin(app, (await findLoginAccount(app, email))?.accountId ?? "");
    expect(await administers(second.email)).toBe(false);
  });

  it("recusa e-mail inválido", async () => {
    await expect(createOwner(app, { ...input(), email: "sem-arroba" })).rejects.toThrow(/e-mail inválido/);
  });
});

// Convenção 14 e seção 3.5 do desenho do R8: toda organização nasce com a saída travada pela
// administração, venha da tela (`addOrganization`) ou do instalador. Antes, a do instalador nascia sem
// linha de limites, e organização sem linha é organização que pode ligar para fora (revisão fria da
// 0.50.0, item 8).
describe("createOwner: a organização nasce pelo mesmo caminho da tela", () => {
  type Born = { maxTrunks: number | null; maxAgents: number | null; monthlySpendCapCents: number | null; outboundAllowed: boolean; policyEnabled: boolean; timezone: string; language: string | null };
  const born = async (organizationId: string): Promise<Born | null> =>
    withSystem(app, (q) =>
      q.one<Born & Record<string, unknown>>(
        `select l.max_trunks as "maxTrunks", l.max_agents as "maxAgents", l.monthly_spend_cap_cents as "monthlySpendCapCents", l.outbound_allowed as "outboundAllowed",
                p.enabled as "policyEnabled", p.timezone, o.language
           from organizations o
           join organization_limits l on l.organization_id = o.id
           join outbound_policy p on p.organization_id = o.id
          where o.id = $1`,
        [organizationId],
      ),
    );
  const setting = (key: string, value: unknown): Promise<void> =>
    withSystem(app, async (q) => {
      await q.exec("insert into installation_settings (key, value) values ($1, $2) on conflict (key) do update set value = excluded.value", [key, JSON.stringify(value)]);
    });

  it("numa instalação nova, sem padrão gravado, nasce sem limite e com a saída travada", async () => {
    await clearInstallationState(owner);
    const created = await createOwner(app, input());
    if (!created.created) throw new Error("expected the owner to be created");

    expect(await born(created.organizationId)).toEqual({
      maxTrunks: null,
      maxAgents: null,
      monthlySpendCapCents: null,
      outboundAllowed: false,
      policyEnabled: false,
      timezone: "America/Sao_Paulo",
      language: null,
    });
    // A mesma leitura de `checkOutboundAllowed` e da rota da política: a trava vale pela organização.
    expect((await withOrg(app, created.organizationId, (q) => organizationLimits(q))).outboundAllowed).toBe(false);
  });

  it("com padrões gravados, copia os limites, o fuso e o idioma, e liberar a saída não a liga", async () => {
    await clearInstallationState(owner);
    await setting("defaults.limits", { maxTrunks: 2, maxAgents: 5, monthlySpendCapCents: 12_345, outboundAllowed: true });
    await setting("defaults.timezone", "America/Manaus");
    await setting("defaults.language", "es");
    const created = await createOwner(app, input());
    if (!created.created) throw new Error("expected the owner to be created");

    expect(await born(created.organizationId)).toEqual({
      maxTrunks: 2,
      maxAgents: 5,
      monthlySpendCapCents: 12_345,
      outboundAllowed: true,
      policyEnabled: false,
      timezone: "America/Manaus",
      language: "es",
    });
    await clearInstallationState(owner);
  });
});
