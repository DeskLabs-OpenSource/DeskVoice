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

# Atualização que dá certo, numa instalação que veio de uma versão sem agente de atualização.
A="$DESKVOICE_DEPLOY_DIR/app.env"; env_unset "$E" UPDATE_AGENT_TOKEN
: > "$FAKE_DIR/calls.log"
published_before="$(cat "$DESKVOICE_DEPLOY_DIR/docker-compose.override.yml")"
out="$(bash "$KIT/update.sh" --to 0.2.0 --yes 2>&1)"; equal "atualização saudável sai com zero" 0 "$?"
equal "a atualização não muda o que está publicado" "$published_before" "$(cat "$DESKVOICE_DEPLOY_DIR/docker-compose.override.yml")"
contains "mostra a versão atual" "$out" "Atual: 0.1.0"
contains "mostra a versão alvo" "$out" "Alvo:  0.2.0"
equal "grava a versão nova" 0.2.0 "$(env_get "$E" DESKVOICE_VERSION)"
check "o backup vem antes das migrations" test "$(position ' pg_dump ')" -lt "$(position 'run --rm migrate')"
check "as migrations vêm antes de subir" test "$(position 'run --rm migrate')" -lt "$(position ' up -d')"
equal "fez exatamente um backup" 1 "$(ls "$DESKVOICE_BACKUP_DIR"/*/manifest.txt | wc -l | tr -d ' ')"
contains "diz que conferiu as peças" "$out" "todas as peças essenciais respondendo"
contains "confere a porta publicada, pelo caminho de quem usa" "$out" "O painel responde pela porta publicada (https://voz.exemplo.com.br)"
check "quem veio de versão sem agente ganha o segredo antes de o painel subir" test "$(grep -n 'UPDATE_AGENT_TOKEN' "$E" | wc -l | tr -d ' ')" = 1
lacks "o segredo do agente não vai para o arquivo que voz e rotinas recebem" "$(cat "$A")" "UPDATE_AGENT_TOKEN"
equal "atualização boa: reinicia o Caddy uma vez, para ele ler o Caddyfile novo" 1 "$(grep -c ' restart caddy$' "$FAKE_DIR/calls.log")"
equal "atualização boa, sem arquivo do Asterisk diferente: não o reinicia (derrubaria ligações)" 0 "$(grep -c ' restart asterisk$' "$FAKE_DIR/calls.log")"
equal "atualização boa, sem arquivo do Asterisk diferente: nem o recarrega" 0 "$(grep -c 'asterisk -rx module reload' "$FAKE_DIR/calls.log")"
check "quem veio de versão sem agente ganha o agendamento" test -f "$DESKVOICE_SYSTEMD_DIR/deskvoice-agent.service"
contains "diz que agendou o agente" "$out" "Agente de atualização agendado"
secret_before="$(env_get "$E" POSTGRES_PASSWORD)"

