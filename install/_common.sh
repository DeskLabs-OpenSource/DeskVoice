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
ENV_FILE="$DEPLOY_DIR/.env"                 # o que o Compose interpola (a senha do dono, só para o postgres; o segredo do agente, só para o painel; a chave do WAHA, para painel, voz e rotinas)
APP_ENV_FILE="$DEPLOY_DIR/app.env"          # painel, voz e rotinas; sem a senha do dono do banco
MIGRATE_ENV_FILE="$DEPLOY_DIR/migrate.env"  # só o serviço migrate e a criação do primeiro usuário
GENERATED_DIR="$DEPLOY_DIR/asterisk/generated"
# Gravado pelo instalador em todo modo: diz onde o Caddy (a entrada única) escuta e que
# portas publica. É o único lugar em que uma porta web é publicada.
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
sha512_of_text() {  # sha512_of_text <texto> → o hash em hexadecimal
  if have sha512sum; then printf '%s' "$1" | sha512sum | awk '{print $1}'
  elif have shasum; then printf '%s' "$1" | shasum -a 512 | awk '{print $1}'
  else printf '%s' "$1" | openssl dgst -sha512 | awk '{print $NF}'; fi
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
env_unset() {  # env_unset <arquivo> <CHAVE>: tira a chave, se existir
  local file="$1" tmp
  [ -f "$file" ] || return 0
  tmp="$(mktemp "$file.XXXXXX")"
  ENV_KEY="$2" awk 'index($0, ENVIRON["ENV_KEY"] "=") != 1' "$file" > "$tmp"
  chmod 600 "$tmp"
  mv "$tmp" "$file"
}
env_set_if_missing() {  # nunca troca um segredo que já existe
  [ -n "$(env_get "$1" "$2")" ] || env_set "$1" "$2" "$3"
}

# O segredo do agente de atualização (install/agent.sh): só com ele a rota do agente responde.
# Mora em deploy/.env, o arquivo que o Compose interpola, e chega SÓ ao painel (o Compose o entrega
# pelo `environment` desse serviço, como faz com a senha do banco para o Postgres). Voz e rotinas,
# que recebem o app.env, não o conhecem.
# Devolve 0 se acabou de criar (o painel precisa ser recriado para recebê-lo) e 1 se já existia.
ensure_agent_token() {
  local old
  # Instalação feita por uma versão de desenvolvimento, que guardava o segredo no app.env: muda de lugar.
  old="$(env_get "$APP_ENV_FILE" UPDATE_AGENT_TOKEN)"
  if [ -n "$old" ]; then env_unset "$APP_ENV_FILE" UPDATE_AGENT_TOKEN; fi
  [ -z "$(env_get "$ENV_FILE" UPDATE_AGENT_TOKEN)" ] || return 1
  env_set "$ENV_FILE" UPDATE_AGENT_TOKEN "${old:-$(random_hex 32)}"
  # Rodando com sudo numa instalação de outro usuário, o arquivo regravado não pode virar do root:
  # o dono da instalação (e o agente, que roda como ele) deixaria de conseguir ler.
  if [ "$(id -u)" = 0 ]; then chown "$(owner_of "$DEPLOY_DIR")" "$ENV_FILE" 2>/dev/null || true; fi
}

# WhatsApp por QR Code: a chave com que painel, voz e rotinas falam com o WAHA, o serviço que a
# instalação liga pela tela (ver whatsapp_enabled). Mora em deploy/.env e o Compose a entrega só a esses três serviços, pelo `environment`
# de cada um. O contêiner do WAHA recebe só o hash (WAHA_API_KEY_SHA512): quem lê o ambiente dele
# não aprende a chave. Pode rodar quantas vezes for; a chave que já existe nunca é trocada.
# Devolve 0 se acabou de criar a chave (os serviços precisam ser recriados para recebê-la) e 1 se
# ela já existia.
#
# A imagem do WAHA sem navegador é publicada com uma etiqueta por arquitetura. A de amd64 é o padrão
# do Compose; em ARM, WAHA_IMAGE aponta para esta, da MESMA versão (um teste do kit confere).
WAHA_IMAGE_ARM64="devlikeapro/waha:noweb-arm-2026.10.1@sha256:fce6ae58ba819221521b2673704ef9e6d87f98571d67daec62eb737edd77c2c9"
# O que o serviço custa, para o agente conferir ANTES de baixar. A imagem ocupa 3,19 GB (medido em
# 11/11/2026); durante o download o Docker guarda também as camadas comprimidas (cerca de 0,76 GB);
# e sobra 1 GB, abaixo do qual a checagem de saúde já acusa o disco e o banco pode parar de gravar.
# 3,19 + 0,76 + 1 ≈ 5 GB. A memória é o teto do serviço no Compose (mem_limit: 1280m).
WAHA_DISK_NEEDED_MB=5120
WAHA_MEMORY_CEILING_MB=1280
MEMINFO_FILE="${DESKVOICE_MEMINFO:-/proc/meminfo}"   # os testes trocam
free_disk_mb() { df -Pm "$1" 2>/dev/null | awk 'NR == 2 { print $4 }'; }   # MB livres no disco da pasta
# Onde o Docker guarda as imagens (pode ser outro disco). Sem resposta, vale o disco da instalação.
docker_free_mb() {
  local root
  root="$(docker info --format '{{.DockerRootDir}}' 2>/dev/null || true)"
  if [ -z "$root" ] || [ ! -d "$root" ]; then root="$DEPLOY_DIR"; fi
  free_disk_mb "$root"
}
available_memory_mb() { awk '/^MemAvailable:/ { print int($2 / 1024) }' "$MEMINFO_FILE" 2>/dev/null || true; }
# A imagem do WAHA que ESTA instalação usa, na forma que o Docker guarda quando ela é baixada por
# resumo: `repositório@sha256:...`. Sai do Compose (ou de WAHA_IMAGE, em ARM), nunca de fora.
waha_image_ref() {
  local ref
  ref="$(env_get "$ENV_FILE" WAHA_IMAGE)"
  if [ -z "$ref" ]; then ref="$(sed -n 's/.*WAHA_IMAGE:-\(.*\)}$/\1/p' "$DEPLOY_DIR/docker-compose.yml" | head -n 1)"; fi
  case "$ref" in *@sha256:*) printf '%s@%s\n' "${ref%%:*}" "${ref##*@}" ;; esac
}
ensure_waha() {
  local key hash created=1
  key="$(env_get "$ENV_FILE" WAHA_API_KEY)"
  if [ -z "$key" ]; then key="$(random_hex 32)"; env_set "$ENV_FILE" WAHA_API_KEY "$key"; created=0; fi
  hash="$(sha512_of_text "$key")"
  if [ "$(env_get "$ENV_FILE" WAHA_API_KEY_SHA512)" != "$hash" ]; then env_set "$ENV_FILE" WAHA_API_KEY_SHA512 "$hash"; fi
  case "$(uname -m)" in
    aarch64|arm64) if [ "$(env_get "$ENV_FILE" WAHA_IMAGE)" != "$WAHA_IMAGE_ARM64" ]; then env_set "$ENV_FILE" WAHA_IMAGE "$WAHA_IMAGE_ARM64"; fi ;;
    *) if [ -n "$(env_get "$ENV_FILE" WAHA_IMAGE)" ]; then env_unset "$ENV_FILE" WAHA_IMAGE; fi ;;
  esac
  # Como no segredo do agente: regravado com sudo, o arquivo não pode virar do root.
  if [ "$(id -u)" = 0 ]; then chown "$(owner_of "$DEPLOY_DIR")" "$ENV_FILE" 2>/dev/null || true; fi
  return "$created"
}

