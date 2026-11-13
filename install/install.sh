#!/usr/bin/env bash
# Instalador do DeskVoice. Pode ser rodado quantas vezes for preciso: ele retoma de onde
# parou e nunca troca um segredo que já existe.
#
#   bash install/install.sh                 pergunta o que precisa
#   bash install/install.sh --dry-run       mostra o que faria, sem alterar nada
#   bash install/install.sh --yes           não pergunta: lê as respostas de variáveis DESKVOICE_*
#   bash install/install.sh --yes --answers respostas.env   ... ou de um arquivo CHAVE=valor
#   --force                                 segue mesmo em sistema fora da lista aceita (o passo 1 a mostra)
#   --build                                 para quem desenvolve: constrói as imagens nesta máquina, a partir
#                                           do código desta pasta, em vez de baixar a versão publicada
#
# A versão instalada é a publicada mais recente, e o número fica gravado em deploy/.env. Enquanto
# o projeto não tiver nenhuma versão publicada, as imagens são construídas nesta máquina.
#
# Respostas aceitas (variável ou linha do arquivo):
#   DESKVOICE_DOMAIN           domínio do painel (HTTPS). Vazio = sem domínio por enquanto: o painel fica só
#                              nesta VPS (127.0.0.1) e você entra por túnel SSH
#   DESKVOICE_ORG_NAME         nome da empresa
#   DESKVOICE_OWNER_NAME       seu nome
#   DESKVOICE_OWNER_EMAIL      seu e-mail (é o login)
#   DESKVOICE_OWNER_PASSWORD   sua senha do painel (10 caracteres ou mais)
#   DESKVOICE_PUBLIC_IP        opcional: IP público, se a descoberta automática falhar
#   DESKVOICE_PANEL_LOCAL_ONLY=yes   opcional, sem domínio: o painel só abre de dentro da VPS (túnel SSH). Já é
#                              o padrão de instalação nova; serve para FECHAR uma instalação publicada por HTTP
#   DESKVOICE_PANEL_PUBLIC_HTTP=yes  opcional, sem domínio: publica o painel na internet por HTTP, SEM HTTPS
#                              (a senha trafega sem criptografia). Só para teste, e só pedindo de propósito
#                              As duas só aceitam o valor yes, e só valem sem domínio: com outro valor, ou
#                              numa instalação com domínio, o instalador para com erro em vez de ignorar
#   DESKVOICE_PANEL_PORT       opcional: a porta local do painel (padrão: 3080 ou a seguinte livre). Só vale
#                              quando o painel sai por uma porta local (sem domínio, ou 80/443 de outro proxy)
#   DESKVOICE_APPLY_UFW=yes    opcional: aplica as regras no firewall ufw sem perguntar. Só aceita yes; com o
#                              ufw inativo, não tem efeito, e o instalador diz
#   DESKVOICE_RTP_START / DESKVOICE_RTP_END   opcional: outra faixa de portas de áudio
#   DESKVOICE_VERSION          opcional: uma versão publicada específica (exemplo: 0.3.0), em vez da mais recente.
#                              Não combina com --build, que constrói o código desta pasta: as duas juntas param com erro
#   DESKVOICE_ADOPT=yes (ou --adopt)  esta pasta passa a ser a da instalação desta máquina, que foi feita a partir
#                              de uma pasta que não existe mais (movida ou de outro usuário). Os dados ficam; antes,
#                              copie para cá os três arquivos de ambiente de deploy/ da pasta antiga
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

ASSUME_YES=0; DRY_RUN=0; FORCE=0; BUILD=0; answers_file=""
while [ $# -gt 0 ]; do
  case "$1" in
    --yes|-y) ASSUME_YES=1 ;;
    --dry-run) DRY_RUN=1 ;;
    --force) FORCE=1 ;;
    --build) BUILD=1 ;;
    --adopt) DESKVOICE_ADOPT=yes ;;
    --answers) answers_file="${2:-}"; shift ;;
    -h|--help) sed -n '2,39p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "Não conheço a opção $1." "Veja as opções com: bash install/install.sh --help" ;;
  esac
  shift
done

if [ -n "$answers_file" ]; then
  [ -f "$answers_file" ] || die "Não achei o arquivo de respostas $answers_file." "Confira o caminho. Cada linha tem o formato DESKVOICE_ALGUMA_COISA=valor."
  # Lido linha a linha, nunca executado: só chaves DESKVOICE_* entram.
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in DESKVOICE_[A-Z_]*=*) export "${line%%=*}=${line#*=}" ;; esac
  done < "$answers_file"
fi

# Opções de exposição do painel: o valor é conferido aqui, em todo modo e antes de qualquer coisa
# ser gravada. Se a opção tem efeito no modo desta máquina é conferido adiante, quando o modo é
# conhecido (domínio, 80/443): opção sem efeito para com erro, nunca é ignorada em silêncio.
for option in DESKVOICE_PANEL_LOCAL_ONLY DESKVOICE_PANEL_PUBLIC_HTTP DESKVOICE_APPLY_UFW DESKVOICE_ADOPT; do
  case "$(printenv "$option" || true)" in
    ""|yes) ;;
    *) die "O valor de $option ($(printenv "$option")) não vale." "O único valor aceito é yes, em minúsculas: $option=yes. Para ficar com o padrão, não defina a variável." ;;
  esac
done
if [ -n "${DESKVOICE_PANEL_LOCAL_ONLY:-}" ] && [ -n "${DESKVOICE_PANEL_PUBLIC_HTTP:-}" ]; then
  die "DESKVOICE_PANEL_LOCAL_ONLY=yes e DESKVOICE_PANEL_PUBLIC_HTTP=yes pedem coisas opostas (painel só nesta VPS, e painel na internet por HTTP)." "Escolha uma das duas e rode de novo."
fi
if [ -n "${DESKVOICE_PANEL_PORT:-}" ]; then
  valid_port "$DESKVOICE_PANEL_PORT" >/dev/null || die "A porta do painel em DESKVOICE_PANEL_PORT ($DESKVOICE_PANEL_PORT) não vale." "Use um número de 1 a 65535, ou não defina a variável."
fi
if [ "$BUILD" = 1 ] && [ -n "${DESKVOICE_VERSION:-}" ]; then
  die "DESKVOICE_VERSION=$DESKVOICE_VERSION e --build pedem coisas diferentes: a primeira, as imagens publicadas dessa versão; a segunda, imagens construídas nesta máquina a partir do código desta pasta." "Escolha um dos dois e rode de novo: tire a variável para construir aqui, ou tire o --build para instalar a versão publicada."
fi
# Antes de qualquer coisa: se já há um DeskVoice nesta máquina, ele tem de ser o desta pasta. A
# exceção é a adoção, pedida de propósito, quando a pasta dona não existe mais.
adopt_from=""
if [ -z "${DESKVOICE_ADOPT:-}" ]; then refuse_foreign_install
else
  adopt_from="$(foreign_install_dir)"
  [ -n "$adopt_from" ] || die "DESKVOICE_ADOPT=yes serve para esta pasta adotar uma instalação feita a partir de uma pasta que não existe mais, e não é o caso: ou não há DeskVoice nesta máquina, ou ele já é o desta pasta." "Rode sem a opção: bash install/install.sh"
  # Com a dona viva, as duas pastas passariam a mandar nos mesmos contêineres.
  [ ! -d "$adopt_from" ] || die "A instalação desta máquina pertence a $adopt_from, que existe: adotá-la daqui deixaria duas pastas mandando nos mesmos contêineres. Nada foi alterado." "Rode a partir de lá: cd $(dirname "$adopt_from") && bash install/install.sh"
  # Os segredos estão nestes arquivos, e a senha do banco está gravada no volume: com segredos
  # gerados de novo aqui, o painel e as migrations não entram no banco que já existe.
  for f in "$ENV_FILE" "$APP_ENV_FILE" "$MIGRATE_ENV_FILE"; do
    [ -f "$f" ] || die "Para adotar a instalação, $f tem de existir nesta pasta, e não existe. Ele precisa ser o da pasta antiga ($adopt_from): com segredos novos, o banco que já existe recusa a conexão. Nada foi alterado." "Copie deploy/.env, deploy/app.env e deploy/migrate.env da pasta antiga (ou do backup dela, ou de onde você a moveu) para $DEPLOY_DIR e rode de novo: DESKVOICE_ADOPT=yes bash install/install.sh"
  done
  ok "Adoção: esta pasta passa a ser a da instalação que foi feita a partir de $adopt_from, que não existe mais"
