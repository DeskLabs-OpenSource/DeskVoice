#!/usr/bin/env bash
# O Laya (desenho R12, fatia 8a): o serviço existe no Compose, num perfil, e quem já instalou não é
# surpreendido. Sem a marca, nem a atualização nem o instalador baixam ou sobem a imagem dele.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
fake_install
source "$KIT/_common.sh"; set +e; trap - ERR
C="$REPO/deploy/docker-compose.yml"
export DESKVOICE_HEALTH_TIMEOUT=0
printf 'agents=3\ncalls=120\nusers=1\n' > "$FAKE_DIR/counts_backup"; cp "$FAKE_DIR/counts_backup" "$FAKE_DIR/counts_restore"

# ── O nome da imagem ──
equal "image_ref dá o nome da imagem do Laya, como o das outras três" "$(image_prefix)/deskvoice-laya:1.2.3" "$(image_ref laya 1.2.3)"
lacks "o Laya fica fora de APP_SERVICES, a lista que a atualização baixa" " $APP_SERVICES " " laya "
equal "APP_SERVICES continua sendo os três processos" "panel voice routines" "$APP_SERVICES"

# ── O serviço no Compose ──
laya_block="$(awk '/^  laya:/ { on = 1; next } on && /^  [a-z-]+:/ { on = 0 } on' "$C")"
contains "o Laya fica num perfil: não sobe nem é baixado por padrão" "$laya_block" 'profiles: ["laya"]'
# shellcheck disable=SC2016  # procura o texto literal do Compose
contains "a imagem é a do projeto, com a etiqueta da versão" "$laya_block" 'image: ${DESKVOICE_IMAGE_PREFIX:-localhost}/deskvoice-laya:${DESKVOICE_VERSION:-dev}'
contains "a imagem nasce de deploy/laya/" "$laya_block" 'build: { context: ./laya, target: laya }'
lacks "o Laya não publica porta" "$laya_block" "ports:"
lacks "o Laya não lê o app.env" "$laya_block" "env_file"
lacks "o Laya não recebe chave nem segredo" "$laya_block" "KEY"
contains "o Laya tem teto de memória" "$laya_block" "mem_limit: 3g"
# shellcheck disable=SC2016  # procura o texto literal do Compose
contains "o Laya tem teto de CPU, com padrão" "$laya_block" 'cpus: "${LAYA_CPUS:-2}"'
contains "o Laya tem healthcheck" "$laya_block" "healthcheck:"
contains "o Laya só fica na rede interna" "$laya_block" "networks: [internal]"
lacks "o Laya não monta volume" "$laya_block" "volumes:"

# ── Quem já instalou não é surpreendido ──
: > "$FAKE_DIR/calls.log"
out="$(bash "$KIT/update.sh" --to 0.2.0 --yes 2>&1)"; equal "a atualização sai com zero" 0 "$?"
contains "a atualização baixa os três processos" "$(grep ' pull ' "$FAKE_DIR/calls.log")" "pull -q panel voice routines"
lacks "a atualização não baixa, não constrói e não sobe o Laya" "$(cat "$FAKE_DIR/calls.log")" "laya"
lacks "a atualização não liga o perfil do Laya" "$(cat "$FAKE_DIR/calls.log")" "--profile laya"
lacks "a atualização não escreve a marca do Laya" "$(cat "$DESKVOICE_DEPLOY_DIR/.env")" "LAYA"

finish
