import { randomUUID } from "node:crypto";
import { hashToken, verifyPassword, withSystem } from "@deskvoice/core";
import { afterAll, describe, expect, it } from "vitest";
import { openTestDbs, t0 } from "../../test/helpers";
import { createOwner } from "./create-owner";
import { resetPassword } from "./reset-password";

const { app, owner } = openTestDbs();
afterAll(async () => {
  await app.close();
  await owner.close();
});

async function newOwner(): Promise<{ email: string; userId: string; organizationId: string }> {
  const email = `dono-${randomUUID()}@example.com`;
  const result = await createOwner(app, { email, name: "Rafa", organization: "Clínica Aurora", password: "senha-antiga-longa" });
  if (!result.created) throw new Error("expected the owner to be created");
  return { email, userId: result.userId, organizationId: result.organizationId };
}

const passwordHashOf = async (userId: string): Promise<string> => {
  const row = await withSystem(app, (q) => q.one<{ password_hash: string }>("select password_hash from users where id = $1", [userId]));
  if (!row) throw new Error("user not found");
  return row.password_hash;
};

const sessionsOf = async (userId: string): Promise<number> =>
  (await withSystem(app, (q) => q.many("select 1 from sessions where user_id = $1", [userId]))).length;

describe("resetPassword", () => {
  it("troca a senha e encerra as sessões abertas do usuário", async () => {
    const user = await newOwner();
    await withSystem(app, (q) =>
      q.exec("insert into sessions (organization_id, user_id, token_hash, expires_at) values ($1, $2, $3, $4)", [
        user.organizationId,
        user.userId,
        hashToken(randomUUID()),
        new Date(t0.getTime() + 86_400_000),
      ]),
    );

    const result = await resetPassword(app, { email: user.email, password: "senha-nova-bem-longa" });

    expect(result).toEqual({ changed: true, sessionsClosed: 1 });
    const stored = await passwordHashOf(user.userId);
    expect(await verifyPassword("senha-nova-bem-longa", stored)).toBe(true);
    expect(await verifyPassword("senha-antiga-longa", stored)).toBe(false);
    expect(await sessionsOf(user.userId)).toBe(0);
  });

  it("não altera nada quando o e-mail não existe", async () => {
    const result = await resetPassword(app, { email: `ninguem-${randomUUID()}@example.com`, password: "senha-nova-bem-longa" });
    expect(result).toEqual({ changed: false, reason: "email_not_found" });
  });

  it("recusa senha curta sem tocar na senha atual", async () => {
    const user = await newOwner();
    const before = await passwordHashOf(user.userId);
    await expect(resetPassword(app, { email: user.email, password: "curta" })).rejects.toThrow(/pelo menos 10 caracteres/);
    expect(await passwordHashOf(user.userId)).toBe(before);
  });

  it("não mexe na senha nem nas sessões de outro usuário", async () => {
    const target = await newOwner();
    const other = await newOwner();
    const otherBefore = await passwordHashOf(other.userId);
    await withSystem(app, (q) =>
      q.exec("insert into sessions (organization_id, user_id, token_hash, expires_at) values ($1, $2, $3, $4)", [
        other.organizationId,
        other.userId,
        hashToken(randomUUID()),
        new Date(t0.getTime() + 86_400_000),
      ]),
    );

    await resetPassword(app, { email: target.email, password: "senha-nova-bem-longa" });

    expect(await passwordHashOf(other.userId)).toBe(otherBefore);
    expect(await sessionsOf(other.userId)).toBe(1);
  });
});
