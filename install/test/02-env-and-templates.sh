#!/usr/bin/env bash
# Geração dos três arquivos de ambiente e renderização dos modelos do Asterisk.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
source "$KIT/_common.sh"; set +e; trap - ERR
D="$DESKVOICE_DEPLOY_DIR"

write_env_files "https://voz.exemplo.com.br" 203.0.113.10 voz.exemplo.com.br 10000 10200
keys() { sed 's/=.*//' "$1" | sort | tr '\n' ' '; }
equal "campos do .env (a versão é gravada pelo instalador; o endereço das imagens mora em images.env)" "PANEL_DOMAIN POSTGRES_PASSWORD RTP_END RTP_START UPDATE_AGENT_TOKEN " "$(keys "$D/.env")"
equal "campos do app.env" "ARI_PASSWORD ARI_USERNAME DATABASE_URL DESKVOICE_SECRET_KEY INTERNAL_TOKEN PUBLIC_IP PUBLIC_URL SYSTEM_DATABASE_URL " "$(keys "$D/app.env")"
equal "campos do migrate.env" "APP_DB_PASSWORD MIGRATION_DATABASE_URL SYSTEM_DATABASE_URL SYSTEM_DB_PASSWORD " "$(keys "$D/migrate.env")"
for f in .env app.env migrate.env; do equal "permissão 600 em $f" 600 "$(mode_of "$D/$f")"; done

owner_pw="$(env_get "$D/.env" POSTGRES_PASSWORD)"; app_pw="$(env_get "$D/migrate.env" APP_DB_PASSWORD)"; sys_pw="$(env_get "$D/migrate.env" SYSTEM_DB_PASSWORD)"
check "senha do dono tem tamanho de segredo" test "${#owner_pw}" -ge 32
lacks "app.env não tem a senha do dono do banco" "$(cat "$D/app.env")" "$owner_pw"
lacks "app.env não tem a URL de migration" "$(cat "$D/app.env")" "MIGRATION_DATABASE_URL"
lacks ".env não tem a chave de segredos" "$(cat "$D/.env")" "DESKVOICE_SECRET_KEY"
equal "DATABASE_URL usa o papel da aplicação" "postgres://deskvoice_app:${app_pw}@postgres:5432/deskvoice" "$(env_get "$D/app.env" DATABASE_URL)"
equal "SYSTEM_DATABASE_URL usa o papel de sistema" "postgres://deskvoice_system:${sys_pw}@postgres:5432/deskvoice" "$(env_get "$D/app.env" SYSTEM_DATABASE_URL)"
equal "SYSTEM_DATABASE_URL igual nos dois arquivos" "$(env_get "$D/app.env" SYSTEM_DATABASE_URL)" "$(env_get "$D/migrate.env" SYSTEM_DATABASE_URL)"
equal "MIGRATION_DATABASE_URL usa o dono" "postgres://deskvoice:${owner_pw}@postgres:5432/deskvoice" "$(env_get "$D/migrate.env" MIGRATION_DATABASE_URL)"
equal "chave de segredos tem 32 bytes em base64" 32 "$(env_get "$D/app.env" DESKVOICE_SECRET_KEY | base64 -d 2>/dev/null | wc -c | tr -d ' ')"
check "três senhas de banco diferentes entre si" test "$owner_pw" != "$app_pw" -a "$app_pw" != "$sys_pw"

