# Instalar o DeskVoice na mesma VPS do DeskcommCRM

Se o DeskcommCRM já roda nesta VPS, as portas 80 e 443 são do Caddy dele. O DeskVoice não
disputa essas portas em nenhum momento: o Caddy dele fica só com HTTP numa porta local
(`127.0.0.1:3080`), e o Caddy do CRM publica o domínio do painel para fora. É o mesmo arranjo de
qualquer VPS que já tem um proxy — a diferença é que aqui o proxy é de contêiner, e o
`127.0.0.1` do host não é o mesmo endereço para ele.

O caminho completo é: instalar, ligar o Caddy do DeskVoice na rede do ponto de extensão do CRM
(pelo próprio instalador, para a ligação sobreviver às atualizações), soltar um arquivo `.caddy` e
recarregar o Caddy do CRM.

## Como fica o desenho

```
navegador ── https://voz.exemplo.com.br ──▶ Caddy do CRM (80/443, HTTPS)
                                            │  lê caddy-sites/*.caddy
                                            ▼
                                          rede <projeto>_caddy-sites
                                            │  alias `deskvoice`
                                            ▼
                                          Caddy do DeskVoice (HTTP :80, dentro do contêiner)
                                            │
                                            └─▶ painel e /voice-ws
```

Nada do DeskVoice publica 80 ou 443. A única porta que ele abre no host é a `127.0.0.1:3080`, e
ela serve para conferir de dentro da VPS.

## Antes de começar

1. **O CRM instalado, com o ponto de extensão.** Na pasta do clone do CRM:

   ```bash
   ls caddy-sites/
   docker compose -f docker-compose.prod.yml exec caddy tail -3 /etc/caddy/Caddyfile
   ```

   A primeira linha precisa listar a pasta (pelo menos o `README.caddy`); a segunda precisa
   terminar em `import /etc/caddy/sites/*.caddy`. É esse `import` que faz o seu arquivo valer.

2. **Um domínio só para o painel do DeskVoice**, com registro A apontando para o IP desta VPS.
   Quem emite o certificado é o Caddy do CRM, com o mesmo `ACME_EMAIL` que ele já usa. Não use o
   domínio do CRM.

