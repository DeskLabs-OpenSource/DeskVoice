// O idioma com que uma organização nova nasce (R8, seção 3.5, fatia 8a; forma A da DESA-208):
// `defaults.language` em `installation_settings`, COPIADO para `organizations.language` da nova na
// criação. É essa coluna, que chega à tela por `GET /auth/me`, que o agente novo e o menu novo
// propõem (`proposedLanguage`). Sem padrão, a coluna fica nula e os formulários propõem pt-BR, como
// sempre. A fundadora e as que já existem não mudam, nem quando o padrão muda.
import { randomUUID } from "node:crypto";
import { withSystem } from "@deskvoice/core";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { clearInstallationState as clear, openTestDbs } from "../../../../../../packages/core/test/helpers";
import { NOW, call, createOrganization, createUser, startPanel } from "../../../../test/kit";
import { proposedLanguage } from "../../../ui/proposed-language";
import { GET as me } from "./auth/me/route";
import { GET as readDefaults, PUT as writeDefaults } from "./installation/defaults/organization/route";
import { GET as listOrganizations, POST as addOrganization } from "./installation/organizations/route";

const panel = startPanel();
const { owner } = openTestDbs();

const clearInstallationState = (): Promise<void> => clear(owner);
beforeEach(clearInstallationState);
afterAll(async () => {
  await clearInstallationState();
  await owner.close();
  await panel.close();
});

const FOUNDING_KEY = "installation.founding_organization_id";

const accountOf = async (userId: string): Promise<string> =>
  (await withSystem(panel.app, (q) => q.one<{ id: string }>("select account_id as id from users where id = $1", [userId])))?.id ?? "";
const system = <T>(sql: string, params: unknown[] = []): Promise<T[]> => withSystem(panel.app, (q) => q.many<T & Record<string, unknown>>(sql, params));
/** O idioma gravado na organização. */
const languageOf = async (org: string): Promise<string | null> => (await system<{ language: string | null }>("select language from organizations where id = $1", [org]))[0]?.language ?? null;
const storedDefault = async (): Promise<unknown[]> => (await system<{ value: unknown }>("select value from installation_settings where key = 'defaults.language'")).map((row) => row.value);

/** O que o formulário de agente novo (e o de menu novo) propõe a uma pessoa da organização: o `/auth/me` dela pela `proposedLanguage`. */
async function proposedFor(org: string): Promise<string> {
  const person = await createUser(panel.app, org, "owner");
  const response = await call(me, { cookie: person.cookie });
  expect(response.status).toBe(200);
  return proposedLanguage((response.data as { organizationLanguage?: unknown }).organizationLanguage);
}

/** A fundadora, com uma pessoa dona que administra a instalação, e outra organização que já existe. */
async function scene() {
  const founding = await createOrganization(panel.app, `Fundadora ${randomUUID().slice(0, 8)}`);
  await system("insert into installation_settings (key, value) values ($1, to_jsonb($2::text)) returning key", [FOUNDING_KEY, founding]);
  const admin = await createUser(panel.app, founding, "owner");
  await withSystem(panel.app, async (q) => q.exec("update accounts set installation_admin_at = now() where id = $1", [await accountOf(admin.id)]));
  const existing = await createOrganization(panel.app, `Já existe ${randomUUID().slice(0, 8)}`);
  /** Cria pela área da instalação, confirmando a lista que a tela mostraria. */
  const create = async (name = `Nova ${randomUUID().slice(0, 8)}`): Promise<string> => {
    const { creation } = (await call(listOrganizations, { cookie: admin.cookie })).data as { creation: { granted: { accountId: string }[]; losing: { accountId: string }[] } };
    const shown = { granted: creation.granted.map((p) => p.accountId), losing: creation.losing.map((p) => p.accountId) };
    const created = await call(addOrganization, { method: "POST", cookie: admin.cookie, body: { name, shown, keep: [] } });
    expect(created.status).toBe(200);
    return (created.data as { organizationId: string }).organizationId;
  };
  const setDefault = (body: Record<string, unknown>) => call(writeDefaults, { method: "PUT", cookie: admin.cookie, body });
  return { founding, admin, existing, create, setDefault };
}