# Segunda execução, com respostas diferentes: segredo nenhum muda; configuração muda.
before="$(grep -hE '^(POSTGRES_PASSWORD|APP_DB_PASSWORD|SYSTEM_DB_PASSWORD|DESKVOICE_SECRET_KEY|INTERNAL_TOKEN|ARI_PASSWORD)=' "$D/.env" "$D/app.env" "$D/migrate.env")"
env_set "$D/.env" COMPOSE_PROFILES caddy
write_env_files "http://198.51.100.7" 198.51.100.7 ":80" 20000 20200
after="$(grep -hE '^(POSTGRES_PASSWORD|APP_DB_PASSWORD|SYSTEM_DB_PASSWORD|DESKVOICE_SECRET_KEY|INTERNAL_TOKEN|ARI_PASSWORD)=' "$D/.env" "$D/app.env" "$D/migrate.env")"
equal "segunda execução não troca nenhum segredo" "$before" "$after"
equal "segunda execução mantém seis segredos" 6 "$(printf '%s\n' "$after" | wc -l | tr -d ' ')"
equal "segunda execução atualiza o IP" 198.51.100.7 "$(env_get "$D/app.env" PUBLIC_IP)"
equal "segunda execução atualiza a faixa" 20000 "$(env_get "$D/.env" RTP_START)"
lacks "COMPOSE_PROFILES de instalação antiga é removido" "$(cat "$D/.env")" "COMPOSE_PROFILES"
equal "nenhuma chave duplicada" "" "$(cat "$D/.env" "$D/app.env" | sed 's/=.*//' | sort | uniq -d)"
for f in .env app.env migrate.env; do equal "permissão 600 mantida em $f" 600 "$(mode_of "$D/$f")"; done

env_set "$D/x.env" K 'a\b&c|d$e "f"'
equal "env_set preserva caracteres especiais" 'a\b&c|d$e "f"' "$(env_get "$D/x.env" K)"

# Modelos do Asterisk
render_asterisk_config
G="$D/asterisk/generated"
contains "ari.conf recebe a senha da ARI" "$(cat "$G/ari.conf")" "password = $(env_get "$D/app.env" ARI_PASSWORD)"
equal "pasta com a senha da ARI fechada para outros usuários" 700 "$(mode_of "$G")"

# Servidor endurecido (umask 077): o repositório baixado e tudo o que o instalador escreve nascem
# legíveis só pelo dono. O Asterisk roda com outro usuário dentro do contêiner, então todo arquivo
# que ele monta precisa sair legível, qualquer que seja o umask. Achado na primeira instalação
# real: o plano de discagem e a ARI não carregaram e a checagem dizia "ok".
( umask 077
  chmod 600 "$D/asterisk/extensions.conf" "$D/asterisk/http.conf"
  rm -rf "$G"
  source "$KIT/_common.sh"; render_asterisk_config )
for f in extensions.conf http.conf ari.conf rtp.conf pjsip.conf; do
  check "umask 077: $f existe na pasta montada" test -s "$G/$f"
  equal "umask 077: $f legível pelo Asterisk" 644 "$(mode_of "$G/$f")"
done
equal "umask 077: a pasta continua fechada para outros usuários da VPS" 700 "$(mode_of "$G")"
contains "o plano de discagem montado é o do repositório" "$(cat "$G/extensions.conf")" "Stasis(deskvoice,inbound)"
lacks "o compose não monta mais arquivo direto do repositório" "$(grep -E '^\s+- \./asterisk/' "$D/docker-compose.yml")" "./asterisk/extensions.conf"

# ── Entrada única: só o Caddy do DeskVoice publica porta, nos dois modos ──
O="$D/docker-compose.override.yml"
services_with_ports() { awk '/^  [a-z-]+:/ { s = $1 } /^    ports:/ { print s }' "$1" | tr -d ':' | tr '\n' ' '; }
equal "compose base: só o Asterisk publica porta (o Caddy recebe as dele do instalador)" "asterisk " "$(services_with_ports "$REPO/deploy/docker-compose.yml")"
lacks "compose base: o Caddy não é mais opcional" "$(cat "$REPO/deploy/docker-compose.yml")" "profiles:"
contains "o Caddy encaminha a voz do navegador" "$(cat "$REPO/deploy/Caddyfile")" "reverse_proxy voice:8091"
contains "o Caddy encaminha o resto ao painel" "$(cat "$REPO/deploy/Caddyfile")" "reverse_proxy panel:3000"
hops() { env_get "$D/app.env" TRUSTED_PROXY_HOPS; }
ports_published() { sed -n 's/^ *- "\(.*\)"$/\1/p' "$O" | tr '\n' ' '; }
setting() { sed -n "s/.*$1: \"\(.*\)\".*/\1/p" "$O"; }