3. **As portas de telefonia livres.** O DeskVoice usa `5060/udp` e uma faixa de áudio
   (`10000-10200/udp` por padrão). Confira antes:

   ```bash
   sudo ss -lunp | grep ':5060'
   ```

   Vazio, siga. Se aparecer o Asterisk do CRM, leia [Se a telefonia do CRM estiver
   ligada](#se-a-telefonia-do-crm-estiver-ligada) antes de instalar: o instalador recusa nesse
   caso, de propósito.

## Passo 1 — instalar o DeskVoice com o domínio, publicando só em 127.0.0.1

Na pasta do clone do DeskVoice:

```bash
DESKVOICE_DOMAIN=voz.exemplo.com.br bash install/install.sh
```

Informe o domínio mesmo que quem responda ao HTTPS seja o Caddy do CRM: é ele que o instalador
grava como endereço público do painel e que faz o painel confiar no proxy da frente.

O instalador encontra as portas 80 e 443 ocupadas, não briga por elas e grava
`deploy/docker-compose.override.yml` com `CADDY_SITE: ":80"` e uma única publicação,
`127.0.0.1:3080:80`. Confira:

```bash
docker port deskvoice-caddy-1                          # 80/tcp -> 127.0.0.1:3080
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3080/    # 200 ou 307
```

- A porta 3080 é o padrão; se estiver ocupada, o instalador pega a seguinte livre (ou use
  `DESKVOICE_PANEL_PORT=`). Quem diz a porta certa é o `docker port` acima, e o instalador repete
  a linha exata no fim. Nos comandos deste guia, troque 3080 pela sua.
- No fim ele avisa que falta um passo no proxy que já existe, e imprime instruções para Nginx e
  Caddy **instalados na máquina**. Não é o seu caso: o Caddy do CRM é de contêiner, e é o que os
  passos 2 a 6 resolvem.

## Passo 2 — achar o nome da rede do ponto de extensão

Na pasta do clone do CRM:

```bash
docker network ls --format '{{.Name}}' | grep '_caddy-sites$'
docker network inspect <rede> --format '{{range .Containers}}{{.Name}} {{end}}'
```

O primeiro comando imprime algo como `deskcommcrm_caddy-sites`. O prefixo é o nome do projeto do
Compose, que vem do nome da pasta do clone — por isso se mede aqui em vez de decorar. O segundo
mostra quem está na rede: o Caddy do CRM precisa estar na lista.

Não use a rede `_internal` do CRM: é a dos serviços internos dele, e o próprio `caddy-sites`
pede para não misturar.

## Passo 3 — ligar o Caddy do DeskVoice na rede, com um nome

Na pasta do DeskVoice, rode o instalador de novo informando a rede do passo 2:

```bash
DESKVOICE_PROXY_NETWORK=<rede> bash install/install.sh
```

- O instalador grava a rede no arquivo de publicação que ele gera
  (`deploy/docker-compose.override.yml`), e o Caddy do DeskVoice entra nela com o nome
  `deskvoice`, que é o que vai no arquivo `.caddy` do passo 4.
- Reinstalar não troca segredo nem dado, e mantém o domínio e a porta que já estavam.
- Como a rede está declarada, a ligação sobrevive a toda atualização e restauração, sem passo
  repetido.
- Se a rede não existe, o instalador para antes de mudar qualquer coisa e diz o nome que recebeu.
- Para deixar de usar a rede: `DESKVOICE_PROXY_NETWORK=off bash install/install.sh`.

**Por que não `127.0.0.1:3080` nem `host.docker.internal:3080`.** Medido no
`docker-compose.prod.yml` do CRM: o serviço `caddy` está nas redes `internal` e `caddy-sites` e
**não** declara `extra_hosts: host.docker.internal:host-gateway`. Então, de dentro dele,
`127.0.0.1` é o próprio contêiner e `host.docker.internal` não resolve. Se quiser confirmar na
sua VPS antes de usar a segunda possibilidade:

```bash
docker compose -f docker-compose.prod.yml exec caddy \
  wget -q -O- --timeout=3 http://host.docker.internal:3080/ ; echo "rc=$?"
```

`rc=0` com a tela do painel: a sua instalação do CRM tem esse atalho, e você pode usar
`host.docker.internal:3080` no `.caddy` em vez do alias. Erro de endereço: não tem — vá de alias,
que é o que este guia usa. Acrescentar `extra_hosts` no compose do CRM não é opção: é arquivo
versionado, e a alteração trava o `update.sh` dele.

Prove o caminho antes de mexer no Caddy:

```bash
docker compose -f docker-compose.prod.yml exec caddy \
  wget -q -O- http://deskvoice:80/api/v1/system/health
```

Tem de sair um JSON começando com `{"panel":{"status":"ok"…`. Sem isso, recarregar o Caddy só
troca um 404 por um 502 — resolva o passo 3 primeiro.

**A variante que o instalador imprime.** No fim, o instalador do DeskVoice sugere
`docker network connect deskvoice_internal <contêiner do proxy>` e apontar o domínio para
`http://deskvoice-caddy-1:80`. Também funciona, com duas diferenças: o Caddy do CRM passa a
alcançar a rede interna do DeskVoice (onde ficam o Postgres e o processo de voz), e a ligação tem
de ser refeita toda vez que o CRM recria o contêiner dele. A rede `caddy-sites` do CRM existe para
o contrário disso — só o proxy e os serviços publicados por ele. Escolha uma das duas e siga com
ela; misturar as duas não deixa nada mais rápido e dobra o que refazer depois de atualizar.

## Passo 4 — o arquivo `.caddy`

Copie o exemplo versionado para a pasta do ponto de extensão, com um nome novo e a extensão
`.caddy`:

```bash
cp docs/guides/exemplos/deskvoice.caddy <pasta-do-CRM>/caddy-sites/deskvoice.caddy
```

O conteúdo, depois de trocar o domínio:

```caddyfile
voz.exemplo.com.br {
	reverse_proxy deskvoice:80
}
```

Duas linhas bastam, e é de propósito:

- HTTPS e certificado: o Caddy que lê este arquivo já tem as portas 80 e 443 e o `ACME_EMAIL`;
- `X-Forwarded-For`: ele repassa sozinho, e o Caddy do DeskVoice já está configurado para confiar
  no vizinho de rede privada e contar dois saltos;
- `/voice-ws` (o áudio de "Falar com o agente"): quem separa esse caminho é o Caddy do DeskVoice,
  e o WebSocket atravessa o proxy da frente sem regra extra;
- compressão: o Caddy do DeskVoice já comprime (`zstd` e `gzip`), então `encode gzip` aqui seria
  trabalho repetido.

Não edite o `caddy-sites/README.caddy` para publicar: ele é versionado, e arquivo versionado
alterado trava a atualização do CRM. Um arquivo novo ao lado dele não aparece em `git status` e
não atrapalha o `update.sh`.

## Passo 5 — conferir e recarregar o Caddy do CRM

Na pasta do clone do CRM:

```bash
docker compose -f docker-compose.prod.yml exec caddy caddy validate --config /etc/caddy/Caddyfile
docker compose -f docker-compose.prod.yml exec caddy caddy reload  --config /etc/caddy/Caddyfile
```

No modo single-server, troque o `-f` por `docker-compose.single-server.yml` — na mesma ordem em
que a instalação do CRM usa.

`reload`, nunca `restart`: com um arquivo errado, o `reload` recusa, diz a linha e mantém no ar o
que já estava; o `restart` derruba o CRM junto.

## Passo 6 — conferir de fora

1. O domínio responde:

   ```bash
   curl -sS -o /dev/null -w '%{http_code}\n' https://voz.exemplo.com.br/
   ```

   200 ou 307. O primeiro pedido pode demorar: é o certificado saindo. Se não sair, o motivo está
   no log — `docker compose -f docker-compose.prod.yml logs --tail 50 caddy`.

2. O painel responde pelo domínio, e não só pela porta local:

   ```bash
   curl -sS https://voz.exemplo.com.br/api/v1/system/health
   ```

3. No navegador: entre com o e-mail e a senha do dono e clique em **"Falar com o agente"**. É a
   única prova do WebSocket — se o painel abre e o botão não conecta, o problema está no caminho
   do proxy.

4. Na pasta do DeskVoice, `bash install/healthcheck.sh` confere a linha "Entrada única" (painel e
   `/voice-ws`) até a porta do DeskVoice. Ele **não** enxerga o Caddy do CRM: a prova de fora são
   os itens 1 a 3.

## Depois de atualizar o DeskVoice

Não há nada a refazer. `install/update.sh` recria o contêiner do Caddy quando a imagem ou a
configuração muda, e o contêiner novo já nasce na rede, porque ela está declarada no arquivo de
publicação. Para conferir:

```bash
docker network inspect <rede> --format '{{range .Containers}}{{.Name}} {{end}}'
```

A lista precisa ter `deskvoice-caddy-1`.

Se a ligação foi feita à mão, com `docker network connect`, como este guia ensinava até a 0.11.0,
rode o passo 3 uma vez: a partir daí, ela fica declarada.

Se a rede do CRM deixar de existir, porque o CRM foi derrubado com o DeskVoice parado, o Compose
do DeskVoice não sobe serviço nenhum até ela voltar. A atualização confere isso antes do backup e
para sem mexer em nada. Suba o CRM, que recria a rede com o mesmo nome, e rode de novo.

## Se não funcionar

| O que aparece | O que conferir |
|---|---|
| 502 no domínio | O passo 3 foi feito? `docker network inspect <rede>` lista o `deskvoice-caddy-1`? Ele está de pé (`docker ps`)? |
| O Caddy do CRM responde 404 na raiz | O domínio no `.caddy` está igual ao do DNS, e o arquivo tem a extensão `.caddy` |
| Certificado não sai | O registro A aponta para este IP? As portas 80 e 443 chegam de fora? Log do `caddy` do CRM |
| Painel abre, "Falar com o agente" não conecta | O `/voice-ws` não chegou ao DeskVoice: confira se o `.caddy` aponta para o alias e a porta `80`, e o log do Caddy do DeskVoice (`docker logs --tail 50 deskvoice-caddy-1`) |
| O DeskVoice foi instalado **sem** domínio e o limite de login trata todo mundo como um visitante só | Reinstale com `DESKVOICE_DOMAIN=`: só o modo "atrás do proxy **com** domínio" grava `TRUSTED_PROXY_HOPS=2` e faz o Caddy do DeskVoice confiar no proxy da frente; sem domínio ele descarta o `X-Forwarded-For` que chega, como proteção |
| O instalador ou a atualização dizem que a rede não existe | O CRM está no ar? Se o nome mudou, refaça o passo 2 e rode o passo 3 com o nome medido agora |

## Se a telefonia do CRM estiver ligada

Medido nos dois repositórios, em 14/11/2026:

- o DeskVoice escuta SIP em `5060/udp` e áudio em `10000-10200/udp`, e **não** tem variável para
  a porta SIP (`bind=0.0.0.0:5060` em `deploy/asterisk/pjsip.conf.base`);
- o DeskcommCRM publica exatamente `5060:5060/udp` e `10000-10200:10000-10200/udp` quando a
  telefonia dele está ativa — o serviço `asterisk` dele está no profile `telefonia`
  (`COMPOSE_PROFILES=telefonia` no `.env`). Sem esse profile, o contêiner nem existe e as portas
  ficam livres.

Com a telefonia do CRM ligada, o instalador do DeskVoice para em "A porta 5060/udp já está em uso
por outro programa" — de propósito, porque dois PABX na mesma máquina brigariam pela sinalização.
A faixa de áudio dá para mover (`DESKVOICE_RTP_START=20000 DESKVOICE_RTP_END=20200`); a
sinalização, hoje, não. Enquanto não houver porta SIP configurável, esta combinação fica só com o
painel: publicar o DeskVoice na mesma VPS de um CRM **com** telefonia ligada não tem caminho, e
este guia não promete o que não existe.

## O que este guia não cobre

- mudar a porta SIP do DeskVoice para conviver com o Asterisk do CRM ligado (é código, não
  documento, e não existe hoje);
- o conector DeskVoice ↔ CRM (é outro assunto);
- WAHA: o DeskVoice não sobe WAHA próprio — não há serviço `waha` em `deploy/` —, então nesta
  combinação não há um segundo serviço de WhatsApp disputando o mesmo número.
