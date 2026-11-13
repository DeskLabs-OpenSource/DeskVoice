import { randomUUID } from "node:crypto";
import { verifyPassword, withSystem } from "@deskvoice/core";
import { afterAll, describe, expect, it } from "vitest";
import { openTestDbs, tasksOf } from "../../test/helpers";
import { createOwner } from "./create-owner";

const { app, owner } = openTestDbs();
afterAll(async () => {
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
        `select o.name as organization, u.id as user_id, u.name, u.role, u.password_hash, p.enabled as outbound_enabled,
                a.id as agent_id, a.name as agent, a.engine, a.language, a.greeting, a.instructions, a.tools, a.enabled as agent_enabled
           from organizations o
           join users u on u.organization_id = o.id
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

  it("recusa e-mail inválido", async () => {
    await expect(createOwner(app, { ...input(), email: "sem-arroba" })).rejects.toThrow(/e-mail inválido/);
  });
});
