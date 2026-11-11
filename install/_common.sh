#!/usr/bin/env bash
# shellcheck disable=SC2034  # as variáveis daqui são usadas pelos scripts que carregam este arquivo
# Funções compartilhadas pelos scripts do kit. É carregado com `source`, nunca executado.
# Escrito para bash 3.2+ (sem vetor associativo, sem mapfile), para os testes rodarem em
# qualquer máquina.
set -euo pipefail

KIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$KIT_DIR/.." && pwd)"
# Os testes e a simulação trocam estas pastas por diretórios temporários.
DEPLOY_DIR="${DESKVOICE_DEPLOY_DIR:-$REPO_DIR/deploy}"
BACKUP_DIR="${DESKVOICE_BACKUP_DIR:-$REPO_DIR/backups}"
# Três arquivos, por menor privilégio: cada contêiner recebe só o que usa.
ENV_FILE="$DEPLOY_DIR/.env"                 # o que o Compose interpola (e a senha do dono, só para o postgres)
APP_ENV_FILE="$DEPLOY_DIR/app.env"          # painel, voz e rotinas; sem a senha do dono do banco
MIGRATE_ENV_FILE="$DEPLOY_DIR/migrate.env"  # só o serviço migrate e a criação do primeiro usuário
GENERATED_DIR="$DEPLOY_DIR/asterisk/generated"
# Só existe quando 80/443 já são de outro proxy: publica o painel numa porta local.
PROXY_OVERRIDE="$DEPLOY_DIR/docker-compose.override.yml"
DB_USER="deskvoice"
DB_NAME="deskvoice"
APP_SERVICES="panel voice routines"

# ── Mensagens ────────────────────────────────────────────────────────────────
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  C_RED=$'\033[31m'; C_GRN=$'\033[32m'; C_YLW=$'\033[33m'; C_BLD=$'\033[1m'; C_DIM=$'\033[2m'; C_OFF=$'\033[0m'
else
  C_RED=""; C_GRN=""; C_YLW=""; C_BLD=""; C_DIM=""; C_OFF=""
fi
step() { printf '\n%s▶ %s%s\n' "$C_BLD" "$*" "$C_OFF"; }
info() { printf '  %s\n' "$*"; }
ok()   { printf '  %s✓%s %s\n' "$C_GRN" "$C_OFF" "$*"; }
warn() { printf '  %s⚠%s %s\n' "$C_YLW" "$C_OFF" "$*" >&2; }
fail() { printf '  %s✗%s %s\n' "$C_RED" "$C_OFF" "$*" >&2; }
dim()  { printf '  %s%s%s\n' "$C_DIM" "$*" "$C_OFF"; }

# die "<o que aconteceu>" "<o que fazer agora>": nenhum erro sai sem o conserto.
die() {
  printf '\n%s✗ %s%s\n' "$C_RED" "$1" "$C_OFF" >&2
  [ -n "${2:-}" ] && printf '  O que fazer: %s\n' "$2" >&2
  printf '  Se precisar de ajuda, rode: bash install/diagnose.sh\n' >&2
  exit 1
}

have() { command -v "$1" >/dev/null 2>&1; }

# Nenhum script do kit morre calado: comando que falha sem tratamento diz onde foi.
set -E
unexpected_failure() {
  printf '\n%s✗ Um passo falhou de um jeito que o kit não previu (%s, linha %s, código %s).%s\n' "$C_RED" "$(basename "$0")" "$2" "$1" "$C_OFF" >&2
  printf '  O que fazer: rode de novo. Se repetir, rode bash install/diagnose.sh e abra uma issue dizendo o script e a linha acima.\n' >&2
}
trap 'unexpected_failure "$?" "$LINENO"' ERR

confirm() {  # confirm "<pergunta>" → 0 = sim. Com ASSUME_YES=1 responde sim sem perguntar.
  [ "${ASSUME_YES:-0}" = 1 ] && return 0
  local answer=""
  read -r -p "  $1 (s/n) " answer || return 1
  case "$answer" in s|S|sim|Sim|SIM|y|Y) return 0 ;; *) return 1 ;; esac
}