fi

SUDO=""; if [ "$(id -u)" != 0 ] && have sudo; then SUDO="sudo"; fi
# Como se instala um pacote nesta máquina, para as mensagens de conserto: dnf no AlmaLinux e no Rocky.
pkg_install="${SUDO:+$SUDO }apt-get update && ${SUDO:+$SUDO }apt-get install -y"
if ! have apt-get && have dnf; then pkg_install="${SUDO:+$SUDO }dnf install -y"; fi
# Quem entra por SSH nesta máquina: é o nome que vai no comando do túnel.
ssh_user="${SUDO_USER:-$(id -un)}"
would() { info "[simulação] faria: $*"; }
# Problema que impede uma instalação de verdade. Na simulação vira aviso, para o relatório ir até o fim.
blocker() {
  if [ "$DRY_RUN" = 1 ]; then warn "$1 (na instalação de verdade eu pararia aqui. Conserto: $2)"; else die "$1" "$2"; fi
}
show_logs() {  # últimas linhas do log de uma peça, sem segredo
  printf '\n  Últimas linhas do log de %s:\n' "$1" >&2
  dc logs --no-color --tail 30 "$1" 2>&1 | mask_secrets | sed 's/^/    /' >&2 || true
}
# ask <variável de destino> <variável com a resposta> <pergunta> <validador> [segredo=1]
ask() {
  local dest="$1" source_var="$2" question="$3" validator="$4" secret="${5:-0}" value reason
  value="$(printenv "$source_var" || true)"
  if [ "$ASSUME_YES" = 1 ]; then
    reason="$("$validator" "$value")" || die "A resposta em $source_var não vale: $reason." "Corrija o valor de $source_var e rode de novo."
  else
    while :; do
      if [ "$secret" = 1 ]; then read -r -s -p "  $question: " value || die "Não consegui ler a resposta." "Rode num terminal interativo, ou use --yes com as variáveis DESKVOICE_*."; echo
      else read -r -p "  $question${value:+ [$value]}: " typed || die "Não consegui ler a resposta." "Rode num terminal interativo, ou use --yes com as variáveis DESKVOICE_*."; value="${typed:-$value}"; fi
      if reason="$("$validator" "$value")"; then break; fi
      warn "Não vale: $reason. Tente de novo."
      [ "$secret" = 1 ] || value=""
    done
  fi
  printf -v "$dest" '%s' "$value"
}
owner_exists() {
  local n
  n="$(psql_db "$DB_NAME" 'select count(*) from users' 2>/dev/null || true)"
  [ -n "$n" ] && [ "$n" -gt 0 ] 2>/dev/null
}
ours_running() { [ -f "$ENV_FILE" ] && have docker && [ -n "$(dc ps -q --status running "$1" 2>/dev/null)" ]; }

[ "$DRY_RUN" = 1 ] && printf '%sSIMULAÇÃO: nada será alterado nesta máquina.%s\n' "$C_BLD" "$C_OFF"

# ═════════════════════════════════════════════════════════════════════════════
step "1 de 5 · Conferindo a máquina"
os_id=""; os_version=""
if [ -r /etc/os-release ]; then
  os_id="$(sed -n 's/^ID=//p' /etc/os-release | tr -d '"')"; os_version="$(sed -n 's/^VERSION_ID=//p' /etc/os-release | tr -d '"')"
fi
if os_supported "$os_id" "$os_version"; then ok "Sistema: $os_id $os_version"
elif [ "$FORCE" = 1 ]; then warn "Sistema ${os_id:-desconhecido} ${os_version}: não é testado. Seguindo porque você pediu com --force."
else blocker "Este sistema (${os_id:-$(uname -s)} ${os_version}) não está entre os aceitos: $SUPPORTED_SYSTEMS." "use uma VPS com um deles; para tentar assim mesmo, rode de novo com --force"; fi

arch="$(uname -m)"
if arch_supported "$arch"; then ok "Processador: $arch"
else blocker "O processador desta máquina ($arch) não tem imagem do DeskVoice." "use uma VPS x86_64 (amd64); em ARM de 64 bits (arm64) só construindo aqui, com --build"; fi

if [ -r /proc/meminfo ]; then
  ram_mb="$(awk '/^MemTotal:/ { print int($2 / 1024) }' /proc/meminfo)"
  if [ "$ram_mb" -lt 1900 ]; then warn "Memória: ${ram_mb} MB. Abaixo de 2 GB pode faltar memória se as imagens forem construídas nesta máquina. O menor tamanho em que a instalação cabe ainda não foi medido: ela foi provada numa VPS de 8 GB."
  else ok "Memória: ${ram_mb} MB"; fi
else warn "Não consegui ler a memória desta máquina. O menor tamanho em que a instalação cabe ainda não foi medido: ela foi provada numa VPS de 8 GB."; fi
disk_mb="$(df -Pm "$REPO_DIR" | awk 'NR == 2 { print $4 }')"
if [ "$disk_mb" -lt 10240 ]; then warn "Disco: $((disk_mb / 1024)) GB livres. Abaixo de 10 GB pode faltar espaço para as imagens e os backups."
else ok "Disco: $((disk_mb / 1024)) GB livres"; fi

if ! have docker; then
  warn "O Docker não está instalado."
  if [ "$DRY_RUN" = 1 ]; then would "instalar o Docker pelo script oficial (https://get.docker.com), depois de perguntar"
  elif confirm "Posso instalar o Docker agora, pelo script oficial (get.docker.com)?"; then
    have curl || die "Preciso do curl para baixar o instalador do Docker." "Rode: $pkg_install curl  e depois o instalador de novo."
    curl -fsSL https://get.docker.com | $SUDO sh || die "A instalação do Docker falhou." "Veja a mensagem acima. O guia oficial é https://docs.docker.com/engine/install/ . Depois rode o instalador de novo."
    have docker || die "O instalador do Docker terminou, mas o comando docker não apareceu." "Saia do terminal, entre de novo e rode o instalador outra vez."
    ok "Docker instalado"
  else die "Sem o Docker não dá para instalar." "Instale pelo guia https://docs.docker.com/engine/install/ e rode o instalador de novo."; fi
fi
# O Docker instalado com o serviço desligado (assim veio o docker-ce de uma VPS AlmaLinux em
# 12/11/2026): com systemd e permissão de administrador, liga o serviço e confere de novo.
start_docker_service() {
  [ "$(agent_scheduler)" = systemd ] || return 1
  [ "$(id -u)" = 0 ] || [ -n "$SUDO" ] || return 1
  if [ "$DRY_RUN" = 1 ]; then would "ligar o serviço do Docker, que não respondeu (${SUDO:+$SUDO }systemctl enable --now docker), e conferir de novo"; return 0; fi
  info "O Docker não respondeu. Ligando o serviço dele: ${SUDO:+$SUDO }systemctl enable --now docker"
  $SUDO systemctl enable --now docker >/dev/null 2>&1 && docker info >/dev/null 2>&1
}
if have docker; then
  if ! docker compose version >/dev/null 2>&1; then
    blocker "O Docker está instalado, mas falta o plugin compose." "rode: $pkg_install docker-compose-plugin"
  elif ! docker info >/dev/null 2>&1 && ! start_docker_service; then
    blocker "Seu usuário não consegue falar com o Docker (ou o serviço do Docker está parado)." "rode: $SUDO systemctl start docker ; $SUDO usermod -aG docker $(id -un)  — depois saia do terminal, entre de novo e repita o instalador"
  else ok "Docker e compose: $(docker compose version --short 2>/dev/null || echo ok)"; fi