describe("the language a new organization starts with", () => {
  it("I1: with the default 'es', the new one stores 'es' and its new-agent form proposes 'es'", async () => {
    const s = await scene();
    expect(await s.setDefault({ language: "es" })).toMatchObject({ status: 200, data: { timezone: null, language: "es" } });
    expect((await call(readDefaults, { cookie: s.admin.cookie })).data).toEqual({ timezone: null, language: "es" });
    const org = await s.create();
    expect(await languageOf(org)).toBe("es");
    expect(await proposedFor(org)).toBe("es");
  });

  it("I2: changing the default later does not change the one that already exists, nor the founding or existing ones", async () => {
    const s = await scene();
    await s.setDefault({ language: "es" });
    const org = await s.create();
    await s.setDefault({ language: "en" });
    expect(await languageOf(org)).toBe("es");
    expect(await proposedFor(org)).toBe("es");
    const next = await s.create();
    expect(await languageOf(next)).toBe("en");
    expect(await proposedFor(next)).toBe("en");

    await s.setDefault({ language: null });
    expect(await languageOf(org)).toBe("es");
    expect(await languageOf(next)).toBe("en");
    // A fundadora e a que já existia antes de qualquer padrão seguem sem idioma, propondo pt-BR.
    for (const old of [s.founding, s.existing]) {
      expect(await languageOf(old)).toBeNull();
      expect(await proposedFor(old)).toBe("pt-BR");
    }
  });

  it("I3: without a default, the new one stores null and its form proposes pt-BR, as today, and nothing is stored", async () => {
    const s = await scene();
    expect((await call(readDefaults, { cookie: s.admin.cookie })).data).toEqual({ timezone: null, language: null });
    const org = await s.create();
    expect(await languageOf(org)).toBeNull();
    expect(await proposedFor(org)).toBe("pt-BR");
    // Tirar o padrão depois de ter um: a próxima volta a nascer nula.
    await s.setDefault({ language: "en" });
    await s.setDefault({ language: null });
    expect(await languageOf(await s.create())).toBeNull();
  });

  it("I4: a language outside the list is refused with 400, and a valid time zone in the same request is not stored either", async () => {
    const s = await scene();
    for (const body of [{ language: "fr" }, { language: "pt" }, { language: "pt-br" }, { language: "" }, { language: 3 }, { timezone: "Asia/Tokyo", language: "de" }]) {
      expect(await s.setDefault(body)).toMatchObject({ status: 400, code: "validation_error" });
    }
    expect(await storedDefault()).toEqual([]);
    expect((await call(readDefaults, { cookie: s.admin.cookie })).data).toEqual({ timezone: null, language: null });
  });

  it("the column refuses a language outside the list, even written by hand", async () => {
    const s = await scene();
    await expect(system("update organizations set language = 'fr' where id = $1 returning id", [s.existing])).rejects.toThrow(/check/i);
  });

  it("the time zone and the language go in one request, each with its own installation_setting_changed, and an absent field stays as it is", async () => {
    const s = await scene();
    expect(await s.setDefault({ timezone: "Asia/Tokyo", language: "en" })).toMatchObject({ status: 200, data: { timezone: "Asia/Tokyo", language: "en" } });
    expect(await s.setDefault({ language: "es" })).toMatchObject({ status: 200, data: { timezone: "Asia/Tokyo", language: "es" } });
    expect(await s.setDefault({ timezone: "Asia/Tokyo", language: "es" })).toMatchObject({ status: 200 });
    const events = await system<{ actor: string; organization: string | null; payload: unknown }>(
      "select actor_account_id as actor, organization_id as organization, payload from installation_events where kind = 'installation_setting_changed' and payload->>'key' in ('defaults.timezone', 'defaults.language') and at = $1 order by id",
      [NOW],
    );
    const actor = await accountOf(s.admin.id);
    expect(events.slice(-3)).toEqual([
      { actor, organization: null, payload: { key: "defaults.timezone", before: null, after: "Asia/Tokyo" } },
      { actor, organization: null, payload: { key: "defaults.language", before: null, after: "en" } },
      { actor, organization: null, payload: { key: "defaults.language", before: "en", after: "es" } },
    ]);
  });

  it("a key written by hand with something outside the list counts as no default", async () => {
    const s = await scene();
    await system("insert into installation_settings (key, value) values ('defaults.language', to_jsonb('fr'::text)) returning key");
    expect((await call(readDefaults, { cookie: s.admin.cookie })).data).toEqual({ timezone: null, language: null });
    expect(await languageOf(await s.create())).toBeNull();
  });

  it("only who administers the installation changes the default", async () => {
    const s = await scene();
    const other = await createUser(panel.app, s.existing, "owner");
    expect(await call(writeDefaults, { method: "PUT", cookie: other.cookie, body: { language: "es" } })).toMatchObject({ status: 403, code: "forbidden" });
    expect(await storedDefault()).toEqual([]);
  });
});