# ── Segredos ─────────────────────────────────────────────────────────────────
random_hex() {  # random_hex <bytes>: seguro para ir dentro de URL
  if have openssl; then openssl rand -hex "$1"
  else od -An -N "$1" -tx1 /dev/urandom | tr -d ' \n'; fi
}
random_base64_32() {  # 32 bytes em base64: o formato de DESKVOICE_SECRET_KEY
  if have openssl; then openssl rand -base64 32
  else head -c 32 /dev/urandom | base64 | tr -d '\n'; fi
}
sha256_of() {
  if have sha256sum; then sha256sum "$1" | awk '{print $1}'
  else shasum -a 256 "$1" | awk '{print $1}'; fi
}

# ── .env ─────────────────────────────────────────────────────────────────────
env_get() {  # env_get <arquivo> <CHAVE> → valor (vazio se não existir)
  [ -f "$1" ] || return 0
  sed -n "s/^$2=//p" "$1" | head -n 1
}
env_set() {  # env_set <arquivo> <CHAVE> <valor>: troca ou acrescenta; arquivo sempre 600
  local file="$1" key="$2" tmp
  ( umask 077; [ -f "$file" ] || : > "$file" )
  tmp="$(mktemp "$file.XXXXXX")"
  # O valor vai pelo ambiente: na linha de comando o awk interpretaria barras invertidas.
  ENV_KEY="$key" ENV_VALUE="$3" awk '
    BEGIN { key = ENVIRON["ENV_KEY"]; value = ENVIRON["ENV_VALUE"] }
    index($0, key "=") == 1 { if (!done) print key "=" value; done = 1; next }
    { print }
    END { if (!done) print key "=" value }' "$file" > "$tmp"
  chmod 600 "$tmp"
  mv "$tmp" "$file"
}
env_set_if_missing() {  # nunca troca um segredo que já existe
  [ -n "$(env_get "$1" "$2")" ] || env_set "$1" "$2" "$3"
}

# Grava os três arquivos de ambiente. Segredo que já existe fica como está; o resto é
# regravado com o que foi decidido nesta execução.
#   write_env_files <public_url> <public_ip> <panel_domain> <rtp_start> <rtp_end> <profiles>
write_env_files() {
  local pg app sys url_system
  # deploy/.env
  env_set_if_missing "$ENV_FILE" POSTGRES_PASSWORD "$(random_hex 24)"
  env_set_if_missing "$ENV_FILE" DESKVOICE_VERSION "${DESKVOICE_VERSION:-stable}"
  env_set_if_missing "$ENV_FILE" DESKVOICE_IMAGE_PREFIX "${DESKVOICE_IMAGE_PREFIX:-ghcr.io/desklabs-opensource}"
  env_set "$ENV_FILE" PANEL_DOMAIN "$3"
  env_set "$ENV_FILE" RTP_START "$4"
  env_set "$ENV_FILE" RTP_END "$5"
  env_set "$ENV_FILE" COMPOSE_PROFILES "$6"
  # deploy/migrate.env
  env_set_if_missing "$MIGRATE_ENV_FILE" APP_DB_PASSWORD "$(random_hex 24)"
  env_set_if_missing "$MIGRATE_ENV_FILE" SYSTEM_DB_PASSWORD "$(random_hex 24)"
  pg="$(env_get "$ENV_FILE" POSTGRES_PASSWORD)"
  app="$(env_get "$MIGRATE_ENV_FILE" APP_DB_PASSWORD)"; sys="$(env_get "$MIGRATE_ENV_FILE" SYSTEM_DB_PASSWORD)"
  url_system="postgres://deskvoice_system:${sys}@postgres:5432/${DB_NAME}"
  env_set "$MIGRATE_ENV_FILE" MIGRATION_DATABASE_URL "postgres://${DB_USER}:${pg}@postgres:5432/${DB_NAME}"
  env_set "$MIGRATE_ENV_FILE" SYSTEM_DATABASE_URL "$url_system"
  # deploy/app.env
  env_set_if_missing "$APP_ENV_FILE" DESKVOICE_SECRET_KEY "$(random_base64_32)"
  env_set_if_missing "$APP_ENV_FILE" INTERNAL_TOKEN "$(random_hex 32)"
  env_set_if_missing "$APP_ENV_FILE" ARI_PASSWORD "$(random_hex 24)"
  env_set "$APP_ENV_FILE" DATABASE_URL "postgres://deskvoice_app:${app}@postgres:5432/${DB_NAME}"
  env_set "$APP_ENV_FILE" SYSTEM_DATABASE_URL "$url_system"
  env_set "$APP_ENV_FILE" ARI_USERNAME deskvoice
  env_set "$APP_ENV_FILE" PUBLIC_URL "$1"
  env_set "$APP_ENV_FILE" PUBLIC_IP "$2"
}