fi
# SELinux: ele só barra o que os contêineres montam quando o sistema está em Enforcing E o daemon do
# Docker roda com selinux-enabled (o docker-ce vem com isso desligado). Nenhuma instalação foi provada
# assim, e o kit não põe rótulo nas montagens: avisa e segue.
if have getenforce && [ "$(getenforce 2>/dev/null || true)" = Enforcing ] \
  && docker info --format '{{.SecurityOptions}}' 2>/dev/null | grep -q 'name=selinux'; then
  warn "O SELinux está em modo Enforcing e o Docker roda com ele ligado. O DeskVoice nesse modo não foi provado: se um serviço não subir ou não ler a configuração montada, comece o diagnóstico pelo SELinux."
fi

# Que versão esta instalação roda: um número (imagem publicada, nunca construída aqui) ou
# `local` (construída nesta máquina). Nunca um canal: etiqueta móvel não diz o que está rodando.
recorded="$(version_of_tag "$(env_get "$ENV_FILE" DESKVOICE_VERSION)")"
version=""
if [ "$BUILD" = 1 ]; then
  version="$LOCAL_VERSION"
  ok "Versão: as imagens serão construídas nesta máquina, a partir do código desta pasta (--build)"
elif [ -n "${DESKVOICE_VERSION:-}" ]; then
  version="$(version_of_tag "$DESKVOICE_VERSION")"
  is_version "$version" || die "A versão pedida em DESKVOICE_VERSION ($DESKVOICE_VERSION) não vale." "Use o número de uma versão publicada, como 0.3.0."
  ok "Versão: $version (pedida em DESKVOICE_VERSION)"
elif is_version "$recorded"; then
  # Rodar o instalador de novo não troca de versão: isso é trabalho do update.sh, que faz backup.
  version="$recorded"
  ok "Versão: $version (a que esta instalação já usa; para trocar, bash install/update.sh)"
elif ! is_clone; then
  blocker "Não sei qual é a versão publicada mais recente: esta pasta não é um clone do repositório (ou falta o git)." "diga a versão: DESKVOICE_VERSION=<número> bash install/install.sh  — ou baixe pelo comando de uma linha do README, que clona o repositório"
else
  # A simulação não busca nada: lê as versões que o clone já conhece.
  if [ "$DRY_RUN" != 1 ]; then
    fetch_versions || die "Não consegui consultar as versões publicadas do DeskVoice (o git não alcançou o repositório)." "Confira a internet da VPS com: git -C $REPO_DIR fetch --tags origin  — e rode o instalador de novo. Se você já sabe a versão: DESKVOICE_VERSION=<número> bash install/install.sh"
  fi
  version="$(latest_version)"
  if [ -n "$version" ]; then ok "Versão: $version, a publicada mais recente"
  else
    version="$LOCAL_VERSION"
    warn "O DeskVoice ainda não tem nenhuma versão publicada: as imagens serão construídas nesta máquina. Leva alguns minutos e usa bastante processador e memória."
  fi
fi
# Imagem publicada só combina com o código da mesma versão: Compose, Caddyfile e kit da ponta da
# main com imagem de versão anterior é uma combinação que ninguém testou. Quem instala pelo
# comando de uma linha já chega na tag; quem clonou à mão pode estar na main.
if is_version "$version" && is_clone && [ "$DRY_RUN" != 1 ]; then
  tag="$(tag_of_version "$version")"
  if [ "$(git -C "$REPO_DIR" rev-parse HEAD 2>/dev/null)" != "$(git -C "$REPO_DIR" rev-parse "refs/tags/$tag^{commit}" 2>/dev/null)" ]; then
    blocker "O código desta pasta não é o da versão $version, que é a que seria instalada." "vá para a versão e rode de novo: git -C $REPO_DIR checkout $tag && bash install/install.sh  — ou, para rodar o código desta pasta de propósito, construa aqui: bash install/install.sh --build"
  fi
fi
# As imagens publicadas são para x86_64. Em ARM a instalação existe, mas construindo aqui.
if is_version "$version"; then
  case "$arch" in aarch64|arm64) blocker "Ainda não há imagem publicada do DeskVoice para processador ARM ($arch)." "use uma VPS x86_64, ou construa nesta máquina: bash install/install.sh --build" ;; esac
fi
# O Compose dá preferência à variável do terminal sobre o arquivo: as duas têm de dizer o mesmo.
export DESKVOICE_VERSION="$version"

# ═════════════════════════════════════════════════════════════════════════════
step "2 de 5 · Conferindo a rede (é aqui que ligação fica muda)"
rtp_start="${DESKVOICE_RTP_START:-$(env_get "$ENV_FILE" RTP_START)}"; rtp_start="${rtp_start:-10000}"
rtp_end="${DESKVOICE_RTP_END:-$(env_get "$ENV_FILE" RTP_END)}"; rtp_end="${rtp_end:-10200}"
{ valid_port "$rtp_start" && valid_port "$rtp_end"; } >/dev/null && [ "$rtp_start" -lt "$rtp_end" ] \
  || die "A faixa de portas de áudio ($rtp_start a $rtp_end) não vale." "Use dois números de porta, o primeiro menor que o segundo. O padrão é 10000 a 10200."

public_ip="${DESKVOICE_PUBLIC_IP:-}"
if [ -n "$public_ip" ]; then
  reason="$(valid_ipv4 "$public_ip")" || die "O IP informado em DESKVOICE_PUBLIC_IP não vale: $reason." "Corrija e rode de novo."
else
  public_ip="$(discover_public_ip)"
  if [ -z "$public_ip" ]; then
    warn "Não consegui descobrir o IP público sozinho (as consultas externas não responderam)."
    [ "$ASSUME_YES" = 1 ] && die "Sem o IP público o áudio das ligações não chega." "Veja o IP no painel do seu provedor e rode de novo com DESKVOICE_PUBLIC_IP=<o IP>."
    ask public_ip DESKVOICE_PUBLIC_IP "Digite o IP público desta VPS (está no painel do provedor)" valid_ipv4
  fi
fi
if is_private_ipv4 "$public_ip"; then
  warn "O IP $public_ip é de rede interna: a operadora não alcança esse endereço. Confira o IP público no painel do provedor."
fi
local_ip="$(interface_ip)"
case "$(nat_status "$public_ip" "$local_ip")" in
  direct) ok "IP público $public_ip, direto na placa de rede desta máquina" ;;
  nat)
    warn "IP público $public_ip, mas a placa de rede desta máquina tem $local_ip."
    info "Isso quer dizer que a VPS fica atrás de um roteador do provedor (NAT). O DeskVoice já"
    info "anuncia o IP público para a operadora. O que EU NÃO consigo fazer daqui: liberar as"
    info "portas no painel do provedor. Confira lá (firewall / security group) se estão abertas:"
    info "    5060/udp   e   ${rtp_start}-${rtp_end}/udp" ;;
  *) warn "IP público $public_ip. Não consegui ler o IP da placa de rede para saber se há NAT; se houver firewall no painel do provedor, libere 5060/udp e ${rtp_start}-${rtp_end}/udp." ;;
esac

if ours_running asterisk; then
  ok "Portas de telefonia: já estão com o Asterisk do DeskVoice (instalação anterior)"
elif ! have ss; then
  warn "Não consegui conferir se as portas estão livres (comando ss ausente)."
