# Kit de instalação do DeskVoice

Tudo o que se faz na VPS passa por estes scripts. Nenhum deles pede para você editar arquivo à
mão, e nenhum diz "pronto" sem conferir o resultado.

## Antes de ter servidor

Ainda não tem uma VPS? No seu computador (macOS ou Linux):

```bash
curl -fsSL https://raw.githubusercontent.com/DeskLabs-OpenSource/DeskVoice/main/install/start.sh | bash
```

`start.sh` só informa: o que é preciso, o tamanho da máquina, o link da VPS parceira (dizendo que
é de parceria e que não é obrigatório) e o comando seguinte. Não instala, não coleta e não envia
nada. Num terminal, ele pergunta se você quer abrir o link no navegador e só abre com um "s".

O nome, o endereço e o texto da oferta da parceira moram em `partner.env`. Os scripts leem dali.

## Em uma linha

```bash
curl -fsSL https://raw.githubusercontent.com/DeskLabs-OpenSource/DeskVoice/main/install/get.sh | bash
```

`get.sh` baixa o DeskVoice em `~/DeskVoice` e abre o `install.sh`. Instala o `git` se faltar. Rodar
de novo aproveita o que já está na pasta. O kit foi feito pensando na
[VPS da HostGator](https://www.hostgator.com.br/52708-141-3-52.html), parceira do projeto, e funciona em qualquer VPS com Docker.

## Ordem de uso

```bash
# 1. Instalar (na VPS, por SSH)
git clone https://github.com/DeskLabs-OpenSource/DeskVoice.git && cd DeskVoice && bash install/install.sh

# 2. Conferir, sempre que quiser
bash install/healthcheck.sh

# 3. Backup (agende todo dia; veja abaixo)
bash install/backup.sh

# 4. Atualizar, quando sair versão nova: pelo painel (Configurações → Versão e atualização), ou
bash install/update.sh

# Se algo der errado e você for pedir ajuda
bash install/diagnose.sh
```

Depois de instalar, o resto é no painel: a chave do motor de voz, a linha telefônica (tronco SIP
e número) e o agente. Nada disso é pedido no terminal.

## O que cada script faz

| Script | O que faz | O que ele confere antes de dizer que deu certo |
|---|---|---|
| `start.sh` | Roda no seu computador, antes do servidor: diz o que é preciso e entrega o comando seguinte | Não altera nada. Só mostra o link da parceira se conseguiu ler o endereço de `partner.env` |
| `install.sh` | Confere a máquina e a rede, faz poucas perguntas, gera os segredos, baixa as imagens da versão publicada mais recente, sobe tudo e cria o primeiro usuário. Pode ser rodado de novo: retoma de onde parou e nunca troca um segredo que já existe | Cada peça essencial respondendo (painel, banco, Asterisk, worker de voz, rotinas) |
| `healthcheck.sh` | Uma linha por peça, com estado e detalhe. `--json` para monitoramento | Não resume: mostra qual peça está fora |
| `backup.sh` | Copia o banco, os três arquivos de ambiente e a configuração gerada do Asterisk para `backups/<data>/` | Restaura o dump num banco de rascunho e conta as linhas de cada tabela |
| `restore.sh` | Substitui o banco por um backup. Pede que você digite `RESTAURAR` | Compara a contagem de cada tabela com o manifesto do backup, antes e depois de trocar o banco |
| `update.sh` | Mostra versão atual e alvo, faz backup, troca a versão, baixa as imagens dela, aplica as migrations e confere a saúde. Nunca constrói imagem | Se as imagens não baixam, para sem alterar nada. Se uma peça essencial não responder, volta para a versão anterior e restaura o banco do backup |
| `agent.sh` | O agente da atualização pela tela. Passa a cada minuto (o instalador agenda), anuncia ao painel a versão instalada, lê **um sim ou um não** e, se for sim, roda o `update.sh` e devolve o resultado. `--install` instala ou conserta o agendamento | Antes de anunciar, confere que esta pasta é a dona da instalação. Depois de aceitar um pedido, toda saída entrega um resultado; o que não deu para entregar fica guardado para a passada seguinte |
| `diagnose.sh` | Gera um arquivo de texto para você enviar a quem for ajudar | Senhas, chaves e tokens saem como `***`; e-mails e telefones saem encurtados |
| `test/run.sh` | Testes do próprio kit. Não precisam de Docker | Sai com erro se qualquer verificação falhar |

### `install.sh`

```bash
bash install/install.sh               # pergunta o que precisa
bash install/install.sh --dry-run     # mostra o que faria, sem alterar nada
bash install/install.sh --yes         # não pergunta; lê as respostas de variáveis
bash install/install.sh --yes --answers respostas.env
bash install/install.sh --build       # para quem desenvolve: constrói as imagens a partir do código desta pasta
```

Respostas para o modo `--yes` (variável de ambiente ou linha `CHAVE=valor` do arquivo):

| Variável | Para quê |
|---|---|
| `DESKVOICE_DOMAIN` | Domínio do painel (HTTPS). Vazio = sem domínio por enquanto: o painel fica só dentro da VPS, por túnel SSH |
| `DESKVOICE_PANEL_LOCAL_ONLY=yes` | Sem domínio: o painel só abre de dentro da VPS. Já é o padrão de instalação nova; serve para fechar uma instalação que estava publicada por HTTP |
| `DESKVOICE_PANEL_PUBLIC_HTTP=yes` | Sem domínio: publica o painel na internet por HTTP, sem HTTPS. A senha trafega sem criptografia. Só para teste, e só pedindo de propósito |
| `DESKVOICE_PANEL_PORT` | A porta local do painel (padrão: 3080, ou a seguinte livre), quando ele sai por uma porta local |
| `DESKVOICE_ORG_NAME` | Nome da empresa |
| `DESKVOICE_OWNER_NAME`, `DESKVOICE_OWNER_EMAIL`, `DESKVOICE_OWNER_PASSWORD` | O primeiro usuário (dono). Senha com 10 caracteres ou mais |
| `DESKVOICE_PUBLIC_IP` | Só se a descoberta automática do IP falhar |
| `DESKVOICE_APPLY_UFW=yes` | Aplica as regras no firewall `ufw` sem perguntar |
| `DESKVOICE_RTP_START`, `DESKVOICE_RTP_END` | Outra faixa de portas de áudio (padrão 10000 a 10200) |
| `DESKVOICE_VERSION` | Uma versão publicada específica (exemplo: `0.3.0`), em vez da mais recente |

Se usar um arquivo de respostas com a senha, apague-o depois da instalação.

`DESKVOICE_PANEL_LOCAL_ONLY` e `DESKVOICE_PANEL_PUBLIC_HTTP` aceitam um valor só, `yes`, em
minúsculas. Qualquer outro (`1`, `true`, `sim`, `no`) para a instalação com erro, antes de
gravar qualquer coisa; para ficar com o padrão, não defina a variável. O instalador também para
com erro se a opção não tem efeito no modo da sua máquina, em vez de ignorá-la: as duas só
valem **sem domínio** (com domínio o painel abre por HTTPS), e `DESKVOICE_PANEL_PORT` só vale
quando o painel sai por uma porta local.

#### O instalador só diz "pronto" depois de entrar

No fim, ele confere duas coisas pelo caminho de quem usa: pede a rota de saúde pela **porta
publicada** (com domínio, pelo próprio endereço em HTTPS) e faz **login de verdade** pela
entrada única, com o e-mail e a senha que você acabou de definir, conferindo que a sessão vale
e saindo em seguida. A senha vai pela entrada padrão: nunca aparece na tela nem em argumento
de processo. Se o endereço não responde ou o login é recusado, a instalação para com o que
falhou e o que fazer. Rodando de novo numa instalação que já tem dono, ele só testa o login se
a senha vier nas respostas (`--yes`); sem ela, diz "Login NÃO testado" em vez de fingir.

#### Que versão é instalada

O instalador descobre a versão publicada mais recente pelas tags do repositório que você baixou
(a maior tag `vX.Y.Z`), baixa as imagens dessa versão e grava o **número** em `deploy/.env`
(`DESKVOICE_VERSION=X.Y.Z`, sem o `v`). Ele nunca grava um canal como "a mais recente": assim a
instalação sabe o que está rodando, e duas instalações com o mesmo número rodam as mesmas imagens.

| Situação | O que o instalador faz |
|---|---|
| Existe versão publicada e as imagens baixam | Instala essa versão e grava o número |
| Existe versão publicada e as imagens **não** baixam | Para com erro, mostra a resposta do Docker e o comando para testar. Não constrói no lugar |
| O projeto ainda não tem nenhuma versão publicada | Constrói as imagens nesta máquina e grava `local`. Leva alguns minutos e usa bastante memória |
| Você passou `--build` | Constrói a partir do código desta pasta e grava `local`, haja ou não versão publicada |
| Não consegue consultar as versões (sem rede para o `git`, ou a pasta não é um clone) | Para com erro e diz o comando: conferir a rede, ou informar `DESKVOICE_VERSION` |

Rodar o instalador de novo numa instalação que já tem um número gravado **não troca de versão**:
quem troca é o `update.sh`, que faz backup antes. Numa instalação antiga que ainda tem `stable`
gravado (ou `local`), o instalador e o `update.sh` passam para o número da versão publicada
assim que existir uma, sem mexer nos dados.

### `update.sh`: quem atualiza é o atualizador da versão de destino

O `update.sh` instalado decide o alvo, faz o backup e troca o código. Daí em diante quem roda é
o `update.sh` **da versão que acabou de chegar** (ele é chamado com `--resume`, de uso interno).
Assim, um passo que só existe na versão nova, como uma mudança de configuração ou o agendamento
do agente, roda de fato. Antes de passar a vez, o atualizador confere que o novo carrega; se
não, volta o código e nada mais foi tocado.

A 0.1.0 é de antes desse mecanismo: quem atualiza a partir dela roda `bash install/update.sh`
**uma segunda vez** depois de atualizar. Não há o que atualizar; é o atualizador novo gerando o
segredo do agente, recriando o painel para ele recebê-lo e agendando o agente.

### `agent.sh`: a atualização pela tela

```bash
bash install/agent.sh                      # uma passada (é o que o agendamento chama)
sudo bash install/agent.sh --install       # instala ou conserta o agendamento
bash install/agent.sh --install --dry-run  # só diz o que faria
```

O painel não tem acesso ao Docker do servidor: ele só registra o pedido de atualização. O
agente passa a cada minuto, fala com o painel **de dentro do contêiner dele** (a rota do agente
não é alcançável pela internet) e recebe um sim ou um não. Nunca um comando, nunca um número de
versão: o alvo é a maior versão final publicada, que o próprio agente descobre (consulta o
repositório no máximo a cada 10 minutos) e **anuncia** ao painel, para a tela nomear na
confirmação a versão que de fato seria instalada. Com o sim, ele roda `update.sh --to` essa
versão. Cada conversa com o painel tem prazo de 30 segundos: painel que não responde vira falha
no registro, e a passada termina.

| O quê | Onde |
|---|---|
| Agendamento | Timer do systemd `deskvoice-agent.timer` (a cada minuto, com atraso aleatório de até 15 s), rodando como o dono da pasta. Sem systemd: `/etc/cron.d/deskvoice-agent`. Sem nenhum dos dois: o instalador avisa, e a tela mostra que o agente não está instalado |
| Segredo | `UPDATE_AGENT_TOKEN`, em `deploy/.env`, gerado pelo instalador. O Compose o entrega só ao painel; voz e rotinas não o recebem |
| Registro do que falhou | `deploy/agent/agent.log` (a cópia anterior em `agent.log.1`) |
| Resultado ainda não entregue | `deploy/agent/pending-result`; vai na passada seguinte |
| Ver se está passando | `bash install/healthcheck.sh` (linha "Agente de atualização": agendado ou não, e quando falou com o painel pela última vez) e, no painel, Configurações → Versão e atualização |

O agente recusa rodar se a instalação que está no ar foi criada a partir de outra pasta: um
segundo clone do repositório na mesma máquina não atualiza a instalação de verdade.

`--build` é para quem desenvolve. Imagem construída na VPS não é a que o projeto testou e
publicou, e precisa ser reconstruída à mão a cada mudança.

O endereço das imagens mora num arquivo só, `deploy/images.env`, que vem com o repositório. O
Compose, este kit e a publicação das imagens leem dali; nada disso é gravado por instalação.

O instalador grava três arquivos em `deploy/`, todos legíveis só pelo seu usuário. Estão
separados para cada contêiner receber só o que usa:

| Arquivo | Quem recebe | O que tem |
|---|---|---|
| `deploy/.env` | O Compose (que entrega a senha só ao Postgres e o segredo do agente só ao painel) | Senha do dono do banco, domínio, faixa de áudio, número da versão instalada, segredo do agente de atualização |
| `deploy/app.env` | Painel, voz e rotinas | Conexões de aplicação, chave de segredos, senha interna do Asterisk, endereço público. Não tem a senha do dono do banco nem o segredo do agente de atualização |
| `deploy/migrate.env` | Só as migrations e a criação do primeiro usuário | Conexão do dono do banco e as senhas dos papéis de aplicação |

Você não edita nenhum deles. Se um valor precisar mudar (IP novo, domínio novo), rode o
instalador de novo.

Há um quarto arquivo gerado, `deploy/docker-compose.override.yml`: é o único lugar em que uma
porta web é publicada. O painel e a voz do navegador entram sempre por um endereço só, o do
Caddy do DeskVoice:

| Situação da máquina | Onde o Caddy do DeskVoice escuta |
|---|---|
| Portas 80 e 443 livres, com domínio | 80 e 443, com HTTPS automático |
| Sem domínio (com as portas 80 e 443 livres ou não) | Uma porta local única (a partir da 3080), só em `127.0.0.1` e só HTTP. Você entra por túnel SSH |
| Sem domínio, com `DESKVOICE_PANEL_PUBLIC_HTTP=yes` | 80, só HTTP, aberto para a internet; ou a porta local aberta para fora, se 80 e 443 já são de outro proxy |
| 80 e 443 já de outro proxy, com domínio | A mesma porta local única, só em `127.0.0.1`. O proxy que já existe aponta para ela e para mais nada |

O endereço que o instalador anuncia no fim é lido deste arquivo, o mesmo que o Compose publica
e que a checagem de saúde sonda.

O painel e o processo de voz nunca publicam porta própria.

### `healthcheck.sh`

Estados: `ok`, `aviso` (falta configurar, não é defeito) e `falha` (quebrado). Linha telefônica
ainda não cadastrada é `aviso`; linha cadastrada que a operadora recusa é `falha`.

A linha "Entrada única" pergunta ao Caddy do DeskVoice, de dentro, pelos dois caminhos: o
painel e o `/voice-ws` (por onde vai o áudio de "Falar com o agente"). Se o painel responde e a
voz não, é `falha`, com a causa. Ela não enxerga o proxy que você colocou na frente: confere
até a porta do DeskVoice.

A mesma sonda pede a rota do agente de atualização, que para a internet não existe. Quem tem de
recusá-la é o Caddy (404 sem corpo). Se o 404 vem do painel, a linha "Agente de atualização"
vira `aviso`: o Caddy está rodando a configuração de antes da atualização (o arquivo só é
relido ao reiniciar). Resolve com `docker restart deskvoice-caddy-1`; rodar `bash
install/update.sh` também reinicia o Caddy quando o arquivo que ele tem montado não é o do disco.

Código de saída: `0` sem falha, `1` se falhou peça essencial (painel, banco, Asterisk, worker
de voz, rotinas), `2` se falhou outra (linha, motor de voz, entrada única, portas, disco).

### `backup.sh` e `restore.sh`

```bash
bash install/backup.sh                 # mantém os 14 mais recentes
bash install/backup.sh --keep 30
bash install/restore.sh latest
bash install/restore.sh backups/20261110-030000
bash install/restore.sh latest --with-config   # traz também a configuração do backup (troca de VPS)
```

**Trocando de VPS:** depois de `restore.sh latest --with-config` na máquina nova, rode
`bash install/install.sh` de novo. A configuração restaurada traz o IP público da máquina antiga,
e é o instalador que detecta o IP novo e regera os arquivos do Asterisk. Sem esse passo o painel
abre e as ligações ficam mudas.

Agendar todo dia às 3h: `crontab -e` e acrescente
`0 3 * * * cd /caminho/DeskVoice && bash install/backup.sh`.

O backup fica na mesma máquina. Copie a pasta `backups/` para outro lugar de tempos em tempos:
se o disco da VPS se perder, o backup vai junto.

A restauração primeiro monta o backup num banco ao lado e compara as contagens. Só depois ele
toma o lugar do banco atual. Se alguma tabela divergir, o script diz qual, e o banco atual fica
como estava.

## Os problemas mais prováveis

### 1. A ligação conecta e fica muda

É quase sempre rede: o áudio vai por UDP, numa faixa de portas, e alguém no caminho não deixou
passar.

1. Rode `bash install/healthcheck.sh` e leia a linha "Portas UDP locais". Se ela falhar, o
   conserto está escrito nela.
2. No painel do provedor da VPS (firewall, security group), libere a entrada de `5060/udp` e
   de `10000-10200/udp`. O instalador confere a máquina, mas não tem como abrir nem enxergar o
   firewall do provedor.
3. Se o IP público da VPS mudou, rode `bash install/install.sh` de novo. Ele regrava o IP que
   o Asterisk anuncia para a operadora.
4. Refaça a ligação e acompanhe na tela Chamadas. Só a ligação prova que o áudio passa.

### 2. As portas 80 e 443 já estão ocupadas

Já existe outro proxy na máquina (Traefik, Nginx, outro Caddy). O instalador percebe e não
disputa as portas: o DeskVoice inteiro (painel e voz do navegador) fica atrás de **uma porta
local só**, a partir da 3080, e o instalador imprime a linha exata para o proxy que já existe.
Para ver as instruções de novo, rode `bash install/install.sh` outra vez; ele mantém a mesma
porta.

O seu proxy encaminha o domínio inteiro para essa porta. Duas coisas ele precisa repassar,
e as linhas que o instalador imprime já trazem as duas:

- **conexões contínuas (WebSocket):** sem isso o painel abre e "Falar com o agente" não conecta.
  No Nginx são os cabeçalhos `Upgrade` e `Connection`, com `proxy_http_version 1.1`;
- **o endereço de quem acessa (`X-Forwarded-For`):** é com ele que o limite de tentativas de
  login separa uma pessoa da outra.

Se o seu proxy tinha uma regra separada para `/voice-ws` apontando para outra porta (era assim
até a versão anterior), apague-a. Agora é tudo no mesmo destino.

Se quem ocupa é a porta `5060/udp` ou a faixa de áudio, é outro programa de telefonia. Descubra
com `sudo ss -lunp | grep :5060`, pare esse programa e rode o instalador de novo.

### 3. Ainda não tenho domínio

Sem domínio não há HTTPS, então o instalador **não publica a tela de login na internet**: o
painel abre só de dentro da VPS. Do seu computador, abra um túnel e use `http://localhost:3080`
enquanto ele estiver aberto (o instalador mostra o comando com a porta e o IP certos):

```bash
ssh -L 3080:127.0.0.1:3080 usuario@ip-da-vps
```

É uma porta só. "Falar com o agente" funciona por esse mesmo túnel, e em `localhost` o
navegador libera o microfone mesmo sem HTTPS. Pelo IP e sem HTTPS, não libera.

Quando tiver o domínio, aponte-o para a VPS (registro A) e rode de novo, informando o domínio:
o painel passa a abrir por HTTPS, de qualquer lugar.

```bash
DESKVOICE_DOMAIN=voz.suaempresa.com.br bash install/install.sh
```

Quer mesmo o painel aberto pelo IP, por HTTP, sem domínio? É um pedido explícito, e a senha
trafega **sem criptografia**; serve para um teste rápido, não para uso de verdade:

```bash
DESKVOICE_PANEL_PUBLIC_HTTP=yes bash install/install.sh
```

**Instalou antes desta mudança e o painel já abre pelo IP, por HTTP?** Rodar o instalador ou o
atualizador de novo **não muda isso**: a exposição de quem já instalou só muda a pedido. O
instalador avisa com destaque e mostra o comando para fechar o painel e passar ao túnel:

```bash
DESKVOICE_PANEL_LOCAL_ONLY=yes bash install/install.sh
```

Rodar o instalador de novo mantém a escolha feita, e a porta.

### 4. A atualização voltou sozinha

Quer dizer que a versão nova subiu e alguma peça essencial não respondeu. O `update.sh` voltou
para a versão anterior e restaurou o banco do backup feito antes de começar. A mensagem final
diz qual peça falhou e onde está o backup. Rode `bash install/diagnose.sh` e abra uma issue com
o arquivo, dizendo para qual versão tentou atualizar. Sua instalação segue funcionando na
versão anterior.

Se a mensagem disser que a volta não terminou bem, não rode mais nada: seus dados estão no
backup indicado. Gere o diagnóstico e peça ajuda.

Se a mensagem disser que não conseguiu **baixar as imagens**, nada foi alterado: a instalação
segue na versão em que estava, com o banco intocado. Veja o problema 8.

### 5. Esqueci a senha do painel

```bash
bash install/reset-password.sh voce@empresa.com.br
```

O script pede a senha nova duas vezes, troca, encerra as sessões abertas dessa conta e **entra
com a senha nova** pela tela de login antes de dizer que trocou. Só funciona de dentro da VPS:
quem tem acesso ao servidor já é dono da instalação. Se o e-mail não existir, ele diz isso e
não altera nada. Se você errou a senha várias vezes antes de chegar aqui, o painel segura novas
tentativas para esse e-mail por até 15 minutos: o script troca a senha, diz que não conseguiu
testar e pede para esperar.

Não rode o instalador de novo esperando que ele troque a senha: ele vê que já existe um dono e
não cria outro.

### 6. A checagem diz "Controle da telefonia: falha"

O Asterisk está de pé, mas o processo de voz não consegue falar com ele, então nenhuma ligação é
atendida. A causa mais comum é o Asterisk não ter lido a configuração. Rode `bash
install/install.sh` de novo: ele regrava os arquivos com a permissão certa. Se continuar, veja
`docker compose -f deploy/docker-compose.yml logs --tail 50 asterisk`.

### 7. O painel abre e "Falar com o agente" não conecta

A tela diz que o painel abriu mas não alcançou o serviço de voz no mesmo endereço. O áudio do
navegador vai por uma conexão contínua (WebSocket) no caminho `/voice-ws`, pelo mesmo endereço
do painel. Alguém no caminho não repassou essa conexão.

1. Rode `bash install/healthcheck.sh` e leia a linha "Entrada única".
2. Se ela diz **falha**, o problema está dentro do DeskVoice e o conserto está escrito na linha.
   "Formato antigo" ou "não tem porta publicada" se resolvem com `bash install/install.sh`.
3. Se ela diz **ok**, o DeskVoice está entregando painel e voz na porta dele, e quem não repassa
   é o que está na frente: o seu proxy. Confira nele o repasse de WebSocket (problema 2, acima)
   e se o domínio inteiro aponta para a porta única, sem regra separada para `/voice-ws`.
4. Por túnel SSH, confira se o túnel é para a porta do painel que o instalador mostrou. Não
   existe mais segunda porta para abrir.

### 8. O instalador (ou a atualização) não conseguiu baixar as imagens

A mensagem traz a resposta do Docker e um comando `docker pull ...` para testar. As causas, da
mais comum para a menos:

1. A VPS está sem acesso ao registro das imagens (`ghcr.io`). Rode o `docker pull` indicado: se
   ele também falha, é rede ou o registro fora do ar. Tente de novo em alguns minutos.
2. A versão acabou de sair e as imagens ainda estão sendo publicadas. Espere alguns minutos.
3. O `docker pull` responde "denied" ou "unauthorized": a imagem existe e não está pública. Isso
   é defeito da publicação, e não da sua VPS: abra uma issue.

O kit não constrói as imagens na VPS para contornar: uma imagem construída ali não é a que foi
testada, e nenhuma atualização a trocaria depois. Nada é alterado até as imagens baixarem.

## Testes do kit

```bash
bash install/test/run.sh          # todos
bash install/test/run.sh backup   # só os arquivos com "backup" no nome
```

Os testes usam um `docker` de mentira (em `install/test/fake/`) que só registra as chamadas, e
pastas temporárias, e um `git` de mentira que faz as vezes de um clone com as versões que o teste
escolhe. Não sobem contêiner, não falam com a internet e não tocam no git de verdade (só o
teste do `get.sh` clona, e de um repositório local criado por ele).