apply_entry caddy voz.exemplo.com.br
equal "80/443 livres, com domínio: publica 80 e 443" "80:80 443:443 " "$(ports_published)"
equal "80/443 livres, com domínio: o Caddy atende o domínio (HTTPS automático)" voz.exemplo.com.br "$(setting CADDY_SITE)"
equal "80/443 livres, com domínio: o Caddy não confia em ninguém de fora" "127.0.0.1/32" "$(setting CADDY_TRUSTED_PROXIES)"
equal "80/443 livres, com domínio: painel conta 1 salto" 1 "$(hops)"
equal "só o Caddy tem porta" "caddy " "$(services_with_ports "$O")"
lacks "painel nunca publica porta" "$(cat "$O")" "3000"
lacks "voz nunca publica porta" "$(cat "$O")" "8091"
equal "publicação: arquivo só do dono" 600 "$(mode_of "$O")"

apply_entry caddy ""
equal "80/443 livres, sem domínio: só HTTP na 80" "80:80 " "$(ports_published)"
equal "80/443 livres, sem domínio: site :80" ":80" "$(setting CADDY_SITE)"
equal "80/443 livres, sem domínio: 1 salto" 1 "$(hops)"

apply_entry external voz.exemplo.com.br 127.0.0.1 3080
equal "atrás do proxy do operador: UMA porta local, só para dentro da máquina" "127.0.0.1:3080:80 " "$(ports_published)"
equal "atrás do proxy do operador: só HTTP (o HTTPS é do proxy do operador)" ":80" "$(setting CADDY_SITE)"
equal "atrás do proxy do operador: o Caddy ouve só vizinho de rede privada" private_ranges "$(setting CADDY_TRUSTED_PROXIES)"
equal "atrás do proxy do operador: painel conta 2 saltos" 2 "$(hops)"
equal "atrás do proxy do operador: só o Caddy tem porta" "caddy " "$(services_with_ports "$O")"

apply_entry external "" 0.0.0.0 3080
equal "sem domínio, aberto pelo IP: uma porta" "0.0.0.0:3080:80 " "$(ports_published)"
equal "sem domínio, aberto pelo IP: Caddy recebe o visitante direto, não confia em cabeçalho" "127.0.0.1/32" "$(setting CADDY_TRUSTED_PROXIES)"
equal "sem domínio, aberto pelo IP: 1 salto" 1 "$(hops)"
apply_entry external "" 127.0.0.1 3080
equal "sem domínio, por túnel: uma porta só para dentro" "127.0.0.1:3080:80 " "$(ports_published)"
equal "sem domínio, por túnel: não confia em cabeçalho (o lado seguro)" "127.0.0.1/32" "$(setting CADDY_TRUSTED_PROXIES)"
equal "sem domínio, por túnel: 1 salto" 1 "$(hops)"
equal "TRUSTED_PROXY_HOPS aparece uma vez só" 1 "$(grep -c '^TRUSTED_PROXY_HOPS=' "$D/app.env")"

