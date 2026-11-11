import type { OrgQuery } from "@deskvoice/core";
import { z } from "zod";
import { ApiError, handle } from "../../../../server/context";

const COLUMNS = `enabled, purpose, legal_basis as "legalBasis", daily_cap_per_line as "dailyCapPerLine",
  to_char(window_start, 'HH24:MI') as "windowStart", to_char(window_end, 'HH24:MI') as "windowEnd",
  max_attempts_per_contact as "maxAttemptsPerContact", timezone`;

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "must be HH:MM");
const text = z.string().trim().max(2000).nullable();
const fields = z.object({
  enabled: z.boolean(),
  purpose: text,
  legalBasis: text,
  dailyCapPerLine: z.number().int().min(1).max(2000),
  windowStart: time,
  windowEnd: time,
  maxAttemptsPerContact: z.number().int().min(1).max(10),
  timezone: z.string().refine((zone) => Intl.supportedValuesOf("timeZone").includes(zone), "unknown time zone"),
});
type Policy = z.output<typeof fields>;

// Sem linha no banco, a política é a padrão: desligada.
const DEFAULTS: Policy = {
  enabled: false,
  purpose: null,
  legalBasis: null,
  dailyCapPerLine: 200,
  windowStart: "09:00",
  windowEnd: "20:00",
  maxAttemptsPerContact: 3,
  timezone: "America/Sao_Paulo",
};

const read = async (q: OrgQuery): Promise<Policy> => (await q.one<Policy>(`select ${COLUMNS} from outbound_policy`)) ?? DEFAULTS;

export const GET = handle({}, ({ q }) => read(q));

export const PUT = handle({ body: fields.partial(), configure: true }, async ({ q, body }) => {
  const next = { ...(await read(q)), ...body };
  if (next.enabled && (!next.purpose || !next.legalBasis)) {
    throw new ApiError(400, "purpose_required", "To turn outbound calls on, state the purpose and the legal basis.");
  }
  if (next.windowStart >= next.windowEnd) throw new ApiError(400, "validation_error", "windowEnd: must be later than windowStart");
  return q.one(
    `insert into outbound_policy (organization_id, enabled, purpose, legal_basis, daily_cap_per_line, window_start, window_end, max_attempts_per_contact, timezone)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     on conflict (organization_id) do update set enabled = excluded.enabled, purpose = excluded.purpose, legal_basis = excluded.legal_basis,
       daily_cap_per_line = excluded.daily_cap_per_line, window_start = excluded.window_start, window_end = excluded.window_end,
       max_attempts_per_contact = excluded.max_attempts_per_contact, timezone = excluded.timezone
     returning ${COLUMNS}`,
    [q.organizationId, next.enabled, next.purpose || null, next.legalBasis || null, next.dailyCapPerLine, next.windowStart, next.windowEnd, next.maxAttemptsPerContact, next.timezone],
  );
});