else
  udp_busy="$(udp_ports_in_use)"
  if printf '%s\n' "$udp_busy" | grep -qx 5060; then
    blocker "A porta 5060/udp já está em uso por outro programa nesta máquina (provavelmente outro Asterisk ou PABX)." "descubra quem é com: $SUDO ss -lunp | grep :5060  — pare esse programa e rode o instalador de novo"
  fi
  rtp_busy="$(printf '%s\n' "$udp_busy" | busy_in_range "$rtp_start" "$rtp_end" | tr '\n' ' ')"
  if [ -n "$rtp_busy" ]; then
    blocker "Há portas da faixa de áudio em uso por outro programa: $rtp_busy" "pare esse programa, ou escolha outra faixa: DESKVOICE_RTP_START=20000 DESKVOICE_RTP_END=20200 bash install/install.sh"
  fi
  ok "Portas 5060/udp e ${rtp_start}-${rtp_end}/udp livres nesta máquina"
fi

# 80 e 443: se já são de outro proxy, não brigamos por elas. O nosso Caddy sobe do mesmo jeito,
# só com HTTP, numa porta local única: é por ela que entram o painel e a voz do navegador.
busy80=0; busy443=0; own_caddy=0; proxy_mode=caddy; panel_port=""; panel_bind=""; proxy_holder=""; tcp_busy=""
if ours_running caddy; then own_caddy="$(own_caddy_on_80 1)"; fi
previous_entry="$(published_entry)"
# Como o painel já estava publicado, se já estava: a reinstalação não muda a exposição sozinha.
previous_exposure="$(published_exposure)"
if have ss; then
  tcp_busy="$(tcp_ports_in_use)"
  printf '%s\n' "$tcp_busy" | grep -qx 80 && busy80=1
  printf '%s\n' "$tcp_busy" | grep -qx 443 && busy443=1
  proxy_mode="$(decide_proxy_mode "$busy80" "$busy443" "$own_caddy")"
fi
# A porta local do painel, para os modos em que ele sai por uma porta só (sem domínio, ou 80/443
# de outro proxy). Reinstalação: mantém a que o proxy existente (ou o seu túnel) já conhece.
panel_port="${DESKVOICE_PANEL_PORT:-}"
if [ -z "$panel_port" ] && [ -n "$previous_entry" ]; then panel_port="${previous_entry#* }"; fi
if [ -z "$panel_port" ]; then panel_port="$(printf '%s\n' "$tcp_busy" | pick_free_port 3080)"; fi
valid_port "$panel_port" >/dev/null || die "A porta do painel ($panel_port) não vale." "Use um número de 1 a 65535 em DESKVOICE_PANEL_PORT."
if [ "$proxy_mode" = external ]; then
  if have docker; then proxy_holder="$(docker ps --filter publish=80 --filter publish=443 --format '{{.Names}} ({{.Image}})' 2>/dev/null | grep -v '^deskvoice-' | head -n 1 || true)"; fi
  warn "As portas 80/443 já estão em uso${proxy_holder:+ por $proxy_holder}."
  info "Não vou disputar essas portas: o DeskVoice fica todo atrás de UMA porta local, a $panel_port"
  info "(painel e voz juntos). No fim eu mostro exatamente o que configurar no proxy que já existe."
elif have ss; then
  ok "Portas 80 e 443 disponíveis (o painel só as usa com domínio, para o HTTPS)"
else
  warn "Não consegui conferir se as portas 80 e 443 estão livres (comando ss ausente). Se já houver um proxy nelas, o painel não sobe: instale o pacote iproute2 e rode de novo."
fi

dim "O que foi conferido é esta máquina. Não dá para provar daqui que o provedor deixa o áudio (UDP)"
dim "passar: a prova final é a primeira ligação, pelo teste que fica na tela Linha do painel."

# ═════════════════════════════════════════════════════════════════════════════
step "3 de 5 · Algumas perguntas"
domain_or_empty() { [ -z "$1" ] || valid_domain "$1"; }
[ -n "${DESKVOICE_DOMAIN:-}" ] || DESKVOICE_DOMAIN="$(env_get "$ENV_FILE" PANEL_DOMAIN | grep -v '^:80$' | grep -v '^localhost$' || true)"
export DESKVOICE_DOMAIN
[ "$ASSUME_YES" = 1 ] || info "Domínio do painel (exemplo: voz.suaempresa.com.br). Sem domínio por enquanto? Só aperte Enter."
ask domain DESKVOICE_DOMAIN "Domínio do painel" domain_or_empty
if [ -n "$domain" ] && have getent; then
  resolved="$(getent ahostsv4 "$domain" 2>/dev/null | awk 'NR == 1 { print $1 }' || true)"
  if [ -z "$resolved" ]; then warn "O domínio $domain ainda não aponta para lugar nenhum. Crie no seu provedor de domínio um registro A para $public_ip; o HTTPS só funciona depois disso."
  elif [ "$resolved" != "$public_ip" ]; then warn "O domínio $domain aponta para $resolved, e esta VPS é $public_ip. Se não for um proxy (como Cloudflare), corrija o registro A; o HTTPS depende disso."
  else ok "O domínio $domain aponta para esta VPS"; fi
fi

# login_strict só vira 1 onde o dono é de fato criado, com esta senha: aí, se ela não entrar, é
# defeito. Em qualquer outro caso o dono já existia e a senha pode ser outra: recusa é aviso.
create_owner=1; login_strict=0; org_name=""; owner_name=""; owner_email=""; owner_password=""
if ours_running postgres && owner_exists; then
  create_owner=0
  ok "Já existe um usuário dono nesta instalação: não vou criar outro nem pedir senha."
  # Sem perguntar nada: se o e-mail e a senha vieram nas respostas, servem para conferir o login no
  # fim. A senha pode ter sido trocada pelo painel depois, então recusa aqui é aviso, não erro.
  if [ "$ASSUME_YES" = 1 ] && [ -n "${DESKVOICE_OWNER_EMAIL:-}" ] && [ -n "${DESKVOICE_OWNER_PASSWORD:-}" ]; then
    owner_email="$DESKVOICE_OWNER_EMAIL"; owner_password="$DESKVOICE_OWNER_PASSWORD"
  fi
else
  ask org_name DESKVOICE_ORG_NAME "Nome da empresa" valid_name
  ask owner_name DESKVOICE_OWNER_NAME "Seu nome" valid_name
  ask owner_email DESKVOICE_OWNER_EMAIL "Seu e-mail (vai ser o login do painel)" valid_email
  ask owner_password DESKVOICE_OWNER_PASSWORD "Crie uma senha para o painel (10 caracteres ou mais; não aparece na tela)" valid_password 1
  if [ "$ASSUME_YES" != 1 ]; then
    read -r -s -p "  Repita a senha: " again || again=""; echo
    [ "$again" = "$owner_password" ] || die "As duas senhas não são iguais." "Rode o instalador de novo; o que já foi feito é aproveitado."
  fi
fi

# Só a variável não exportada guarda a senha daqui em diante: nenhum processo filho a herda.
unset DESKVOICE_OWNER_PASSWORD

# ── Como o painel é publicado. Uma decisão só, e é dela que saem o arquivo de publicação, o
#    endereço gravado e a mensagem final. ──
#   domain  com domínio: HTTPS (nas 80/443, ou atrás do proxy que já existe)
#   local   sem domínio: só em 127.0.0.1, numa porta local; entra-se por túnel SSH. É o padrão:
#           sem domínio não há HTTPS, e a tela de entrada não vai para a internet sem conexão segura
#   public  sem domínio: HTTP aberto pelo IP. Só pedindo de propósito, ou mantendo o que já estava
exposure=""; kept_public=0
if [ "$proxy_mode" = external ]; then mode_name="80/443 de outro proxy"; else mode_name="80/443 livres"; fi
if [ -n "$domain" ]; then
  if [ "$proxy_mode" = external ]; then why="o painel já fica só em 127.0.0.1, atrás do proxy que existe nesta máquina, que cuida do HTTPS"
  else why="o painel precisa ser alcançado de fora nas portas 80/443, para o certificado do HTTPS"; fi
  [ -z "${DESKVOICE_PANEL_LOCAL_ONLY:-}" ] || die "DESKVOICE_PANEL_LOCAL_ONLY=yes não tem efeito no modo desta instalação (com o domínio $domain, $mode_name): $why." "Tire a variável e rode de novo. Painel só local é o modo de quem está SEM domínio."
  [ -z "${DESKVOICE_PANEL_PUBLIC_HTTP:-}" ] || die "DESKVOICE_PANEL_PUBLIC_HTTP=yes não tem efeito no modo desta instalação (com o domínio $domain, $mode_name): com domínio o painel abre por HTTPS." "Tire a variável e rode de novo."
  exposure=domain
