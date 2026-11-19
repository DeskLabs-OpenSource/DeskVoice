-- O menu por teclas (URA), fatia 1 (#223, sobre o #225). Desenho: DESA-160, decisão A de 18/11.
--
-- Um menu de um nível: o anúncio, as teclas e o que cada uma faz (IA, pessoa ou desligar). Só
-- acrescenta: `phone_numbers.mode` nasce `ai`, e nenhum número muda de comportamento sem o operador
-- mexer. Os `check`s e as chaves estrangeiras abaixo tornam impossível um estado ruim mesmo com o
-- painel errado; a "saída para uma pessoa" (ao menos uma opção `transfer`) olha outras linhas e é
-- conferida na aplicação.
create table ivr_menus (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  name text not null check (length(name) between 1 and 60),
  -- Os mesmos valores de `SpokenLanguage` (`packages/core/src/spoken-language.ts`): a fala de falha
  -- gravada sai nele.
  language text not null default 'pt-BR' check (language in ('pt-BR', 'en', 'es')),
  -- O anúncio fica no banco, e não em `recordings/`: o expurgo por prazo e o apagamento a pedido do
  -- titular apagam `.wav` de lá, e o anúncio não é dado de quem liga. A cópia de segurança do banco
  -- o leva, e o isolamento é o da RLS. PCM16 mono a 8 kHz, sem cabeçalho; nulo até o upload.
  prompt_audio bytea,
  -- A duração, para a tela; preenchida junto com o áudio.
  prompt_audio_ms integer,
  -- A espera por uma tecla depois de o anúncio terminar de tocar.
  timeout_ms integer not null default 5000 check (timeout_ms between 2000 and 15000),
  max_attempts integer not null default 3 check (max_attempts between 1 and 5),
  -- Sem escolha depois de `max_attempts`: vai à primeira opção `transfer`, ou desliga.
  on_no_choice text not null default 'person' check (on_no_choice in ('person', 'hangup')),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (organization_id, id),
  check ((prompt_audio is null) = (prompt_audio_ms is null)),
  -- 60 s de PCM16 a 8 kHz são 960 000 bytes.
  check (octet_length(prompt_audio) <= 960000)
);

create table ivr_options (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  menu_id uuid not null,
  digit text not null check (digit ~ '^[0-9*#]$'),
  label text not null check (length(label) between 1 and 60),
  action text not null check (action in ('agent', 'transfer', 'hangup')),
  agent_id uuid,
  transfer_e164 text,
  unique (menu_id, digit),
  -- Com a organização na chave: a opção nunca aponta para o menu nem para o agente de outra.
  foreign key (organization_id, menu_id) references ivr_menus (organization_id, id) on delete cascade,
  -- Apagar o agente usado por uma opção é recusado: o menu ficaria com uma tecla que não leva a nada.
  foreign key (organization_id, agent_id) references agents (organization_id, id) on delete restrict,
  check ((action = 'agent') = (agent_id is not null)),
  check ((action = 'transfer') = (transfer_e164 is not null))
);
create index ivr_options_agent_idx on ivr_options (organization_id, agent_id);

-- `ai`: atende o agente do número, como sempre. `ivr`: atende o menu. Apagar o menu de um número em
-- `ivr` é recusado, e o número não fica em `ivr` sem menu.
alter table phone_numbers
  add column mode text not null default 'ai' check (mode in ('ai', 'ivr')),
  add column ivr_menu_id uuid,
  add foreign key (organization_id, ivr_menu_id) references ivr_menus (organization_id, id) on delete restrict,
  add check (mode = 'ai' or ivr_menu_id is not null);
create index phone_numbers_ivr_menu_idx on phone_numbers (organization_id, ivr_menu_id);

-- Mesmo isolamento das outras tabelas da organização.
alter table ivr_menus enable row level security;
alter table ivr_menus force row level security;
create policy organization_isolation on ivr_menus
  using (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
  with check (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);
grant select, insert, update, delete on ivr_menus to deskvoice_app, deskvoice_system;

alter table ivr_options enable row level security;
alter table ivr_options force row level security;
create policy organization_isolation on ivr_options
  using (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
  with check (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);
grant select, insert, update, delete on ivr_options to deskvoice_app, deskvoice_system;