# ── Modelos do Asterisk ──────────────────────────────────────────────────────
# Troca só as variáveis do instalador. `${EXTEN}` e outras do próprio Asterisk ficam intactas.
TEMPLATE_VARS="ARI_PASSWORD PUBLIC_IP RTP_START RTP_END"
render_template() {  # render_template <modelo> <destino>; os valores vêm do ambiente
  local src="$1" dst="$2" name tmp
  [ -f "$src" ] || die "Não achei o modelo $src." "Confira se o repositório foi baixado inteiro (git status) e rode de novo."
  for name in $TEMPLATE_VARS; do
    if grep -q "\${$name}" "$src" && [ -z "$(printenv "$name" || true)" ]; then
      die "O modelo $(basename "$src") precisa de $name, que está vazio." "Rode bash install/install.sh de novo: ele gera esse valor."
    fi
  done
  mkdir -p "$(dirname "$dst")"
  tmp="$(mktemp "$dst.XXXXXX")"
  TEMPLATE_VARS="$TEMPLATE_VARS" awk '
    BEGIN { n = split(ENVIRON["TEMPLATE_VARS"], names, " ") }
    { line = $0
      for (i = 1; i <= n; i++) {
        token = "${" names[i] "}"; out = ""
        while ((p = index(line, token)) > 0) { out = out substr(line, 1, p - 1) ENVIRON[names[i]]; line = substr(line, p + length(token)) }
        line = out line
      }
      print line }' "$src" > "$tmp"
  # 644 no arquivo, 700 na pasta (ver render_asterisk_config): dentro do contêiner o
  # Asterisk lê com o usuário dele; na VPS, ninguém além do dono entra na pasta.
  chmod 644 "$tmp"
  mv "$tmp" "$dst"
}
render_asterisk_config() {
  ARI_PASSWORD="$(env_get "$APP_ENV_FILE" ARI_PASSWORD)" PUBLIC_IP="$(env_get "$APP_ENV_FILE" PUBLIC_IP)" \
  RTP_START="$(env_get "$ENV_FILE" RTP_START)" RTP_END="$(env_get "$ENV_FILE" RTP_END)"
  export ARI_PASSWORD PUBLIC_IP RTP_START RTP_END
  # ari.conf guarda a senha de controle das chamadas. O contêiner monta cada arquivo
  # direto (a permissão da pasta não o afeta), então fechar a pasta protege a senha de
  # outros usuários da VPS sem depender do número de usuário que o Asterisk usa.
  mkdir -p "$GENERATED_DIR"
  chmod 700 "$GENERATED_DIR"
  # TUDO o que o Asterisk monta sai desta pasta, com permissão definida aqui. Montar arquivo direto
  # do repositório fazia a instalação depender do umask de quem baixou: num servidor endurecido
  # (umask 077) o plano de discagem e a ARI ficavam ilegíveis para o Asterisk, que subia "saudável"
  # e não atendia nada.
  render_template "$DEPLOY_DIR/asterisk/extensions.conf" "$GENERATED_DIR/extensions.conf"
  render_template "$DEPLOY_DIR/asterisk/http.conf" "$GENERATED_DIR/http.conf"
  render_template "$DEPLOY_DIR/asterisk/ari.conf.tmpl" "$GENERATED_DIR/ari.conf"
  render_template "$DEPLOY_DIR/asterisk/rtp.conf.tmpl" "$GENERATED_DIR/rtp.conf"
  render_template "$DEPLOY_DIR/asterisk/pjsip.conf.base" "$GENERATED_DIR/pjsip.conf"
  unset ARI_PASSWORD
}