elif [ -n "${DESKVOICE_PANEL_LOCAL_ONLY:-}" ]; then exposure=local
elif [ -n "${DESKVOICE_PANEL_PUBLIC_HTTP:-}" ]; then exposure=public
elif [ -n "$previous_exposure" ]; then
  exposure="$previous_exposure"
  if [ "$exposure" = public ]; then kept_public=1; fi
elif [ "$ASSUME_YES" = 1 ]; then exposure=local
else
  info "Sem domínio não há HTTPS. O padrão é o painel ficar só nesta VPS, e você entra por túnel SSH (eu mostro o comando no fim)."
  info "A outra opção é publicar o painel na internet por HTTP: a senha trafega SEM CRIPTOGRAFIA, e qualquer um na rede no caminho pode lê-la."
  if confirm "Publicar o painel na internet por HTTP mesmo assim? (Enter = não)"; then exposure=public; else exposure=local; fi
fi
if [ "$proxy_mode" = caddy ] && [ "$exposure" != local ]; then
  # O Caddy fala direto nas 80/443: não há porta local.
  entry_mode=caddy
  if [ -n "$domain" ]; then why="com o domínio $domain"; else why="publicada por HTTP na porta 80"; fi
  [ -z "${DESKVOICE_PANEL_PORT:-}" ] || die "DESKVOICE_PANEL_PORT=$DESKVOICE_PANEL_PORT não tem efeito no modo desta instalação ($mode_name, $why): o painel sai pelas portas 80/443, sem porta local." "Tire a variável e rode de novo."
else
  # Uma porta local única, com o Caddy só em HTTP atrás dela.
  entry_mode=external
fi
case "$exposure" in
  domain)
    panel_domain="$domain"; public_url="https://$domain"; panel_bind="127.0.0.1" ;;
  local)
    panel_domain="localhost"; public_url="http://localhost:$panel_port"; panel_bind="127.0.0.1"
    ok "Sem domínio: o painel fica só nesta VPS (127.0.0.1:$panel_port) e você entra por túnel SSH. A tela de entrada não vai para a internet sem conexão segura."
    info "Para ter HTTPS, aponte um domínio para $public_ip e rode o instalador de novo, informando o domínio." ;;
  public)
    if [ "$entry_mode" = caddy ]; then panel_domain=":80"; public_url="http://$public_ip"
    else panel_domain="localhost"; public_url="http://$public_ip:$panel_port"; panel_bind="0.0.0.0"; fi
    if [ "$kept_public" = 1 ]; then
      warn "ATENÇÃO: esta instalação já publicava o painel na internet por HTTP, SEM HTTPS ($public_url): a senha trafega sem criptografia."
      warn "Mantive como estava, porque o instalador não muda a exposição de quem já instalou. Para fechar o painel e entrar por túnel SSH: DESKVOICE_PANEL_LOCAL_ONLY=yes bash install/install.sh"
    else
      warn "O painel vai ficar na internet por HTTP, SEM HTTPS ($public_url), porque você pediu: a senha trafega sem criptografia. Serve para testar."
    fi
    info "Para uso de verdade, aponte um domínio para $public_ip e rode o instalador de novo, informando o domínio." ;;
esac

ufw_rules="5060/udp ${rtp_start}:${rtp_end}/udp"
[ "$entry_mode" = caddy ] && ufw_rules="$ufw_rules 80/tcp 443/tcp"
# O Docker publica as portas por fora do ufw (medido: docs/fundacao/ufw-e-docker.md). As regras
# abaixo só valem onde quem escuta é o host, e por isso são oferecidas como opcionais: vender a
# regra como proteção daria a quem instala a impressão de que a porta está fechada.
if have ufw && $SUDO ufw status 2>/dev/null | grep -q '^Status: active'; then
  warn "O firewall ufw está ativo, mas ele não filtra as portas que o Docker publica: 5060/udp e ${rtp_start}-${rtp_end}/udp ficam abertas mesmo sem regra nenhuma, e um 'ufw deny' também não as fecha."
  info "Estas regras são opcionais, para o caso de quem escuta ser o host (instalação sem Docker):"
  for rule in $ufw_rules; do info "    $SUDO ufw allow $rule"; done
  if [ "$DRY_RUN" = 1 ]; then would "oferecer aplicar essas regras"
  elif [ "${DESKVOICE_APPLY_UFW:-}" = yes ] || { [ "$ASSUME_YES" != 1 ] && confirm "Aplico essas regras agora?"; }; then
    for rule in $ufw_rules; do $SUDO ufw allow "$rule" >/dev/null || die "Não consegui aplicar a regra $rule no ufw." "Rode à mão: $SUDO ufw allow $rule"; done
    ok "Regras aplicadas no ufw (elas não mudam nada para as portas publicadas pelo Docker)"
  else warn "Regras NÃO aplicadas — e, com o Docker publicando as portas, elas não fariam diferença: não é por falta delas que uma ligação fica muda. Quem filtra de fora é o firewall do provedor da VPS."; fi
elif [ "${DESKVOICE_APPLY_UFW:-}" = yes ]; then
  info "DESKVOICE_APPLY_UFW=yes não teve efeito: o firewall ufw não está ativo nesta máquina, e não há regra a aplicar."
fi
# firewalld (o firewall do AlmaLinux e do Rocky): só avisa. O Docker cria a zona dele no firewalld
# e encaminha as portas publicadas por fora das outras zonas (docs.docker.com, "Integration with
# firewalld"), então um comando firewall-cmd aqui seria receita sem prova. Nenhuma máquina com
# firewalld ativo foi medida; quem mede é a ligação, de fora.
if have firewall-cmd && [ "$($SUDO firewall-cmd --state 2>/dev/null || true)" = running ]; then
  warn "O firewall firewalld está ativo. O DeskVoice com o firewalld ativo não foi provado: nenhuma instalação mediu se as portas 5060/udp e ${rtp_start}-${rtp_end}/udp chegam aos contêineres."
  info "A prova é de fora: a primeira ligação e o teste da tela Linha do painel. Se a ligação não completar ou ficar muda, comece o diagnóstico pelo firewalld."
fi

