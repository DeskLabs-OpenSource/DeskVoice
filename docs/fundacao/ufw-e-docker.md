# O ufw não filtra as portas que o Docker publica

> Medido em 2026-11-13 por @webtecnica numa VPS de produção de terceiro (Ubuntu com
> Docker 29.1.3 e `ufw` ativo). Responde à issue #52: as regras de `ufw` que o kit aplica para
> `5060/udp` e para a faixa de RTP não mudam nada, porque quem publica essas portas é o Docker.
>
> O IP da máquina aparece como `<IP-DA-VPS>`, e os links dos relatórios do check-host saíram,
> porque mostram o endereço de uma máquina de produção de terceiro.

## A pergunta

`deploy/docker-compose.yml` publica `5060:5060/udp` e a faixa de RTP com `ports:`, e o instalador
oferece `ufw allow` para elas (`install/install.sh`, bloco do `DESKVOICE_APPLY_UFW`), dizendo que
"sem elas a ligação pode ficar muda". A documentação do Docker (`packet-filtering-firewalls.md`)
diz que a porta publicada é entregue pelo próprio Docker, por fora do `ufw`. Uma das duas estava
errada.

## O experimento

Numa máquina com `ufw` em `Default: deny (incoming)`, `deny (routed)`:

| O que escuta | Porta | Publicada por |
|---|---|---|
| contêiner (`node:22-alpine`, HTTP e eco UDP) | `48080/tcp` e `48506/udp` | `docker run -p 48080:80 -p 48506:9999/udp` |
| o próprio host (`python3 -m http.server`, eco UDP) | `48081/tcp` e `48085/udp` | nada — escuta direto no host |

