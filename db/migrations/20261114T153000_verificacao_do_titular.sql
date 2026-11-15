-- O acesso do titular à própria gravação, com prova de posse do número.
--
-- O link compartilhado é um portador: quem tem, abre. Esta tabela guarda a prova de que quem pediu é
-- quem atendeu a ligação — um código de seis dígitos entregue no número de origem (WhatsApp, SMS ou
-- lido na própria ligação). O código nunca é gravado em claro: só o sha256.
create table if not exists caller_verifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  call_id uuid not null references calls (id) on delete cascade,
  -- O número que precisa provar posse. O da chamada, não o que o pedinte digitou.
  phone_e164 text not null,
  -- whatsapp | sms | call (o operador dita o código durante a própria ligação)
  channel text not null,
  code_hash text not null,
  attempts integer not null default 0,
  max_attempts integer not null default 3,
  expires_at timestamptz not null,
  verified_at timestamptz,
  opened_at timestamptz,
  created_by uuid references users (id),
  created_at timestamptz not null
);

create index if not exists caller_verifications_call_idx on caller_verifications (call_id, created_at desc);

grant select, insert, update, delete on caller_verifications to deskvoice_app, deskvoice_system;

alter table caller_verifications enable row level security;
alter table caller_verifications force row level security;
create policy caller_verifications_org on caller_verifications
  using (organization_id = (nullif(current_setting('app.organization_id', true), ''))::uuid)
  with check (organization_id = (nullif(current_setting('app.organization_id', true), ''))::uuid);
