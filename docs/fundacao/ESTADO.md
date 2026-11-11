# Estado da fundação

> Uma linha por fase do método da Fábrica. Retrato de 2026-11-11, commit `f018499`, escrito pela
> auditoria de conformidade. O DeskVoice foi fundado antes de este arquivo existir: onde o
> artefato mora em outro caminho, a linha diz qual.

| Fase | Portão | Fechado? | Artefato |
|---|---|---|---|
| 1. Entradas do dono | As respostas nas palavras do dono | Aberto | `docs/fundacao/entradas-do-dono.md` não existe. As decisões do dono estão resumidas em `docs/specs/2026-11-10-fundacao-design.md` ("Decisões do dono") |
| 2. Levantamentos | Os relatórios guardados | Aberto | `docs/fundacao/levantamentos/` não existe. Nenhum levantamento está no repositório |
| 3. Decisões e desenho | Decisões aprovadas, e o desenho dizendo como foi aprovado | Fechado | `docs/specs/2026-11-10-fundacao-design.md` (a linha 3 diz "aprovado pelo dono em conversa") |
| 4. Contratos | O arquivo existe e cada peça aparece nele | Fechado, com ressalva | `docs/plans/2026-11-10-fundacao.md`, seção "Contratos compartilhados". Tem seção para banco, os três pacotes, API do painel e variáveis; não tem seção própria para `apps/voice` nem `apps/routines` |
| 5. Construção | Verificação local verde, igual à do CI | Fechado | CI da `main` verde em `fb50506`; `pnpm verify` roda a mesma sequência do job `verify`. Lista do que não rodou: `docs/fundacao/nao-exercitado.md` |
| 6. Prova montada | Um caminho de ponta a ponta executado, com a saída guardada | Aberto | Nenhuma saída guardada |
| 7. Revisão fria | Nenhum bloqueador aberto, e a prova refeita | Aberto | Houve revisão fria em 2026-11-11 (citada em `fences/system-access-is-allowlisted.test.ts`). O parecer não está no repositório |
| 8. Instalação real | A instalação funcionando, com evidência | Aberto | `docs/fundacao/instalacao-real.md`. Falta: evidência de funcionamento depois do PR #3, outro provedor, servidor recém-criado, modo com perguntas |
| 9. O dono usa | O registro, e os travamentos corrigidos ou escritos como fora do escopo | Aberto | `docs/fundacao/uso-pelo-dono.md`. Gestão de equipe e conta em correção no ramo `feat/equipe-e-convites` |
| 10. Publicação e devolução | Produto público, com a primeira versão, e a devolução aberta | Aberto | Público desde 2026-11-11, antes de as fases 6 a 9 fecharem. Sem versão publicada. Lições já devolvidas à Fábrica (commit `30797dc`). Auditoria: `docs/fundacao/conformidade-2026-11-11.md` (57 itens F não conformes) |
