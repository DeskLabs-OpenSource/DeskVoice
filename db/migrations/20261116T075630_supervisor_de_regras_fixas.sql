-- O supervisor de regras fixas (desenho 2026-11-13-equipe-de-agentes-e-memoria, seção 4.4, fatia 5;
-- registro 0020, escolha 5A). A rotina `review_call` abre uma pendência quando a ligação terminou
-- sem próximo passo num dos quatro casos fixos.
--
-- `source` diz quem abriu a pendência, sem texto livre. Nula é a pendência de sempre (a ferramenta
-- `create_task`). O índice único parcial é a garantia de no máximo uma pendência de supervisor por
-- ligação, mesmo com nova tentativa da fila ou com duas rotinas ao mesmo tempo. A coluna é da própria
-- `follow_ups`: o RLS, o apagamento a pedido do titular, a exportação e o prazo de guarda já a alcançam.

alter table follow_ups add column source text check (source in ('review_call'));
create unique index follow_ups_one_review_per_call_idx on follow_ups (organization_id, call_id) where source = 'review_call';