A sonda externa é o [check-host.net](https://check-host.net), que abre uma conexão TCP de três
máquinas fora da VPS (Alemanha, EUA, Japão, entre outras) e devolve o tempo de conexão. Todo
tráfego de UDP foi medido de um namespace com `veth` (ver "O que não foi medido").

### Como repetir

```bash
# 1. o contêiner publicado (porta alta, nada a ver com a telefonia de produção)
docker run -d --name dk-probe -p 48080:80 -p 48506:9999/udp node:22-alpine node /app.js

# 2. a sonda externa: pede e depois recolhe o resultado dos três nós
curl -s -H 'Accept: application/json' \
  'https://check-host.net/check-tcp?host=<IP-DA-VPS>:48080&max_nodes=3'
# {"nodes":{...},"ok":1,"permanent_link":"https://check-host.net/check-report/<id>","request_id":"<id>"}
curl -s -H 'Accept: application/json' 'https://check-host.net/check-result/<id>'
# {"de2.node.check-host.net":[{"address":"<IP-DA-VPS>","time":0.089737}], ...}

# 3. o controle: o host escutando, sem Docker no meio
python3 -m http.server 48081 --bind 0.0.0.0 &

# 4. o lado de fora emulado, para o UDP (o check-host não sonda UDP)
ip netns add fora
ip link add veth-dk type veth peer name veth-dk.ns
ip link set veth-dk.ns netns fora
ip addr add 10.99.99.1/24 dev veth-dk && ip link set veth-dk up
ip netns exec fora ip addr add 10.99.99.2/24 dev veth-dk.ns
ip netns exec fora ip link set veth-dk.ns up && ip netns exec fora ip link set lo up
ip netns exec fora ip route add default via 10.99.99.1
ip netns exec fora python3 -c 'import socket,sys;s=socket.socket(2,2);s.settimeout(2.5);
s.sendto(b"probe",("<IP-DA-VPS>",48506));print(s.recvfrom(2048))'

# 5. o que fecha a porta, no TCP e no UDP
iptables -I DOCKER-USER 1 -p tcp -m conntrack --ctorigdstport 48080 --ctdir ORIGINAL -j DROP
iptables -I DOCKER-USER 1 -p udp -m conntrack --ctorigdstport 48506 --ctdir ORIGINAL -j DROP
ip netns exec fora python3 sonda.py udp <IP-DA-VPS> 48506
iptables -D DOCKER-USER -p tcp -m conntrack --ctorigdstport 48080 --ctdir ORIGINAL -j DROP
iptables -D DOCKER-USER -p udp -m conntrack --ctorigdstport 48506 --ctdir ORIGINAL -j DROP
```

O `/app.js` é um servidor de 15 linhas: `http.createServer(...).listen(80)` e um
`dgram.createSocket("udp4")` que devolve o que recebe na 9999. A `sonda.py` é um cliente de 20
linhas, TCP e UDP, com `timeout` de 3 s, que imprime `ABERTO` ou `FECHADO`. No fim: `docker rm -f
dk-probe`, `ip netns del fora`, `kill` no `http.server`, `ufw delete` em cada regra criada e
`iptables -D` em cada regra do `DOCKER-USER`.

### 1. Sem regra nenhuma, o contêiner já está aberto

```
$ ufw status | head -3
Status: active
Default: deny (incoming), allow (outgoing), deny (routed)

$ python3 check-tcp.py <IP-DA-VPS>:48080     # 3 nós externos
de2.node.check-host.net: ABERTO 0.090s
si1.node.check-host.net: ABERTO 0.111s
us5.node.check-host.net: ABERTO 0.009s
```

A porta não tem regra nenhuma e o `ufw` nega toda entrada por padrão — e ela está aberta na
internet.

### 2. Uma regra negando explícita não fecha

```
$ ufw deny 48080/tcp
Rule added
Rule added (v6)
$ ufw status | grep 48080
48080/tcp                  DENY        Anywhere
$ iptables -S ufw-user-input | grep 48080
-A ufw-user-input -p tcp -m tcp --dport 48080 -j DROP
```

```
$ python3 check-tcp.py <IP-DA-VPS>:48080     # 3 nós externos
ch1.node.check-host.net: ABERTO 0.102s
rs1.node.check-host.net: ABERTO 0.127s
us1.node.check-host.net: ABERTO 0.061s
```

A regra existe (está na cadeia `ufw-user-input`, com `DROP`) e não muda nada.
O mesmo vale para UDP:

```
$ ufw deny 48506/udp
$ ip netns exec fora python3 udp.py <IP-DA-VPS>:48506
RESPOSTA de <IP-DA-VPS>:48506 -> ok-udp
```

O eco chega com o endereço **público** na resposta: o pacote foi traduzido (DNAT) para o
contêiner, ou seja, atravessou o caminho normal de uma porta publicada.

### 3. O controle: quando quem escuta é o host, a regra funciona

Mesmo host, mesmo processo, mesma porta — só a regra muda.

```
$ ufw deny 48081/tcp      → python3 check-tcp.py ...:48081
de2.node.check-host.net: FECHADO (Connection timed out)
ir8.node.check-host.net: FECHADO (Connection timed out)
jp1.node.check-host.net: FECHADO (Connection timed out)

$ ufw allow 48081/tcp     → python3 check-tcp.py ...:48081
il2.node.check-host.net: ABERTO 0.159s
it2.node.check-host.net: ABERTO 0.094s
us4.node.check-host.net: ABERTO 0.028s
```

O `ufw` funciona; ele só não vê a
porta publicada pelo Docker.

### 4. `ufw route deny` também não fecha

```
$ ufw route deny proto udp to any port 48506
$ iptables -S ufw-user-forward | grep 48506
-A ufw-user-forward -p udp -m udp --dport 48506 -j DROP
$ ip netns exec fora python3 udp.py <IP-DA-VPS>:48506
RESPOSTA de <IP-DA-VPS>:48506 -> ok-udp
```

O `FORWARD` do Docker (`DOCKER-USER`, `DOCKER-FORWARD`) vem antes das cadeias `ufw-*-forward`,
então a regra de rota do `ufw` nunca é consultada.

### 5. O que fecha a porta

```
$ iptables -I DOCKER-USER 1 -p tcp -m tcp --dport 48080 -j DROP
$ iptables -L DOCKER-USER -v -n
 pkts bytes target     prot opt in     out     source               destination
    0     0 DROP       tcp  --  *      *       0.0.0.0/0            0.0.0.0/0            tcp dpt:48080
$ python3 check-tcp.py <IP-DA-VPS>:48080
ca1.node.check-host.net: ABERTO 0.069s
id1.node.check-host.net: ABERTO 0.244s
ro1.node.check-host.net: ABERTO 0.124s
```

A regra óbvia não serve: no `FORWARD` o pacote **já foi traduzido** para a porta do contêiner
(`80`), então `--dport 48080` nunca casa — o contador de pacotes fica em zero e a porta continua
aberta. A regra que casa usa a
porta **original** da conexão:

```
$ iptables -D DOCKER-USER -p tcp -m tcp --dport 48080 -j DROP
$ iptables -I DOCKER-USER 1 -p tcp -m conntrack --ctorigdstport 48080 --ctdir ORIGINAL -j DROP
$ python3 check-tcp.py <IP-DA-VPS>:48080
hu1.node.check-host.net: FECHADO (Connection timed out)
pl1.node.check-host.net: FECHADO (Connection timed out)
rs1.node.check-host.net: FECHADO (Connection timed out)
```

### 6. O UDP, que é o protocolo da telefonia

O kit publica `5060/udp` e a faixa de RTP, então a regra que fecha precisava ser medida no mesmo
protocolo. Mesma máquina, portas altas, `ufw` em `deny (incoming)` e `deny (routed)`, sonda do
namespace com `veth`:

```
$ ufw deny 48506/udp
$ iptables -S ufw-user-input | grep 48506
-A ufw-user-input -p udp -m udp --dport 48506 -j DROP
$ [netns] sonda.py udp <IP-DA-VPS> 48506
UDP <IP-DA-VPS>:48506 ABERTO -> ok-udp de <IP-DA-VPS>:48506

$ ufw route deny proto udp to any port 48506
$ iptables -S ufw-user-forward | grep 48506
-A ufw-user-forward -p udp -m udp --dport 48506 -j DROP
$ [netns] sonda.py udp <IP-DA-VPS> 48506
UDP <IP-DA-VPS>:48506 ABERTO -> ok-udp de <IP-DA-VPS>:48506
```

Nem a regra de entrada nem a de rota do `ufw` fecham o UDP publicado. A regra óbvia no
`DOCKER-USER` também não:

```
$ iptables -I DOCKER-USER 1 -p udp -m udp --dport 48506 -j DROP
$ iptables -L DOCKER-USER -v -n | head -4
 pkts bytes target     prot opt in     out     source               destination
    0     0 DROP       udp  --  *      *       0.0.0.0/0            0.0.0.0/0            udp dpt:48506
$ [netns] sonda.py udp <IP-DA-VPS> 48506
UDP <IP-DA-VPS>:48506 ABERTO -> ok-udp de <IP-DA-VPS>:48506
$ iptables -L DOCKER-USER -v -n | head -4     # o contador continua em zero
    0     0 DROP       udp  --  *      *       0.0.0.0/0            0.0.0.0/0            udp dpt:48506
```

Com a porta **original**, o UDP fecha — e o contador prova que foi a regra, não o acaso:

```
$ iptables -D DOCKER-USER -p udp -m udp --dport 48506 -j DROP
$ iptables -I DOCKER-USER 1 -p udp -m conntrack --ctorigdstport 48506 --ctdir ORIGINAL -j DROP
$ [netns] sonda.py udp <IP-DA-VPS> 48506
UDP <IP-DA-VPS>:48506 FECHADO (TimeoutError: timed out)
$ [netns] sonda.py udp <IP-DA-VPS> 48506      # 2ª tentativa
UDP <IP-DA-VPS>:48506 FECHADO (TimeoutError: timed out)
$ iptables -L DOCKER-USER -v -n | head -4
    2    66 DROP       udp  --  *      *       0.0.0.0/0            0.0.0.0/0            ctorigdstport 48506 ctdir ORIGINAL
$ [netns] sonda.py tcp <IP-DA-VPS> 48080      # a porta vizinha, mesma máquina: segue aberta
TCP <IP-DA-VPS>:48080 ABERTO
```

O motivo é o mesmo do TCP: a regra de `DNAT` do Docker já trocou a porta antes do `FORWARD`.

```
$ iptables -t nat -S DOCKER | grep 48506
-A DOCKER ! -i docker0 -p udp -m udp --dport 48506 -j DNAT --to-destination 172.17.0.16:9999
```

O controle, que separa "o `ufw` não funciona" de "o `ufw` não vê a porta do Docker" — eco UDP no
**próprio host** (`48085/udp`), mesma sonda, mesma máquina:

```
$ ufw deny 48085/udp  →  [netns] sonda.py udp <IP-DA-VPS> 48085
UDP <IP-DA-VPS>:48085 FECHADO (TimeoutError: timed out)

$ ufw allow 48085/udp →  [netns] sonda.py udp <IP-DA-VPS> 48085
UDP <IP-DA-VPS>:48085 ABERTO -> ok-udp-host de 10.99.99.1:48085
```

### 7. Nem o próprio host é protegido

```
$ curl -s -m 5 http://<IP-DA-VPS>:48080      # com ufw deny 48080/tcp no lugar
ok-tcp
```

## Conclusão

| Porta | Regra do kit ou `ufw deny` | Resultado |
|---|---|---|
| publicada pelo Docker | sim | **não protege**: a porta continua aberta na internet |
| escutada pelo host | sim | protege |
| publicada pelo Docker, do próprio host | sim | também alcança: o `deny` não barra nem o tráfego local |

Ou seja: **as regras de `ufw` do kit são teatro**. Elas não abrem nada que o Docker já não tenha
aberto, e não fecham nada — inclusive porque quem as lê acredita ter fechado. O `firewall` que
decide o que entra numa porta publicada é o do provedor da VPS, ou uma regra em `DOCKER-USER` com
`--ctorigdstport`, medida aqui nos dois protocolos que o kit usa (TCP na seção 5, UDP na 6).

## E o `firewalld`

Medido em 13/11/2026 numa VPS AlmaLinux 9.8, só do DeskVoice: Docker 29.9.3, `iptables` 1.8.10
(nf_tables), `firewalld` 1.3.4 com a zona padrão `public` (issue #52). A sonda UDP saiu de uma
máquina fora da VPS, por outra rede, contra dois ecos: um contêiner publicado com `-p 48506:9999/udp`
e um processo do host em 48507/udp.

| Situação | Contêiner (48506/udp) | Host (48507/udp) |
|---|---|---|
| `firewalld` parado | responde | responde |
| `firewalld` ativo, `public` sem as portas | **responde** | sem resposta |
| `firewalld` ativo, rich rule `reject` na `public` | **responde** | sem resposta |
| `firewalld` parado de novo | responde | responde |

Com o `firewalld` no ar, as pontes do Docker vão para a zona `docker`, e a interface de rede fica na
`public`. As portas de telefonia que o kit publica se comportaram como o eco do contêiner nas três
situações. É o mesmo resultado do `ufw`: a zona do host filtra o que escuta no host, e não o que o
Docker publica, nem com `reject` explícito. O instalador avisa disso e não roda `firewall-cmd`.

### A regra no `DOCKER-USER` com o `firewalld` ativo, o reload e o reinício

Medido em 15/11/2026 na mesma VPS (AlmaLinux 9.8, Docker 29.9.3, `iptables` 1.8.10 nf_tables,
`firewalld` 1.3.4, zona `public`, ligado à mão com o Docker já rodando e sem ligar no boot). Um
contêiner de prova publicado com `-p 48080:80/tcp` foi sondado de fora, de outra rede (um computador
em outro provedor), com `curl -m 6`. A regra é a mesma da seção 5:
`iptables -I DOCKER-USER 1 -p tcp -m conntrack --ctorigdstport 48080 --ctdir ORIGINAL -j DROP`.

| Situação | 48080/tcp de fora |
|---|---|
| `firewalld` ativo, sem a regra | responde |
| `firewalld` ativo, com a regra | **fechada** (o contador da regra sobe a cada sonda) |
| logo depois de `firewall-cmd --reload` | **responde por cerca de 4 s**, e depois fecha de novo |
| depois de reiniciar a máquina | responde: a cadeia `DOCKER-USER` volta vazia |

- **Com o `firewalld` ativo, a regra fecha a porta**, como com o `ufw`. O `firewalld` cria a tabela
  `inet firewalld` dele e não reescreve a `DOCKER-USER`: a regra continua listada e contando.
- **A cada `firewall-cmd --reload` sobra uma janela.** Sondando uma vez por segundo, a porta
  respondeu de 01:23:42 a 01:23:45 UTC e fechou em 01:23:46, com a regra listada o tempo todo. Ao
  que tudo indica, é o tempo que o Docker leva para refazer as cadeias dele depois do reload do
  `firewalld`. Isso não foi medido por dentro.
- **A regra criada à mão não sobrevive ao reinício.** `iptables -I` só vale até a máquina desligar;
  depois do boot, a `DOCKER-USER` voltou vazia e a porta voltou a responder. Quem quiser a regra
  depois de reiniciar precisa recriá-la no boot — é o que o kit passou a fazer, na seção seguinte.
- Os serviços do DeskVoice voltaram sozinhos depois do reinício, com a checagem de saúde verde e o
  WhatsApp de ligação reconectado em segundos.

### A regra que sobrevive ao reinício, do jeito que o kit faz

O boot da máquina esvazia a `DOCKER-USER`: a cadeia é do kernel e nasce vazia. Se o reinício do
serviço do Docker também a esvazia depende do Docker: no 29.9.3, medido em 18/11/2026, **não**
esvaziou (tabela abaixo). Por isso a regra que o kit escreve (`install/docker-user.sh`) não é só um
`iptables -I`: ela deixa um serviço do systemd, `deskvoice-docker-user.service`, com
`After=docker.service` e `PartOf=docker.service`. O systemd chama o mesmo script depois de o Docker
subir, no boot e a cada reinício do serviço dele, e o script confere antes de inserir: nos dois casos,
ele só repõe o que falta ("já estava fechada"), rodar duas vezes não duplica regra, e a porta que saiu
da lista é reaberta.

O `apply` liga o serviço e o deixa ativo na hora (`systemctl enable --now --no-block`): o `PartOf` só
chama de novo uma unidade ativa, e sem isso um reinício do Docker entre o `apply` e o próximo boot
não o chamaria. O `--no-block` é porque o próprio serviço roda o `apply`, e um *start* da unidade de
dentro dela esperaria por ele mesmo. O `apply` sem portas desliga e para o serviço
(`systemctl disable --now`) antes de apagar o arquivo dele, e a unidade não fica na memória do
systemd.

A escolha foi a persistência do próprio instalador, e não uma *direct rule* do `firewalld`
(`firewall-cmd --permanent --direct --add-rule ...`), por dois motivos: a regra que fecha a porta é
a da cadeia do **Docker**, e o `firewalld` não é o dono dela; e o kit já usa o systemd para o que
precisa acontecer sozinho (o timer do agente de atualização). A *direct rule* também não foi medida
aqui, e o que não se mede não entra.

O que **é** medido é o que a regra faz (as duas tabelas acima) e, desde 18/11/2026, o serviço numa
máquina reiniciada (a segunda tabela abaixo). O `bash install/test/run.sh` cobre o script com um
`iptables` e um `systemctl` de mentira: aplicar duas vezes, a cadeia esvaziada, o serviço repondo a
regra, o serviço ligado e ativo pelo `apply`, desligado e parado antes de apagado, e o `--dry-run` não
tocando em nada. O `firewall-cmd --reload` continua
com a janela de alguns segundos descrita acima: ela é do Docker refazendo as cadeias dele, e a regra
está listada o tempo todo.

A regra que o kit escreve não é, letra por letra, a medida acima. Cada porta ganha duas, uma por
família de ponte do Docker (`docker0` e as `br-*` das redes do Compose, como a do DeskVoice):

```
-o docker+ -p tcp -m physdev ! --physdev-is-bridged -m conntrack --ctorigdstport 5061 --ctdir ORIGINAL -j DROP
-o br-+ -p tcp -m physdev ! --physdev-is-bridged -m conntrack --ctorigdstport 5061 --ctdir ORIGINAL -j DROP
```

O motivo é a direção. A `DOCKER-USER` vê os dois sentidos do tráfego dos contêineres, e
`--ctorigdstport N --ctdir ORIGINAL` sozinho também casa com a conexão que o **contêiner** abre para
fora com destino à porta `N`: fechar `5061/tcp` cortaria o SIP-TLS que o Asterisk abre para a
operadora, e fechar `5060/udp` cortaria o registro dele num provedor que escuta na 5060.

O que separa os dois sentidos é a interface de **saída**. O que chega de fora a um contêiner, pelo
`DNAT` da porta publicada (seção 6) ou roteado direto ao IP dele, é roteado para dentro da ponte do
contêiner (`-o`), qualquer que seja a interface por onde entrou. A conexão que o contêiner abre sai
pela interface de fora, e a resposta dela volta na direção `REPLY`: nenhuma das duas casa. O tráfego
entre contêineres da mesma rede não é roteado, é passado de uma porta da ponte para outra, e o
`! --physdev-is-bridged` o deixa de fora.

As alternativas ficaram de fora, e cada uma por uma brecha:

- `--ctstate DNAT` caberia numa regra só, mas deixaria passar o que chega roteado direto ao IP do
  contêiner, sem passar pelo `DNAT`.
- Isentar o que **entra** pelas pontes (`! -i br-+ -o br-+`, ou um `RETURN` para `-i br-+`) faz o
  nome da interface de entrada abrir caminho: numa máquina com uma ponte do host chamada `br-algo`
  (libvirt, LXD, rede montada à mão), o que chega de fora por ela passaria. O `RETURN` ainda isentaria
  tudo o que sai dos contêineres de qualquer regra abaixo dele, inclusive das escritas por outra pessoa.
- Ler o nome exato das pontes no Docker na hora de aplicar envelhece: uma rede recriada muda de nome,
  e o serviço só reaplica no boot e a cada reinício do Docker.
- Casar a interface de fora (`-i eth0`) não serve, porque o nome dela muda de máquina para máquina.

Os limites da forma nova, os conhecidos:

- **Falha fechada:** se a saída da máquina para fora é ela mesma uma ponte chamada `docker*` ou
  `br-*`, a conexão do contêiner para a porta fechada também é barrada. Não abre entrada; corta essa
  saída, como a forma antiga cortava em qualquer máquina.
- **Fica aberta:** uma ponte do Docker com nome escolhido à mão (`com.docker.network.bridge.name`),
  fora de `docker*` e `br-*`. A rede do Compose do DeskVoice não escolhe nome.
- **Hairpin, falha fechada:** com o `userland-proxy` do Docker desligado, a conexão de um contêiner
  ao IP público da própria máquina, na porta fechada, também é roteada para dentro da ponte e é
  barrada. Não abre entrada. Não medido: na bancada abaixo o `userland-proxy` estava ligado.
- **O módulo `br_netfilter`:** aplicar a regra o carrega, se ele ainda não estiver carregado: o
  `-m physdev` o pede ao kernel (`xt_physdev`, também pelo `iptables-nft`). Medido em 18/11/2026: a
  primeira regra com `physdev` carregou o módulo, com `bridge-nf-call-iptables=1`, e o `apply` sem
  portas não o descarregou. Com ele, o tráfego de ponte de todos os contêineres passa a atravessar a
  `FORWARD` e o `conntrack` até o reboot, e o serviço o carrega de novo no boot (medido na segunda
  rodada, abaixo). Numa VPS só do DeskVoice, a checagem de saúde ficou igual com o módulo no ar: as pontes
  do Docker têm os `ACCEPT` dele. O que mais pesa, e não foi medido: numa máquina com outra ponte que
  não é do Docker (libvirt, LXD), o tráfego entre as máquinas dela passa a cair na política da
  `FORWARD`, que o Docker deixa em `DROP`, e pode parar. O `physdev` fica porque, sem ele, com o
  módulo carregado (por esta regra ou pelo próprio Docker), a regra barraria o tráfego entre
  contêineres da mesma rede na porta fechada; com ele, esse tráfego passou (medido em TCP).
- **Para descarregar o `br_netfilter` à mão:** `rmmod br_netfilter`, ou reinicie a máquina. Nunca
  `modprobe -r br_netfilter`: ele também descarrega o módulo `bridge` e derruba todas as redes do
  Docker até um `systemctl restart docker`. Medido: desfazer assim deixou a VPS de teste cerca de
  2 minutos sem as redes do Docker.

Quem já tinha a regra antiga (escrita à mão, como esta página ensinava, ou por uma versão de teste
deste script) é avisado: ao aplicar, e a cada boot pelo serviço, o script escreve as novas, tira
todas as cópias da antiga, nessa ordem, e diz que trocou.

As tabelas das seções 5 e 6 e a do `firewalld` mediram a forma antiga, **sem** as interfaces. A
forma nova foi medida em 18/11/2026, entre 02:47 e 02:52 UTC, numa VPS de teste, sobre o `5a6bb00`
do PR #426: `iptables` 1.8.10 (nf_tables), kernel 5.14.0 (el9_8), Docker 29.9.3 sem `daemon.json`,
`userland-proxy` ligado, `firewalld` inativo e `br_netfilter` não carregado antes. Uma rede de prova
`br-*`, com um servidor publicando `48080/tcp` e `48506/udp` e um cliente na mesma rede.

| Situação | Resultado |
|---|---|
| de fora, `48080/tcp` e `48506/udp`, sem a regra | respondem |
| de fora, as mesmas portas, com a regra | **sem resposta**; o contador da regra `br-+` subiu (13 pacotes em TCP, 1 em UDP) |
| o contêiner abre conexão para um host externo na `48080/tcp`, com a regra | passa |
| contêiner para contêiner da mesma rede na `48080/tcp`, com o `br_netfilter` carregado | passa |
| `apply` das duas portas | 4 regras (porta × ponte), serviço gravado e ligado |
| `apply` de novo | não duplica |
| `apply` sem portas | reabre, esvazia a cadeia e apaga o serviço; o `br_netfilter` continua carregado |
| checagem de saúde da 0.35.0 com o `br_netfilter` carregado | igual à de antes |

O reinício da máquina e o do Docker, com o serviço, foram medidos na mesma VPS em 18/11/2026, das
19:18 às 19:24 UTC ([2ª rodada no PR #426](https://github.com/DeskLabs-OpenSource/DeskVoice/pull/426#issuecomment-6989139786)),
com a 0.37.1: Docker 29.9.3, kernel 5.14 (el9), `firewalld` inativo, `br_netfilter` não carregado
antes, um contêiner numa rede `br-*` publicando `48080/tcp` e `48506/udp`, sondado de fora e de dentro.

| Passo | De fora | `DOCKER-USER` |
|---|---|---|
| `apply 48080/tcp 48506/udp` | **sem resposta** nas duas | 4 regras |
| `systemctl restart docker`, serviço ligado mas ainda inativo | sem resposta | as mesmas 4: o Docker **não** esvaziou a cadeia |
| reinício da máquina | **sem resposta** | as mesmas 4, repostas pelo serviço na subida |
| `systemctl restart docker`, serviço ativo | sem resposta | as mesmas 4; o serviço foi chamado (`PartOf`) e disse "já estava fechada" |
| `apply` sem portas | n/a | vazia; o arquivo da unidade sumiu, mas ela ficou "active (exited)" na memória do systemd (corrigido depois: o `apply` agora para a unidade antes de apagar) |

A checagem de saúde ficou igual em todos os passos, e o contêiner respondeu de dentro o tempo todo.
Nessa rodada, o `apply` não carregou o `br_netfilter`; depois do reinício, com o serviço, ele estava
carregado. Por que a primeira rodada o carregou no `apply` e esta não, não foi investigado.

Continua sem medição: um Docker que esvazie a cadeia ao reiniciar; o serviço ativo pelo próprio
`apply` (`enable --now`), que veio depois da rodada; a família `docker+` com tráfego (os contadores
dela ficaram em 0); o hairpin, porque o `userland-proxy` estava ligado; o tráfego roteado direto ao
IP do contêiner; UDP de saída e UDP entre contêineres; IPv6; o `firewalld` ativo; uma máquina com
outra ponte que não é do Docker, ou com a saída para fora numa ponte `br-*`. Para esses casos, o que existe é o raciocínio acima e o `bash install/test/run.sh`, que
lê as regras escritas e decide, pacote a pacote, o que elas barram.

Uma porta é `porta` ou `min:max`, seguida de `/tcp` ou `/udp`, a mesma forma do `ufw`:

```
# numa VPS com o Docker publicando 5061/tcp, por exemplo
$ bash install/docker-user.sh apply 5061/tcp
  ✓ porta fechada: 5061/tcp
  ✓ regra reposta no boot e ao reiniciar o Docker (deskvoice-docker-user.service)

$ bash install/docker-user.sh apply 5061/tcp      # de novo: não duplica
  já estava fechada: 5061/tcp

$ bash install/docker-user.sh show
  -o br-+ -p tcp -m physdev ! --physdev-is-bridged -m conntrack --ctorigdstport 5061 --ctdir ORIGINAL -j DROP
  -o docker+ -p tcp -m physdev ! --physdev-is-bridged -m conntrack --ctorigdstport 5061 --ctdir ORIGINAL -j DROP
  no boot, o serviço repõe: 5061/tcp

$ bash install/docker-user.sh apply              # sem portas: reabre e apaga o serviço
```

O instalador chama esse script quando recebe `DESKVOICE_DOCKER_USER_DROP`, e não fecha nada sem
ele: fechar `5060/udp` deixa a telefonia muda, porque é por ela que as ligações entram.

Em qualquer VPS com o SSH fora da porta 22, ligar o `firewalld` corta o acesso: a zona `public` de
fábrica libera o serviço `ssh`, que é a porta 22. Antes de ligar (ou antes de um `--reload`),
libere a porta do SSH na configuração permanente com `firewall-cmd --permanent --add-port=<porta>/tcp`
(com o `firewalld` parado, `firewall-offline-cmd --add-port=<porta>/tcp`). Foi o que a medida acima
precisou.

## O que mudou no kit

A regra continua sendo oferecida, e a mensagem passa a dizer a verdade: ela é opcional, vale para
quem escuta no host, e não é por falta dela que uma ligação fica muda. A alternativa — remover a
regra e a opção `DESKVOICE_APPLY_UFW` — foi descartada porque numa instalação sem Docker (ou com o
daemon em `"iptables": false`) a regra ainda é o que abre a porta; o risco de remover é a ligação
ficar muda em silêncio nesse caso, e o risco de manter é alguém achar que fechou o que não fechou.
A mensagem nova ataca o segundo sem criar o primeiro.

## O que não foi medido

- **`firewalld`, além do que está na seção dele**: o `firewalld` foi ligado com o Docker já rodando,
  e não com os dois subindo juntos no boot. A regra no `DOCKER-USER` com ele ativo foi medida só em
  TCP, e não em UDP. Também não foram medidos uma ligação de verdade com ele ligado, nem uma regra
  recriada no boot.
- **UDP de fora, de verdade**: o check-host não sonda UDP. O UDP foi medido de um namespace com
  `veth` no mesmo host, que percorre as mesmas cadeias (`PREROUTING` → DNAT → `FORWARD`), mas não
  passa por um roteador de verdade. O TCP, esse sim, foi medido de três países. Vale para o UDP
  tudo o que está medido acima, inclusive a regra que fecha (seção 6). A medição do `firewalld`
  é a exceção: nela o UDP saiu de uma máquina fora da VPS, por outra rede.
- **IPv6**: o `ufw` cria as regras também em `(v6)` e o Docker publica em `[::]`, mas nenhuma sonda
  externa usou IPv6. A VPS da medição do `firewalld` não tem endereço IPv6 público, então lá não há o
  que sondar.
- **Docker com o iptables desligado**: nesse modo o Docker não escreve as regras dele e o `ufw`
  volta a valer. Não foi medido; é a razão de a regra continuar sendo oferecida.
