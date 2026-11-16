# Estado da fundação

> Uma linha por fase do método da Fábrica. O primeiro retrato é de 2026-11-11, commit `f018499`, escrito
> pela auditoria de conformidade. As linhas 6, 8, 9 e 10 foram revistas em 2026-11-16, sobre a `main`
> em `5c98a0c` (versão 0.19.2), pela sessão que mantém o projeto. As linhas 1 a 5 e a 7 continuam como
> em 11/11. O DeskVoice foi fundado antes de este arquivo existir: onde o artefato mora em outro
> caminho, a linha diz qual.

| Fase | Portão | Fechado? | Artefato |
|---|---|---|---|
| 1. Entradas do dono | As respostas nas palavras do dono | Aberto | `docs/fundacao/entradas-do-dono.md` não existe. As decisões do dono estão resumidas em `docs/specs/2026-11-10-fundacao-design.md` ("Decisões do dono") |
| 2. Levantamentos | Os relatórios guardados | Aberto | `docs/fundacao/levantamentos/` não existe. Nenhum levantamento está no repositório |
| 3. Decisões e desenho | Decisões aprovadas, e o desenho dizendo como foi aprovado | Fechado | `docs/specs/2026-11-10-fundacao-design.md` (a linha 3 diz "aprovado pelo dono em conversa") |
| 4. Contratos | O arquivo existe e cada peça aparece nele | Fechado, com ressalva | `docs/plans/2026-11-10-fundacao.md`, seção "Contratos compartilhados". Tem seção para banco, os três pacotes, API do painel e variáveis; não tem seção própria para `apps/voice` nem `apps/routines` |
| 5. Construção | Verificação local verde, igual à do CI | Fechado | CI da `main` verde em `fb50506`; `pnpm verify` roda a mesma sequência do job `verify`. Lista do que não rodou: `docs/fundacao/nao-exercitado.md` |
| 6. Prova montada | Um caminho de ponta a ponta executado, com a saída guardada | Fechado | Saídas guardadas em `docs/fundacao/registros/`. A de ponta a ponta mais completa é uma ligação com motor real: o agente atende, passa a ligação a outro agente, que responde e encerra, com custo por agente e gravação ([`registros/2026-11-16-passagem-0.19.2/`](registros/2026-11-16-passagem-0.19.2/)). Ela começou por um script, pela chamada do navegador, e não por operadora. O CI roda a chamada simulada de ponta a ponta a cada PR (job `simulated-call`) |
| 7. Revisão fria | Nenhum bloqueador aberto, e a prova refeita | Aberto | Houve revisão fria em 2026-11-11 (citada em `fences/system-access-is-allowlisted.test.ts`). O parecer não está no repositório |
| 8. Instalação real | A instalação funcionando, com evidência | Fechado, com ressalva | `docs/fundacao/instalacao-real.md`. A VPS da parceira (AlmaLinux 9.8) roda desde a 0.3.0, foi atualizada por versão até a 0.19.2 e tem saídas guardadas. Também foram provados backup e restauração, a volta automática e a atualização pela tela. Continua sem prova: outro provedor (a primeira máquina e a da parceira são da HostGator, e a segunda não tem o provedor anotado), um servidor recém-criado e o modo com perguntas no terminal |
| 9. O dono usa | O registro, e os travamentos corrigidos ou escritos como fora do escopo | Aberto | `docs/fundacao/uso-pelo-dono.md`. A gestão de equipe e a conta entraram no PR #5. A demora da resposta pelo WhatsApp foi consertada (#136) e teve a ligação de prova do dono em 15/11. Continua aberta a pergunta sobre a queda do WhatsApp por QR em 12/11 (`device_removed`). O registro não tem uso do dono para cadastrar linha, responder aprovação e ver custo |
| 10. Publicação e devolução | Produto público, com a primeira versão, e a devolução aberta | Fechado, com ressalva | Público desde 2026-11-11. A primeira versão, a `v0.1.0`, saiu em 11/11, e até 16/11 foram 24 versões, a última a `v0.19.2`, com imagens para amd64 e arm64. Lições devolvidas à Fábrica (commit `30797dc`). A ressalva: a publicação veio antes de as fases 6 a 9 fecharem, fora da ordem do método. A auditoria de 11/11 (`docs/fundacao/conformidade-2026-11-11.md`, 57 itens F não conformes) não foi refeita |