# ── Instalação antiga (painel e voz em duas portas) converge sem perguntar nada ──
legacy_two_ports() {  # legacy_two_ports <endereço do painel>
  printf '# Gerado pelo instalador: 80/443 já são de outro proxy nesta máquina.\nservices:\n  panel:\n    ports:\n      - "%s:3080:3000"\n  voice:\n    ports:\n      - "127.0.0.1:3081:8091"\n' "$1" > "$O"
  env_set "$D/app.env" VOICE_WEB_PUBLIC_PORT 3081; env_set "$D/app.env" TRUSTED_PROXY_HOPS 0; env_set "$D/.env" COMPOSE_PROFILES ""
}
legacy_two_ports 127.0.0.1; env_set "$D/.env" PANEL_DOMAIN localhost
equal "formato antigo: lê o endereço e a porta do painel" "127.0.0.1 3080" "$(published_entry)"
converge_entry
equal "antiga, por túnel: o Caddy assume a MESMA porta do painel" "127.0.0.1:3080:80 " "$(ports_published)"
lacks "antiga: a porta de voz 3081 some" "$(cat "$O")" "3081"
equal "antiga: só o Caddy tem porta" "caddy " "$(services_with_ports "$O")"
lacks "antiga: VOICE_WEB_PUBLIC_PORT sai do app.env" "$(cat "$D/app.env")" "VOICE_WEB_PUBLIC_PORT"
lacks "antiga: COMPOSE_PROFILES sai do .env" "$(cat "$D/.env")" "COMPOSE_PROFILES"
equal "antiga, por túnel: 1 salto" 1 "$(hops)"
before_again="$(cat "$O" "$D/app.env" "$D/.env")"; converge_entry
equal "convergir de novo não muda nada" "$before_again" "$(cat "$O" "$D/app.env" "$D/.env")"
legacy_two_ports 0.0.0.0; converge_entry
equal "antiga, aberta pelo IP: continua aberta, na mesma porta" "0.0.0.0:3080:80 " "$(ports_published)"
legacy_two_ports 127.0.0.1; env_set "$D/.env" PANEL_DOMAIN voz.exemplo.com.br; converge_entry
equal "antiga, com domínio e proxy do operador: mesma porta" "127.0.0.1:3080:80 " "$(ports_published)"
equal "antiga, com domínio e proxy do operador: 2 saltos" 2 "$(hops)"
rm "$O"; env_set "$D/.env" COMPOSE_PROFILES caddy; converge_entry
equal "antiga, com o Caddy nas 80/443 (sem arquivo): passa a publicar 80 e 443" "80:80 443:443 " "$(ports_published)"
equal "antiga, com o Caddy nas 80/443: atende o domínio" voz.exemplo.com.br "$(setting CADDY_SITE)"
rm "$O"; env_set "$D/.env" PANEL_DOMAIN ":80"; converge_entry
equal "antiga, Caddy sem domínio: só a 80" "80:80 " "$(ports_published)"
equal "formato atual: published_entry lê a porta do Caddy" "127.0.0.1 3080" "$(apply_entry external "" 127.0.0.1 3080; published_entry)"
contains "rtp.conf recebe o início da faixa" "$(cat "$G/rtp.conf")" "rtpstart=20000"
contains "rtp.conf recebe o fim da faixa" "$(cat "$G/rtp.conf")" "rtpend=20200"
contains "pjsip.conf anuncia o IP público no áudio" "$(cat "$G/pjsip.conf")" "external_media_address=198.51.100.7"
contains "pjsip.conf anuncia o IP público na sinalização" "$(cat "$G/pjsip.conf")" "external_signaling_address=198.51.100.7"
contains "pjsip.conf tolera a ausência do arquivo de troncos" "$(cat "$G/pjsip.conf")" "#tryinclude generated/pjsip_trunks.conf"
lacks "nenhum \${...} do instalador sobra" "$(cat "$G"/*.conf | grep -E '\$\{(ARI_PASSWORD|PUBLIC_IP|RTP_START|RTP_END)\}')" '${'

printf 'x=${EXTEN} y=${PUBLIC_IP} z=${PUBLIC_IP}\n' > "$SANDBOX/t.tmpl"
PUBLIC_IP='1.2.3.4' render_template "$SANDBOX/t.tmpl" "$SANDBOX/t.out"
equal "troca todas as ocorrências e deixa variável do Asterisk intacta" 'x=${EXTEN} y=1.2.3.4 z=1.2.3.4' "$(cat "$SANDBOX/t.out")"
refuse "modelo com variável vazia é recusado" bash -c "source '$KIT/_common.sh'; PUBLIC_IP='' render_template '$SANDBOX/t.tmpl' '$SANDBOX/t2.out'"
refuse "variável vazia não deixa arquivo pela metade" test -e "$SANDBOX/t2.out"
finish