# ═════════════════════════════════════════════════════════════════════════════
step "4 de 5 · Instalando"
if [ "$DRY_RUN" = 1 ]; then
  would "gravar deploy/.env, deploy/app.env e deploy/migrate.env (permissão 600), gerando só os segredos que ainda não existem"
  would "gerar deploy/asterisk/generated/{ari,rtp,pjsip}.conf com o IP $public_ip e a faixa ${rtp_start}-${rtp_end}"
  if [ "$entry_mode" = external ]; then would "subir o Caddy do DeskVoice só com HTTP em ${panel_bind}:${panel_port}, a única porta publicada: painel e voz do navegador entram por ela (arquivo deploy/docker-compose.override.yml)"
    if [ -n "$domain" ]; then would "pedir que o proxy existente encaminhe ${domain} inteiro para 127.0.0.1:${panel_port}, repassando WebSocket"
    elif [ "$exposure" = local ]; then would "deixar o painel só para dentro da VPS; do seu computador: ssh -L ${panel_port}:127.0.0.1:${panel_port} ${ssh_user}@${public_ip}"
    else would "avisar: pelo IP e sem HTTPS o navegador não libera o microfone; \"Falar com o agente\" pede domínio ou túnel"; fi
  elif [ -n "$domain" ]; then would "subir o Caddy do DeskVoice nas portas 80/443 para ${panel_domain} (painel e voz do navegador pelo mesmo endereço)"
  else would "subir o Caddy do DeskVoice na porta 80, só com HTTP e aberto para a internet (painel e voz do navegador pelo mesmo endereço)"; fi
  if [ "$version" = "$LOCAL_VERSION" ]; then would "construir as imagens do DeskVoice nesta máquina e gravar a versão como \"$LOCAL_VERSION\""
  else would "baixar as imagens da versão ${version:-(a definir)} e gravar esse número em deploy/.env; se elas não baixarem, parar com erro, sem construir aqui"; fi
  if [ -n "$adopt_from" ]; then would "tirar os contêineres criados pela pasta antiga ($adopt_from) e recriá-los a partir desta, com os mesmos volumes (os dados ficam)"; fi
  would "subir o Postgres e aplicar as migrations"
  if [ "$create_owner" = 1 ]; then would "criar a empresa \"$org_name\" e o usuário dono $owner_email"; fi
  would "subir painel, voz, rotinas e Asterisk, e esperar todos responderem"
  would "conferir que o endereço publicado responde e, com a senha do dono em mãos, entrar de verdade pela tela de entrada antes de dizer que está pronto"
  case "$(agent_scheduler)" in
    systemd) would "agendar o agente de atualização (timer do systemd $AGENT_UNIT.timer, uma passada por minuto): é ele que permite atualizar pela tela" ;;
    cron) would "agendar o agente de atualização (uma linha em $CRON_DIR/$AGENT_UNIT, uma passada por minuto): é ele que permite atualizar pela tela" ;;
    *) would "avisar que esta máquina não tem systemd nem cron: sem o agente agendado, a atualização fica só pelo terminal" ;;
  esac
  printf '\n%sSimulação concluída: nada foi alterado.%s Endereço que o painel teria: %s\n' "$C_BLD" "$C_OFF" "$public_url"
  exit 0
fi

write_env_files "$public_url" "$public_ip" "$panel_domain" "$rtp_start" "$rtp_end"
# Entrada única: só o Caddy publica porta. Reescreve por inteiro o arquivo de publicação (o de
# uma versão antiga publicava painel e voz em duas portas), define quantos proxies o painel
# conta até o endereço do visitante e tira VOICE_WEB_PUBLIC_PORT de quem já tinha instalado.
apply_entry "$entry_mode" "$domain" "$panel_bind" "$panel_port"
# O endereço sai do arquivo que acabou de ser gravado: é o que o Compose publica e o que a checagem
# de saúde sonda. Atrás do proxy do operador o endereço de quem usa é o domínio, que depende de um
# passo dele; o que dá para conferir daqui é a porta local.
entry_url="$(published_address "$public_ip")"
if [ "$exposure" = domain ] && [ "$entry_mode" = external ]; then announced_url="$public_url"
else
  announced_url="$entry_url"
  [ "$announced_url" = "$public_url" ] || die "A publicação gravada dá o endereço '${announced_url:-nenhum}', e o decidido era '$public_url'." "Isso é um defeito do instalador, não seu: abra uma issue com esta mensagem. Nada foi iniciado."
fi
probe_url="$(published_probe_url "$public_ip")"
ok "Segredos e configuração gravados em deploy/ (só o seu usuário lê)"
render_asterisk_config
ok "Configuração do Asterisk gerada"

info "Baixando as imagens de apoio (banco, telefonia)..."
# shellcheck disable=SC2086
dc pull -q postgres asterisk caddy \
  || die "Não consegui baixar as imagens do banco, do Asterisk e do Caddy." "Quase sempre é a internet da VPS ou o Docker Hub fora do ar. Teste: docker pull hello-world  — e rode o instalador de novo."
# shellcheck disable=SC2086
if [ "$version" = "$LOCAL_VERSION" ]; then
  # Só dois casos chegam aqui: o projeto ainda não tem versão publicada, ou você pediu --build.
  info "Construindo as imagens do DeskVoice nesta máquina..."
  dc build $APP_SERVICES || die "A construção das imagens falhou." "Veja a mensagem acima. Causas comuns: disco cheio (df -h) ou pouca memória (free -m). Depois rode o instalador de novo."
  ok "Imagens construídas nesta máquina"
elif pull_output="$(dc pull -q $APP_SERVICES 2>&1)"; then ok "Imagens do DeskVoice $version baixadas"
else
  # Versão publicada sem imagem é erro, e não motivo para construir aqui: imagem construída na
  # VPS não é a que foi testada, e nenhuma atualização a troca depois.
  printf '%s\n' "$pull_output" | tail -n 5 | sed 's/^/    /' >&2
  die "Não consegui baixar as imagens da versão $version (resposta do Docker acima). Nada foi instalado nem alterado no que já estava rodando." "Causas prováveis: a internet da VPS ou o ghcr.io fora do ar; ou a versão acabou de sair e as imagens ainda estão sendo publicadas (espere alguns minutos). Teste com: docker pull $(image_ref panel "$version")  — e rode o instalador de novo. Para construir nesta máquina de propósito, a partir do código desta pasta: bash install/install.sh --build"
fi
# Só agora, com as imagens em mãos, a versão é gravada.
env_set "$ENV_FILE" DESKVOICE_VERSION "$version"

if [ -n "$adopt_from" ]; then
  # Os contêineres guardam a pasta de onde foram criados (e, nela, os arquivos montados): só
  # recriados daqui passam a ser desta pasta. O Compose não recria um contêiner cuja configuração
  # não mudou (o do banco), então todos saem antes. Os dados ficam nos volumes do projeto, cujo nome
  # vem do nome fixo do projeto (`name: deskvoice` no docker-compose.yml), e não da pasta: `down`
  # sem -v não os apaga, e os contêineres de daqui os encontram.
  info "Tirando os contêineres criados pela pasta antiga, para recriá-los a partir desta (os dados ficam)..."
  dc down --remove-orphans || die "Não consegui tirar os contêineres criados pela pasta antiga." "Veja a mensagem acima e rode de novo: DESKVOICE_ADOPT=yes bash install/install.sh"
fi
info "Subindo o banco..."
dc up -d --wait postgres || { show_logs postgres; die "O banco (Postgres) não ficou pronto." "Veja o log acima. Causa comum: disco cheio (df -h). Depois rode o instalador de novo."; }
ok "Banco no ar"
info "Aplicando a estrutura do banco..."
dc run --rm migrate || { show_logs migrate; die "As migrations do banco falharam." "Veja o log acima e rode o instalador de novo; se repetir, bash install/diagnose.sh e peça ajuda."; }
ok "Estrutura do banco aplicada"

if [ "$create_owner" = 1 ] && ! owner_exists; then
  # A senha vai pela entrada padrão: nunca aparece em lista de processos nem em log.
  printf '%s' "$owner_password" | dc run --rm -T migrate pnpm --filter @deskvoice/routines run create-owner -- \
      --email "$owner_email" --name "$owner_name" --organization "$org_name" --password-stdin >/dev/null \
    || die "Não consegui criar o usuário dono." "Rode o instalador de novo. Se repetir: bash install/diagnose.sh"
  owner_exists || die "O comando de criar o usuário terminou, mas o usuário não está no banco." "Rode: bash install/diagnose.sh e peça ajuda com o arquivo gerado."
  ok "Empresa e usuário dono criados ($owner_email)"
  login_strict=1
elif [ "$create_owner" = 1 ]; then
  # A instalação estava parada (ou sem os arquivos de ambiente) e o banco já tinha um dono.
  ok "Já existe um usuário dono no banco desta instalação: não criei outro, e a senha dele não mudou."
fi

info "Subindo painel, voz, rotinas e telefonia..."
dc up -d --remove-orphans || die "O Docker não conseguiu subir os serviços." "Veja a mensagem acima; depois confira com bash install/healthcheck.sh e rode o instalador de novo."
# Reinstalação (ou `git pull` seguido do instalador, em instalação construída aqui): o Caddy e o
# Asterisk que já estavam de pé seguem com a configuração antiga. O Caddy reinicia se o Caddyfile
# mudou; o Asterisk recarrega o que mudou (ver converge_asterisk).
converge_caddy
converge_asterisk

