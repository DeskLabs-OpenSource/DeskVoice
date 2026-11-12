-- Ligação pelo WhatsApp (WaCalls): se a organização pediu o serviço, e o que o painel sabe do número
-- conectado nele. Desenho: docs/specs/2026-11-12-ligacao-pelo-whatsapp.md.

-- Uma linha por organização, como `whatsapp_sessions`. A verdade sobre o pareamento mora no WaCalls;
-- aqui fica o último estado que o painel viu, para ele perceber a mudança (conectou, caiu) e avisar,
-- e para a tela dizer qual número está conectado e desde quando.
create table whatsapp_call_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id),
  -- A organização pediu o serviço pela tela. O serviço é da instalação e só existe nela se alguma
  -- organização o quer: é isto que o agente do servidor lê como sim ou não (`whatsappCalls`).
  service_wanted boolean not null default false,
  -- Nome da sessão no WaCalls: `deskvoice_` mais o id INTEIRO da organização. Sem nome nem telefone de ninguém.
  session_name text not null unique,
  -- O id que o WaCalls deu à sessão. Muda a cada pareamento (parear de novo é apagar e criar).
  wacalls_session_id text,
  status text not null default 'disconnected'
    check (status in ('disconnected', 'starting', 'qr', 'connected', 'failed')),
  -- Por que está em `failed`: 'logged_out' (o aparelho foi desvinculado), 'qr_expired' (o código
  -- venceu sem leitura) ou 'missing' (o WaCalls não tem mais a sessão). Nulo fora de `failed`.
  failure text,
  phone_e164 text,
  connected_at timestamptz,
  updated_at timestamptz not null default now()
);
-- Um número por organização: vários números está fora desta capacidade (seção 12 do desenho).
create unique index whatsapp_call_sessions_one_per_org_idx on whatsapp_call_sessions (organization_id);

-- Mesmo isolamento das tabelas da fundação.
alter table whatsapp_call_sessions enable row level security;
alter table whatsapp_call_sessions force row level security;
create policy organization_isolation on whatsapp_call_sessions
  using (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
  with check (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);
grant select, insert, update, delete on whatsapp_call_sessions to deskvoice_app, deskvoice_system;

-- O que o agente do servidor contou sobre o serviço de ligação pelo WhatsApp na última fala, nos
-- mesmos códigos do serviço de WhatsApp por QR Code. Nulo = o agente ainda não contou.
alter table update_agent_status
  add column whatsapp_calls_service text check (whatsapp_calls_service in ('absent', 'running', 'failed')),
  add column whatsapp_calls_service_reason text,
  add column whatsapp_calls_service_warning text,
  add column whatsapp_calls_service_free_mb integer,
  add column whatsapp_calls_service_needed_mb integer;