out="$(bash "$KIT/update.sh" --to 0.2.0 --yes 2>&1)"; equal "mesma versão: nada a fazer, zero" 0 "$?"
contains "mesma versão: diz que já está" "$out" "já está na versão 0.2.0"
# Quem chegou à versão pelo atualizador ANTIGO (que não conhece o agente) roda o update.sh de novo:
# mesmo sem nada a atualizar, ele entrega o segredo ao painel e agenda o agente.
env_unset "$E" UPDATE_AGENT_TOKEN; rm -f "$DESKVOICE_SYSTEMD_DIR"/deskvoice-agent.*; rm -f "$FAKE_DIR/timer_enabled"; : > "$FAKE_DIR/calls.log"
out="$(bash "$KIT/update.sh" --to 0.2.0 --yes 2>&1)"; equal "mesma versão, sem agente: zero" 0 "$?"
check "mesma versão, sem agente: gera o segredo" test -n "$(env_get "$E" UPDATE_AGENT_TOKEN)"
equal "mesma versão, sem agente: recria só o painel para ele receber o segredo" 1 "$(grep -c ' up -d panel$' "$FAKE_DIR/calls.log")"
check "mesma versão, sem agente: agenda" test -f "$DESKVOICE_SYSTEMD_DIR/deskvoice-agent.timer"
equal "mesma versão, sem agente: não faz backup nem migration" 0 "$(grep -cE ' pg_dump |run --rm migrate' "$FAKE_DIR/calls.log")"
: > "$FAKE_DIR/calls.log"
out="$(bash "$KIT/update.sh" --to 0.2.0 --yes 2>&1)"
equal "mesma versão, já com agente: não recria o painel" 0 "$(grep -c ' up -d panel$' "$FAKE_DIR/calls.log")"
equal "mesma versão, já com agente: não mexe no systemd de novo" 0 "$(grep -cE '^systemctl (daemon-reload|enable)' "$FAKE_DIR/calls.log")"
equal "mesma versão, Caddy com o Caddyfile do disco: não reinicia" 0 "$(grep -c ' restart caddy$' "$FAKE_DIR/calls.log")"
# A ponte da 0.1.0: o atualizador antigo trocou o Caddyfile no disco e não reiniciou o Caddy, que
# segue com o arquivo antigo montado. A segunda rodada compara o conteúdo e reinicia.
grep -v 'system/agent' "$DESKVOICE_DEPLOY_DIR/Caddyfile" > "$FAKE_DIR/caddy_mounted"; : > "$FAKE_DIR/calls.log"
out="$(bash "$KIT/update.sh" --to 0.2.0 --yes 2>&1)"; equal "segunda rodada com Caddy desatualizado: zero" 0 "$?"
check "segunda rodada: compara o Caddyfile montado no contêiner" grep -q 'exec -T caddy cat /etc/caddy/Caddyfile' "$FAKE_DIR/calls.log"
equal "segunda rodada: reinicia o Caddy que ficou com o Caddyfile antigo" 1 "$(grep -c ' restart caddy$' "$FAKE_DIR/calls.log")"
contains "segunda rodada: diz que reiniciou o Caddy" "$out" "Reiniciando o Caddy"
rm "$FAKE_DIR/caddy_mounted"; : > "$FAKE_DIR/calls.log"
out="$(bash "$KIT/update.sh" --to 0.2.0 --yes 2>&1)"
equal "depois de reiniciado: não reinicia de novo" 0 "$(grep -c ' restart caddy$' "$FAKE_DIR/calls.log")"

# Sem backup não há atualização.
touch "$FAKE_DIR/pg_dump_fail"; : > "$FAKE_DIR/calls.log"
out="$(bash "$KIT/update.sh" --to 0.3.0 --yes 2>&1)"; equal "backup falhou: atualização não começa" 1 "$?"
equal "backup falhou: versão intacta" 0.2.0 "$(env_get "$E" DESKVOICE_VERSION)"
equal "backup falhou: nenhuma migration rodou" 0 "$(grep -c 'run --rm migrate' "$FAKE_DIR/calls.log")"
contains "backup falhou: diz que nada mudou" "$out" "atualização NÃO começou"
rm "$FAKE_DIR/pg_dump_fail"

# Versão nova sobe doente: volta para a anterior e restaura o banco.
printf '%s\n' postgres asterisk voice routines caddy > "$FAKE_DIR/running"   # o painel não sobe
: > "$FAKE_DIR/calls.log"
out="$(bash "$KIT/update.sh" --to 0.3.0 --yes 2>&1)"; equal "versão doente: sai com erro" 1 "$?"
equal "versão doente: volta a versão anterior" 0.2.0 "$(env_get "$E" DESKVOICE_VERSION)"
equal "versão doente: restaura o banco do backup" 1 "$(grep -c 'alter database deskvoice_restore rename to deskvoice' "$FAKE_DIR/calls.log")"
# A volta também reinicia o Caddy: sem isso ele seguiria com o Caddyfile da versão que não ficou.
equal "versão doente: o Caddy é reiniciado na ida e de novo na volta" 2 "$(grep -c ' restart caddy$' "$FAKE_DIR/calls.log")"
check "versão doente: o reinício da volta vem depois de restaurar o banco" test "$(grep -n ' restart caddy$' "$FAKE_DIR/calls.log" | tail -n 1 | cut -d: -f1)" -gt "$(position 'alter database deskvoice_restore rename to deskvoice')"
contains "versão doente: mostra qual peça falhou" "$out" "falha  Painel"
contains "versão doente: não esconde que a volta também não respondeu" "$out" "a volta para 0.2.0 não terminou bem"
lacks "versão doente: não diz atualizado" "$out" "Atualizado para"
equal "nenhum segredo mudou no caminho" "$secret_before" "$(env_get "$E" POSTGRES_PASSWORD)"

