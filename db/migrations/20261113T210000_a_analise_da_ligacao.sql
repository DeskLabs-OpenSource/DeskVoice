-- A análise da ligação no fim (desenho `docs/specs/2026-11-13-analise-da-ligacao.md`, seção 3.1).
--
-- As colunas não têm padrão: `null` é "não analisada", e nenhuma linha antiga é reescrita. Fica
-- `null` a ligação com a análise desligada, sem fala, sem chave, no teto ou cujo provedor falhou; o
-- motivo vai para a linha do tempo (`analysis_not_done`), não para cá.
--
-- `analysis` guarda a forma de `packages/core/src/analysis.ts`, validada com zod na escrita e na
-- leitura: inteira até o prazo de guarda, e depois a expurgada, sem texto (`purgeTranscripts`).
-- `analysis_score` é a soma da régua (`scoreOf`) e mora fora do `jsonb` porque a lista de chamadas
-- mostra e ordena por ela; não é fala de ninguém e fica depois do prazo.
alter table calls
  add column analysis jsonb,
  add column analysis_score smallint check (analysis_score is null or (analysis_score between 0 and 10)),
  add column analyzed_at timestamptz;
