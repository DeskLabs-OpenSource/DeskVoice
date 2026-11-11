#!/usr/bin/env bash
# Geração dos três arquivos de ambiente e renderização dos modelos do Asterisk.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
source "$KIT/_common.sh"; set +e; trap - ERR
D="$DESKVOICE_DEPLOY_DIR"

write_env_files "https://voz.exemplo.com.br" 203.0.113.10 voz.exemplo.com.br 10000 10200 caddy
keys() { sed 's/=.*//' "$1" | sort | tr '\n' ' '; }
equal "campos do .env" "COMPOSE_PROFILES DESKVOICE_IMAGE_PREFIX DESKVOICE_VERSION PANEL_DOMAIN POSTGRES_PASSWORD RTP_END RTP_START " "$(keys "$D/.env")"
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
write_env_files "http://198.51.100.7" 198.51.100.7 ":80" 20000 20200 ""
after="$(grep -hE '^(POSTGRES_PASSWORD|APP_DB_PASSWORD|SYSTEM_DB_PASSWORD|DESKVOICE_SECRET_KEY|INTERNAL_TOKEN|ARI_PASSWORD)=' "$D/.env" "$D/app.env" "$D/migrate.env")"
equal "segunda execução não troca nenhum segredo" "$before" "$after"
equal "segunda execução mantém seis segredos" 6 "$(printf '%s\n' "$after" | wc -l | tr -d ' ')"
equal "segunda execução atualiza o IP" 198.51.100.7 "$(env_get "$D/app.env" PUBLIC_IP)"
equal "segunda execução atualiza a faixa" 20000 "$(env_get "$D/.env" RTP_START)"
equal "perfil vazio fica vazio" "" "$(env_get "$D/.env" COMPOSE_PROFILES)"
equal "nenhuma chave duplicada" "" "$(cat "$D/.env" "$D/app.env" | sed 's/=.*//' | sort | uniq -d)"
for f in .env app.env migrate.env; do equal "permissão 600 mantida em $f" 600 "$(mode_of "$D/$f")"; done

env_set "$D/x.env" K 'a\b&c|d$e "f"'
equal "env_set preserva caracteres especiais" 'a\b&c|d$e "f"' "$(env_get "$D/x.env" K)"

# Modelos do Asterisk
render_asterisk_config
G="$D/asterisk/generated"
contains "ari.conf recebe a senha da ARI" "$(cat "$G/ari.conf")" "password = $(env_get "$D/app.env" ARI_PASSWORD)"
equal "pasta com a senha da ARI fechada para outros usuários" 700 "$(mode_of "$G")"
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
