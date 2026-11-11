# Configurado e ainda não exercitado

> O que existe no repositório e nunca rodou de verdade. Leia como desenho, e não como prova.
> Retrato de 2026-11-11, commit `f018499`. Um item sai daqui quando rodar, com a evidência.

## CI e versões

| Peça | Situação | Como foi conferido |
|---|---|---|
| Fila de merge | Configurada na regra do ramo. Nenhuma contribuição a atravessou: os PRs #2, #3 e #4 entraram por passagem de administrador | `gh run list`: nenhuma execução por `merge_group` |
| Revisão por quem não escreveu | Exigida na regra. Nunca aconteceu | `gh pr list`: os três PRs com revisão pendente e merge do autor |
| Acolhida (`welcome.yml`) | Disparou quatro vezes e o job foi pulado, porque os PRs eram do próprio repositório. Nunca comentou num PR de fork | `gh run list` |
| Passo de atualização no CI | Pulado até existir a primeira versão | `.github/workflows/ci.yml:139-143` |
| Corte de versão (`release.yml`) | O job de etiqueta roda a cada push na `main` e sai sem nada a marcar. Nenhuma versão foi cortada | `gh api .../releases`: 0 |
| Publicação de imagens (`publish-image.yml`) | Nunca rodou | `gh run list` |
| Imagens para arm64 | Declaradas no workflow que nunca rodou | `publish-image.yml:87` |
| Promoção do canal `stable` | Nunca rodou. Nenhuma imagem `stable` foi publicada pelo CI | idem |

## Instalação e operação

| Peça | Situação |
|---|---|
| Instalação por perguntas no terminal | Só o modo sem perguntas rodou numa máquina real |
| Instalação em servidor recém-criado | A única instalação real foi numa máquina compartilhada |
| Instalação em VPS de outro provedor | Nunca |
| O caminho do `install.sh` que grava, sobe e cria o usuário | Só rodou na instalação real. Nenhum teste do kit o executa fora da simulação |
| Instalar baixando imagem publicada | Nunca: não há imagem. A instalação real construiu na VPS |
| Atualizador (`update.sh`) | Testado só com um substituto do Docker. Nunca atualizou uma instalação |
| Volta automática da atualização | Idem |
| Backup e restauração | Testados com um substituto do Docker. O README diz que foram conferidos à mão num Postgres real; não há registro dessa conferência |
| Recuperação de senha (`reset-password.sh`) | Testada com um substituto do Docker e por teste de banco. Nunca rodou num servidor real |
| Diagnóstico (`diagnose.sh`) | Idem |
| Detecção de outro proxy em 80/443 | Coberta por teste do modo de ensaio. Sem registro de ter rodado numa máquina real |

## Produto

| Peça | Situação |
|---|---|
| Ligação recebida por operadora (tronco SIP) | Nunca |
| Transferência para uma pessoa | Nunca com operadora |
| Ligação feita pelo agente | Nunca com operadora |
| Chamada pelo navegador | Uma conversa com motor real aconteceu por um cliente de teste. Nunca por um navegador |
| Encaminhamento de `/voice-ws` pelo Caddy e por proxy de terceiros | Nunca conferido; a checagem de saúde não tem linha para isso |
| Motor Gemini Live e motor OpenAI Realtime | Um motor real conversou uma vez, por cliente de teste. Qual deles, e se o outro já rodou, não está registrado |
| Medição de custo com motor real | Não há registro do custo mostrado na tela para a conversa real |
| Envio de WhatsApp por conector | Nunca com um conector real |
| Webhook para um receptor real | Nunca |
| Painel em inglês e em espanhol | O README diz que as telas foram conferidas em português |
| Mais de uma organização na mesma instalação | Só em teste de banco |
