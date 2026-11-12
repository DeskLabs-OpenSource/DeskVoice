#!/usr/bin/env bash
# Apoio dos testes: diretórios temporários, programas de mentira no PATH e asserções.
# Cada arquivo de teste carrega este e termina com `finish`.
set -uo pipefail
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KIT="$(cd "$TEST_DIR/.." && pwd)"
REPO="$(cd "$KIT/.." && pwd)"
SANDBOX="$(mktemp -d "${TMPDIR:-/tmp}/deskvoice-test.XXXXXX")"
trap '[ -n "$SANDBOX" ] && [ -d "$SANDBOX" ] && rm -rf "$SANDBOX"' EXIT

export FAKE_DIR="$SANDBOX/fake"
export DESKVOICE_DEPLOY_DIR="$SANDBOX/deploy"
export DESKVOICE_BACKUP_DIR="$SANDBOX/backups"
export NO_COLOR=1
# O agendamento do agente vai para pastas do teste: nada aqui toca no systemd nem no cron da máquina.
export DESKVOICE_SYSTEMD_DIR="$SANDBOX/systemd" DESKVOICE_SYSTEMD_RUN_DIR="$SANDBOX/systemd-run" DESKVOICE_CRON_DIR="$SANDBOX/cron.d"
export PATH="$TEST_DIR/fake:$PATH"
mkdir -p "$FAKE_DIR" "$DESKVOICE_DEPLOY_DIR" "$DESKVOICE_SYSTEMD_DIR" "$DESKVOICE_SYSTEMD_RUN_DIR"
cp -R "$REPO/deploy/asterisk" "$DESKVOICE_DEPLOY_DIR/asterisk"
rm -rf "$DESKVOICE_DEPLOY_DIR/asterisk/generated"
cp "$REPO/deploy/docker-compose.yml" "$REPO/deploy/images.env" "$REPO/deploy/Caddyfile" "$DESKVOICE_DEPLOY_DIR/"
echo 203.0.113.10 > "$FAKE_DIR/public_ip"
echo 203.0.113.10 > "$FAKE_DIR/iface_ip"
: > "$FAKE_DIR/calls.log"

PASSED=0; FAILED=0
pass() { PASSED=$((PASSED + 1)); }
flunk() { FAILED=$((FAILED + 1)); printf '    ✗ %s\n' "$1"; }
check() {  # check "<descrição>" comando...   passa se o comando sair com 0
  local name="$1"; shift
  if "$@" >/dev/null 2>&1; then pass; else flunk "$name"; fi
}
refuse() {  # refuse "<descrição>" comando...  passa se o comando sair com erro
  local name="$1"; shift
  if "$@" >/dev/null 2>&1; then flunk "$name (deveria ter recusado)"; else pass; fi
}
equal() {  # equal "<descrição>" <esperado> <obtido>
  if [ "$2" = "$3" ]; then pass; else flunk "$1: esperava '$2', veio '$3'"; fi
}
contains() {  # contains "<descrição>" <texto> <trecho>
  case "$2" in *"$3"*) pass ;; *) flunk "$1: não achei '$3'" ;; esac
}
lacks() {  # lacks "<descrição>" <texto> <trecho>
  case "$2" in *"$3"*) flunk "$1: achei '$3', que não devia estar ali" ;; *) pass ;; esac
}
mode_of() { if stat -c %a "$1" >/dev/null 2>&1; then stat -c %a "$1"; else stat -f %Lp "$1"; fi; }
# Uma instalação de mentira, já "feita": os três arquivos de ambiente e os do Asterisk.
fake_install() {
  ( source "$KIT/_common.sh"
    write_env_files "https://voz.exemplo.com.br" 203.0.113.10 voz.exemplo.com.br 10000 10200
    env_set "$ENV_FILE" DESKVOICE_VERSION 0.1.0
    apply_entry caddy voz.exemplo.com.br
    render_asterisk_config )
  printf '%s\n' postgres asterisk panel voice routines caddy > "$FAKE_DIR/running"
  printf '%s\n' 'panel|ok|respondendo' 'database|ok|respondendo' 'routines|ok|o processo de rotinas está conectado ao banco, e a fila está em dia' 'trunk|warn|nenhuma linha cadastrada ainda' 'engine|warn|nenhuma chave de motor de voz configurada' > "$FAKE_DIR/panel_health"
  echo 0 > "$FAKE_DIR/pg_isready_exit"
  printf 'asterisk|ok|PJSIP 20.20.1\n' > "$FAKE_DIR/voice_health"
  printf 'UNCONN 0 0 0.0.0.0:5060 0.0.0.0:*\n' > "$FAKE_DIR/ss_udp"
}
finish() {
  printf '  %s: %s passaram, %s falharam\n' "$(basename "$0")" "$PASSED" "$FAILED"
  [ "$FAILED" = 0 ]
}