# Migration da versão nova falha: volta, e a anterior responde.
printf '%s\n' postgres asterisk panel voice routines caddy > "$FAKE_DIR/running"
echo 1 > "$FAKE_DIR/migrate_exit"
out="$(bash "$KIT/update.sh" --to 0.3.0 --yes 2>&1)"; equal "migration falhou: sai com erro" 1 "$?"
equal "migration falhou: volta a versão anterior" 0.2.0 "$(env_get "$E" DESKVOICE_VERSION)"
contains "migration falhou: diz o que aconteceu e onde está" "$out" "foi desfeita: você está de volta na versão 0.2.0"
contains "migration falhou: aponta o backup usado" "$out" "$DESKVOICE_BACKUP_DIR/"
echo 0 > "$FAKE_DIR/migrate_exit"

# Entrada única respondia antes e parou depois (peças essenciais de pé): conta como regressão e volta.
# O Docker de mentira responde ok até a subida da versão nova, e 404 a partir dela.
cat > "$FAKE_DIR/entry_probe_after_up" <<'PROBE'
panel|404
voice|404
PROBE
out="$(bash "$KIT/update.sh" --to 0.3.0 --yes 2>&1)"; equal "entrada quebrou na atualização: sai com erro" 1 "$?"
equal "entrada quebrou: volta a versão anterior" 0.2.0 "$(env_get "$E" DESKVOICE_VERSION)"
contains "entrada quebrou: diz que o painel deixou de abrir" "$out" "deixou de abrir pelo endereço que abria antes"
lacks "entrada quebrou: não diz atualizado" "$out" "Atualizado para"

# O mesmo, com uma peça NÃO essencial em falha antes e depois (uma linha que a operadora recusa:
# a checagem sai com 2). A entrada que respondia e parou ainda provoca a volta: a regra olha a
# linha da entrada, e não o código de saída da checagem.
rm -f "$FAKE_DIR/entry_probe"
printf '%s\n' 'panel|ok|respondendo' 'trunk|fail|registro recusado pela operadora (401)' 'engine|ok|gemini-live' > "$FAKE_DIR/panel_health"
bash "$KIT/healthcheck.sh" >/dev/null 2>&1; equal "linha recusada: a checagem sai com 2 antes da atualização" 2 "$?"
out="$(bash "$KIT/update.sh" --to 0.3.0 --yes 2>&1)"; equal "linha recusada e entrada quebrou: sai com erro" 1 "$?"
equal "linha recusada e entrada quebrou: volta a versão anterior" 0.2.0 "$(env_get "$E" DESKVOICE_VERSION)"
contains "linha recusada e entrada quebrou: diz que o painel deixou de abrir" "$out" "deixou de abrir pelo endereço que abria antes"
# E o contrário: a mesma peça não essencial em falha, com a entrada respondendo antes e depois.
# A checagem sai com 2 o tempo todo, e isso NÃO provoca volta.
rm -f "$FAKE_DIR/entry_probe_after_up" "$FAKE_DIR/entry_probe"
out="$(bash "$KIT/update.sh" --to 0.3.0 --yes 2>&1)"; equal "linha recusada e entrada ok: a atualização termina bem" 0 "$?"
equal "linha recusada e entrada ok: fica na versão nova, sem volta" 0.3.0 "$(env_get "$E" DESKVOICE_VERSION)"
lacks "linha recusada e entrada ok: não diz que voltou" "$out" "Voltando para a versão"
bash "$KIT/healthcheck.sh" >/dev/null 2>&1; equal "linha recusada: a checagem segue saindo com 2 depois" 2 "$?"
printf '%s\n' 'panel|ok|respondendo' 'trunk|warn|nenhuma linha cadastrada ainda' 'engine|warn|nenhuma chave de motor de voz configurada' > "$FAKE_DIR/panel_health"
rm -f "$FAKE_DIR/entry_probe_after_up" "$FAKE_DIR/entry_probe"

