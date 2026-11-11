#!/usr/bin/env bash
# update.sh: nunca roda sem backup; se a versão nova não fica saudável, volta sozinho.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
fake_install
source "$KIT/_common.sh"; set +e; trap - ERR
E="$DESKVOICE_DEPLOY_DIR/.env"
export DESKVOICE_HEALTH_TIMEOUT=0
printf 'agents=3\ncalls=120\nusers=1\n' > "$FAKE_DIR/counts_backup"
cp "$FAKE_DIR/counts_backup" "$FAKE_DIR/counts_restore"
position() { grep -n -- "$1" "$FAKE_DIR/calls.log" | head -n 1 | cut -d: -f1; }

# Atualização que dá certo.
: > "$FAKE_DIR/calls.log"
out="$(bash "$KIT/update.sh" --to v0.2.0 --yes 2>&1)"; equal "atualização saudável sai com zero" 0 "$?"
contains "mostra a versão atual" "$out" "Atual: stable"
contains "mostra a versão alvo" "$out" "Alvo:  v0.2.0"
equal "grava a versão nova" v0.2.0 "$(env_get "$E" DESKVOICE_VERSION)"
check "o backup vem antes das migrations" test "$(position ' pg_dump ')" -lt "$(position 'run --rm migrate')"
check "as migrations vêm antes de subir" test "$(position 'run --rm migrate')" -lt "$(position ' up -d')"
equal "fez exatamente um backup" 1 "$(ls "$DESKVOICE_BACKUP_DIR"/*/manifest.txt | wc -l | tr -d ' ')"
contains "diz que conferiu as peças" "$out" "todas as peças essenciais respondendo"
secret_before="$(env_get "$E" POSTGRES_PASSWORD)"

out="$(bash "$KIT/update.sh" --to v0.2.0 --yes 2>&1)"; equal "mesma versão: nada a fazer, zero" 0 "$?"
contains "mesma versão: diz que já está" "$out" "já está na versão v0.2.0"

# Sem backup não há atualização.
touch "$FAKE_DIR/pg_dump_fail"; : > "$FAKE_DIR/calls.log"
out="$(bash "$KIT/update.sh" --to v0.3.0 --yes 2>&1)"; equal "backup falhou: atualização não começa" 1 "$?"
equal "backup falhou: versão intacta" v0.2.0 "$(env_get "$E" DESKVOICE_VERSION)"
equal "backup falhou: nenhuma migration rodou" 0 "$(grep -c 'run --rm migrate' "$FAKE_DIR/calls.log")"
contains "backup falhou: diz que nada mudou" "$out" "atualização NÃO começou"
rm "$FAKE_DIR/pg_dump_fail"

# Versão nova sobe doente: volta para a anterior e restaura o banco.
printf '%s\n' postgres asterisk voice routines caddy > "$FAKE_DIR/running"   # o painel não sobe
: > "$FAKE_DIR/calls.log"
out="$(bash "$KIT/update.sh" --to v0.3.0 --yes 2>&1)"; equal "versão doente: sai com erro" 1 "$?"
equal "versão doente: volta a versão anterior" v0.2.0 "$(env_get "$E" DESKVOICE_VERSION)"
equal "versão doente: restaura o banco do backup" 1 "$(grep -c 'alter database deskvoice_restore rename to deskvoice' "$FAKE_DIR/calls.log")"
contains "versão doente: mostra qual peça falhou" "$out" "falha  Painel"
contains "versão doente: não esconde que a volta também não respondeu" "$out" "a volta para v0.2.0 não terminou bem"
lacks "versão doente: não diz atualizado" "$out" "Atualizado para"
equal "nenhum segredo mudou no caminho" "$secret_before" "$(env_get "$E" POSTGRES_PASSWORD)"

# Migration da versão nova falha: volta, e a anterior responde.
printf '%s\n' postgres asterisk panel voice routines caddy > "$FAKE_DIR/running"
echo 1 > "$FAKE_DIR/migrate_exit"
out="$(bash "$KIT/update.sh" --to v0.3.0 --yes 2>&1)"; equal "migration falhou: sai com erro" 1 "$?"
equal "migration falhou: volta a versão anterior" v0.2.0 "$(env_get "$E" DESKVOICE_VERSION)"
contains "migration falhou: diz o que aconteceu e onde está" "$out" "foi desfeita: você está de volta na versão v0.2.0"
contains "migration falhou: aponta o backup usado" "$out" "$DESKVOICE_BACKUP_DIR/"
echo 0 > "$FAKE_DIR/migrate_exit"

# Entrada única respondia antes e parou depois (peças essenciais de pé): conta como regressão e volta.
# O Docker de mentira responde ok até a subida da versão nova, e 404 a partir dela.
cat > "$FAKE_DIR/entry_probe_after_up" <<'PROBE'
panel|404
voice|404
PROBE
out="$(bash "$KIT/update.sh" --to v0.3.0 --yes 2>&1)"; equal "entrada quebrou na atualização: sai com erro" 1 "$?"
equal "entrada quebrou: volta a versão anterior" v0.2.0 "$(env_get "$E" DESKVOICE_VERSION)"
contains "entrada quebrou: diz que o painel deixou de abrir" "$out" "deixou de abrir pelo endereço que abria antes"
lacks "entrada quebrou: não diz atualizado" "$out" "Atualizado para"
rm -f "$FAKE_DIR/entry_probe_after_up" "$FAKE_DIR/entry_probe"

# Instalação de antes da entrada única: a atualização converge a publicação sozinha.
O="$DESKVOICE_DEPLOY_DIR/docker-compose.override.yml"; A="$DESKVOICE_DEPLOY_DIR/app.env"
printf 'services:\n  panel:\n    ports:\n      - "127.0.0.1:3080:3000"\n  voice:\n    ports:\n      - "127.0.0.1:3081:8091"\n' > "$O"
env_set "$A" VOICE_WEB_PUBLIC_PORT 3081; env_set "$E" PANEL_DOMAIN localhost
out="$(bash "$KIT/update.sh" --to v0.4.0 --yes 2>&1)"; equal "atualização de instalação de duas portas: zero" 0 "$?"
contains "atualização: o Caddy assume a porta do painel" "$(cat "$O")" '"127.0.0.1:3080:80"'
lacks "atualização: painel deixa de publicar porta" "$(cat "$O")" ":3000"
lacks "atualização: voz deixa de publicar porta" "$(cat "$O")" "8091"
lacks "atualização: VOICE_WEB_PUBLIC_PORT sai" "$(cat "$A")" "VOICE_WEB_PUBLIC_PORT"
equal "atualização: 1 salto por túnel" 1 "$(env_get "$A" TRUSTED_PROXY_HOPS)"

out="$(bash "$KIT/update.sh" --yes 2>&1)"; equal "sem --to e sem repositório git: recusa" 1 "$?"
contains "sem --to: diz como informar a versão" "$out" "--to <versão>"
refuse "nome de versão com caractere estranho é recusado" bash "$KIT/update.sh" --yes --to 'v1;rm -rf x'
equal "nenhum teste chamou git que altera estado" 0 "$(grep -cE '^git .*(checkout|fetch|reset|commit|stash)' "$FAKE_DIR/calls.log")"
finish
