#!/usr/bin/env bash
# install.sh de verdade (com Docker de mentira): a publicação que ele grava em cada modo, a
# reinstalação por cima de uma instalação de duas portas e as instruções finais, com UMA porta.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
source "$KIT/_common.sh"; set +e; trap - ERR
D="$DESKVOICE_DEPLOY_DIR"; O="$D/docker-compose.override.yml"; A="$D/app.env"
export DESKVOICE_ORG_NAME="Clínica Exemplo" DESKVOICE_OWNER_NAME="Ana Exemplo" DESKVOICE_OWNER_EMAIL=ana@exemplo.com.br DESKVOICE_OWNER_PASSWORD="senha-de-teste-123"
export DESKVOICE_HEALTH_TIMEOUT=0
echo 1 > "$FAKE_DIR/users_count"
: > "$FAKE_DIR/git_tags"   # um clone do repositório, ainda sem nenhuma versão publicada
printf 'asterisk|ok|PJSIP 20.20.1\n' > "$FAKE_DIR/voice_health"
printf '%s\n' 'panel|ok|respondendo' 'trunk|warn|sem linha' 'engine|warn|sem chave' > "$FAKE_DIR/panel_health"
other_proxy() { printf 'LISTEN 0 511 0.0.0.0:80 0.0.0.0:*\nLISTEN 0 511 0.0.0.0:443 0.0.0.0:*\n%s' "${1:-}" > "$FAKE_DIR/ss_tcp"; }
install() { bash "$KIT/install.sh" --yes --force 2>&1; }
ports_published() { sed -n 's/^ *- "\(.*\)"$/\1/p' "$O" | tr '\n' ' '; }
services_with_ports() { awk '/^  [a-z-]+:/ { s = $1 } /^    ports:/ { print s }' "$O" | tr -d ':' | tr '\n' ' '; }

# ── 1. Instalação que já existia, no formato de DUAS portas (o caso da instalação de teste real):
#       painel em 127.0.0.1:3080, voz em 127.0.0.1:3081, sem domínio, por túnel. ──
write_env_files "http://localhost:3080" 203.0.113.10 localhost 10000 10200
printf '# Gerado pelo instalador: 80/443 já são de outro proxy nesta máquina.\nservices:\n  panel:\n    ports:\n      - "127.0.0.1:3080:3000"\n  voice:\n    ports:\n      - "127.0.0.1:3081:8091"\n' > "$O"
env_set "$A" VOICE_WEB_PUBLIC_PORT 3081; env_set "$A" TRUSTED_PROXY_HOPS 1; env_set "$D/.env" COMPOSE_PROFILES ""
secret_before="$(env_get "$A" DESKVOICE_SECRET_KEY)"
# As portas antigas estão ocupadas pelos NOSSOS contêineres antigos; a reinstalação não pode fugir delas.
other_proxy 'LISTEN 0 128 127.0.0.1:3080 0.0.0.0:*
LISTEN 0 128 127.0.0.1:3081 0.0.0.0:*
'
printf '%s\n' postgres asterisk panel voice routines caddy > "$FAKE_DIR/running"
out="$(DESKVOICE_DOMAIN="" install)"; equal "reinstalar por cima de duas portas: sai com zero" 0 "$?"
equal "reinstalar: UMA publicação, na mesma porta que o túnel já conhecia" "127.0.0.1:3080:80 " "$(ports_published)"
equal "reinstalar: só o Caddy tem porta" "caddy " "$(services_with_ports)"
lacks "reinstalar: a porta de voz antiga não fica em lugar nenhum do arquivo" "$(cat "$O")" "3081"
lacks "reinstalar: VOICE_WEB_PUBLIC_PORT sai do app.env" "$(cat "$A")" "VOICE_WEB_PUBLIC_PORT"
equal "reinstalar: continua só local, sem ninguém pedir" "http://localhost:3080" "$(env_get "$A" PUBLIC_URL)"
equal "reinstalar por túnel: 1 salto, Caddy sem confiar em cabeçalho" "1 127.0.0.1/32" "$(env_get "$A" TRUSTED_PROXY_HOPS) $(sed -n 's/.*CADDY_TRUSTED_PROXIES: "\(.*\)".*/\1/p' "$O")"
equal "reinstalar: segredo nenhum muda" "$secret_before" "$(env_get "$A" DESKVOICE_SECRET_KEY)"
check "reinstalar: sobe tirando contêiner e porta que sobraram" grep -q "docker-compose.override.yml up -d --remove-orphans" "$FAKE_DIR/calls.log"
check "reinstalar: baixa a imagem do Caddy" grep -q "pull -q postgres asterisk caddy" "$FAKE_DIR/calls.log"
contains "túnel: uma porta só" "$out" "ssh -L 3080:127.0.0.1:3080 <usuário>@203.0.113.10"
lacks "túnel: nenhuma menção à segunda porta" "$out" "3081"
lacks "túnel: nenhuma segunda regra -L" "$out" "-L 3080:127.0.0.1:3080 -L"
contains "confere a entrada antes de anunciar o endereço" "$out" "Entrada única conferida"