# ── Validadores: devolvem 0 se vale; senão escrevem o motivo e devolvem 1 ─────
valid_email() {
  local v="$1" re='^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$'
  if [ -z "$v" ]; then echo "o e-mail ficou vazio"; return 1; fi
  if [ "${#v}" -gt 254 ]; then echo "o e-mail é longo demais"; return 1; fi
  case "$v" in *..*|.*|*.@*|*@.*|*.) echo "o e-mail tem um ponto fora do lugar"; return 1 ;; esac
  [[ "$v" =~ $re ]] || { echo "isso não parece um e-mail (exemplo: voce@empresa.com.br)"; return 1; }
}
valid_ipv4() {
  local v="$1" re='^([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})$' part
  [[ "$v" =~ $re ]] || { echo "isso não é um endereço IP (exemplo: 203.0.113.10)"; return 1; }
  for part in "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}" "${BASH_REMATCH[3]}" "${BASH_REMATCH[4]}"; do
    case "$part" in 0?*) echo "o IP tem um número começando com zero"; return 1 ;; esac
    [ "$part" -le 255 ] || { echo "cada número do IP vai de 0 a 255"; return 1; }
  done
}
is_private_ipv4() {  # 0 = endereço que não é alcançável pela internet
  case "$1" in
    10.*|192.168.*|127.*|169.254.*|0.*) return 0 ;;
    172.1[6-9].*|172.2[0-9].*|172.3[01].*) return 0 ;;
    100.6[4-9].*|100.[7-9][0-9].*|100.1[01][0-9].*|100.12[0-7].*) return 0 ;;
  esac
  return 1
}
valid_domain() {
  local v="$1" re='^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$'
  if [ -z "$v" ]; then echo "o domínio ficou vazio"; return 1; fi
  case "$v" in
    *://*) echo "escreva só o domínio, sem http:// ou https://"; return 1 ;;
    */*) echo "escreva só o domínio, sem barra nem caminho"; return 1 ;;
    *:*) echo "escreva só o domínio, sem porta"; return 1 ;;
    *" "*) echo "o domínio não pode ter espaço"; return 1 ;;
  esac
  if [ "${#v}" -gt 253 ]; then echo "o domínio é longo demais"; return 1; fi
  if valid_ipv4 "$v" >/dev/null 2>&1; then echo "isso é um IP, não um domínio; para usar o IP, deixe o domínio vazio"; return 1; fi
  [[ "$v" =~ $re ]] || { echo "isso não parece um domínio (exemplo: voz.suaempresa.com.br, em minúsculas)"; return 1; }
}
valid_password() {
  local v="$1"
  if [ "${#v}" -lt 10 ]; then echo "a senha precisa de pelo menos 10 caracteres"; return 1; fi
  if [ "${#v}" -gt 128 ]; then echo "a senha passou de 128 caracteres"; return 1; fi
  case "$v" in " "*|*" ") echo "a senha não pode começar nem terminar com espaço"; return 1 ;; esac
  case "$v" in *[![:print:]]*) echo "a senha tem um caractere invisível (tab ou quebra de linha)"; return 1 ;; esac
  [[ "$v" =~ [^0-9] ]] || { echo "a senha não pode ser só números"; return 1; }
}
valid_port() {
  local re='^[0-9]{1,5}$'
  [[ "$1" =~ $re ]] && [ "$((10#$1))" -ge 1 ] && [ "$((10#$1))" -le 65535 ] || { echo "porta inválida: use um número de 1 a 65535"; return 1; }
}
valid_name() {
  local v="$1"
  case "$v" in ""|" "*|*" ") echo "o nome ficou vazio ou tem espaço sobrando no começo ou no fim"; return 1 ;; esac
  if [ "${#v}" -gt 80 ]; then echo "o nome passou de 80 caracteres"; return 1; fi
  case "$v" in *[[:cntrl:]]*) echo "o nome tem um caractere invisível"; return 1 ;; esac
}

# ── Sistema e rede: decisões puras, para o teste simular sem depender da máquina ──
os_supported() {  # os_supported <ID do os-release> <VERSION_ID>
  local major="${2%%.*}"
  case "$major" in ''|*[!0-9]*) return 1 ;; esac
  case "$1" in ubuntu) [ "$major" -ge 22 ] ;; debian) [ "$major" -ge 12 ] ;; *) return 1 ;; esac
}
arch_supported() { case "$1" in x86_64|amd64|aarch64|arm64) return 0 ;; *) return 1 ;; esac; }

nat_status() {  # nat_status <ip público> <ip da interface> → direct | nat | unknown
  if [ -z "$1" ] || [ -z "$2" ]; then echo unknown
  elif [ "$1" = "$2" ]; then echo direct
  else echo nat; fi
}

# Lê a saída de `ss -Hln` (tcp ou udp) e devolve as portas em uso, uma por linha.
ports_from_ss() { awk '{ n = split($(NF >= 5 ? 4 : NF), a, ":"); if (a[n] ~ /^[0-9]+$/) print a[n] }' | sort -un; }

busy_in_range() {  # busy_in_range <início> <fim> < lista de portas → as que caem na faixa
  awk -v a="$1" -v b="$2" '$1 >= a && $1 <= b'
}
pick_free_port() {  # pick_free_port <primeira candidata> < lista de portas em uso
  local busy candidate="$1"
  busy="$(cat)"
  while printf '%s\n' "$busy" | grep -qx "$candidate"; do candidate=$((candidate + 1)); done
  echo "$candidate"
}

# Sem o nosso Caddy, o painel e a porta de voz do navegador são publicados em portas locais.
#   write_proxy_override <endereço> <porta do painel> <porta da voz do navegador>
write_proxy_override() {
  local tmp
  tmp="$(mktemp "$PROXY_OVERRIDE.XXXXXX")"
  cat > "$tmp" <<OVERRIDE
# Gerado pelo instalador: 80/443 já são de outro proxy nesta máquina.
services:
  panel:
    ports:
      - "$1:$2:3000"
  # Porta por onde chega o áudio de "Falar com o agente" (WebSocket).
  voice:
    ports:
      - "$1:$3:8091"
OVERRIDE
  chmod 600 "$tmp"
  mv "$tmp" "$PROXY_OVERRIDE"
}

# Quem publica o painel? `caddy` = o nosso Caddy pega 80/443; `external` = já existe um
# proxy nessas portas e a gente não briga: o painel sai numa porta local.
#   decide_proxy_mode <80 ocupada: 0|1> <443 ocupada: 0|1> <é o nosso Caddy: 0|1>
decide_proxy_mode() {
  if [ "$3" = 1 ]; then echo caddy
  elif [ "$1" = 1 ] || [ "$2" = 1 ]; then echo external
  else echo caddy; fi
}

# A linha da VPS parceira só aparece com certeza de que a máquina é de outro provedor.
# Na dúvida (fabricante genérico, vazio, desconhecido) não aparece.
partner_hint_allowed() {  # partner_hint_allowed "<fabricante lido de /sys/class/dmi/id/sys_vendor>"
  case "$1" in
    *DigitalOcean*|*Amazon*|*Hetzner*|*Google*|*Microsoft*|*Vultr*|*Linode*|*Akamai*|*Oracle*|*Scaleway*) return 0 ;;
  esac
  return 1
}

# ── Docker ───────────────────────────────────────────────────────────────────
dc() {
  if [ -f "$PROXY_OVERRIDE" ]; then
    docker compose --env-file "$ENV_FILE" -f "$DEPLOY_DIR/docker-compose.yml" -f "$PROXY_OVERRIDE" "$@"
  else
    docker compose --env-file "$ENV_FILE" -f "$DEPLOY_DIR/docker-compose.yml" "$@"
  fi
}
require_install() {
  local f
  for f in "$ENV_FILE" "$APP_ENV_FILE" "$MIGRATE_ENV_FILE"; do
    [ -f "$f" ] || die "Não achei $f: o DeskVoice ainda não foi instalado nesta pasta (ou a instalação parou no meio)." "Rode: bash install/install.sh"
  done
  have docker || die "O Docker não está instalado." "Rode: bash install/install.sh (ele oferece instalar o Docker)."
}
psql_db() {  # psql_db <banco> <sql> → saída crua, uma linha por registro
  dc exec -T postgres psql -U "$DB_USER" -d "$1" -v ON_ERROR_STOP=1 -At -c "$2"
}

# Contagem exata de linhas por tabela, no formato `tabela=numero`, em ordem alfabética.
table_counts() {  # table_counts <banco>
  psql_db "$1" "select table_name || '=' || (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name"
}

# Compara o manifesto de um backup com as contagens do banco restaurado.
# Escreve uma linha por tabela que diverge e devolve 1 se houver alguma.
#   compare_counts <manifesto> <arquivo com tabela=numero>
compare_counts() {
  local found status=0
  # Sem PIPESTATUS de propósito: em bash antigo a armadilha de erro o zera, e a divergência
  # passava como "igual" (medido no bash 3.2).
  found="$(awk -F= '
    FNR == NR { if ($1 ~ /^table:/) { expected[substr($1, 7)] = $2; total++ } ; next }
    { actual[$1] = $2 }
    END {
      if (total == 0) { print "o manifesto não lista nenhuma tabela"; exit 1 }
      for (t in expected) {
        if (!(t in actual)) { printf "tabela %s: o backup tinha %s linhas e ela não existe no banco restaurado\n", t, expected[t]; bad = 1 }
        else if (actual[t] != expected[t]) { printf "tabela %s: o backup tinha %s linhas, o banco restaurado tem %s\n", t, expected[t], actual[t]; bad = 1 }
      }
      for (t in actual) if (!(t in expected)) { printf "tabela %s: existe no banco restaurado (%s linhas) e não estava no backup\n", t, actual[t]; bad = 1 }
      exit bad
    }' "$1" "$2")" || status=$?
  if [ -n "$found" ]; then printf '%s\n' "$found" | sort; fi
  return "$status"
}

# ── Sem segredo na tela nem em arquivo ───────────────────────────────────────
# Filtro: troca por *** o valor de todo segredo do .env e o que tiver cara de senha,
# chave ou token; encurta e-mail e telefone, que são dado pessoal de quem ligou.
SECRET_KEYS="POSTGRES_PASSWORD APP_DB_PASSWORD SYSTEM_DB_PASSWORD DESKVOICE_SECRET_KEY INTERNAL_TOKEN ARI_PASSWORD"
mask_secrets() {  # ... | mask_secrets   (lê os segredos dos três arquivos de ambiente)
  local f key list=""
  for f in "$ENV_FILE" "$APP_ENV_FILE" "$MIGRATE_ENV_FILE"; do
    for key in $SECRET_KEYS; do list="$list$(env_get "$f" "$key")"$'\n'; done
  done
  MASK_VALUES="$list" awk '
    BEGIN { n = split(ENVIRON["MASK_VALUES"], secrets, "\n") }
    { line = $0
      for (i = 1; i <= n; i++) {
        if (length(secrets[i]) < 6) continue
        out = ""
        while ((p = index(line, secrets[i])) > 0) { out = out substr(line, 1, p - 1) "***"; line = substr(line, p + length(secrets[i])) }
        line = out line
      }
      print line }' \
  | sed -E \
      -e 's#(://[^:/@[:space:]]+):[^@[:space:]]+@#\1:***@#g' \
      -e 's#(([Pp]assword|PASSWORD|[Ss]enha|SENHA|[Ss]ecret|SECRET|[Tt]oken|TOKEN|[Aa]pi[_-]?[Kk]ey|API_KEY|SECRET_KEY)[A-Za-z_]*"?[[:space:]]*[=:][[:space:]]*"?)[^[:space:]",}]+#\1***#g' \
      -e 's#(Bearer|Basic) [A-Za-z0-9._~+/=-]+#\1 ***#g' \
      -e 's#[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+\.[A-Za-z0-9.-]+)#***@\1#g' \
      -e 's#(^|[^0-9.])(\+?[0-9]{4})[0-9]{4,9}([0-9]{2})([^0-9.]|$)#\1\2****\3\4#g'
}

# ── Leitura da máquina ───────────────────────────────────────────────────────
udp_ports_in_use() { if have ss; then { ss -Hlun 2>/dev/null || true; } | ports_from_ss; fi; }
tcp_ports_in_use() { if have ss; then { ss -Hltn 2>/dev/null || true; } | ports_from_ss; fi; }
interface_ip() {
  local ip=""
  if have ip; then ip="$(ip -4 route get 1.1.1.1 2>/dev/null | sed -n 's/.* src \([0-9.]*\).*/\1/p' | head -n 1 || true)"; fi
  if [ -z "$ip" ] && have hostname; then ip="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"; fi
  echo "$ip"
}
PUBLIC_IP_SOURCES="${DESKVOICE_IP_SOURCES:-https://api.ipify.org https://ifconfig.me/ip https://icanhazip.com}"
discover_public_ip() {  # tenta cada fonte; devolve vazio se nenhuma respondeu um IP válido
  local url ip
  have curl || return 0
  for url in $PUBLIC_IP_SOURCES; do
    ip="$(curl -4 -fsS --max-time 6 "$url" 2>/dev/null | tr -d '[:space:]' || true)"
    if valid_ipv4 "$ip" >/dev/null 2>&1; then echo "$ip"; return 0; fi
  done
}
