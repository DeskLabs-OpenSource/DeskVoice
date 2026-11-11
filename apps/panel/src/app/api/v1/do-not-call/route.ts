import { toE164 } from "@deskvoice/core";
import { z } from "zod";
import { ApiError, handle, notFound } from "../../../../server/context";
import { phone } from "../../../../server/shapes";

export const GET = handle({}, ({ q }) => q.many(`select e164, reason, created_at as "createdAt" from do_not_call order by created_at desc, e164`));

const add = z.object({ numbers: z.array(z.string()).min(1).max(500), reason: z.string().trim().max(200).nullable().optional() });

// Vários de uma vez (colados da planilha). Um inválido reprova o lote inteiro e a resposta diz
// quais: melhor que gravar metade e deixar a pessoa achando que todos estão protegidos.
export const POST = handle({ body: add, configure: true }, async ({ q, body }) => {
  const normalized = body.numbers.map((raw) => ({ raw, e164: toE164(raw) }));
  const invalid = normalized.filter((entry) => entry.e164 === null).map((entry) => entry.raw);
  if (invalid.length > 0) throw new ApiError(400, "invalid_numbers", invalid.join(", "));
  const added = await q.exec(
    `insert into do_not_call (organization_id, e164, reason) select $1, unnest($2::text[]), $3 on conflict do nothing`,
    [q.organizationId, [...new Set(normalized.map((entry) => entry.e164))], body.reason || null],
  );
  return { added };
});

export const DELETE = handle({ body: z.object({ number: phone }), configure: true }, async ({ q, body }) => {
  if ((await q.exec("delete from do_not_call where e164 = $1", [body.number])) === 0) throw notFound();
  return null;
});