timeout="${DESKVOICE_HEALTH_TIMEOUT:-240}"; waited=0
info "Esperando cada peça responder (até ${timeout}s)..."
until NO_COLOR=1 bash "$KIT_DIR/healthcheck.sh" --essential >/dev/null 2>&1; do
  if [ "$waited" -ge "$timeout" ]; then
    report="$(NO_COLOR=1 bash "$KIT_DIR/healthcheck.sh" --essential 2>&1 || true)"
    printf '%s\n' "$report" >&2
    printf '%s\n' "$report" | awk '$1 == "falha" { print $2 }' | while read -r piece; do
      case "$piece" in Banco) show_logs postgres ;; Asterisk) show_logs asterisk ;; Painel) show_logs panel ;; Worker) show_logs voice ;; Rotinas) show_logs routines ;; esac
    done
    die "A instalação subiu, mas nem toda peça respondeu em ${timeout}s (lista acima)." "Espere um minuto e rode bash install/healthcheck.sh. Se a falha continuar, rode bash install/diagnose.sh e peça ajuda com o arquivo."
  fi
  sleep 5; waited=$((waited + 5))
done
ok "Painel, banco, Asterisk, voz e rotinas respondendo"
# O agente de atualização passa a cada minuto: é o que deixa o painel oferecer "atualizar".
install_agent_schedule
# A entrada única é o que você de fato abre: confere antes de anunciar o endereço.
entry_line="$(NO_COLOR=1 bash "$KIT_DIR/healthcheck.sh" 2>/dev/null | grep 'Entrada única' || true)"
if [ "$(printf '%s\n' "$entry_line" | awk '{ print $1 }')" = ok ]; then ok "Entrada única conferida: painel e voz do navegador respondem pelo mesmo endereço"
else
  warn "A entrada única ainda não respondeu como devia:"
  info "${entry_line:-(a checagem não devolveu a linha da entrada)}"
fi

# ── A prova final, pelo caminho de quem usa: a porta publicada responde, e a tela de entrada
#    aceita o usuário. Só depois disso o instalador diz "pronto". ──
outside_down=0   # 1 = o endereço de fora (domínio em HTTPS) não abriu; a porta local responde
reach=""   # 200 = respondeu; vazio = não deu para conferir (sem curl); outro = não respondeu
if have curl; then
  entry_wait="$timeout"; [ "$entry_wait" -le 90 ] || entry_wait=90; waited=0
  while :; do
    reach="$(probe_published "$probe_url")"
    if [ "$reach" = 200 ] || [ "$waited" -ge "$entry_wait" ]; then break; fi
    sleep 5; waited=$((waited + 5))
  done
  if [ "$reach" != 200 ] && [ "$exposure" = domain ] && [ "$entry_mode" = caddy ]; then
    # Quem não respondeu foi o endereço DE FORA. O caso mais comum é o de quem instala com domínio
    # pela primeira vez: o DNS ainda não aponta para cá (ou a VPS não alcança o próprio endereço
    # público). Não é instalação quebrada: confere se o Caddy responde na porta 80 DESTA máquina
    # (com domínio ele redireciona para o HTTPS; qualquer resposta serve) e segue, sem dar o
    # endereço como certo. Só a porta local sem resposta é defeito de verdade.
    local_reach="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 -H "Host: $domain" "http://127.0.0.1/api/v1/system/health" 2>/dev/null || true)"
    case "$local_reach" in
      ""|000) unset owner_password
        die "Tudo foi instalado e as peças respondem, mas o Caddy do DeskVoice não responde nem na porta 80 desta máquina (e $announced_url não abriu; resposta: ${reach:-nenhuma}). Por isso não digo que está pronto, e o login não foi testado." "Veja o que o Caddy diz: docker compose -f deploy/docker-compose.yml logs --tail 50 caddy  — confira com bash install/healthcheck.sh e rode o instalador de novo (nada se perde)." ;;
    esac
    outside_down=1
    warn "O endereço $announced_url ainda NÃO abre (resposta daqui: ${reach:-nenhuma}). O Caddy responde na porta 80 desta máquina, então o que falta é de fora: o domínio, ou o certificado. Sigo, sem dar o endereço como certo."
  elif [ "$reach" != 200 ]; then
    unset owner_password
    die "Tudo foi instalado e as peças respondem, mas a porta publicada do painel ($probe_url) não respondeu nesta máquina (resposta: ${reach:-nenhuma}). Por isso não digo que está pronto, e o login não foi testado." "Veja o que o Caddy diz: docker compose -f deploy/docker-compose.yml logs --tail 50 caddy  — confira com bash install/healthcheck.sh e rode o instalador de novo (nada se perde)."
  else
    ok "Endereço conferido: $probe_url respondeu nesta máquina, pela porta publicada"
  fi
else
  warn "Não conferi a porta publicada do painel: falta o comando curl nesta máquina. O login abaixo é testado por dentro, pelo Caddy."
fi

login_state=skipped
if [ -n "$owner_password" ]; then
  # Uma tentativa só (o painel limita tentativas por e-mail). E-mail e senha seguem pela entrada
  # padrão: nunca em argumento de processo, nunca na tela.
  login_result="$(try_login "$owner_email" "$owner_password")"
  login_state="${login_result%%|*}"; login_detail="${login_result#*|}"
fi
unset owner_password
# Com o endereço de fora sem abrir, o certificado pode não ter saído ainda, e aí nem por dentro a
# sonda chega à tela de entrada. Isso é consequência do mesmo problema, e não outro defeito.
if [ "$outside_down" = 1 ] && [ "$login_state" != ok ] && [ "$login_state" != rejected ] && [ "$login_state" != session ] && [ "$login_state" != limited ] && [ "$login_state" != skipped ]; then
  warn "Login NÃO testado: sem o certificado do HTTPS, a tela de entrada ainda não responde nem por dentro (${login_result:-sem resposta da sonda}). Depois que o endereço abrir, entre pelo navegador."
  login_state=untested
fi
login_fix="Troque a senha com: bash install/reset-password.sh ${owner_email:-<e-mail>}  — e entre em $announced_url. Se não entrar, rode bash install/diagnose.sh e peça ajuda com o arquivo."
case "$login_state" in
  ok) ok "Login conferido: entrei pela tela de entrada com o e-mail $owner_email e a senha informada, a sessão valeu, e saí" ;;
  skipped) warn "Login NÃO testado: o usuário dono já existia e eu não tenho a senha dele. Se não lembrar a senha: bash install/reset-password.sh" ;;
  limited) warn "Login NÃO testado: o painel está no limite de tentativas de entrada para $owner_email (senhas erradas recentes: o painel segura o endereço de onde vieram por até 15 minutos, e o e-mail inteiro por até uma hora quando vieram muitas, de vários lugares). Espere e entre pelo navegador." ;;
  rejected)
    if [ "$login_strict" = 1 ]; then
      die "O usuário dono foi criado, mas a tela de entrada RECUSOU o e-mail e a senha que acabaram de ser definidos (HTTP $login_detail). A instalação subiu; o que não funciona é entrar." "$login_fix"
    fi
    warn "Login NÃO conferido: a tela de entrada recusou a senha informada para $owner_email. O usuário já existia, e a senha pode ter sido trocada depois. Se não lembrar: bash install/reset-password.sh $owner_email" ;;
  untested) ;;
  session) die "A tela de entrada aceitou o e-mail e a senha, mas a sessão não valeu na rota seguinte (HTTP $login_detail): quem entrar volta para a tela de login." "Rode bash install/diagnose.sh e abra uma issue com o arquivo, dizendo que o login foi aceito e a sessão não valeu." ;;
  *) die "Não consegui chegar à tela de entrada pelo Caddy do DeskVoice para testar o login (${login_result:-sem resposta da sonda})." "Confira com bash install/healthcheck.sh (linha \"Entrada única\") e rode o instalador de novo. Se repetir: bash install/diagnose.sh" ;;