# Grava os três arquivos de ambiente. Segredo que já existe fica como está; o resto é
# regravado com o que foi decidido nesta execução.
#   write_env_files <public_url> <public_ip> <panel_domain> <rtp_start> <rtp_end>
write_env_files() {
  local pg app sys url_system
  # deploy/.env
  env_set_if_missing "$ENV_FILE" POSTGRES_PASSWORD "$(random_hex 24)"
  # A versão não é gravada aqui: quem decide é o instalador (número publicado ou `local`) e o
  # atualizador. O endereço das imagens saiu deste arquivo: a fonte única é deploy/images.env.
  env_unset "$ENV_FILE" DESKVOICE_IMAGE_PREFIX
  env_set "$ENV_FILE" PANEL_DOMAIN "$3"
  env_set "$ENV_FILE" RTP_START "$4"
  env_set "$ENV_FILE" RTP_END "$5"
  # O Caddy deixou de ser perfil opcional: a chave de instalações antigas sai.
  env_unset "$ENV_FILE" COMPOSE_PROFILES
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
  ensure_agent_token || true
  ensure_waha || true
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
  # Arquivo que já existe é reescrito NO LUGAR, e só se mudou. O Compose monta cada arquivo do
  # Asterisk um a um, e um arquivo montado assim fica preso ao inode que existia quando o contêiner
  # subiu: trocado por renomeação, o contêiner seguiria lendo o antigo, e recarregar não adiantaria.
  # ponytail: a escrita no lugar não é atômica; o arquivo novo já está inteiro em $tmp antes, e se
  # ela falhar (disco cheio) a renomeação abaixo ainda deixa o disco certo, e converge_asterisk vê o
  # contêiner com o arquivo antigo e reinicia.
  if [ -f "$dst" ] && { cmp -s "$tmp" "$dst" || cat "$tmp" > "$dst" 2>/dev/null; }; then rm -f "$tmp"
  else mv "$tmp" "$dst"; fi
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
  render_asterisk_file extensions.conf extensions.conf
  render_asterisk_file http.conf http.conf
  render_asterisk_file ari.conf.tmpl ari.conf
  render_asterisk_file rtp.conf.tmpl rtp.conf
  render_asterisk_file pjsip.conf.base pjsip.conf
  unset ARI_PASSWORD
}
# O que mudou num arquivo que o Asterisk já tinha fica anotado em ASTERISK_PENDING, para
# converge_asterisk recarregar depois que os contêineres sobem. Arquivo novo (instalação nova)
# não: o Asterisk que sobe pela primeira vez já lê o que está no disco.
ASTERISK_PENDING="$GENERATED_DIR/.reload-pending"
render_asterisk_file() {  # render_asterisk_file <modelo em deploy/asterisk> <arquivo em generated>
  local dst="$GENERATED_DIR/$2" before=""
  if [ -f "$dst" ]; then before="$(cksum < "$dst")"; fi
  render_template "$DEPLOY_DIR/asterisk/$1" "$dst"
  if [ -n "$before" ] && [ "$before" != "$(cksum < "$dst")" ]; then echo "$2" >> "$ASTERISK_PENDING"; fi
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
# Os sistemas aceitos, numa frase só: é a que as mensagens do kit mostram. Muda junto com os_supported.
# O RHEL fica de fora até alguém instalar nele: pede assinatura ativa para o dnf baixar pacotes, um
# passo que nenhuma instalação provou. Quem quiser tentar usa --force, como em qualquer outro sistema.
SUPPORTED_SYSTEMS="Ubuntu 22.04+, Debian 12+, AlmaLinux 9+ ou Rocky Linux 9+"
os_supported() {  # os_supported <ID do os-release> <VERSION_ID>
  local major="${2%%.*}"
  case "$major" in ''|*[!0-9]*) return 1 ;; esac
  case "$1" in
    ubuntu) [ "$major" -ge 22 ] ;; debian) [ "$major" -ge 12 ] ;;
    almalinux|rocky) [ "$major" -ge 9 ] ;;
    *) return 1 ;;
  esac
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

