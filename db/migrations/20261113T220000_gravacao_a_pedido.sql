-- Quem ligou pediu para não ser gravado. A partir do pedido a chamada não é mais gravada, mas o
-- trecho em que o pedido foi feito fica no arquivo: é a prova de que a revogação existiu, quando
-- começou e quem a pediu. Sem isso, a instalação não teria como demonstrar que atendeu ao pedido.
-- Só se preenche quando havia gravação a parar. O motivo é fala de quem ligou: o prazo de guarda
-- da transcrição o apaga (`purgeTranscripts`), e o fato do pedido (quando, por quem) fica.
alter table calls add column recording_paused_at timestamptz;
alter table calls add column recording_paused_by text check (recording_paused_by in ('agent', 'human'));
alter table calls add column recording_pause_reason text;