esac

# ═════════════════════════════════════════════════════════════════════════════
if [ "$outside_down" = 1 ]; then step "5 de 5 · Instalado; o endereço ainda não abre"
elif [ "$login_state" = ok ]; then step "5 de 5 · Pronto para configurar"
else step "5 de 5 · Instalado, com o login ainda por conferir (aviso acima)"; fi
if [ "$outside_down" = 1 ]; then
  printf '\n  %sPainel:%s %s  (ainda NÃO abre: veja abaixo)\n  Login:  o e-mail e a senha que você definiu aqui\n' "$C_BLD" "$C_OFF" "$announced_url"
  printf '\n  %sO que falta para o endereço abrir%s:\n' "$C_BLD" "$C_OFF"
  info "A instalação terminou e as peças respondem nesta máquina. O que não respondeu foi o endereço de fora."
  info "Causa mais provável: o domínio $domain ainda não aponta para $public_ip (registro A no provedor do domínio)."
  info "Sem isso o certificado do HTTPS não sai. Depois de criar ou corrigir o registro, a propagação leva de minutos a algumas horas."
  info "Outra causa: as portas 80 e 443 fechadas no firewall da VPS ou no painel do provedor; ou esta VPS não alcança o próprio"
  info "endereço público, e nesse caso o painel pode já abrir do seu computador: teste $announced_url no navegador."
  info "Não precisa instalar de novo. O Caddy tenta o certificado sozinho; para conferir: bash install/healthcheck.sh (linha \"Entrada única\")."
  info "O motivo exato está em: docker compose -f deploy/docker-compose.yml logs --tail 50 caddy"
else
  printf '\n  %sPainel:%s %s\n  Login:  o e-mail e a senha que você definiu aqui\n' "$C_BLD" "$C_OFF" "$announced_url"
fi
if [ "$exposure" = domain ] && [ "$entry_mode" = external ]; then
  info "Este endereço só vale depois do passo abaixo, no seu proxy: daqui eu conferi até a porta local 127.0.0.1:${panel_port}."
elif [ "$exposure" = public ]; then
  info "Conferido de dentro desta máquina. De fora, depende de a porta estar liberada no firewall da VPS e do provedor."
fi
tunnel_port="$panel_port"; tunnel_local="$panel_port"
if [ "$entry_mode" = caddy ]; then tunnel_port=80; tunnel_local=8080; fi
if [ "$exposure" = domain ] && [ "$entry_mode" = external ]; then
  printf '\n  %sFalta um passo seu, no proxy que já existe nesta máquina%s%s:\n' "$C_BLD" "${proxy_holder:+ ($proxy_holder)}" "$C_OFF"
  info "Encaminhe o domínio $domain INTEIRO para uma porta só: 127.0.0.1:${panel_port}. Painel e voz entram por ela."
  info "O proxy precisa repassar conexões contínuas (WebSocket), senão o painel abre e \"Falar com o agente\" não conecta."
  info "• Nginx instalado na máquina:   location / { proxy_pass http://127.0.0.1:${panel_port}; proxy_http_version 1.1; proxy_set_header Upgrade \$http_upgrade; proxy_set_header Connection \"upgrade\"; proxy_set_header Host \$host; proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for; proxy_set_header X-Forwarded-Proto \$scheme; proxy_buffering off; }"
  info "• Caddy instalado na máquina:   $domain { reverse_proxy 127.0.0.1:${panel_port} { flush_interval -1 } }   (WebSocket e X-Forwarded-For ele já repassa)"
  info "• Proxy em contêiner (Traefik, Nginx Proxy Manager, Caddy): docker network connect deskvoice_internal <contêiner do proxy>  e aponte $domain para  http://deskvoice-caddy-1:80  com WebSocket ligado (X-Forwarded-For ele já envia). Se o contêiner do proxy for recriado, repita o comando."
  info "Se o proxy antigo tinha uma regra separada para /voice-ws, apague-a: agora é tudo no mesmo destino."
elif [ "$exposure" = local ]; then
  printf '\n  %sComo abrir o painel%s:\n' "$C_BLD" "$C_OFF"
  info "Sem domínio, o painel só abre de dentro desta VPS: a tela de entrada não fica na internet sem HTTPS."
  info "Do seu computador, abra um túnel (uma porta só):"
  info "    ssh -L ${panel_port}:127.0.0.1:${panel_port} ${ssh_user}@${public_ip}"
  info "e acesse $announced_url enquanto o túnel estiver aberto. \"Falar com o agente\" funciona por ele."
  info "Para ter HTTPS e abrir de qualquer lugar: aponte um domínio (registro A) para $public_ip e rode"
  info "    DESKVOICE_DOMAIN=<seu domínio> bash install/install.sh"
  info "Publicar por HTTP pelo IP, sem domínio, só pedindo de propósito (a senha trafega sem criptografia):"
  info "    DESKVOICE_PANEL_PUBLIC_HTTP=yes bash install/install.sh"
elif [ "$exposure" = public ]; then
  printf '\n  %sSobre o acesso%s:\n' "$C_BLD" "$C_OFF"
  info "Sem domínio, o painel ficou na internet em $announced_url, SEM HTTPS: a senha trafega sem criptografia."
  if [ "$entry_mode" = external ]; then info "Libere a porta ${panel_port}/tcp no firewall."; fi
  info "Para fechar o painel e entrar por túnel SSH: DESKVOICE_PANEL_LOCAL_ONLY=yes bash install/install.sh"
  info "Para ter HTTPS: aponte um domínio para $public_ip e rode DESKVOICE_DOMAIN=<seu domínio> bash install/install.sh"
  info "Atenção: pelo IP e sem HTTPS o navegador não libera o microfone. \"Falar com o agente\" só funciona"
  info "com domínio (HTTPS) ou por túnel SSH (ssh -L ${tunnel_local}:127.0.0.1:${tunnel_port} ${ssh_user}@${public_ip}), abrindo http://localhost:${tunnel_local}."
fi
printf '\n  %sJá funciona:%s painel, banco, Asterisk esperando ligação, worker de voz e rotinas.\n' "$C_BLD" "$C_OFF"
printf '  %sAinda não funciona, até você configurar no painel:%s atender ligação.\n' "$C_BLD" "$C_OFF"
printf '\n  %sPara ver funcionando agora, sem chave nem operadora:%s na tela Chamadas, clique em "Simular uma chamada".\n' "$C_BLD" "$C_OFF"
printf '\n  %sPróximos quatro passos para atender ligação de verdade, todos pela tela:%s\n' "$C_BLD" "$C_OFF"
info "1. Configurações → Inteligência artificial: cole a chave do Gemini ou da OpenAI."
info "2. Agentes → Recepção: troque o motor de voz de \"Simulado\" para o que você configurou."
info "   O agente de exemplo nasce no motor simulado, que serve para demonstração e não fala com ninguém."
info "3. Linha: cadastre o tronco SIP e o número que a operadora te passou."
info "4. Faça a primeira ligação para o número e acompanhe na tela Chamadas. É ela que prova que o áudio passa."
printf '\n  Conferir a saúde:  bash install/healthcheck.sh\n  Pedir ajuda:       bash install/diagnose.sh   (gera um arquivo sem senhas para você enviar)\n'
# Quem chegou aqui já tem servidor: nenhuma oferta. No máximo uma linha, e só com certeza de que a
# máquina é de outro provedor. O endereço vem de partner.env.
partner_url="$(partner_value PARTNER_URL)"
if [ -n "$partner_url" ] && partner_hint_allowed "$(cat /sys/class/dmi/id/sys_vendor 2>/dev/null || true)"; then
  dim "Se um dia for trocar de VPS: a recomendada pelo projeto é a da $(partner_value PARTNER_NAME), por link de parceria, que apoia o projeto: $partner_url"
fi
