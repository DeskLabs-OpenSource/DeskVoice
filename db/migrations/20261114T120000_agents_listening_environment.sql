-- Ambiente de quem liga, por agente. `noisy` ajusta a detecção de fala do provedor para ruído de
-- fundo (obra, música, pessoas falando); o que cada motor manda está em `listeningEnvironment`, nos
-- motores de `packages/voice-engine`.
-- Padrão `normal`: quem já instalou não faz nada, e o agente envia ao provedor o mesmo de antes.
alter table agents
  add column listening_environment text not null default 'normal'
    check (listening_environment in ('normal', 'noisy'));
