-- Quem ligou pediu para não ser gravado. A partir do pedido a chamada não é mais gravada, mas o
-- trecho em que o pedido foi feito fica no arquivo: é a prova de que a revogação existiu, quando
-- começou e quem a pediu. Sem isso, a instalação não teria como demonstrar que atendeu ao pedido.
alter table calls add column recording_paused_at timestamptz;
alter table calls add column recording_paused_by text check (recording_paused_by in ('agent', 'human'));
alter table calls add column recording_pause_reason text;

-- Pedido feito no painel enquanto a chamada acontece. O processo de voz lê esta coluna durante a
-- ligação e a zera ao aplicar: a chamada é dele, e o painel não fala com ele por outro caminho.
alter table calls add column recording_pause_requested_at timestamptz;
alter table calls add column recording_pause_requested_by uuid references users (id) on delete set null;
alter table calls add column recording_pause_request text;
