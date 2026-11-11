#!/usr/bin/env bash
# O instalador confere o que anuncia: a publicação que ele grava em CADA modo (o que o Compose vai
# publicar, lido do docker-compose.override.yml), as opções de exposição valendo em todo modo, o
# padrão seguro sem domínio, a reinstalação que não muda a exposição, e o login de verdade no fim.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
source "$KIT/_common.sh"; set +e; trap - ERR
D="$DESKVOICE_DEPLOY_DIR"; O="$D/docker-compose.override.yml"; A="$D/app.env"
PW="senha-de-teste-123"
export DESKVOICE_ORG_NAME="Clínica Exemplo" DESKVOICE_OWNER_NAME="Ana Exemplo" DESKVOICE_OWNER_EMAIL=ana@exemplo.com.br DESKVOICE_OWNER_PASSWORD="$PW"
export DESKVOICE_HEALTH_TIMEOUT=0
: > "$FAKE_DIR/git_tags"
printf 'asterisk|ok|PJSIP 20.20.1\n' > "$FAKE_DIR/voice_health"
printf '%s\n' 'panel|ok|respondendo' 'trunk|warn|sem linha' 'engine|warn|sem chave' > "$FAKE_DIR/panel_health"
: > "$FAKE_DIR/ss_udp"   # máquina nova: a 5060 está livre
free_ports() { : > "$FAKE_DIR/ss_tcp"; }
other_proxy() { printf 'LISTEN 0 511 0.0.0.0:80 0.0.0.0:*\nLISTEN 0 511 0.0.0.0:443 0.0.0.0:*\n' > "$FAKE_DIR/ss_tcp"; }
# O Docker de mentira não sobe nem derruba nada: os contêineres "rodam" o tempo todo. O que faz o
# instalador ver uma máquina nova é não haver deploy/.env (aí nenhum contêiner é tido como nosso).
printf '%s\n' postgres asterisk panel voice routines caddy > "$FAKE_DIR/running"
fresh() {
  rm -f "$D/.env" "$A" "$D/migrate.env" "$O" "$FAKE_DIR/login_stdin" "$FAKE_DIR/login_probe" "$FAKE_DIR/host_probe" "$FAKE_DIR/create_owner_stdin"
  echo 0 > "$FAKE_DIR/users_count"; : > "$FAKE_DIR/calls.log"
}
install() { bash "$KIT/install.sh" --yes --force 2>&1; }
ports_published() { sed -n 's/^ *- "\(.*\)"$/\1/p' "$O" 2>/dev/null | tr '\n' ' '; }
announced() { printf '%s\n' "$1" | sed -n 's/^  Painel: //p'; }
probed() { sed -n 's/^curl .* \(http[^ ]*\)\/api\/v1\/system\/health$/\1/p' "$FAKE_DIR/calls.log" | tail -n 1; }

# ── Os seis modos: o que fica publicado, o endereço anunciado e o endereço conferido ──
# 1. 80/443 livres, sem domínio, sem opção: o padrão é só local.
free_ports; fresh
out="$(DESKVOICE_DOMAIN="" install)"; equal "livres, sem domínio, padrão: zero" 0 "$?"
equal "livres, sem domínio, padrão: publica só em 127.0.0.1" "127.0.0.1:3080:80 " "$(ports_published)"
lacks "livres, sem domínio, padrão: a 80 não é publicada" "$(cat "$O")" '"80:80"'
equal "livres, sem domínio, padrão: anuncia o endereço do túnel" "http://localhost:3080" "$(announced "$out")"
equal "livres, sem domínio, padrão: o endereço gravado é o anunciado" "http://localhost:3080" "$(env_get "$A" PUBLIC_URL)"
equal "livres, sem domínio, padrão: confere a porta publicada" "http://127.0.0.1:3080" "$(probed)"
contains "padrão sem domínio: ensina o túnel" "$out" "ssh -L 3080:127.0.0.1:3080 <usuário>@203.0.113.10"
contains "padrão sem domínio: diz como apontar um domínio para ter HTTPS" "$out" "DESKVOICE_DOMAIN=<seu domínio> bash install/install.sh"
contains "padrão sem domínio: diz como publicar por HTTP de propósito, com o risco" "$out" "DESKVOICE_PANEL_PUBLIC_HTTP=yes"
# O login de verdade, com o usuário recém-criado.
contains "dono novo: login conferido" "$out" "Login conferido"
contains "dono novo, login conferido: diz pronto" "$out" "Pronto para configurar"
equal "o login recebe e-mail e senha pela entrada padrão" "ana@exemplo.com.br|$PW" "$(tr '\n' '|' < "$FAKE_DIR/login_stdin")"
equal "a criação do dono recebe a senha pela entrada padrão" "$PW" "$(cat "$FAKE_DIR/create_owner_stdin")"
refuse "a senha nunca vai em argumento de processo" grep -q "$PW" "$FAKE_DIR/calls.log"
lacks "a senha nunca aparece na tela" "$out" "$PW"
check "o login é pela entrada única (pelo Caddy), não direto no painel" grep -q "host:'caddy',port:80,path,method" "$FAKE_DIR/calls.log"
check "a conferência do endereço vem antes do login" test "$(grep -n '^curl .*system/health' "$FAKE_DIR/calls.log" | tail -n 1 | cut -d: -f1)" -lt "$(grep -n 'auth/login' "$FAKE_DIR/calls.log" | head -n 1 | cut -d: -f1)"

