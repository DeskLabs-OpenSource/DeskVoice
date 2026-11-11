import { toE164, type Clock, type OrgQuery } from "@deskvoice/core";

export type OutboundRefusalCode = "outbound_disabled" | "outside_window" | "do_not_call" | "daily_cap_reached" | "attempts_exhausted";
export type OutboundDecision = { allowed: true } | { allowed: false; code: OutboundRefusalCode; message: string };

interface PolicyRow {
  enabled: boolean;
  daily_cap_per_line: number;
  window_start: string;
  window_end: string;
  max_attempts_per_contact: number;
  timezone: string;
}

const refuse = (code: OutboundRefusalCode, message: string): OutboundDecision => ({ allowed: false, code, message });

const minutesOf = (time: string): number => {
  const [hours = "0", minutes = "0"] = time.split(":");
  return Number(hours) * 60 + Number(minutes);
};

/** Minutos desde a meia-noite no fuso da política. Nunca o fuso da máquina. */
function localMinutes(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", hour: "2-digit", minute: "2-digit" }).formatToParts(at);
  const part = (type: string): number => Number(parts.find((candidate) => candidate.type === type)?.value ?? 0);
  return part("hour") * 60 + part("minute");
}

/**
 * Toda ligação feita pelo agente passa por aqui antes de existir. As contagens leem `calls`:
 * recusa não conta como ligação feita.
 *
 * `lineE164` é o número da linha por onde a ligação vai sair (o `from_e164` da chamada). Sem ele,
 * o teto diário conta todas as ligações de saída da organização.
 */
export async function checkOutboundAllowed(q: OrgQuery, toE164Input: string, clock: Clock, lineE164?: string | null): Promise<OutboundDecision> {
  const policy = await q.one<PolicyRow>(
    "select enabled, daily_cap_per_line, window_start::text, window_end::text, max_attempts_per_contact, timezone from outbound_policy where organization_id = $1",
    [q.organizationId],
  );
  if (!policy?.enabled) return refuse("outbound_disabled", "Outbound calls are turned off for this organization.");

  const to = toE164(toE164Input) ?? toE164Input;
  const blocked = await q.one("select 1 as hit from do_not_call where organization_id = $1 and e164 = $2", [q.organizationId, to]);
  if (blocked) return refuse("do_not_call", `${to} is on the do-not-call list.`);

  const now = clock.now();
  const minute = localMinutes(now, policy.timezone);
  const start = minutesOf(policy.window_start);
  const end = minutesOf(policy.window_end);
  // Janela que atravessa a meia-noite (22:00 às 06:00) vale nas duas pontas.
  const inWindow = start <= end ? minute >= start && minute < end : minute >= start || minute < end;
  if (!inWindow) {
    return refuse("outside_window", `Outbound calls are allowed from ${policy.window_start.slice(0, 5)} to ${policy.window_end.slice(0, 5)} (${policy.timezone}).`);
  }

  // O dia começa à meia-noite do fuso da política; a conta é do banco, que conhece horário de verão.
  const today = await q.one<{ count: number }>(
    `select count(*)::int as count from calls
      where organization_id = $1 and direction = 'outbound' and status <> 'refused'
        and started_at >= date_trunc('day', $2::timestamptz at time zone $3) at time zone $3
        and ($4::text is null or from_e164 = $4)`,
    [q.organizationId, now, policy.timezone, lineE164 ?? null],
  );
  if ((today?.count ?? 0) >= policy.daily_cap_per_line) {
    return refuse("daily_cap_reached", `This line already made ${today?.count} outbound calls today; the daily cap is ${policy.daily_cap_per_line}.`);
  }

  const attempts = await q.one<{ count: number }>(
    "select count(*)::int as count from calls where organization_id = $1 and direction = 'outbound' and status <> 'refused' and to_e164 = $2",
    [q.organizationId, to],
  );
  if ((attempts?.count ?? 0) >= policy.max_attempts_per_contact) {
    return refuse("attempts_exhausted", `${to} was already called ${attempts?.count} times; the limit per contact is ${policy.max_attempts_per_contact}.`);
  }
  return { allowed: true };
}
