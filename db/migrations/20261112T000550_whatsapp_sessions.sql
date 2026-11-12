-- WhatsApp por QR Code: se a organização pediu o serviço, e o que o painel sabe da sessão que o
-- WAHA da instalação mantém.

-- Uma linha por organização nesta fatia (um número por instalação). A verdade sobre a conexão
-- mora no WAHA; aqui fica o último estado que o painel viu, para ele perceber a mudança (conectou,
-- caiu) e avisar, e para a tela dizer qual número está conectado e desde quando.
create table whatsapp_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id),
  -- A organização pediu o serviço de WhatsApp pela tela. O serviço (o WAHA) é da instalação e só
  -- existe nela se alguma organização o quer: é isto que o agente do servidor lê como sim ou não.
  service_wanted boolean not null default false,
  -- Nome da sessão no WAHA. Sai do id da organização; não leva nome nem telefone de ninguém.
  session_name text not null unique,
  status text not null default 'disconnected'
    check (status in ('disconnected', 'starting', 'qr', 'connected', 'failed')),
  -- Por que está em `failed`: o estado que o WAHA informou. Nulo fora de `failed`.
  failure text,
  phone_e164 text,
  connected_at timestamptz,
  updated_at timestamptz not null default now()
);
-- Uma sessão por organização. Vários números é decisão que ainda não foi tomada: quando for, é
-- este índice que sai.
create unique index whatsapp_sessions_one_per_org_idx on whatsapp_sessions (organization_id);

-- Mesmo isolamento das tabelas da fundação.
alter table whatsapp_sessions enable row level security;
alter table whatsapp_sessions force row level security;
create policy organization_isolation on whatsapp_sessions
  using (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
  with check (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);
grant select, insert, update, delete on whatsapp_sessions to deskvoice_app, deskvoice_system;

-- O que o agente do servidor contou sobre o serviço de WhatsApp na última fala: de pé, fora, ou
-- falhou ao ligar ou desligar (com o código da falha). Nulo = o agente ainda não contou. Como o
-- resto desta tabela, a mesma linha é gravada para cada organização.
alter table update_agent_status
  add column whatsapp_service text check (whatsapp_service in ('absent', 'running', 'failed')),
  add column whatsapp_service_reason text,
  -- Aviso que acompanha o estado (pouca memória ao instalar; imagem que não saiu do disco ao remover)
  -- e, quando faltou disco, quanto havia e quanto o serviço pede, em MB.
  add column whatsapp_service_warning text,
  add column whatsapp_service_free_mb integer,
  add column whatsapp_service_needed_mb integer;
