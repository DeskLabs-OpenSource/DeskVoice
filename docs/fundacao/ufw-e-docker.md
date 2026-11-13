# O ufw não filtra as portas que o Docker publica

> Medido em 2026-11-13 por @webtecnica na VPS de produção do parceiro (152.53.89.236, Ubuntu com
> Docker 29.1.3 e `ufw` ativo). Responde à issue #52: as regras de `ufw` que o kit aplica para
> `5060/udp` e para a faixa de RTP não mudam nada, porque quem publica essas portas é o Docker.

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
  'https://check-host.net/check-tcp?host=152.53.89.236:48080&max_nodes=3'
# {"nodes":{...},"ok":1,"permanent_link":"https://check-host.net/check-report/<id>","request_id":"<id>"}
curl -s -H 'Accept: application/json' 'https://check-host.net/check-result/<id>'
# {"de2.node.check-host.net":[{"address":"152.53.89.236","time":0.089737}], ...}

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
s.sendto(b"probe",("152.53.89.236",48506));print(s.recvfrom(2048))'
```

O `/app.js` é um servidor de 15 linhas: `http.createServer(...).listen(80)` e um
`dgram.createSocket("udp4")` que devolve o que recebe na 9999. No fim: `docker rm -f dk-probe`,
`ip netns del fora`, `kill` no `http.server` e `ufw delete` em cada regra criada.

### 1. Sem regra nenhuma, o contêiner já está aberto

```
$ ufw status | head -3
Status: active
Default: deny (incoming), allow (outgoing), deny (routed)

$ python3 check-tcp.py 152.53.89.236:48080     # 3 nós externos
de2.node.check-host.net: ABERTO 0.090s
si1.node.check-host.net: ABERTO 0.111s
us5.node.check-host.net: ABERTO 0.009s
```

A porta não tem regra nenhuma e o `ufw` nega toda entrada por padrão — e ela está aberta na
internet. [Relatório](https://check-host.net/check-report/57882201kdd0).

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
$ python3 check-tcp.py 152.53.89.236:48080     # 3 nós externos
ch1.node.check-host.net: ABERTO 0.102s
rs1.node.check-host.net: ABERTO 0.127s
us1.node.check-host.net: ABERTO 0.061s
```

A regra existe (está na cadeia `ufw-user-input`, com `DROP`) e não muda nada.
[Relatório](https://check-host.net/check-report/57882415k9ea). O mesmo vale para UDP:

```
$ ufw deny 48506/udp
$ ip netns exec fora python3 udp.py 152.53.89.236:48506
RESPOSTA de 152.53.89.236:48506 -> ok-udp
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

Relatórios: [negando](https://check-host.net/check-report/57882cc0ke75),
[liberando](https://check-host.net/check-report/57884abfkbef). O `ufw` funciona; ele só não vê a
porta publicada pelo Docker.

### 4. `ufw route deny` também não fecha

```
$ ufw route deny proto udp to any port 48506
$ iptables -S ufw-user-forward | grep 48506
-A ufw-user-forward -p udp -m udp --dport 48506 -j DROP
$ ip netns exec fora python3 udp.py 152.53.89.236:48506
RESPOSTA de 152.53.89.236:48506 -> ok-udp
```

O `FORWARD` do Docker (`DOCKER-USER`, `DOCKER-FORWARD`) vem antes das cadeias `ufw-*-forward`,
então a regra de rota do `ufw` nunca é consultada.

### 5. O que fecha a porta

```
$ iptables -I DOCKER-USER 1 -p tcp -m tcp --dport 48080 -j DROP
$ iptables -L DOCKER-USER -v -n
 pkts bytes target     prot opt in     out     source               destination
    0     0 DROP       tcp  --  *      *       0.0.0.0/0            0.0.0.0/0            tcp dpt:48080
$ python3 check-tcp.py 152.53.89.236:48080
ca1.node.check-host.net: ABERTO 0.069s
id1.node.check-host.net: ABERTO 0.244s
ro1.node.check-host.net: ABERTO 0.124s
```

A regra obvia não serve: no `FORWARD` o pacote **já foi traduzido** para a porta do contêiner
(`80`), então `--dport 48080` nunca casa — o contador de pacotes fica em zero e a porta continua
aberta ([relatório](https://check-host.net/check-report/578861cbk759)). A regra que casa usa a
porta **original** da conexão:

```
$ iptables -D DOCKER-USER -p tcp -m tcp --dport 48080 -j DROP
$ iptables -I DOCKER-USER 1 -p tcp -m conntrack --ctorigdstport 48080 --ctdir ORIGINAL -j DROP
$ python3 check-tcp.py 152.53.89.236:48080
hu1.node.check-host.net: FECHADO (Connection timed out)
pl1.node.check-host.net: FECHADO (Connection timed out)
rs1.node.check-host.net: FECHADO (Connection timed out)
```

[Relatório](https://check-host.net/check-report/57886338k3b1).

### 6. Nem o próprio host é protegido

```
$ curl -s -m 5 http://152.53.89.236:48080      # com ufw deny 48080/tcp no lugar
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
`--ctorigdstport`.

## O que mudou no kit

A regra continua sendo oferecida, e a mensagem passa a dizer a verdade: ela é opcional, vale para
quem escuta no host, e não é por falta dela que uma ligação fica muda. A alternativa — remover a
regra e a opção `DESKVOICE_APPLY_UFW` — foi descartada porque numa instalação sem Docker (ou com o
daemon em `"iptables": false`) a regra ainda é o que abre a porta; o risco de remover é a ligação
ficar muda em silêncio nesse caso, e o risco de manter é alguém achar que fechou o que não fechou.
A mensagem nova ataca o segundo sem criar o primeiro.

## O que não foi medido

- **`firewalld`**: esta VPS não tem `firewalld`, e instalá-lo derrubaria o `ufw` de uma máquina em
  produção. O comportamento com `firewalld` segue não medido (o instalador só avisa, nunca promete).
- **UDP de fora, de verdade**: o check-host não sonda UDP. O UDP foi medido de um namespace com
  `veth` no mesmo host, que percorre as mesmas cadeias (`PREROUTING` → DNAT → `FORWARD`), mas não
  passa por um roteador de verdade. O TCP, esse sim, foi medido de três países.
- **IPv6**: o `ufw` cria as regras também em `(v6)` e o Docker publica em `[::]`, mas nenhuma sonda
  externa usou IPv6.
- **Docker com o iptables desligado**: nesse modo o Docker não escreve as regras dele e o `ufw`
  volta a valer. Não foi medido; é a razão de a regra continuar sendo oferecida.