# Grava a publicação da entrada única. Só o Caddy ganha porta; painel e voz, nunca.
#   write_proxy_override <site do Caddy> <em quem o Caddy confia> <publicação>...
# Cada publicação é uma linha de `ports` do Compose: "80:80", "127.0.0.1:3080:80".
# O arquivo é reescrito por inteiro: o que uma versão antiga publicava (painel e voz em duas
# portas) some na reinstalação, e o `up` seguinte recria os contêineres sem a porta antiga.
write_proxy_override() {
  local tmp site="$1" trusted="$2" port
  shift 2
  tmp="$(mktemp "$PROXY_OVERRIDE.XXXXXX")"
  {
    echo "# Gerado pelo instalador. Não edite: rode bash install/install.sh para mudar."
    echo "services:"
    echo "  caddy:"
    echo "    environment:"
    echo "      CADDY_SITE: \"$site\""
    echo "      CADDY_TRUSTED_PROXIES: \"$trusted\""
    echo "    ports:"
    for port in "$@"; do echo "      - \"$port\""; done
  } > "$tmp"
  chmod 600 "$tmp"
  mv "$tmp" "$PROXY_OVERRIDE"
}
# O que o arquivo de publicação diz hoje, para a reinstalação manter a porta que o proxy do
# operador (ou o túnel) já conhece. Lê o formato atual (Caddy, porta 80 de dentro) e o antigo
# (painel direto, porta 3000 de dentro). Devolve "<endereço> <porta>" ou nada.
published_entry() {
  [ -f "$PROXY_OVERRIDE" ] || return 0
  sed -n -e 's/.*"\([0-9.]*\):\([0-9][0-9]*\):80".*/\1 \2/p' -e 's/.*"\([0-9.]*\):\([0-9][0-9]*\):3000".*/\1 \2/p' "$PROXY_OVERRIDE" | head -n 1
}
# Sem domínio, como o painel está publicado hoje: `local` (só em 127.0.0.1, por túnel) ou `public`
# (HTTP aberto, na 80 ou numa porta). Nada = ainda não há publicação. É o que a reinstalação
# consulta para NÃO mudar a exposição de quem já instalou sem que a pessoa peça.
published_exposure() {
  local entry
  entry="$(published_entry)"
  if [ -n "$entry" ]; then
    if [ "${entry%% *}" = "127.0.0.1" ]; then echo local; else echo public; fi
  elif [ -f "$PROXY_OVERRIDE" ]; then
    if grep -q '"80:80"' "$PROXY_OVERRIDE"; then echo public; fi
  elif [ -n "$(env_get "$ENV_FILE" PANEL_DOMAIN)" ]; then echo public   # instalação de antes do arquivo de publicação
  fi
}
# O endereço que a publicação GRAVADA dá a quem abre o painel. Lê o mesmo arquivo que o Compose
# publica e que a checagem de saúde sonda: o que o instalador anuncia no fim sai daqui, e não de
# uma conta feita à parte.
#   published_address <ip público>  →  https://<domínio> | http://localhost:<porta> | http://<ip>[:<porta>]
published_address() {
  local site entry
  site="$(sed -n 's/.*CADDY_SITE: "\(.*\)".*/\1/p' "$PROXY_OVERRIDE" 2>/dev/null | head -n 1 || true)"
  case "$site" in ""|:*) ;; *) echo "https://$site"; return 0 ;; esac
  entry="$(published_entry)"
  if [ -n "$entry" ]; then
    if [ "${entry%% *}" = "127.0.0.1" ]; then echo "http://localhost:${entry#* }"; else echo "http://$1:${entry#* }"; fi
  elif grep -q '"80:80"' "$PROXY_OVERRIDE" 2>/dev/null; then echo "http://$1"
  fi
}
# Por onde se fala com o Caddy de dentro da rede dos contêineres, a partir da publicação gravada.
#   entry_target  →  "<http|https> <porta de dentro> <nome do site>", ou nada sem publicação
entry_target() {
  local site
  site="$(sed -n 's/.*CADDY_SITE: "\(.*\)".*/\1/p' "$PROXY_OVERRIDE" 2>/dev/null | head -n 1 || true)"
  case "$site" in "") ;; :*) echo "http 80 localhost" ;; *) echo "https 443 $site" ;; esac
}
# Entra de verdade pela entrada única, como a pessoa vai entrar: POST no login, uma rota que só
# responde com sessão e, no fim, sai (não fica sessão aberta). Roda de dentro do contêiner do
# painel, falando com o Caddy. Lê da ENTRADA PADRÃO "e-mail<quebra de linha>senha": a senha nunca
# vai em argumento de processo. Escreve uma linha:
#   ok|200 · rejected|<HTTP> (e-mail ou senha recusados) · limited|429 (limite de tentativas)
#   session|<HTTP> (entrou, e a sessão não valeu) · unreachable|<motivo> (não chegou ao painel)
#   login_probe_js <http|https> <porta> <nome do site>
login_probe_js() {
  cat <<JS
const m=require('$1');let s='';process.stdin.on('data',d=>s+=d).on('end',async()=>{
const i=s.indexOf('\\n'),email=s.slice(0,i).trim().toLowerCase(),password=s.slice(i+1);
const call=(method,path,headers,body)=>new Promise(done=>{const q=m.request({host:'caddy',port:$2,path,method,servername:'$3',headers:{Host:'$3',...headers},rejectUnauthorized:false,timeout:15000},r=>{let b='';r.on('data',d=>b+=d).on('end',()=>done({status:r.statusCode,cookie:(r.headers['set-cookie']||[]).map(c=>c.split(';')[0]).join('; '),body:b}))});
q.on('timeout',()=>q.destroy(new Error('sem resposta em 15s')));q.on('error',e=>done({status:0,error:String(e.code||e.message).replace(/[\\n|]/g,' ')}));if(body)q.write(body);q.end()});
const sent=JSON.stringify({email,password});
const login=await call('POST','/api/v1/auth/login',{'content-type':'application/json','content-length':Buffer.byteLength(sent)},sent);
if(login.status===0)return console.log('unreachable|'+login.error);
if(login.status===429)return console.log('limited|429');
if(login.status===400||login.status===401)return console.log('rejected|'+login.status);
if(login.status!==200||!login.cookie)return console.log('unreachable|HTTP '+login.status);
const me=await call('GET','/api/v1/auth/me',{cookie:login.cookie});
let who='';try{who=String(JSON.parse(me.body).data.email).toLowerCase()}catch(e){who=''}
await call('POST','/api/v1/auth/logout',{cookie:login.cookie});
console.log(me.status===200&&who===email?'ok|200':'session|'+me.status)});
JS
}
# Uma tentativa de login pela entrada única, com a sonda acima. Devolve a linha dela (vazia se a
# sonda não rodou). Uma tentativa só por chamada: o painel limita tentativas por e-mail.
#   try_login <e-mail> <senha>
try_login() {
  local target
  target="$(entry_target)"
  [ -n "$target" ] || return 0
  # shellcheck disable=SC2086  # entry_target devolve três palavras, de propósito
  printf '%s\n%s' "$1" "$2" | dc exec -T panel node -e "$(login_probe_js $target)" 2>/dev/null | tail -n 1 || true
}
# Onde a porta publicada responde, vista de dentro desta máquina: em 127.0.0.1 (publicada só
# local ou aberta, tanto faz); com HTTPS, pelo próprio domínio, como quem abre o navegador.
#   published_probe_url <ip público>  →  endereço, ou nada sem publicação
published_probe_url() {
  local url
  url="$(published_address "$1")"
  case "$url" in
    https://*) echo "$url" ;;
    http://*:*) echo "http://127.0.0.1:${url##*:}" ;;
    http://*) echo "http://127.0.0.1" ;;
  esac
}
# Pede a rota de saúde pela porta publicada. Devolve o código HTTP (000 sem resposta), ou nada
# se esta máquina não tem curl.
#   probe_published <endereço de published_probe_url>
probe_published() {
  have curl || return 0
  curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$1/api/v1/system/health" 2>/dev/null || true
}
# O nosso Caddy é quem está nas portas 80/443? (1 = sim.) Rodando com o arquivo atual publicando
# a 80, ou rodando numa instalação antiga, de antes de o arquivo existir nesse modo.
own_caddy_on_80() {  # own_caddy_on_80 <o Caddy do DeskVoice está rodando: 0|1>
  [ "$1" = 1 ] || { echo 0; return 0; }
  if [ ! -f "$PROXY_OVERRIDE" ] || grep -q '"80:80"' "$PROXY_OVERRIDE"; then echo 1; else echo 0; fi
}

