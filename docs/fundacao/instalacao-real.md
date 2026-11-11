# Instalação real

> Registro criado em 2026-11-11 pela auditoria de conformidade, a partir do que o dono informou e
> do que está no PR #3. Quem escreveu este arquivo não esteve na instalação.

## O que foi feito

| Campo | Valor |
|---|---|
| Data | 2026-11-11 |
| Máquina | VPS de teste do parceiro (HostGator), Ubuntu 22.04, segundo o PR #3. Máquina compartilhada, e não um servidor recém-criado |
| Caminho | O comando de uma linha do README (`install/get.sh`) |
| Modo | Sem perguntas (`--yes`), com as respostas por variáveis `DESKVOICE_*` |
| Chave de provedor | Nenhuma na instalação |

## O que a instalação achou

| Defeito | Efeito | Correção |
|---|---|---|
| Arquivos de configuração do Asterisk montados direto do repositório herdavam a permissão de quem baixou. Com permissões padrão restritas (umask 077), o Asterisk não lia o plano de discagem nem a interface de controle | O instalador terminava dizendo que tudo respondia, e nenhuma ligação seria atendida | PR #3: tudo o que o Asterisk lê sai de `deploy/asterisk/generated`, gravado com permissão explícita |
| A checagem de saúde não conferia a ligação entre o processo de voz e o Asterisk | O defeito acima não aparecia em lugar nenhum | PR #3: linha "Controle da telefonia" em `install/healthcheck.sh` |

Evidência: <https://github.com/DeskLabs-OpenSource/DeskVoice/pull/3>.

## O que não foi provado

- Instalação num servidor recém-criado.
- Instalação pelo modo com perguntas no terminal.
- Instalação numa VPS de outro provedor.
- Entrada no painel pelo navegador com o usuário criado pelo instalador, conferida pelo instalador.
- Backup, restauração e atualização nessa máquina.
- Ligação por operadora.
- Chamada pelo navegador a partir de um navegador.

## O que não foi medido

- Memória e disco do sistema parado, com o tamanho da máquina (item 3.4 da conformidade).

## O que aconteceu depois do merge das correções

Registrado por quem conduziu a instalação (a sessão que constrói o DeskVoice), a partir do que foi observado na própria máquina. Não há captura guardada no repositório; os comandos abaixo reproduzem a conferência.

| Quando (UTC, 2026-11-11) | O que foi feito | O que se observou |
|---|---|---|
| 13:48, depois do PR #3 | `git pull` e `bash install/install.sh --yes` de novo, na mesma instalação | O instalador reconheceu a instalação anterior, não criou outro dono e manteve o painel só local. `bash install/healthcheck.sh`: "Controle da telefonia: ok, o processo de voz está conectado ao Asterisk". O usuário do Asterisk lê os cinco arquivos de configuração; `dialplan show from-trunk` mostra as três entradas; a interface de controle está ligada |
| 14:09 | Chamada simulada pelas rotas do painel instalado | Desfecho `completed`, 24 eventos, aviso de gravação antes da saudação, resumo gravado pelas rotinas |
| 14:44, depois do PR #4 | `git pull` e instalador de novo | Painel em `127.0.0.1:3080` e voz do navegador em `127.0.0.1:3081`; de fora, pela internet, nenhuma das duas responde |
| 14:45 | Conversa por voz com o motor OpenAI Realtime, por um cliente de teste que faz o papel do navegador com fala gravada | Fala em português entendida e transcrita, ferramenta `notify_human` acionada, 67 s, custo estimado de 33 centavos de dólar |

| por volta de 17:10, depois do PR #7 | Backup, `git pull` e instalador de novo, com a instalação em duas portas | A instalação passou para a entrada única: só o Caddy publica porta (`127.0.0.1:3080`), painel e voz deixaram de publicar. `healthcheck.sh` com a linha "Entrada única: ok". Dados preservados |
| por volta de 17:20 | Conversa por voz pela entrada única, pelo mesmo cliente de teste, através de um túnel SSH para a porta única | Aviso de gravação, saudação, fala em português entendida e respondida; 17 centavos de dólar. O cliente de teste não foi guardado no repositório |
| 19:10, depois da versão 0.1.0 | `git pull` (a `main` era o commit da tag) e `bash install/update.sh --yes`, com a instalação em `stable` e imagens construídas na própria VPS | Primeira atualização entre versões. Backup conferido, as três imagens `0.1.0` baixadas do registro sem login, migrations, subida, saída 0. Depois: `DESKVOICE_VERSION=0.1.0`, a cópia do endereço das imagens saiu do `.env`, contêineres nas imagens publicadas, Postgres 17.11 e Caddy 2.11.9, todas as peças da saúde em ok, agente, usuário e nove chamadas preservados. Compose 5.1.4 |
| por volta de 19:20 | Comando de uma linha (`get.sh`) em simulação (`--yes --dry-run`), numa pasta separada da mesma VPS | O clone ficou na tag `v0.1.0`; o instalador reconheceu a 0.1.0 como a publicada mais recente e disse que baixaria as imagens dela, sem construir. Nada foi alterado na instalação viva |

Então rodar o instalador uma segunda vez **foi** exercitado, três vezes, numa instalação com dados. O que continua sem prova está na lista acima.

Correção sobre a causa do defeito de permissão: o `umask 077` não era da máquina. Veio do comando de quem instalava, que restringiu as permissões para proteger o arquivo da senha, e o instalador herdou. Um servidor endurecido teria o mesmo efeito, mas essa instalação não prova como é o padrão da VPS do parceiro.

## Ordem dos fatos

O repositório ficou público em 2026-11-11 às 12:09 UTC. A correção do defeito entrou às 13:47 UTC.
A instalação real aconteceu depois da publicação (item 13.5 da conformidade).

## O que continua sem prova depois da 0.1.0

- Instalação do zero, de verdade, pelo comando de uma linha contra uma versão publicada, numa máquina limpa. Só a simulação e a atualização foram exercitadas.
- Conversa por voz depois da atualização para a 0.1.0.
- A volta automática do `update.sh` numa VPS.
- Instalação em processador ARM, que só existe construindo na própria máquina.
