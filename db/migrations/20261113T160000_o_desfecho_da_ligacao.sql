-- O desfecho comercial da ligação, ao lado do resumo técnico que já existe.
--
-- `calls.summary` responde o que foi dito; `calls.outcome` responde o que aconteceu. Os dois convivem:
-- o resumo é para quem lê uma ligação, o desfecho é para quem lê o dia inteiro.
--
-- `unknown` é resposta legítima, e é o padrão de quem não classificou: nenhuma linha antiga é
-- reescrita, e uma ligação feita sem provedor disponível fica em `unknown` em vez de inventar um
-- desfecho. `outcome_evidence` guarda a fala que sustenta a classificação e `outcome_confidence` a
-- confiança declarada pelo provedor — sem as duas, um relatório de conversão seria caixa-preta.
alter table calls
  add column outcome text check (outcome in ('booked', 'callback_requested', 'message_taken', 'not_interested', 'info_only', 'unknown')),
  add column outcome_confidence numeric(3, 2) check (outcome_confidence is null or (outcome_confidence >= 0 and outcome_confidence <= 1)),
  add column outcome_evidence text,
  add column outcome_classified_at timestamptz;