# ── 2. Mesma máquina, agora com domínio atrás do proxy do operador ──
out="$(DESKVOICE_DOMAIN=voz.exemplo.com.br install)"; equal "com domínio atrás do proxy do operador: zero" 0 "$?"
equal "proxy do operador: mesma porta única, só para dentro" "127.0.0.1:3080:80 " "$(ports_published)"
equal "proxy do operador: 2 saltos e Caddy ouvindo só rede privada" "2 private_ranges" "$(env_get "$A" TRUSTED_PROXY_HOPS) $(sed -n 's/.*CADDY_TRUSTED_PROXIES: "\(.*\)".*/\1/p' "$O")"
nginx="$(printf '%s\n' "$out" | grep 'Nginx instalado')"
equal "Nginx: uma linha só" 1 "$(printf '%s\n' "$nginx" | wc -l | tr -d ' ')"
contains "Nginx: destino é a porta única" "$nginx" "proxy_pass http://127.0.0.1:3080;"
contains "Nginx: repassa Upgrade (WebSocket)" "$nginx" 'proxy_set_header Upgrade $http_upgrade;'
contains "Nginx: repassa Connection (WebSocket)" "$nginx" 'proxy_set_header Connection "upgrade";'
contains "Nginx: HTTP/1.1, sem o qual o WebSocket não passa" "$nginx" "proxy_http_version 1.1;"
contains "Nginx: acrescenta o endereço do visitante" "$nginx" 'proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;'
contains "Caddy do operador: uma linha, porta única" "$(printf '%s\n' "$out" | grep 'Caddy instalado')" "reverse_proxy 127.0.0.1:3080"
contains "proxy em contêiner: aponta para o Caddy do DeskVoice, não para o painel" "$(printf '%s\n' "$out" | grep 'Proxy em contêiner')" "http://deskvoice-caddy-1:80"
contains "proxy em contêiner: pede WebSocket" "$(printf '%s\n' "$out" | grep 'Proxy em contêiner')" "WebSocket"
lacks "nenhuma instrução aponta para o painel direto" "$out" "deskvoice-panel-1"
lacks "nenhuma instrução aponta para a voz direto" "$out" "deskvoice-voice-1"
lacks "nenhuma instrução usa a porta de voz" "$out" "8091"
lacks "nenhuma segunda porta nas instruções" "$out" "3081"
contains "manda apagar a regra antiga de /voice-ws" "$out" "regra separada para /voice-ws"

# ── 3. Sem domínio, aberto pelo IP ──
env_set "$D/.env" PANEL_DOMAIN localhost   # resposta vazia mantém o domínio anterior; aqui a máquina nunca teve
out="$(DESKVOICE_DOMAIN="" DESKVOICE_PANEL_PUBLIC_HTTP=yes install)"; equal "aberto pelo IP: zero" 0 "$?"
equal "aberto pelo IP: uma publicação" "0.0.0.0:3080:80 " "$(ports_published)"
equal "aberto pelo IP: 1 salto" 1 "$(env_get "$A" TRUSTED_PROXY_HOPS)"
contains "aberto pelo IP: avisa do microfone e ensina o túnel de uma porta" "$out" "ssh -L 3080:127.0.0.1:3080 <usuário>@203.0.113.10"

# ── 4. Máquina com 80/443 livres ──
: > "$FAKE_DIR/ss_tcp"; rm "$O"
out="$(DESKVOICE_DOMAIN=voz.exemplo.com.br install)"; equal "80/443 livres com domínio: zero" 0 "$?"
equal "80/443 livres com domínio: publica 80 e 443" "80:80 443:443 " "$(ports_published)"
equal "80/443 livres: só o Caddy tem porta" "caddy " "$(services_with_ports)"
equal "80/443 livres: 1 salto" 1 "$(env_get "$A" TRUSTED_PROXY_HOPS)"
lacks "80/443 livres: nenhum passo de proxy pedido" "$out" "Falta um passo seu"
# Reinstalar com o nosso Caddy já nas 80/443 (as portas aparecem ocupadas, por nós): continua nelas.
other_proxy
out="$(DESKVOICE_DOMAIN=voz.exemplo.com.br install)"
equal "reinstalar com o nosso Caddy nas 80/443: continua nas 80/443" "80:80 443:443 " "$(ports_published)"
env_set "$D/.env" PANEL_DOMAIN ":80"
out="$(DESKVOICE_DOMAIN="" install)"
equal "80/443 nossas, sem domínio: só a 80" "80:80 " "$(ports_published)"
equal "sem domínio: endereço pelo IP" "http://203.0.113.10" "$(env_get "$A" PUBLIC_URL)"

# A entrada com problema não é escondida no fim da instalação.
printf 'panel|200\nvoice|502\n' > "$FAKE_DIR/entry_probe"
out="$(DESKVOICE_DOMAIN="" install)"; equal "voz inalcançável pela entrada: a instalação termina (o painel funciona)" 0 "$?"
contains "voz inalcançável pela entrada: avisa com a causa" "$out" "/voice-ws não chega ao serviço de voz"
lacks "voz inalcançável pela entrada: não diz conferida" "$out" "Entrada única conferida"
lacks "senha do dono nunca aparece" "$out" "senha-de-teste-123"
finish