# Aplica a entrada única de um modo: grava a publicação do Caddy, o número de saltos que o
# painel conta e tira o que a versão de duas portas deixou. Usada pelo instalador (com o que
# ele acabou de decidir) e pela atualização (com o que a instalação já tinha).
#   apply_entry <caddy|external> <domínio ou vazio> [<endereço local> <porta local>]
apply_entry() {
  local mode="$1" domain="$2" has_domain=0 trust hops
  if [ -n "$domain" ]; then has_domain=1; fi
  trust="$(trust_for_mode "$mode" "$has_domain")"; hops="${trust%% *}"; trust="${trust#* }"
  if [ "$mode" = external ]; then write_proxy_override ":80" "$trust" "$3:$4:80"
  elif [ "$has_domain" = 1 ]; then write_proxy_override "$domain" "$trust" "80:80" "443:443"
  else write_proxy_override ":80" "$trust" "80:80"; fi
  env_set "$APP_ENV_FILE" TRUSTED_PROXY_HOPS "$hops"
  # A segunda porta acabou: o navegador usa sempre /voice-ws no endereço do painel.
  env_unset "$APP_ENV_FILE" VOICE_WEB_PUBLIC_PORT
}
# Instalação feita antes da entrada única: passa para o formato atual sem perguntar nada,
# mantendo o endereço e a porta que o proxy do operador (ou o túnel) já conhece.
# Não faz nada em instalação que já está no formato atual.
converge_entry() {
  local domain entry
  domain="$(env_get "$ENV_FILE" PANEL_DOMAIN)"
  case "$domain" in :80|localhost) domain="" ;; esac
  if [ ! -f "$PROXY_OVERRIDE" ]; then apply_entry caddy "$domain"
  elif grep -q ':3000"' "$PROXY_OVERRIDE"; then
    entry="$(published_entry)"
    apply_entry external "$domain" "${entry%% *}" "${entry#* }"
  fi
  env_unset "$ENV_FILE" COMPOSE_PROFILES
}