# Instalação de antes da entrada única: a atualização converge a publicação sozinha.
O="$DESKVOICE_DEPLOY_DIR/docker-compose.override.yml"; A="$DESKVOICE_DEPLOY_DIR/app.env"
printf 'services:\n  panel:\n    ports:\n      - "127.0.0.1:3080:3000"\n  voice:\n    ports:\n      - "127.0.0.1:3081:8091"\n' > "$O"
env_set "$A" VOICE_WEB_PUBLIC_PORT 3081; env_set "$E" PANEL_DOMAIN localhost
out="$(bash "$KIT/update.sh" --to 0.4.0 --yes 2>&1)"; equal "atualização de instalação de duas portas: zero" 0 "$?"
contains "atualização: o Caddy assume a porta do painel" "$(cat "$O")" '"127.0.0.1:3080:80"'
lacks "atualização: painel deixa de publicar porta" "$(cat "$O")" ":3000"
lacks "atualização: voz deixa de publicar porta" "$(cat "$O")" "8091"
lacks "atualização: VOICE_WEB_PUBLIC_PORT sai" "$(cat "$A")" "VOICE_WEB_PUBLIC_PORT"
equal "atualização: 1 salto por túnel" 1 "$(env_get "$A" TRUSTED_PROXY_HOPS)"

