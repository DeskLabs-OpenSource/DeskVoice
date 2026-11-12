# Configurado e ainda não exercitado

> O que existe no repositório e nunca rodou de verdade. Leia como desenho, e não como prova.
> Retrato de 2026-11-11, commit `f018499`, revisto no mesmo dia no ramo
> `feat/versao-fixa-e-imagens`, e de novo depois da versão 0.2.0, com o que
> [`instalacao-real.md`](instalacao-real.md) registra na seção "Depois da 0.2.0". Um item sai
> daqui quando rodar, com a evidência.

## CI e versões

| Peça | Situação | Como foi conferido |
|---|---|---|
| Fila de merge | Configurada na regra do ramo. Nenhuma contribuição a atravessou: os PRs #2, #3 e #4 entraram por passagem de administrador | `gh run list`: nenhuma execução por `merge_group` |
| Revisão por quem não escreveu | Exigida na regra. Nunca aconteceu | `gh pr list`: os três PRs com revisão pendente e merge do autor |
| Acolhida (`welcome.yml`) | Disparou quatro vezes e o job foi pulado, porque os PRs eram do próprio repositório. Nunca comentou num PR de fork | `gh run list` |
| Passo de atualização no CI | Era pulado até existir a primeira versão. A 0.1.0 existe desde 2026-11-11; o passo ainda não rodou num PR depois dela | `.github/workflows/ci.yml` |
| Corte de versão (`release.yml`) | O ato 2 rodou uma vez, na 0.1.0: reconheceu o merge do PR `release/0.1.0`, criou a tag anotada no commit da `main` e disparou a publicação. Na 0.1.0 o ato 1 (o workflow abrir o PR) não rodou: o PR foi aberto à mão, com os mesmos passos, porque a organização não permitia que o Actions abrisse pull request. Na 0.2.0 o ato 1 rodou pelo workflow pela primeira vez e abriu o PR de versão. As verificações do evento de PR ficaram em `action_required`; o `ready` verde veio do `ci` disparado no ramo, anexado ao commit | `gh run view 43082922051` (0.1.0); [`instalacao-real.md`](instalacao-real.md), "A versão 0.2.0" |
| Publicação de imagens (`publish-image.yml`) | Rodou na 0.1.0: as três imagens amd64 foram construídas e publicadas. Na 0.2.0 a publicação rodou inteira, sem intervenção. Reexecutar o workflow inteiro (que sobrescreveria a etiqueta) nunca aconteceu | `gh run view 43082962811` |
| Imagens para arm64 | Não são publicadas. A publicação é só para amd64; em ARM a instalação constrói na própria máquina (`--build`), o que nunca foi exercitado numa máquina ARM | `publish-image.yml` |
| Canal `stable` | Deixou de existir: o job de promoção saiu do workflow e a instalação descobre a versão pelas tags do repositório | `publish-image.yml` |
| Release do GitHub publicada no fim da publicação das imagens | Na 0.1.0, com os pacotes ainda privados, o job foi pulado; depois de tornados públicos, a reexecução só dos jobs que falharam publicou a release. Na 0.2.0 os pacotes seguiram públicos e a release nasceu sozinha | `gh release view v0.1.0`; [`instalacao-real.md`](instalacao-real.md), "A versão 0.2.0" |
| Tag fora da `main` não publica | O caminho que aceita rodou (a tag da 0.1.0 é de commit da `main`). O caminho que recusa nunca rodou num runner | `publish-image.yml`, job `probe` |
| Nome da imagem lido da fonte única no workflow | Rodou num runner, na 0.1.0: as imagens saíram com o endereço de `deploy/images.env` e a etiqueta `0.1.0` | `gh run view 43082962811` |
| Imagens publicadas baixam sem credencial | Provado na 0.1.0: o `verify-public` falhou com os pacotes privados, dizendo o conserto, e passou depois que o dono os tornou públicos. A VPS de teste baixou as três sem login, e a segunda VPS também, na instalação do zero contra a 0.1.0 | `gh run view 43082962811` |

## Instalação e operação