# 2. 80/443 livres, sem domínio, com a opção: o defeito medido (era ignorada, e saía 0.0.0.0:80).
fresh
out="$(DESKVOICE_DOMAIN="" DESKVOICE_PANEL_LOCAL_ONLY=yes install)"; equal "livres, sem domínio, só local: zero" 0 "$?"
equal "livres, sem domínio, só local: publica só em 127.0.0.1" "127.0.0.1:3080:80 " "$(ports_published)"
equal "livres, sem domínio, só local: anuncia o túnel, e não o IP" "http://localhost:3080" "$(announced "$out")"
#    ... e o HTTP aberto, só pedindo de propósito.
fresh
out="$(DESKVOICE_DOMAIN="" DESKVOICE_PANEL_PUBLIC_HTTP=yes install)"; equal "livres, sem domínio, HTTP pedido: zero" 0 "$?"
equal "livres, sem domínio, HTTP pedido: publica a 80" "80:80 " "$(ports_published)"
equal "livres, sem domínio, HTTP pedido: anuncia o IP" "http://203.0.113.10" "$(announced "$out")"
equal "livres, sem domínio, HTTP pedido: confere a porta publicada" "http://127.0.0.1" "$(probed)"
contains "HTTP pedido: nomeia o risco" "$out" "a senha trafega sem criptografia"
contains "HTTP pedido: diz que de fora depende do firewall" "$out" "De fora, depende de a porta estar liberada"

# 3. 80/443 livres, com domínio: 80 e 443; as duas opções param com erro, antes de gravar.
fresh
out="$(DESKVOICE_DOMAIN=voz.exemplo.com.br install)"; equal "livres, com domínio: zero" 0 "$?"
equal "livres, com domínio: publica 80 e 443" "80:80 443:443 " "$(ports_published)"
equal "livres, com domínio: anuncia o domínio em HTTPS" "https://voz.exemplo.com.br" "$(announced "$out")"
equal "livres, com domínio: confere o próprio endereço" "https://voz.exemplo.com.br" "$(probed)"
fresh
out="$(DESKVOICE_DOMAIN=voz.exemplo.com.br DESKVOICE_PANEL_LOCAL_ONLY=yes install)"; equal "livres, com domínio, só local: para com erro" 1 "$?"
contains "livres, com domínio, só local: nomeia a opção" "$out" "DESKVOICE_PANEL_LOCAL_ONLY=yes não tem efeito"
contains "livres, com domínio, só local: nomeia o modo" "$out" "com o domínio voz.exemplo.com.br, 80/443 livres"
refuse "livres, com domínio, só local: nada foi gravado" test -e "$O"
refuse "livres, com domínio, só local: nem os arquivos de ambiente" test -e "$D/.env"

# 4. 80/443 de outro proxy, sem domínio: padrão só local; com a opção, igual; aberto só pedindo.
other_proxy; fresh
out="$(DESKVOICE_DOMAIN="" install)"; equal "outro proxy, sem domínio, padrão: zero" 0 "$?"
equal "outro proxy, sem domínio, padrão: publica só em 127.0.0.1" "127.0.0.1:3080:80 " "$(ports_published)"
equal "outro proxy, sem domínio, padrão: anuncia o túnel" "http://localhost:3080" "$(announced "$out")"
fresh
out="$(DESKVOICE_DOMAIN="" DESKVOICE_PANEL_LOCAL_ONLY=yes install)"; equal "outro proxy, sem domínio, só local: zero" 0 "$?"
equal "outro proxy, sem domínio, só local: publica só em 127.0.0.1" "127.0.0.1:3080:80 " "$(ports_published)"
fresh
out="$(DESKVOICE_DOMAIN="" DESKVOICE_PANEL_PUBLIC_HTTP=yes install)"; equal "outro proxy, sem domínio, HTTP pedido: zero" 0 "$?"
equal "outro proxy, sem domínio, HTTP pedido: publica a porta para fora" "0.0.0.0:3080:80 " "$(ports_published)"
equal "outro proxy, sem domínio, HTTP pedido: anuncia IP e porta" "http://203.0.113.10:3080" "$(announced "$out")"