# Quantos proxies o painel conta até chegar ao endereço do visitante (TRUSTED_PROXY_HOPS), e
# em quem o Caddy confia (CADDY_TRUSTED_PROXIES). Sempre há o nosso Caddy na frente do painel.
#   trust_for_mode <caddy|external> <tem domínio: 0|1>  →  "<saltos> <confiança do Caddy>"
#
# - Caddy recebendo o visitante direto (80/443, ou a porta local sem domínio, aberta ou por
#   túnel): 1 salto. O Caddy não confia em ninguém, descarta o X-Forwarded-For que chegar e
#   escreve o endereço real da conexão. Por túnel esse endereço é o da própria máquina, igual
#   para todos: o limite de login fica único em vez de por visitante, e ninguém o forja.
# - Caddy atrás do proxy do operador (modo externo com domínio; a porta só abre em 127.0.0.1):
#   2 saltos. O Caddy confia só em vizinho de rede privada e ACRESCENTA o endereço dele; o
#   painel lê o segundo item do fim, que foi escrito pelo proxy do operador. Preferido a
#   "1 salto com o Caddy calculando o cliente" porque é posicional e falha fechado: se a cadeia
#   vier mais curta que o esperado (conexão que não passou pelo proxy), o painel lê
#   "desconhecido" em vez de aceitar um valor escrito pelo visitante.
trust_for_mode() {
  if [ "$1" = external ] && [ "$2" = 1 ]; then echo "2 private_ranges"; else echo "1 127.0.0.1/32"; fi
}

# Onde o nosso Caddy escuta? `caddy` = nas portas 80/443; `external` = já existe um proxy
# nessas portas e a gente não briga: o nosso Caddy sai numa porta local única.
#   decide_proxy_mode <80 ocupada: 0|1> <443 ocupada: 0|1> <quem ocupa é o nosso Caddy: 0|1>
decide_proxy_mode() {
  if [ "$3" = 1 ]; then echo caddy
  elif [ "$1" = 1 ] || [ "$2" = 1 ]; then echo external
  else echo caddy; fi
}

# Nome, endereço e texto da oferta da parceira moram em partner.env, lido como texto.
partner_value() { sed -n "s/^$1=\"\\(.*\\)\"\$/\\1/p" "$KIT_DIR/partner.env" 2>/dev/null | head -n 1; }

# A linha da VPS parceira só aparece com certeza de que a máquina é de outro provedor.
# Na dúvida (fabricante genérico, vazio, desconhecido) não aparece.
partner_hint_allowed() {  # partner_hint_allowed "<fabricante lido de /sys/class/dmi/id/sys_vendor>"
  case "$1" in
    *DigitalOcean*|*Amazon*|*Hetzner*|*Google*|*Microsoft*|*Vultr*|*Linode*|*Akamai*|*Oracle*|*Scaleway*) return 0 ;;
  esac
  return 1
}

# ── Imagens e versão: uma fonte só ───────────────────────────────────────────
# O endereço das imagens mora em deploy/images.env. O formato da versão é um só: X.Y.Z, sem `v`,
# na etiqueta da imagem e em DESKVOICE_VERSION. A tag do git é vX.Y.Z, e version_of_tag e
# tag_of_version são a única conversão entre as duas: o atualizador e o publish-image.yml usam
# estas mesmas funções.
IMAGES_FILE="$DEPLOY_DIR/images.env"
# O que fica gravado quando as imagens foram construídas nesta máquina (antes da primeira versão
# publicada, ou com --build). Não é canal: não existe imagem publicada com esta etiqueta.
LOCAL_VERSION="local"
version_of_tag() { printf '%s\n' "${1#v}"; }
tag_of_version() { printf 'v%s\n' "$1"; }
is_version() {  # 0 = número de versão no formato único (X.Y.Z, ou X.Y.Z-rc.1 para pré-versão)
  local re='^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$'
  [[ "$1" =~ $re ]]
}
image_prefix() { env_get "$IMAGES_FILE" DESKVOICE_IMAGE_PREFIX; }
image_repo() {  # image_repo <panel|voice|routines> → o nome sem a etiqueta
  printf '%s/deskvoice-%s\n' "$(image_prefix)" "$1"
}
image_ref() {  # image_ref <panel|voice|routines> <versão> → o nome completo, igual ao do Compose
  printf '%s:%s\n' "$(image_repo "$1")" "$2"
}

# A versão publicada mais recente é a maior tag final do clone. O Compose e o kit vêm do mesmo
# repositório, e a tag só nasce no CI, de um commit da main. Pré-versão não conta: só entra com
# pedido explícito. Devolve X.Y.Z, ou nada enquanto não houver nenhuma versão.
is_clone() { have git && git -C "$REPO_DIR" rev-parse --git-dir >/dev/null 2>&1; }
fetch_versions() { git -C "$REPO_DIR" fetch --tags --quiet origin; }
latest_version() {
  local tag
  tag="$(git -C "$REPO_DIR" tag --list 'v[0-9]*' --sort=-v:refname | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | head -n 1 || true)"
  if [ -n "$tag" ]; then version_of_tag "$tag"; fi
}

