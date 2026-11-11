import type { OrgQuery } from "@deskvoice/core";

/** Valor de uma configuração da organização da transação, ou `null` se não existir. */
export async function readSetting(q: OrgQuery, key: string): Promise<unknown> {
  const row = await q.one<{ value: unknown }>("select value from settings where organization_id = $1 and key = $2", [q.organizationId, key]);
  return row?.value ?? null;
}
