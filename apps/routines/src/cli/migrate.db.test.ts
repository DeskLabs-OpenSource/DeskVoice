import { randomUUID } from "node:crypto";
import { createDb, withSystem } from "@deskvoice/core";
import { afterAll, describe, expect, it } from "vitest";
import { openOwnerDb, setRolePassword } from "./migrate";

const ownerUrl = process.env.TEST_MIGRATION_DATABASE_URL ?? "";
const owner = openOwnerDb(ownerUrl);
const role = `dv_test_${randomUUID().replaceAll("-", "")}`;

afterAll(async () => {
  await withSystem(owner, (q) => q.exec(`drop role if exists ${role}`));
  await owner.close();
});

describe("setRolePassword", () => {
  it("define a senha do papel, mesmo com aspas e barras, e a senha passa a valer", async () => {
    await withSystem(owner, (q) => q.exec(`create role ${role} login`));
    const password = `it's "quoted" \\ $1 ; drop role ${role}; --`;
    await setRolePassword(owner, role, password);

    const url = new URL(ownerUrl);
    url.username = role;
    url.password = encodeURIComponent(password);
    const asRole = createDb(url.toString(), url.toString());
    try {
      expect(await withSystem(asRole, (q) => q.one("select current_user as who"))).toEqual({ who: role });
    } finally {
      await asRole.close();
    }
  });

  it("papel inexistente é erro, não silêncio", async () => {
    await expect(setRolePassword(owner, "no_such_role_here", "x")).rejects.toThrow(/does not exist/);
  });
});