# ── Docker ───────────────────────────────────────────────────────────────────
# O serviço de WhatsApp (WAHA) fica num perfil do Compose e só existe na instalação que o pediu
# pela tela. Quem liga e desliga é o agente (install/agent.sh), que grava DESKVOICE_WHATSAPP=on em
# deploy/.env; com a marca, TODO comando do kit enxerga o serviço (subir, baixar, reiniciar).
whatsapp_enabled() { [ "$(env_get "$ENV_FILE" DESKVOICE_WHATSAPP)" = on ]; }
dc() {
  local profile=""
  if whatsapp_enabled; then profile="--profile whatsapp"; fi
  # shellcheck disable=SC2086  # vazio ou duas palavras, de propósito
  if [ -f "$PROXY_OVERRIDE" ]; then
    docker compose --env-file "$IMAGES_FILE" --env-file "$ENV_FILE" $profile -f "$DEPLOY_DIR/docker-compose.yml" -f "$PROXY_OVERRIDE" "$@"
  else
    docker compose --env-file "$IMAGES_FILE" --env-file "$ENV_FILE" $profile -f "$DEPLOY_DIR/docker-compose.yml" "$@"
  fi
}
# O projeto do Compose tem nome fixo (`name: deskvoice` no docker-compose.yml): toda pasta com o
# kit manda nos MESMOS contêineres. Um segundo clone (ou uma cópia antiga) geraria segredos novos,
# ou trocaria a versão e o banco da instalação de outra pasta.
# Devolve a pasta deploy/ dona da instalação desta máquina, se ela NÃO é a desta pasta. Vazio: não
# há contêiner do DeskVoice (instalação nova), ou a dona é esta pasta, ou o Docker não respondeu
# (aí o próprio script para adiante, por não conseguir falar com ele). Conta contêiner parado: uma
# instalação parada também tem dona.
foreign_install_dir() {
  local dirs dir mine theirs
  have docker || return 0
  dirs="$(docker ps -a --filter label=com.docker.compose.project=deskvoice --format '{{.Label "com.docker.compose.project.working_dir"}}' 2>/dev/null)" || return 0
  [ -n "$dirs" ] || return 0
  mine="$(cd "$DEPLOY_DIR" 2>/dev/null && pwd -P)"
  while IFS= read -r dir; do
    # Rótulo vazio ou pasta que não existe mais também não é esta pasta.
    theirs="$(cd "$dir" 2>/dev/null && pwd -P || true)"
    if [ -z "$theirs" ] || [ "$theirs" != "$mine" ]; then echo "${dir:-uma pasta que o Docker não informou}"; return 0; fi
  done <<EOF
$(printf '%s\n' "$dirs" | sort -u)
EOF
}
# Para o script antes de ele tocar em qualquer coisa, se a instalação desta máquina é de outra pasta.
refuse_foreign_install() {
  local other
  other="$(foreign_install_dir)"
  [ -n "$other" ] || return 0
  # Pasta que não existe mais (instalação movida, ou outro usuário): mandar para ela não tem saída.
  [ -d "$other" ] || die "O DeskVoice desta máquina foi instalado a partir de $other, que não existe mais (a pasta foi movida ou apagada), e este comando está em $DEPLOY_DIR. Nada foi alterado." "Para esta pasta passar a ser a da instalação, sem perder os dados: copie deploy/.env, deploy/app.env e deploy/migrate.env da pasta antiga (ou do backup dela) para $DEPLOY_DIR e rode: DESKVOICE_ADOPT=yes bash $KIT_DIR/install.sh"
  die "O DeskVoice desta máquina foi instalado a partir de outra pasta ($other), e este comando está em $DEPLOY_DIR. Rodar daqui mandaria na instalação de lá: segredos novos, outra versão ou outro banco. Nada foi alterado." "Rode o comando a partir da pasta da instalação: cd $(dirname "$other") && bash install/$(basename "$0")"
}
require_install() {
  local f
  # Antes dos arquivos: num segundo clone eles faltam, e "rode o instalador" seria o conselho errado.
  refuse_foreign_install
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

# ── Agente de atualização: o agendamento ─────────────────────────────────────
# O agente (install/agent.sh) passa a cada minuto. Quem o chama é um timer do systemd; em máquina
# sem systemd, uma linha em /etc/cron.d; sem nenhum dos dois, ninguém, e a tela diz "agente não
# instalado". Tudo aqui pode rodar quantas vezes for: só grava o que mudou.
AGENT_STATE_DIR="$DEPLOY_DIR/agent"   # trava, registro e resultado pendente do agente
AGENT_UNIT="deskvoice-agent"
# Os testes trocam estas pastas: nenhum teste toca no systemd nem no cron de verdade.
SYSTEMD_DIR="${DESKVOICE_SYSTEMD_DIR:-/etc/systemd/system}"
SYSTEMD_RUN_DIR="${DESKVOICE_SYSTEMD_RUN_DIR:-/run/systemd/system}"
CRON_DIR="${DESKVOICE_CRON_DIR:-/etc/cron.d}"
agent_scheduler() {  # → systemd | cron | none
  if have systemctl && [ -d "$SYSTEMD_RUN_DIR" ]; then echo systemd
  elif [ -d "$CRON_DIR" ]; then echo cron
  else echo none; fi
}
owner_of() { if stat -c %U "$1" >/dev/null 2>&1; then stat -c %U "$1"; else stat -f %Su "$1"; fi; }
# Grava um arquivo de sistema. Sem permissão na pasta, tenta o sudo SEM pedir senha: o agente
# roda sem terminal, e uma pergunta ali travaria a atualização.
root_install() {  # root_install <origem> <destino>
  if [ -w "$(dirname "$2")" ]; then install -m 644 "$1" "$2"
  elif have sudo; then sudo -n install -m 644 "$1" "$2"
  else return 1; fi
}
root_systemctl() {
  if [ "$(id -u)" = 0 ]; then systemctl "$@"
  elif have sudo; then sudo -n systemctl "$@"
  else return 1; fi
}
# Instala ou atualiza o agendamento do agente. Nunca derruba quem chamou: se não der, avisa e
# diz o comando. Devolve sempre 0.
install_agent_schedule() {
  local kind user file tmp changed=0 manual="sudo bash $KIT_DIR/agent.sh --install"
  kind="$(agent_scheduler)"
  if [ "$kind" = none ]; then
    warn "Esta máquina não tem systemd nem cron: o agente de atualização não foi agendado. A tela vai mostrar \"agente não instalado\", e a atualização continua pelo terminal: bash install/update.sh"
    return 0
  fi
  # O caminho entra num arquivo de unidade e numa linha de cron, sem aspas.
  case "$REPO_DIR" in *[!A-Za-z0-9_./-]*)
    warn "O caminho desta instalação ($REPO_DIR) tem espaço ou caractere especial, e o agente de atualização não foi agendado. A atualização continua pelo terminal: bash install/update.sh"
    return 0 ;;
  esac
  user="$(owner_of "$REPO_DIR")"
  # Montado numa pasta temporária: a pasta de estado do agente é dele, e este passo pode rodar como root.
  tmp="$(mktemp -d)"
  if [ "$kind" = systemd ]; then
    AGENT_USER="$user" AGENT_DIR="$REPO_DIR" TEMPLATE_VARS="AGENT_USER AGENT_DIR" render_template "$KIT_DIR/$AGENT_UNIT.service.tmpl" "$tmp/$AGENT_UNIT.service"
    cp "$KIT_DIR/$AGENT_UNIT.timer" "$tmp/$AGENT_UNIT.timer"
    for file in "$AGENT_UNIT.service" "$AGENT_UNIT.timer"; do
      cmp -s "$tmp/$file" "$SYSTEMD_DIR/$file" && continue
      root_install "$tmp/$file" "$SYSTEMD_DIR/$file" || { rm -rf "$tmp"; warn "Não consegui gravar $SYSTEMD_DIR/$file (precisa de administrador): o agente de atualização não foi agendado. Rode uma vez: $manual"; return 0; }
      changed=1
    done
    rm -rf "$tmp"
    if [ "$changed" = 1 ]; then root_systemctl daemon-reload || true; fi
    if [ "$changed" = 1 ] || ! systemctl is-enabled --quiet "$AGENT_UNIT.timer" 2>/dev/null; then
      root_systemctl enable --now "$AGENT_UNIT.timer" >/dev/null 2>&1 || { warn "Gravei o agendamento do agente de atualização, mas não consegui ligá-lo. Rode uma vez: $manual"; return 0; }
    fi
    ok "Agente de atualização agendado (systemd: $AGENT_UNIT.timer, a cada minuto, como $user)"
  else
    {
      echo "# Gerado pelo instalador do DeskVoice. Não edite: rode bash install/agent.sh --install."
      echo "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
      echo "* * * * * $user bash $KIT_DIR/agent.sh --jitter >/dev/null 2>&1"
    } > "$tmp/$AGENT_UNIT.cron"
    if ! cmp -s "$tmp/$AGENT_UNIT.cron" "$CRON_DIR/$AGENT_UNIT"; then
      root_install "$tmp/$AGENT_UNIT.cron" "$CRON_DIR/$AGENT_UNIT" || { rm -rf "$tmp"; warn "Não consegui gravar $CRON_DIR/$AGENT_UNIT (precisa de administrador): o agente de atualização não foi agendado. Rode uma vez: $manual"; return 0; }
    fi
    rm -rf "$tmp"
    ok "Agente de atualização agendado (cron: $CRON_DIR/$AGENT_UNIT, a cada minuto, como $user)"
  fi
}
# Arquivo de configuração montado como arquivo único: quando a troca de versão (ou a volta) o
# regrava no disco, o contêiner que já estava de pé pode continuar com o antigo. Quem veio da 0.1.0
# (cujo atualizador não reiniciava o Caddy) ficava sem a regra que recusa a rota do agente. Compara
# o CONTEÚDO que o contêiner lê com o do disco (a data do arquivo não serve: depois de um checkout
# ela é a do checkout).
#   mount_differs <serviço> <caminho no contêiner> <arquivo no disco>  →  0 se diferem
mount_differs() { ! dc exec -T "$1" cat "$2" 2>/dev/null | cmp -s - "$3"; }
# O Caddy reinicia só se o Caddyfile que ele lê não é o do disco. Pode rodar quantas vezes for.
converge_caddy() {
  [ -n "$(dc ps -q --status running caddy 2>/dev/null)" ] || return 0
  [ -f "$DEPLOY_DIR/Caddyfile" ] || return 0
  mount_differs caddy /etc/caddy/Caddyfile "$DEPLOY_DIR/Caddyfile" || return 0
  info "Reiniciando o Caddy, para ele ler o Caddyfile desta versão (o painel fica fora por alguns segundos)..."
  dc restart caddy >/dev/null 2>&1 || warn "Não consegui reiniciar o Caddy. Rode: docker restart deskvoice-caddy-1"
}
# Os cinco arquivos que render_asterisk_config grava e o Compose monta um a um. Reiniciar o Asterisk
# derruba as ligações em andamento; recarregar o módulo de cada arquivo, não. Então:
#   - o contêiner ainda lê um arquivo diferente do disco (ficou preso ao inode de antes de uma
#     troca por renomeação, como fazia o kit até esta versão): recarregar relê o antigo, e só
#     reiniciar resolve;
#   - senão, o que render_asterisk_config anotou como mudado é recarregado, módulo a módulo
#     (`module reload` diz o resultado de cada um; `core reload` não diz nada). Se algum não
#     recarregar, reinicia, dizendo por quê.
# Teto conhecido (código do Asterisk 20, res/res_pjsip/config_transport.c): com allow_reload=no, o
# padrão, recarregar o transporte do PJSIP não aplica protocolo, bind, TLS, TCP, ToS e CoS. O
# modelo do kit não muda nenhum deles por instalação; uma versão que mudar precisa reiniciar.
asterisk_module_of() {
  case "$1" in
    extensions.conf) echo pbx_config ;; http.conf) echo http ;; ari.conf) echo res_ari ;;
    rtp.conf) echo res_rtp_asterisk ;; pjsip.conf) echo res_pjsip ;;
  esac
}
restart_asterisk() {  # restart_asterisk "<por quê>"
  info "Reiniciando o Asterisk: $1. Ligações em andamento caem, e as novas ficam sem atendimento por alguns segundos..."
  if dc restart asterisk >/dev/null 2>&1; then rm -f "$ASTERISK_PENDING"
  else warn "Não consegui reiniciar o Asterisk. Rode: docker restart deskvoice-asterisk-1"; fi
}
converge_asterisk() {
  local f stale="" modules="" out wanted reloaded
  # Parado, ele lê o que está no disco quando subir.
  if [ -z "$(dc ps -q --status running asterisk 2>/dev/null)" ]; then rm -f "$ASTERISK_PENDING"; return 0; fi
  for f in extensions http ari rtp pjsip; do
    [ -f "$GENERATED_DIR/$f.conf" ] || continue
    if mount_differs asterisk "/etc/asterisk/$f.conf" "$GENERATED_DIR/$f.conf"; then stale="$f.conf"; break; fi
  done
  if [ -n "$stale" ]; then restart_asterisk "o contêiner ainda lê a versão antiga de $stale, e recarregar não alcança o arquivo novo"; return 0; fi
  [ -s "$ASTERISK_PENDING" ] || { rm -f "$ASTERISK_PENDING"; return 0; }
  while read -r f; do modules="$modules $(asterisk_module_of "$f")"; done < <(sort -u "$ASTERISK_PENDING")
  out="$(dc exec -T asterisk asterisk -rx "module reload$modules" 2>&1 || true)"
  wanted="$(echo "$modules" | wc -w | tr -d ' ')"
  reloaded="$(printf '%s\n' "$out" | grep -c 'reloaded successfully' || true)"
  if [ "$reloaded" = "$wanted" ]; then
    ok "Asterisk com a configuração desta versão ($(sort -u "$ASTERISK_PENDING" | tr '\n' ' ' | sed 's/ $//')), recarregada sem derrubar ligações"
    rm -f "$ASTERISK_PENDING"
  else
    restart_asterisk "recarregar a configuração não deu certo ($(printf '%s' "$out" | tr '\n' ' ' | cut -c1-200))"
  fi
}
# Deixa a instalação pronta para a atualização pela tela: o segredo (e o painel com ele) e o
# agendamento. É o que leva o agente a quem instalou antes de ele existir.
converge_agent() {
  if ensure_agent_token && [ -n "$(dc ps -q --status running panel 2>/dev/null)" ]; then
    info "Recriando só o painel, para ele receber o segredo do agente de atualização (o painel fica fora por alguns segundos)..."
    dc up -d panel >/dev/null 2>&1 || warn "Não consegui recriar o painel. Rode: bash install/install.sh"
  fi
  converge_caddy
  install_agent_schedule
}

