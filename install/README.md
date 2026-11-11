# Kit de instalação do DeskVoice

Tudo o que se faz na VPS passa por estes scripts. Nenhum deles pede para você editar arquivo à
mão, e nenhum diz "pronto" sem conferir o resultado.

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

# 4. Atualizar, quando sair versão nova
bash install/update.sh

# Se algo der errado e você for pedir ajuda
bash install/diagnose.sh
```

Depois de instalar, o resto é no painel: a chave do motor de voz, a linha telefônica (tronco SIP
e número) e o agente. Nada disso é pedido no terminal.

## O que cada script faz

| Script | O que faz | O que ele confere antes de dizer que deu certo |
|---|---|---|
| `install.sh` | Confere a máquina e a rede, faz poucas perguntas, gera os segredos, sobe tudo e cria o primeiro usuário. Pode ser rodado de novo: retoma de onde parou e nunca troca um segredo que já existe | Cada peça essencial respondendo (painel, banco, Asterisk, worker de voz, rotinas) |
| `healthcheck.sh` | Uma linha por peça, com estado e detalhe. `--json` para monitoramento | Não resume: mostra qual peça está fora |
| `backup.sh` | Copia o banco, os três arquivos de ambiente e a configuração gerada do Asterisk para `backups/<data>/` | Restaura o dump num banco de rascunho e conta as linhas de cada tabela |
| `restore.sh` | Substitui o banco por um backup. Pede que você digite `RESTAURAR` | Compara a contagem de cada tabela com o manifesto do backup, antes e depois de trocar o banco |
| `update.sh` | Mostra versão atual e alvo, faz backup, troca a versão, aplica as migrations e confere a saúde | Se uma peça essencial não responder, volta para a versão anterior e restaura o banco do backup |
| `diagnose.sh` | Gera um arquivo de texto para você enviar a quem for ajudar | Senhas, chaves e tokens saem como `***`; e-mails e telefones saem encurtados |
| `test/run.sh` | Testes do próprio kit. Não precisam de Docker | Sai com erro se qualquer verificação falhar |

### `install.sh`

```bash
bash install/install.sh               # pergunta o que precisa
bash install/install.sh --dry-run     # mostra o que faria, sem alterar nada
bash install/install.sh --yes         # não pergunta; lê as respostas de variáveis
bash install/install.sh --yes --answers respostas.env
```

Respostas para o modo `--yes` (variável de ambiente ou linha `CHAVE=valor` do arquivo):

| Variável | Para quê |
|---|---|
| `DESKVOICE_DOMAIN` | Domínio do painel. Vazio = sem domínio por enquanto |
| `DESKVOICE_ORG_NAME` | Nome da empresa |
| `DESKVOICE_OWNER_NAME`, `DESKVOICE_OWNER_EMAIL`, `DESKVOICE_OWNER_PASSWORD` | O primeiro usuário (dono). Senha com 10 caracteres ou mais |
| `DESKVOICE_PUBLIC_IP` | Só se a descoberta automática do IP falhar |
| `DESKVOICE_APPLY_UFW=yes` | Aplica as regras no firewall `ufw` sem perguntar |
| `DESKVOICE_RTP_START`, `DESKVOICE_RTP_END` | Outra faixa de portas de áudio (padrão 10000 a 10200) |

Se usar um arquivo de respostas com a senha, apague-o depois da instalação.

O instalador grava três arquivos em `deploy/`, todos legíveis só pelo seu usuário. Estão
separados para cada contêiner receber só o que usa:

| Arquivo | Quem recebe | O que tem |
|---|---|---|
| `deploy/.env` | O Compose (e o Postgres) | Senha do dono do banco, domínio, faixa de áudio, versão |
| `deploy/app.env` | Painel, voz e rotinas | Conexões de aplicação, chave de segredos, senha interna do Asterisk, endereço público. Não tem a senha do dono do banco |
| `deploy/migrate.env` | Só as migrations e a criação do primeiro usuário | Conexão do dono do banco e as senhas dos papéis de aplicação |

Você não edita nenhum deles. Se um valor precisar mudar (IP novo, domínio novo), rode o
instalador de novo.

Há um quarto arquivo gerado, `deploy/docker-compose.override.yml`: é o único lugar em que uma
porta web é publicada. O painel e a voz do navegador entram sempre por um endereço só, o do
Caddy do DeskVoice:

| Situação da máquina | Onde o Caddy do DeskVoice escuta |
|---|---|
| Portas 80 e 443 livres, com domínio | 80 e 443, com HTTPS automático |
| Portas 80 e 443 livres, sem domínio | 80, só HTTP |
| 80 e 443 já de outro proxy | Uma porta local única (a partir da 3080), só HTTP. O proxy que já existe, ou um túnel SSH, aponta para ela e para mais nada |

O painel e o processo de voz nunca publicam porta própria.

### `healthcheck.sh`

Estados: `ok`, `aviso` (falta configurar, não é defeito) e `falha` (quebrado). Linha telefônica
ainda não cadastrada é `aviso`; linha cadastrada que a operadora recusa é `falha`.

A linha "Entrada única" pergunta ao Caddy do DeskVoice, de dentro, pelos dois caminhos: o
painel e o `/voice-ws` (por onde vai o áudio de "Falar com o agente"). Se o painel responde e a
voz não, é `falha`, com a causa. Ela não enxerga o proxy que você colocou na frente: confere
até a porta do DeskVoice.

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

Sem domínio o painel abre pelo IP e **sem HTTPS**: a senha trafega sem proteção. Serve para testar.
Quando tiver o domínio, aponte-o para a VPS e rode `bash install/install.sh` de novo.

Se as portas 80 e 443 já são de outro proxy e você não quer um login exposto na internet, peça
acesso só local:

```bash
DESKVOICE_PANEL_LOCAL_ONLY=yes bash install/install.sh
```

O painel passa a abrir só de dentro da VPS. Do seu computador, abra um túnel e use
`http://localhost:3080` enquanto ele estiver aberto:

```bash
ssh -L 3080:127.0.0.1:3080 usuario@ip-da-vps
```

É uma porta só. "Falar com o agente" funciona por esse mesmo túnel, e em `localhost` o
navegador libera o microfone mesmo sem HTTPS. Pelo IP e sem HTTPS, não libera.

Rodar o instalador de novo mantém essa escolha.

### 4. A atualização voltou sozinha

Quer dizer que a versão nova subiu e alguma peça essencial não respondeu. O `update.sh` voltou
para a versão anterior e restaurou o banco do backup feito antes de começar. A mensagem final
diz qual peça falhou e onde está o backup. Rode `bash install/diagnose.sh` e abra uma issue com
o arquivo, dizendo para qual versão tentou atualizar. Sua instalação segue funcionando na
versão anterior.

Se a mensagem disser que a volta não terminou bem, não rode mais nada: seus dados estão no
backup indicado. Gere o diagnóstico e peça ajuda.

### 5. Esqueci a senha do painel

```bash
bash install/reset-password.sh voce@empresa.com.br
```

O script pede a senha nova duas vezes, troca e encerra as sessões abertas dessa conta. Só
funciona de dentro da VPS: quem tem acesso ao servidor já é dono da instalação. Se o e-mail não
existir, ele diz isso e não altera nada.

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

## Testes do kit

```bash
bash install/test/run.sh          # todos
bash install/test/run.sh backup   # só os arquivos com "backup" no nome
```

Os testes usam um `docker` de mentira (em `install/test/fake/`) que só registra as chamadas, e
pastas temporárias. Não sobem contêiner, não falam com a internet e não tocam no git.
