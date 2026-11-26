-- As peças do motor pipeline (R5, fatia 3b): transcrição, cérebro e voz escolhidos à parte.
-- Desenho: docs/specs/2026-11-17-motor-de-voz-em-pipeline.md, seção 3.3 e fatia 3.
--
-- `{ transcriber, brain, model, synthesizer, voiceId }`. Nula, sem default: quem já instalou não muda
-- nada, e o agente abre o motor de `engine`, como sempre. Nenhuma rota, tela ou API escreve aqui antes
-- da fatia 5. A coluna não guarda chave: cada peça usa a chave da organização (`settings`).
alter table agents add column pipeline jsonb;