# ── O Asterisk monta cinco arquivos um a um: a atualização os regrava, e ele precisa passar a usar
#    a configuração nova sem derrubar ligação. Com um clone (git de mentira) cuja versão de destino
#    traz um modelo do Asterisk diferente. ──
ASTERISK_MODEL="$DESKVOICE_DEPLOY_DIR/asterisk/extensions.conf"; GEN="$DESKVOICE_DEPLOY_DIR/asterisk/generated"
model_of() { mkdir -p "$FAKE_DIR/git_checkout/$1/deploy/asterisk"; { cat "$ASTERISK_MODEL.original"; echo "; modelo da $1"; } > "$FAKE_DIR/git_checkout/$1/deploy/asterisk/extensions.conf"; }
restarts() { grep -c ' restart asterisk$' "$FAKE_DIR/calls.log"; }
reloads() { grep -c 'exec -T asterisk asterisk -rx module reload' "$FAKE_DIR/calls.log"; }
inode() { ls -i "$1" | awk '{ print $1 }'; }
cp "$ASTERISK_MODEL" "$ASTERISK_MODEL.original"
export FAKE_GIT_WORKTREE="$SANDBOX"
# Antes de cada atualização, "onde o clone está" (main, no git de mentira) é o modelo instalado.
mkdir -p "$FAKE_DIR/git_checkout/main/deploy/asterisk"; cp "$ASTERISK_MODEL" "$FAKE_DIR/git_checkout/main/deploy/asterisk/extensions.conf"
printf '%s\n' v0.9.0 v0.8.0 v0.7.0 v0.6.0 v0.5.0 v0.4.0 > "$FAKE_DIR/git_tags"; for v in v0.5.0 v0.6.0 v0.7.0 v0.8.0 v0.9.0; do model_of "$v"; done
installed() { cp "$FAKE_DIR/git_checkout/$1/deploy/asterisk/extensions.conf" "$FAKE_DIR/git_checkout/main/deploy/asterisk/extensions.conf"; }
inode_before="$(inode "$GEN/extensions.conf")"; : > "$FAKE_DIR/calls.log"
out="$(bash "$KIT/update.sh" --to 0.5.0 --yes 2>&1)"; equal "modelo do Asterisk mudou: a atualização termina bem" 0 "$?"
equal "modelo do Asterisk mudou: o arquivo é regravado no lugar (o contêiner monta o arquivo, preso ao inode)" "$inode_before" "$(inode "$GEN/extensions.conf")"
contains "modelo do Asterisk mudou: o disco tem o modelo novo" "$(cat "$GEN/extensions.conf")" "; modelo da v0.5.0"
equal "modelo do Asterisk mudou: recarrega uma vez" 1 "$(reloads)"
equal "... só o módulo do arquivo que mudou (o plano de discagem)" 1 "$(grep -c 'asterisk -rx module reload pbx_config$' "$FAKE_DIR/calls.log")"
equal "modelo do Asterisk mudou: não reinicia o Asterisk (ligações em andamento seguem)" 0 "$(restarts)"
check "modelo do Asterisk mudou: recarrega depois de subir a versão nova" test "$(grep -n 'module reload' "$FAKE_DIR/calls.log" | cut -d: -f1)" -gt "$(position ' up -d --remove-orphans')"
contains "modelo do Asterisk mudou: diz que recarregou sem derrubar ligações" "$out" "recarregada sem derrubar ligações"
refuse "modelo do Asterisk mudou: nada fica pendente" test -e "$GEN/.reload-pending"
installed v0.5.0
# A versão nova sobe doente: a volta regera a configuração da versão anterior e recarrega de novo.
printf '%s\n' postgres asterisk voice routines caddy > "$FAKE_DIR/running"; : > "$FAKE_DIR/calls.log"
out="$(bash "$KIT/update.sh" --to 0.6.0 --yes 2>&1)"; equal "modelo mudou e a versão subiu doente: sai com erro" 1 "$?"
equal "modelo mudou e a versão voltou: recarrega na ida e de novo na volta" 2 "$(reloads)"
equal "modelo mudou e a versão voltou: não reinicia o Asterisk" 0 "$(restarts)"
check "na volta, recarrega depois de restaurar o banco" test "$(grep -n 'module reload' "$FAKE_DIR/calls.log" | tail -n 1 | cut -d: -f1)" -gt "$(position 'alter database deskvoice_restore rename to deskvoice')"
lacks "na volta, o disco tem de novo a configuração da versão anterior" "$(cat "$GEN/extensions.conf")" "; modelo da v0.6.0"
contains "... gerada do modelo dela" "$(cat "$GEN/extensions.conf")" "; modelo da v0.5.0"
equal "na volta, o arquivo segue o mesmo inode que o contêiner montou" "$inode_before" "$(inode "$GEN/extensions.conf")"
printf '%s\n' postgres asterisk panel voice routines caddy > "$FAKE_DIR/running"
# O Asterisk não recarrega: aí sim reinicia, dizendo por quê.
touch "$FAKE_DIR/asterisk_reload_fail"; : > "$FAKE_DIR/calls.log"
out="$(bash "$KIT/update.sh" --to 0.7.0 --yes 2>&1)"; equal "recarregar falhou: a atualização termina bem" 0 "$?"
equal "recarregar falhou: tenta recarregar antes" 1 "$(reloads)"
equal "recarregar falhou: reinicia o Asterisk uma vez" 1 "$(restarts)"
contains "recarregar falhou: diz por que reinicia, com a resposta do Asterisk" "$out" "recarregar a configuração não deu certo (The module 'pbx_config' reported a reload failure"
contains "recarregar falhou: diz que ligações em andamento caem" "$out" "Ligações em andamento caem"
refuse "recarregar falhou e reiniciou: nada fica pendente" test -e "$GEN/.reload-pending"
rm "$FAKE_DIR/asterisk_reload_fail"; installed v0.7.0
# Instalação que o kit anterior regravou por renomeação: o contêiner ficou preso ao arquivo antigo, e
# recarregar releria o antigo. Reinicia, uma vez, dizendo por quê; e não recarrega à toa.
mkdir -p "$FAKE_DIR/asterisk_mounted"; cp "$GEN"/*.conf "$FAKE_DIR/asterisk_mounted/"; echo "; de antes" >> "$FAKE_DIR/asterisk_mounted/rtp.conf"
: > "$FAKE_DIR/calls.log"
out="$(bash "$KIT/update.sh" --to 0.8.0 --yes 2>&1)"; equal "contêiner preso ao arquivo antigo: a atualização termina bem" 0 "$?"
equal "contêiner preso ao arquivo antigo: reinicia o Asterisk uma vez" 1 "$(restarts)"
equal "contêiner preso ao arquivo antigo: não recarrega (releria o antigo)" 0 "$(reloads)"
contains "contêiner preso ao arquivo antigo: diz por quê" "$out" "o contêiner ainda lê a versão antiga de"
contains "contêiner preso ao arquivo antigo: depois do reinício lê o arquivo novo" "$(cat "$FAKE_DIR/asterisk_mounted/extensions.conf")" "; modelo da v0.8.0"
installed v0.8.0
# A migration falha antes de qualquer subida: a volta regera o que o Asterisk já usava. Nenhum reinício.
echo 1 > "$FAKE_DIR/migrate_exit"; : > "$FAKE_DIR/calls.log"
out="$(bash "$KIT/update.sh" --to 0.9.0 --yes 2>&1)"; equal "modelo mudou e a migration falhou: sai com erro" 1 "$?"
contains "modelo mudou e a migration falhou: voltou" "$out" "foi desfeita: você está de volta na versão 0.8.0"
equal "modelo mudou e a migration falhou: o Asterisk não é reiniciado" 0 "$(restarts)"
contains "modelo mudou e a migration falhou: o Asterisk lê a configuração da versão anterior" "$(cat "$FAKE_DIR/asterisk_mounted/extensions.conf")" "; modelo da v0.8.0"
echo 0 > "$FAKE_DIR/migrate_exit"
# Nada mudou na configuração: nem recarrega nem reinicia.
: > "$FAKE_DIR/calls.log"
out="$(bash "$KIT/update.sh" --to 0.8.0 --yes 2>&1)"
equal "mesma configuração: não recarrega" 0 "$(reloads)"
equal "mesma configuração: não reinicia" 0 "$(restarts)"
# ── Imagens de terceiros: sai a que o Compose da versão de onde se saiu fixava por resumo e o da nova
#    não fixa mais (issue #163). Só a referência exata; a de outro sistema e a que segue fixada ficam. ──
pins() { sed -nE 's/^[[:space:]]*image:[[:space:]]*(\$\{[A-Z_]+:-)?([^}[:space:]]+@sha256:[0-9a-f]{64})\}?[[:space:]]*$/\2/p' "$DESKVOICE_DEPLOY_DIR/docker-compose.yml"; }
OLD_WACALLS="ghcr.io/jotadev66/wacalls@sha256:$(printf 'a%.0s' $(seq 64))"
OLD_CADDY="caddy:2.10.0-alpine@sha256:$(printf 'b%.0s' $(seq 64))"
KEPT="$(pins | grep waha)"
mkdir -p "$FAKE_DIR/git_checkout/main/deploy"
{ echo "services:"; echo "  wacalls:"; echo "    image: $OLD_WACALLS"; echo "  waha:"; echo "    image: \${WAHA_IMAGE:-$KEPT}"; echo "  caddy:"; echo "    image: $OLD_CADDY"; } > "$FAKE_DIR/git_checkout/main/deploy/docker-compose.yml"
third() { grep '^rmi .*@sha256:' "$FAKE_DIR/calls.log" | sed 's/^rmi //'; }
{ echo "$OLD_WACALLS"; echo "$KEPT"; echo postgres:16; } > "$FAKE_DIR/images"; : > "$FAKE_DIR/calls.log"
out="$(bash "$KIT/update.sh" --to 0.9.0 --yes 2>&1)"; equal "terceiros: a atualização sai com zero" 0 "$?"
equal "terceiros: tenta só as que a versão nova deixou de fixar" "$(printf '%s\n' "$OLD_CADDY" "$OLD_WACALLS")" "$(third)"
equal "terceiros: sai a antiga; ficam a que segue fixada e a de outro sistema" "$(printf '%s\n' "$KEPT" postgres:16)" "$(cat "$FAKE_DIR/images")"
contains "terceiros: diz o que saiu" "$out" "Imagens de terceiros que a versão 0.9.0 deixou de usar removidas"
contains "terceiros: diz que voltar pede internet" "$out" "Voltar para a versão 0.8.0 pede internet"
lacks "terceiros: a que não estava no disco não vira aviso" "$out" "Não consegui remover a imagem $OLD_CADDY"
equal "terceiros: nunca força" 0 "$(grep -cE '^rmi (.* )?(-f|--force)( |$)' "$FAKE_DIR/calls.log")"
# Um contêiner usa a antiga: aviso, e a atualização termina bem.
{ echo "$OLD_WACALLS"; echo "$KEPT"; } > "$FAKE_DIR/images"; echo "$OLD_WACALLS" > "$FAKE_DIR/rmi_busy"; installed v0.8.0
env_set "$E" DESKVOICE_VERSION 0.8.0; : > "$FAKE_DIR/calls.log"
out="$(bash "$KIT/update.sh" --to 0.9.0 --yes 2>&1)"; equal "terceiros em uso: sai com zero" 0 "$?"
contains "terceiros em uso: avisa, nomeando a imagem" "$out" "Não consegui remover a imagem $OLD_WACALLS"
equal "terceiros em uso: ela fica" "$(printf '%s\n' "$OLD_WACALLS" "$KEPT")" "$(cat "$FAKE_DIR/images")"
rm -f "$FAKE_DIR/rmi_busy" "$FAKE_DIR/images"; env_set "$E" DESKVOICE_VERSION 0.8.0
rm -rf "$FAKE_DIR/git_tags" "$FAKE_DIR/git_checkout" "$FAKE_DIR/asterisk_mounted"; unset FAKE_GIT_WORKTREE
cp "$ASTERISK_MODEL.original" "$ASTERISK_MODEL"; : > "$FAKE_DIR/calls.log"

# ── Imagens antigas: com tudo respondendo, saem as do DeskVoice que nem a versão nova nem a de onde
#    se saiu usam. Só por nome exato, com `rmi` sem força, e nunca `prune`. ──
images_of() { local v s; for v in "$@"; do for s in $APP_SERVICES; do image_ref "$s" "$v"; done; done; }
removed() { grep '^rmi ' "$FAKE_DIR/calls.log" | grep -v ':rollback$' | sed 's/^rmi //'; }
forced() { grep -cE '^(rmi|image rm) (.* )?(-f|--force)( |$)' "$FAKE_DIR/calls.log"; }
# A (0.8.0, a instalada) para B (0.10.0), com Z (0.1.0) mais velha e uma imagem de terceiros.
{ images_of 0.1.0 0.8.0 0.10.0; echo postgres:17.11-alpine; } > "$FAKE_DIR/images"; : > "$FAKE_DIR/calls.log"
out="$(bash "$KIT/update.sh" --to 0.10.0 --yes 2>&1)"; equal "limpeza: a atualização sai com zero" 0 "$?"
equal "limpeza: remove só as três imagens da versão mais velha" "$(images_of 0.1.0)" "$(removed)"
equal "limpeza: ficam a versão nova, a anterior e a de terceiros" "$(images_of 0.8.0 0.10.0; echo postgres:17.11-alpine)" "$(cat "$FAKE_DIR/images")"
equal "limpeza: nunca chama prune" 0 "$(grep -c 'prune' "$FAKE_DIR/calls.log")"
equal "limpeza: nunca força a remoção" 0 "$(forced)"
equal "limpeza: lista só as três imagens do DeskVoice, pelo nome" "$(for s in $APP_SERVICES; do echo "image ls --format {{.Tag}} $(image_repo "$s")"; done)" "$(grep '^image ls' "$FAKE_DIR/calls.log")"
check "limpeza: vem depois de a etiqueta rollback sair" test "$(grep -n ':rollback$' "$FAKE_DIR/calls.log" | grep ':rmi ' | tail -n 1 | cut -d: -f1)" -lt "$(position "^rmi $(image_ref panel 0.1.0)")"
contains "limpeza: nomeia cada imagem removida" "$out" "$(image_ref routines 0.1.0)"
contains "limpeza: diz que a anterior fica" "$out" "A imagem da versão 0.8.0 fica, para voltar a ela sem internet"
# O `rmi` recusa uma (contêiner usando): aviso, e a atualização termina bem.
images_of 0.9.0 0.10.0 0.11.0 > "$FAKE_DIR/images"; image_ref panel 0.9.0 > "$FAKE_DIR/rmi_busy"; : > "$FAKE_DIR/calls.log"
out="$(bash "$KIT/update.sh" --to 0.11.0 --yes 2>&1)"; equal "rmi recusado: a atualização sai com zero" 0 "$?"
equal "rmi recusado: fica na versão nova" 0.11.0 "$(env_get "$E" DESKVOICE_VERSION)"
contains "rmi recusado: avisa, nomeando a imagem" "$out" "Não consegui remover a imagem antiga $(image_ref panel 0.9.0)"
contains "rmi recusado: diz que terminou" "$out" "Atualizado para 0.11.0"
equal "rmi recusado: as outras saem assim mesmo" "$(image_ref panel 0.9.0; images_of 0.10.0 0.11.0)" "$(cat "$FAKE_DIR/images")"
lacks "rmi recusado: não tenta forçar" "$out" "--force"
equal "rmi recusado: nem força" 0 "$(forced)"
rm "$FAKE_DIR/rmi_busy"
# A atualização volta: nada é removido.
images_of 0.1.0 0.11.0 0.12.0 > "$FAKE_DIR/images"; images_before="$(cat "$FAKE_DIR/images")"
printf '%s\n' postgres asterisk voice routines caddy > "$FAKE_DIR/running"; : > "$FAKE_DIR/calls.log"
out="$(bash "$KIT/update.sh" --to 0.12.0 --yes 2>&1)"; equal "limpeza, versão doente: sai com erro" 1 "$?"
equal "limpeza, versão doente: nenhuma imagem removida" "" "$(removed)"
equal "limpeza, versão doente: as imagens seguem todas" "$images_before" "$(cat "$FAKE_DIR/images")"
printf '%s\n' postgres asterisk panel voice routines caddy > "$FAKE_DIR/running"
# Instalação em `local` (construída aqui) que passa para a publicada: a local sai, dizendo como volta.
env_set "$E" DESKVOICE_VERSION local; images_of local 0.13.0 > "$FAKE_DIR/images"; : > "$FAKE_DIR/calls.log"
out="$(bash "$KIT/update.sh" --to 0.13.0 --yes 2>&1)"; equal "local para publicada: zero" 0 "$?"
equal "local para publicada: remove a local" "$(images_of local)" "$(removed)"
equal "local para publicada: fica a publicada" "$(images_of 0.13.0)" "$(cat "$FAKE_DIR/images")"
contains "local para publicada: diz que a local só volta construindo" "$out" "A local só volta construindo de novo: bash install/install.sh --build"
lacks "local para publicada: não promete que a local fica" "$out" "A imagem da versão local fica"
# Instalação que continua em `local` (em ARM não há imagem publicada para baixar): nada sai.
env_set "$E" DESKVOICE_VERSION local; images_of local > "$FAKE_DIR/images"; touch "$FAKE_DIR/pull_fail"; : > "$FAKE_DIR/calls.log"
out="$(bash "$KIT/update.sh" --to 0.14.0 --yes 2>&1)"; equal "continua em local: a atualização não acontece" 1 "$?"
equal "continua em local: a versão segue local" local "$(env_get "$E" DESKVOICE_VERSION)"
equal "continua em local: nenhuma imagem removida" "" "$(removed)"
equal "continua em local: a local segue no disco" "$(images_of local)" "$(cat "$FAKE_DIR/images")"
rm "$FAKE_DIR/pull_fail" "$FAKE_DIR/images"; : > "$FAKE_DIR/calls.log"

out="$(bash "$KIT/update.sh" --yes 2>&1)"; equal "sem --to e sem repositório git: recusa" 1 "$?"
contains "sem --to: diz como informar a versão" "$out" "--to <versão>"
refuse "nome de versão com caractere estranho é recusado" bash "$KIT/update.sh" --yes --to 'v1;rm -rf x'
equal "nenhum teste chamou git que altera estado" 0 "$(grep -cE '^git .*(checkout|fetch|reset|commit|stash)' "$FAKE_DIR/calls.log")"
finish