| Peça | Situação |
|---|---|
| Instalação por perguntas no terminal | Só o modo sem perguntas rodou numa máquina real |
| Instalação em servidor recém-criado | Nunca. As duas instalações reais foram em máquinas compartilhadas |
| Instalação em VPS de outro provedor | Nunca |
| O caminho do `install.sh` que grava, sobe e cria o usuário | Rodou nas instalações reais. O CI passou a instalar de verdade no runner (job `install` de `.github/workflows/ci.yml`: constrói as imagens do commit com `--build` e sobe tudo, sem domínio). Os testes do kit o executam com o Docker de mentira (`install/test/11-install-entry.sh`, `13-version.sh`, `16-install-proves-entry.sh`) |
| Instalar baixando imagem publicada | Saiu desta lista: em 2026-11-11, instalação do zero pelo comando de uma linha contra a 0.1.0, numa segunda VPS (Ubuntu 22.04, x86_64, 8 GB, compartilhada). 67 segundos do `curl` até tudo respondendo; clone na tag; três imagens baixadas sem login; saúde com todas as peças em ok |
| Instalação que grava o número da versão | Testada só com substitutos do Docker e do git. Nenhuma instalação real gravou um número: ainda não há versão publicada |
| Erro claro quando a versão publicada não tem imagem que baixe | Idem. A mensagem nunca apareceu numa máquina real |
| Passagem de uma instalação com `stable` gravado para o número da versão | Idem. A única instalação real ainda está em `stable`, com imagens construídas nela |
| Menor tamanho de máquina em que a instalação cabe | Não medido. A instalação foi provada em VPS de 8 GB. Na instalação com imagens publicadas (0.1.0, segunda VPS), o sistema **parado**, sem chamada, usava cerca de 320 MiB somando os seis contêineres. Isso é memória em repouso, e não tamanho mínimo de máquina |
| Atualizador (`update.sh`) | Atualizou instalações reais: a primeira atualização entre versões e, nas duas VPS de teste, a ponte da 0.1.0 para a 0.2.0 (`update.sh --yes` duas vezes; rodada 1 com backup, imagens 0.2.0 e migration nova; rodada 2 recriou o painel e agendou o timer do systemd), em [`instalacao-real.md`](instalacao-real.md). A passagem de vez com `--resume` nunca rodou numa máquina real: a ponte não a exercita, porque a 0.1.0 não a tem |
| Agente de atualização | Nas duas VPS de teste, falou com o painel em menos de dois minutos depois da segunda rodada, e a saúde mostrou "Agente de atualização: ok". Ouvir um "sim" do painel e atualizar: nunca |
| Tela de atualização | Aberta por navegador só pelo teste de tela de Configurações, que confere que o bloco carrega e mostra a versão em execução. O botão de atualizar nunca foi clicado num navegador |
| Reinício do Caddy na segunda rodada do `update.sh`, e o aviso da saúde quando quem recusa a rota do agente é o painel | Testados só com o Docker de mentira. O defeito que os originou foi visto nas VPS de teste e corrigido à mão, reiniciando o Caddy |
| `DESKVOICE_PANEL_LOCAL_ONLY` com as portas 80 e 443 livres; padrão só local sem domínio; `DESKVOICE_PANEL_PUBLIC_HTTP` | Testados só com o Docker de mentira. Na instalação real em que a opção foi passada, ela foi ignorada (o defeito que originou a correção) |
| Login de verdade no fim do instalador, e depois do `reset-password.sh` | A sonda foi exercitada contra um servidor de mentira e os scripts com o Docker de mentira. Nunca contra um painel real |
| Volta automática da atualização | Testada só com um substituto do Docker. Nunca numa VPS |
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
| Motor OpenAI Realtime | Conversou uma vez na instalação real, por cliente de teste ([`instalacao-real.md`](instalacao-real.md), 14:45). Nenhuma conversa por voz depois das atualizações para a 0.1.0 e a 0.2.0 |
| Motor Gemini Live | Nunca rodou com chave. Testado contra servidor falso |
| Medição de custo com motor real | Não há registro do custo mostrado na tela para a conversa real |
| Envio de WhatsApp por conector | Nunca com um conector real |
| Webhook para um receptor real | Nunca |
| Painel em inglês e em espanhol | O README diz que as telas foram conferidas em português. Os testes de tela rodam só em pt-BR |
| Testes de tela (`apps/panel/test/e2e`) | Guardam entrar, configurar (blocos de uma instalação nova e o limite de ligações recebidas), simular uma chamada, convidar e revogar um convite, e a confirmação antes de tirar um número da lista de não ligar. Em 2026-11-12 rodaram numa máquina de desenvolvimento, sem Docker (painel construído com `next start`, processo de voz e Postgres temporário), e cada um ficou vermelho com uma sabotagem própria. No CI rodam pela primeira vez no PR que os trouxe, no job `install`. Sem guarda de tela continuam: as outras confirmações de apagar (agente, linha, número, chave de motor, conector, webhook, pessoa da equipe), aceitar um convite pelo link, trocar a senha, "Falar com o agente" (pede microfone), instalar ou conectar o WhatsApp e atualizar pela tela |
| Mais de uma organização na mesma instalação | Só em teste de banco |
