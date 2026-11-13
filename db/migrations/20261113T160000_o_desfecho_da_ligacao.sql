-- O desfecho comercial da ligação, ao lado do resumo técnico que já existe.
--
-- `calls.summary` responde o que foi dito; `calls.outcome` responde o que aconteceu. Os dois convivem:
-- o resumo é para quem lê uma ligação, o desfecho é para quem lê o dia inteiro.
--
-- As colunas não têm padrão: `null` é "não classificado", e nenhuma linha antiga é reescrita. Fica
-- `null` a ligação de organização com a classificação desligada (o de fábrica), sem fala, sem chave
-- do motor, já no teto de custo ou cujo provedor falhou; a falha vai para a linha do tempo, não
-- para cá. `unknown` é resposta legítima do provedor: a conversa não sustenta afirmação sobre o
-- cliente. `outcome_evidence` guarda a fala que sustenta a classificação, e sai com o prazo de
-- guarda da transcrição; `outcome_confidence`, a confiança declarada pelo provedor. Sem as duas, um
-- relatório de conversão seria caixa-preta.
alter table calls
  add column outcome text check (outcome in ('booked', 'callback_requested', 'message_taken', 'not_interested', 'info_only', 'unknown')),
  add column outcome_confidence numeric(3, 2) check (outcome_confidence is null or (outcome_confidence >= 0 and outcome_confidence <= 1)),
  add column outcome_evidence text,
  add column outcome_classified_at timestamptz;