# 5. 80/443 de outro proxy, com domínio: porta local; o domínio depende do proxy do operador, e a
#    mensagem diz até onde foi conferido.
fresh
out="$(DESKVOICE_DOMAIN=voz.exemplo.com.br install)"; equal "outro proxy, com domínio: zero" 0 "$?"
equal "outro proxy, com domínio: publica só em 127.0.0.1" "127.0.0.1:3080:80 " "$(ports_published)"
equal "outro proxy, com domínio: anuncia o domínio" "https://voz.exemplo.com.br" "$(announced "$out")"
contains "outro proxy, com domínio: diz que só conferiu até a porta local" "$out" "daqui eu conferi até a porta local 127.0.0.1:3080"
equal "outro proxy, com domínio: o que conferiu foi a porta local" "http://127.0.0.1:3080" "$(probed)"
fresh
out="$(DESKVOICE_DOMAIN=voz.exemplo.com.br DESKVOICE_PANEL_LOCAL_ONLY=yes install)"; equal "outro proxy, com domínio, só local: para com erro" 1 "$?"
contains "outro proxy, com domínio, só local: nomeia a opção e o modo" "$out" "DESKVOICE_PANEL_LOCAL_ONLY=yes não tem efeito no modo desta instalação (com o domínio voz.exemplo.com.br, 80/443 de outro proxy)"
refuse "outro proxy, com domínio, só local: nada foi gravado" test -e "$O"

# 6. Valor que não é `yes`: recusado em todo modo, antes de gravar (o "1" da instalação real).
for ports in free_ports other_proxy; do for domain in "" voz.exemplo.com.br; do
  $ports; fresh
  out="$(DESKVOICE_DOMAIN="$domain" DESKVOICE_PANEL_LOCAL_ONLY=1 install)"; equal "valor 1 ($ports, domínio '$domain'): para com erro" 1 "$?"
  contains "valor 1 ($ports, domínio '$domain'): diz o valor aceito" "$out" "O único valor aceito é yes"
  refuse "valor 1 ($ports, domínio '$domain'): nada foi gravado" test -e "$D/.env"
done; done

# ── Reinstalação: a exposição não muda sozinha ──
free_ports; fresh
out="$(DESKVOICE_DOMAIN="" DESKVOICE_PANEL_PUBLIC_HTTP=yes install)"   # instalado como antes desta mudança: HTTP na 80
printf 'LISTEN 0 511 0.0.0.0:80 0.0.0.0:*\n' > "$FAKE_DIR/ss_tcp"     # a 80 agora é do nosso Caddy
out="$(DESKVOICE_DOMAIN="" install)"; equal "reinstalar quem está em HTTP na 80: zero" 0 "$?"
equal "reinstalar quem está em HTTP na 80: continua na 80, sem ninguém pedir" "80:80 " "$(ports_published)"
contains "reinstalar em HTTP: avisa com destaque" "$out" "ATENÇÃO: esta instalação já publicava o painel na internet por HTTP, SEM HTTPS"
contains "reinstalar em HTTP: diz o comando para passar ao modo local" "$out" "DESKVOICE_PANEL_LOCAL_ONLY=yes bash install/install.sh"
# Instalação de antes do arquivo de publicação (só o .env diz que era sem domínio): também fica.
rm "$O"
out="$(DESKVOICE_DOMAIN="" install)"
equal "reinstalar instalação antiga sem arquivo de publicação: continua na 80" "80:80 " "$(ports_published)"
# A atualização (converge_entry é o que ela chama) também não mexe.
before="$(cat "$O")"; converge_entry; equal "atualização não muda quem está em HTTP na 80" "$before" "$(cat "$O")"
# Passar ao modo local é um pedido, e daí em diante fica local, na mesma porta.
out="$(DESKVOICE_DOMAIN="" DESKVOICE_PANEL_LOCAL_ONLY=yes DESKVOICE_PANEL_PORT=3090 install)"; equal "fechar o painel a pedido: zero" 0 "$?"
equal "fechar o painel a pedido: só em 127.0.0.1, na porta pedida" "127.0.0.1:3090:80 " "$(ports_published)"
free_ports
out="$(DESKVOICE_DOMAIN="" install)"
equal "reinstalar quem está local: continua local, na porta que o túnel já conhece" "127.0.0.1:3090:80 " "$(ports_published)"
before="$(cat "$O")"; converge_entry; equal "atualização não muda quem está local" "$before" "$(cat "$O")"

