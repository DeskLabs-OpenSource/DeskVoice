#!/usr/bin/env bash
# Junta num arquivo de texto o que alguém precisa para te ajudar: versões, saúde, estado
# dos contêineres, fim dos logs e teste de portas. SEM segredos: senhas, chaves e tokens
# saem como ***, e e-mails e telefones saem encurtados.
#
#   bash install/diagnose.sh                gera deskvoice-diagnostico-<data>.txt na pasta do projeto
#   bash install/diagnose.sh --out arquivo  escolhe onde gravar
#
# Funciona mesmo com a instalação pela metade: cada seção que não der para coletar diz por quê.
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

out="$REPO_DIR/deskvoice-diagnostico-$(date +%Y%m%d-%H%M%S).txt"
while [ $# -gt 0 ]; do
  case "$1" in
    --out) out="${2:-}"; shift ;;
    -h|--help) sed -n '2,9p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "Não conheço a opção $1." "Use --out <arquivo> ou nenhuma opção." ;;
  esac
  shift
done
[ -n "$out" ] || die "Faltou o nome do arquivo depois de --out." "Exemplo: bash install/diagnose.sh --out /tmp/diagnostico.txt"

section() { printf '\n===== %s =====\n' "$1"; }
# Roda um comando; se falhar, a seção registra a falha em vez de derrubar o diagnóstico.
try() { "$@" 2>&1 || printf '(não consegui coletar: "%s" saiu com erro %s)\n' "$1" "$?"; }
env_keys() {  # nomes de todas as variáveis; valor só das que não são segredo
  local f="$1" line key
  [ -f "$f" ] || { echo "(arquivo não existe)"; return 0; }
  while IFS= read -r line; do
    key="${line%%=*}"
    case "$key" in
      *PASSWORD*|*SECRET*|*TOKEN*|*KEY*|*_URL) echo "$key=***" ;;
      *) echo "$line" ;;
    esac
  done < "$f"
}

collect() {
  echo "Diagnóstico do DeskVoice · $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "Este arquivo não contém senhas nem chaves. Confira antes de enviar, se quiser."

  section "Sistema"
  try uname -a
  if [ -r /etc/os-release ]; then grep -E '^(PRETTY_NAME|VERSION_ID)=' /etc/os-release; fi
  if [ -r /proc/meminfo ]; then grep -E '^(MemTotal|MemAvailable)' /proc/meminfo; fi
  try df -Ph "$REPO_DIR"

  section "Versões"
  echo "DeskVoice (deploy/.env): $(env_get "$ENV_FILE" DESKVOICE_VERSION)"
  if have git; then echo "Código: $(git -C "$REPO_DIR" describe --tags --always --dirty 2>/dev/null || echo 'sem git')"; fi
  if have docker; then try docker --version; try docker compose version; else echo "Docker: não instalado"; fi

  section "Configuração (valores de segredo ocultos)"
  for f in "$ENV_FILE" "$APP_ENV_FILE" "$MIGRATE_ENV_FILE"; do
    echo "--- $(basename "$f")"; env_keys "$f"
  done
  if [ -f "$PROXY_OVERRIDE" ]; then echo "--- docker-compose.override.yml (onde a entrada única é publicada)"; cat "$PROXY_OVERRIDE"; fi

  section "Rede"
  echo "IP público configurado: $(env_get "$APP_ENV_FILE" PUBLIC_IP)"
  echo "IP público visto agora: $(discover_public_ip || true)"
  echo "IP da placa de rede:    $(interface_ip)"
  if have ss; then
    echo "--- UDP em escuta (5060 e faixa de áudio)"
    try ss -Hlun | awk -v a="$(env_get "$ENV_FILE" RTP_START)" -v b="$(env_get "$ENV_FILE" RTP_END)" '{ n = split($4, p, ":"); port = p[n] + 0 } port == 5060 || (port >= a && port <= b && ++shown <= 5)'
    echo "--- TCP em escuta (80, 443)"
    try ss -Hltn | awk '{ n = split($4, p, ":") } p[n] == 80 || p[n] == 443'
  else echo "(comando ss ausente: sem teste de portas)"; fi
  if have ufw; then echo "--- ufw"; try ufw status; fi

  if [ -f "$ENV_FILE" ] && have docker; then
    section "Saúde (bash install/healthcheck.sh)"
    NO_COLOR=1 bash "$KIT_DIR/healthcheck.sh" 2>&1 || echo "(código de saída: $?)"
    section "Contêineres"
    try dc ps -a
    for service in postgres migrate panel voice routines asterisk caddy; do
      section "Log: $service (últimas 60 linhas)"
      try dc logs --no-color --tail 60 "$service"
    done
  else
    section "Saúde e contêineres"
    echo "(sem deploy/.env ou sem Docker: a instalação não chegou a subir)"
  fi
}

umask 077
# Tudo passa pelo filtro antes de tocar o disco: nenhum segredo chega a ser gravado.
collect | mask_secrets > "$out"
ok "Diagnóstico gravado em: $out"
info "Ele não tem senhas nem chaves. Envie esse arquivo para quem for te ajudar"
info "(issue em https://github.com/DeskLabs-OpenSource/DeskVoice/issues ou a comunidade)."
