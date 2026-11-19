-- Quem lê a ligação, escolhido em cada agente (R4, fatia 5). Desenho: DESA-163.
--
-- Nula é "segue a organização" (`calls.analysis_brain`, ou o motor do agente sem ela): toda linha que
-- já existe nasce nula, e quem só atualiza não vê diferença. A forma (`{ "kind": "engine" }` ou
-- `{ "kind": "brain", "brain": ..., "model": ... }`) é conferida pelo zod `agentAnalysisBrain`
-- (`packages/core/src/agent-analysis-brain.ts`) na escrita e na leitura: fora da forma, a rotina não
-- lê a ligação e diz por quê, sem cair na escolha da organização nem no motor.
alter table agents add column analysis_brain jsonb;
