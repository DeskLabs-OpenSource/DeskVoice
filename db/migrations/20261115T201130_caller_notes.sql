-- Notas do agente sobre quem ligou (desenho 2026-11-13-equipe-de-agentes-e-memoria, fatia 3;
-- registro 0020, 1A e 2A). A nota é o que a pessoa disse e importa para a próxima ligação ("prefere
-- de manhã"). Só a ferramenta `remember_caller_note` escreve aqui, por `saveCallerNote`, e o texto
-- mora só nesta tabela: nem `tool_called`, nem evento, nem aviso o copiam. Sai pelo prazo da memória
-- (`purge_caller_notes`), pelo prazo de guarda da transcrição (`purge_transcripts`) e pelo
-- apagamento a pedido do titular (`eraseCaller`).

create table caller_notes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id),
  -- A ligação em que a nota nasceu. A cascata só evita nota órfã: o prazo nunca apaga a ligação, e
  -- quem apaga a nota vencida é a rotina do prazo, explicitamente.
  call_id uuid not null,
  -- O telefone do outro lado da ligação, em E.164 (`from_e164` na recebida, `to_e164` na feita).
  -- Nunca vem do modelo. Ligação sem número não grava nota.
  caller_e164 text not null,
  text text not null check (char_length(text) between 1 and 300),
  created_at timestamptz not null,
  unique (organization_id, id),
  foreign key (organization_id, call_id) references calls (organization_id, id) on delete cascade
);
create index caller_notes_caller_idx on caller_notes (organization_id, caller_e164, created_at);
create index caller_notes_call_idx on caller_notes (organization_id, call_id);
create index caller_notes_created_idx on caller_notes (organization_id, created_at);

-- Mesmo isolamento das tabelas da fundação.
alter table caller_notes enable row level security;
alter table caller_notes force row level security;
create policy organization_isolation on caller_notes
  using (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
  with check (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);
grant select, insert, update, delete on caller_notes to deskvoice_app, deskvoice_system;