# ── Reinstalação e o login: sem a senha não há o que testar, e o instalador diz isso ──
rm -f "$FAKE_DIR/login_stdin"
out="$(DESKVOICE_DOMAIN="" DESKVOICE_OWNER_PASSWORD="" install)"; equal "reinstalar sem informar a senha: zero" 0 "$?"
contains "reinstalar sem senha: diz que NÃO testou o login" "$out" "Login NÃO testado: o usuário dono já existia"
lacks "reinstalar sem senha: não finge que conferiu" "$out" "Login conferido"
lacks "reinstalar sem senha: não diz pronto" "$out" "Pronto para configurar"
refuse "reinstalar sem senha: nenhuma tentativa de login" test -e "$FAKE_DIR/login_stdin"
# Com a senha nas respostas, testa; se ela não entra (pode ter sido trocada), avisa e não finge.
echo 'rejected|401' > "$FAKE_DIR/login_probe"
out="$(DESKVOICE_DOMAIN="" install)"; equal "reinstalar com senha que não entra: termina (o dono pode ter trocado a senha)" 0 "$?"
contains "reinstalar com senha que não entra: avisa" "$out" "Login NÃO conferido"
lacks "reinstalar com senha que não entra: não diz pronto" "$out" "Pronto para configurar"

# ── Dono novo e o login falha: o instalador NÃO diz pronto ──
fresh; echo 'rejected|401' > "$FAKE_DIR/login_probe"
out="$(DESKVOICE_DOMAIN="" install)"; equal "dono novo, login recusado: para com erro" 1 "$?"
contains "dono novo, login recusado: diz o que falhou" "$out" "RECUSOU o e-mail e a senha"
contains "dono novo, login recusado: diz o que fazer" "$out" "bash install/reset-password.sh ana@exemplo.com.br"
lacks "dono novo, login recusado: não diz pronto" "$out" "Pronto"
lacks "dono novo, login recusado: não anuncia o painel" "$out" "Painel:"
fresh; echo 'session|401' > "$FAKE_DIR/login_probe"
out="$(DESKVOICE_DOMAIN="" install)"; equal "login aceito e sessão que não vale: para com erro" 1 "$?"
contains "sessão que não vale: diz o que falhou" "$out" "a sessão não valeu"
lacks "sessão que não vale: não diz pronto" "$out" "Pronto"
fresh; echo 'unreachable|ECONNREFUSED' > "$FAKE_DIR/login_probe"
out="$(DESKVOICE_DOMAIN="" install)"; equal "tela de entrada inalcançável: para com erro" 1 "$?"
lacks "tela de entrada inalcançável: não diz pronto" "$out" "Pronto"
fresh; : > "$FAKE_DIR/login_probe"
out="$(DESKVOICE_DOMAIN="" install)"; equal "sonda do login sem resposta: para com erro" 1 "$?"
fresh; echo 'limited|429' > "$FAKE_DIR/login_probe"
out="$(DESKVOICE_DOMAIN="" install)"; equal "limite de tentativas: termina, dizendo que não testou" 0 "$?"
contains "limite de tentativas: diz que NÃO testou" "$out" "Login NÃO testado: o painel está no limite de tentativas"
lacks "limite de tentativas: não diz pronto" "$out" "Pronto para configurar"

# ── A porta publicada não responde: não anuncia o endereço e não tenta o login ──
fresh; printf 000 > "$FAKE_DIR/host_probe"
out="$(DESKVOICE_DOMAIN="" install)"; equal "porta publicada sem resposta: para com erro" 1 "$?"
contains "porta publicada sem resposta: diz qual" "$out" "http://127.0.0.1:3080) não respondeu"
lacks "porta publicada sem resposta: não diz pronto" "$out" "Pronto"
lacks "porta publicada sem resposta: não anuncia o painel" "$out" "Painel:"
refuse "porta publicada sem resposta: nenhuma tentativa de login" test -e "$FAKE_DIR/login_stdin"
fresh; printf 000 > "$FAKE_DIR/host_probe"
out="$(DESKVOICE_DOMAIN=voz.exemplo.com.br install)"; equal "domínio que não abre: para com erro" 1 "$?"
contains "domínio que não abre: diz a causa mais comum" "$out" "o domínio voz.exemplo.com.br ainda não aponta para 203.0.113.10"
lacks "domínio que não abre: não diz pronto" "$out" "Pronto"
finish
