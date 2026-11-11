# Configurado e ainda não exercitado

> O que existe no repositório e nunca rodou de verdade. Leia como desenho, e não como prova.
> Retrato de 2026-11-11, commit `f018499`, revisto no mesmo dia no ramo
> `feat/versao-fixa-e-imagens`. Um item sai daqui quando rodar, com a evidência.

## CI e versões

| Peça | Situação | Como foi conferido |
|---|---|---|
| Fila de merge | Configurada na regra do ramo. Nenhuma contribuição a atravessou: os PRs #2, #3 e #4 entraram por passagem de administrador | `gh run list`: nenhuma execução por `merge_group` |
| Revisão por quem não escreveu | Exigida na regra. Nunca aconteceu | `gh pr list`: os três PRs com revisão pendente e merge do autor |
| Acolhida (`welcome.yml`) | Disparou quatro vezes e o job foi pulado, porque os PRs eram do próprio repositório. Nunca comentou num PR de fork | `gh run list` |
| Passo de atualização no CI | Era pulado até existir a primeira versão. A 0.1.0 existe desde 2026-11-11; o passo ainda não rodou num PR depois dela | `.github/workflows/ci.yml` |
| Corte de versão (`release.yml`) | O ato 2 rodou uma vez, na 0.1.0: reconheceu o merge do PR `release/0.1.0`, criou a tag anotada no commit da `main` e disparou a publicação. O ato 1 (o workflow abrir o PR) nunca rodou: o PR foi aberto à mão, com os mesmos passos, porque a organização não permitia que o Actions abrisse pull request | `gh run view 43082922051` |
| Publicação de imagens (`publish-image.yml`) | Rodou uma vez, na 0.1.0: as três imagens amd64 foram construídas e publicadas. Reexecutar o workflow inteiro (que sobrescreveria a etiqueta) nunca aconteceu | `gh run view 43082962811` |
| Imagens para arm64 | Não são publicadas. A publicação é só para amd64; em ARM a instalação constrói na própria máquina (`--build`), o que nunca foi exercitado numa máquina ARM | `publish-image.yml` |
| Canal `stable` | Deixou de existir: o job de promoção saiu do workflow e a instalação descobre a versão pelas tags do repositório | `publish-image.yml` |
| Release do GitHub publicada no fim da publicação das imagens | Rodou uma vez, na 0.1.0. Com os pacotes ainda privados o job foi pulado; depois de tornados públicos, a reexecução só dos jobs que falharam publicou a release | `gh release view v0.1.0` |
| Tag fora da `main` não publica | O caminho que aceita rodou (a tag da 0.1.0 é de commit da `main`). O caminho que recusa nunca rodou num runner | `publish-image.yml`, job `probe` |
| Nome da imagem lido da fonte única no workflow | Rodou num runner, na 0.1.0: as imagens saíram com o endereço de `deploy/images.env` e a etiqueta `0.1.0` | `gh run view 43082962811` |
| Imagens publicadas baixam sem credencial | Provado na 0.1.0: o `verify-public` falhou com os pacotes privados, dizendo o conserto, e passou depois que o dono os tornou públicos. A VPS de teste baixou as três sem login | `gh run view 43082962811` |

## Instalação e operação

| Peça | Situação |
|---|---|
| Instalação por perguntas no terminal | Só o modo sem perguntas rodou numa máquina real |
| Instalação em servidor recém-criado | A única instalação real foi numa máquina compartilhada |
| Instalação em VPS de outro provedor | Nunca |
| O caminho do `install.sh` que grava, sobe e cria o usuário | Só rodou na instalação real. Nenhum teste do kit o executa fora da simulação |
| Instalar baixando imagem publicada | Nunca: não há imagem. A instalação real construiu na VPS |
| Instalação que grava o número da versão | Testada só com substitutos do Docker e do git. Nenhuma instalação real gravou um número: ainda não há versão publicada |
| Erro claro quando a versão publicada não tem imagem que baixe | Idem. A mensagem nunca apareceu numa máquina real |
| Passagem de uma instalação com `stable` gravado para o número da versão | Idem. A única instalação real ainda está em `stable`, com imagens construídas nela |
| Menor tamanho de máquina em que a instalação cabe | Não medido. A instalação foi provada numa VPS de 8 GB e 4 vCPU, e o sistema parado usa cerca de 400 MB. Falta medir com imagens publicadas, sem a etapa de construção |
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
| Chamada pelo navegador | Uma conversa com motor real aconteceu por um cliente de teste, que faz o papel do navegador com fala gravada. Nunca por um navegador com microfone |
| Encaminhamento de `/voice-ws` pelo Caddy do DeskVoice | Saiu desta lista: provado em 2026-11-11 na instalação real, com uma conversa por voz pela entrada única. A evidência foi informada por quem conduziu a instalação; [`instalacao-real.md`](instalacao-real.md) ainda só registra a conversa feita antes da entrada única, e falta acrescentar esta. A checagem de saúde ganhou a linha "Entrada única" |
| Encaminhamento de `/voice-ws` por proxy de terceiros (Nginx, Traefik, outro Caddy) | Nunca conferido. A linha "Entrada única" confere só até a porta do DeskVoice |
| Painel com domínio e HTTPS automático | Nunca numa instalação real: a única foi sem domínio |
| Motor OpenAI Realtime | Conversou uma vez na instalação real, por cliente de teste ([`instalacao-real.md`](instalacao-real.md), 14:45) |
| Motor Gemini Live | Nunca rodou com chave. Testado contra servidor falso |
| Medição de custo com motor real | Não há registro do custo mostrado na tela para a conversa real |
| Envio de WhatsApp por conector | Nunca com um conector real |
| Webhook para um receptor real | Nunca |
| Painel em inglês e em espanhol | O README diz que as telas foram conferidas em português |
| Mais de uma organização na mesma instalação | Só em teste de banco |