# A chave do WAHA nasce em toda instalação (é uma linha no .env), para o serviço poder ser ligado
# pela tela sem recriar ninguém. Quem chegou a esta versão por um atualizador antigo, que não a
# gerou, ganha a chave aqui, e painel, voz e rotinas são recriados para recebê-la.
converge_waha() {
  if ensure_waha && [ -n "$(dc ps -q --status running panel 2>/dev/null)" ]; then
    info "Recriando painel, voz e rotinas, para receberem a chave do serviço de WhatsApp (ficam fora por alguns segundos)..."
    dc up -d >/dev/null 2>&1 || warn "Não consegui recriar os serviços. Rode: bash install/install.sh"
  fi
}

# ── Sem segredo na tela nem em arquivo ───────────────────────────────────────
# Filtro: troca por *** o valor de todo segredo do .env e o que tiver cara de senha,
# chave ou token; encurta e-mail e telefone, que são dado pessoal de quem ligou. E-mail é o que
# termina num rótulo de letras (o TLD): `pacote@1.2.3`, na saída do pnpm, não é e-mail.
SECRET_KEYS="POSTGRES_PASSWORD APP_DB_PASSWORD SYSTEM_DB_PASSWORD DESKVOICE_SECRET_KEY INTERNAL_TOKEN ARI_PASSWORD UPDATE_AGENT_TOKEN WAHA_API_KEY"
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
      -e 's#[A-Za-z0-9._%+-]+@(([A-Za-z0-9-]+\.)+[A-Za-z]{2,})#***@\1#g' \
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
