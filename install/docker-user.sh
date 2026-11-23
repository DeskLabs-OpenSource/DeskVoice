#!/usr/bin/env bash
# A regra da cadeia DOCKER-USER: é ela que decide o que entra numa porta que o Docker publica.
# Nem o ufw nem o firewalld filtram essas portas — medido de fora, ver docs/fundacao/ufw-e-docker.md.
#
#   bash install/docker-user.sh apply 5060/udp        fecha a porta 5060/udp e deixa a regra de pé
#   bash install/docker-user.sh apply 5060/udp 10000:10200/udp
#   bash install/docker-user.sh apply                 tira as regras e a persistência, sem fechar nada
#   bash install/docker-user.sh show                  lista as regras desta máquina na DOCKER-USER
#   --dry-run                                         mostra o que faria, sem alterar nada
#
# A forma da porta é a mesma do ufw: `porta` ou `min:max`, seguida de `/tcp` ou `/udp`.
#
# Duas coisas que a regra criada à mão não tem, e esta tem (medido em 15/11/2026, issue #142):
#   - ela volta sozinha depois de reiniciar a máquina: a cadeia DOCKER-USER nasce vazia no boot, e
#     um serviço do systemd (deskvoice-docker-user.service) roda depois do Docker e a recria;
#     o mesmo serviço roda de novo a cada reinício do Docker (PartOf). Se esse reinício esvazia a
#     cadeia depende do Docker (o 29.9.3 não esvaziou, medido em 18/11/2026): nos dois casos, o
#     serviço só repõe o que falta;
#   - rodar duas vezes não duplica nada: cada porta tem uma regra só, conferida antes de inserir.
#
# Fechar 5060/udp deixa a telefonia muda: quem fecha a porta é quem sabe de onde vêm as ligações
# (o provedor SIP). Por isso nada aqui é automático no instalador sem a variável
# DESKVOICE_DOCKER_USER_DROP, e nada é fechado por padrão.
#
# IPv6 fica de fora de propósito: nenhuma sonda externa do projeto usou IPv6 até hoje, e o script
# não fecha o que não foi medido (issue #142).
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

DRY_RUN_RULE=0
VERB=""; SPECS=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN_RULE=1 ;;
    -h|--help) sed -n '2,26p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    apply|show) [ -z "$VERB" ] || die "Só um comando por vez: recebi '$1' depois de '$VERB'." "Rode: bash install/docker-user.sh --help"
                VERB="$1" ;;
    -*) die "Não conheço a opção $1." "Veja as opções com: bash install/docker-user.sh --help" ;;
    *) [ -n "$VERB" ] || die "Falta o comando antes das portas ('$1')." "Rode: bash install/docker-user.sh apply $1"
       SPECS="$SPECS $1" ;;
  esac
  shift
done
[ -n "$VERB" ] || { sed -n '2,26p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0; }

SUDO=""; if [ "$(id -u)" != 0 ] && have sudo; then SUDO="sudo"; fi
UNIT_NAME="deskvoice-docker-user"
UNIT_FILE="$DOCKER_USER_UNIT_FILE"

for spec in $SPECS; do
  docker_user_spec_valid "$spec" || die "A porta '$spec' não vale." "Use a forma do ufw: 5060/udp, ou uma faixa 10000:10200/udp."
done

ipt() { $SUDO iptables -w 5 "$@"; }
# As duas conferências usam o mesmo privilégio da escrita: sem root, o iptables recusa até ler a
# cadeia, e no Debian ele mora em /usr/sbin, que só entra no PATH pelo sudo.
$SUDO sh -c 'command -v iptables' >/dev/null 2>&1 || die "Não achei o comando iptables nesta máquina." "Instale o pacote do iptables (no AlmaLinux: $SUDO dnf install -y iptables) e rode de novo."
ipt -S DOCKER-USER >/dev/null 2>&1 || die "A cadeia DOCKER-USER não existe nesta máquina: quem a cria é o Docker, quando sobe." "Ligue o Docker e rode de novo: $SUDO systemctl start docker"

# Uma porta tem uma regra por família de ponte do Docker (docker0 e as br-* das redes do Compose),
# em RULE: a que barra o que é roteado para dentro da ponte (-o). O que chega de fora a um contêiner,
# pelo DNAT da porta publicada ou roteado direto ao IP dele, sai pela ponte, venha pela interface que
# vier: nenhuma isenção depende do nome da interface de entrada, e uma ponte do host chamada br-algo
# não abre caminho. A conexão que o contêiner abre para fora sai pela interface de fora, e a resposta
# dela volta na direção REPLY: nenhuma das duas casa (fechar 5061/tcp não corta o SIP-TLS do Asterisk
# para a operadora). O tráfego entre contêineres da mesma rede não é roteado, é passado de porta a
# porta da ponte, e o ! --physdev-is-bridged o deixa de fora. O que fica sem cobertura é uma ponte do
# Docker com nome escolhido à mão (fora de docker* e br-*); a do Compose do DeskVoice não escolhe nome.
# Com o userland-proxy desligado, a conexão de um contêiner ao IP público desta máquina na porta
# fechada (hairpin) também é barrada: falha fechada, não abre entrada (não medido).
# O -m physdev carrega o br_netfilter (xt_physdev, também pelo iptables-nft), se ele ainda não
# estiver carregado, com bridge-nf-call-iptables=1, e o apply sem portas não o descarrega (medido em
# 18/11/2026): o tráfego de ponte de todos os contêineres passa a atravessar a FORWARD e o conntrack
# até o reboot, e o serviço o carrega de novo no boot. Numa VPS só do DeskVoice a checagem de saúde
# ficou igual com ele (medido). Numa máquina com outra ponte que não é do Docker (libvirt, LXD), o
# tráfego entre as máquinas dela passa a cair na política da FORWARD, que o Docker deixa em DROP, e
# pode parar (não medido). O physdev fica porque, sem ele, com o módulo carregado, a regra barraria o
# tráfego entre contêineres da mesma rede na porta; com ele, esse tráfego passou (medido em TCP).
# Para descarregar o módulo à mão: rmmod br_netfilter, ou reiniciar. Nunca modprobe -r br_netfilter:
# ele descarrega também o bridge e derruba as redes do Docker até um systemctl restart docker (medido).
# O que foi e o que não foi medido está em docs/fundacao/ufw-e-docker.md.
# O --ctorigdstport enxerga a porta de fora: na DOCKER-USER o pacote já passou pelo DNAT do Docker.
# Em LEGACY, a forma de antes (sem as interfaces), que o kit troca onde a achar.
BRIDGES="docker+ br-+"
rule_args() {  # rule_args <spec> <ponte>
  local proto="${1#*/}" port="${1%/*}"
  RULE=(-o "$2" -p "$proto" -m physdev ! --physdev-is-bridged -m conntrack --ctorigdstport "$port" --ctdir ORIGINAL -j DROP)
  LEGACY=(-p "$proto" -m conntrack --ctorigdstport "$port" --ctdir ORIGINAL -j DROP)
}
current_rules() {  # as regras desta máquina na DOCKER-USER, uma por linha
  $SUDO iptables -w 5 -S DOCKER-USER 2>/dev/null | grep -- '--ctorigdstport' || true
}
delete_all() {  # delete_all <regra...>: todas as cópias; a criada à mão pode ter mais de uma
  while ipt -C DOCKER-USER "$@" >/dev/null 2>&1; do
    ipt -D DOCKER-USER "$@" >/dev/null || break
  done
}
remove_rule() {  # remove_rule <spec>: as regras da porta, e a da forma antiga
  local bridge
  for bridge in $BRIDGES; do rule_args "$1" "$bridge"; delete_all "${RULE[@]}"; done
  delete_all "${LEGACY[@]}"
}
apply_rule() {  # apply_rule <spec>: fecha a porta, uma regra por ponte
  local bridge missing=0
  for bridge in $BRIDGES; do
    rule_args "$1" "$bridge"
    ipt -C DOCKER-USER "${RULE[@]}" >/dev/null 2>&1 && continue
    missing=1
    if [ "$DRY_RUN_RULE" = 1 ]; then info "[simulação] faria: $SUDO iptables -I DOCKER-USER 1 ${RULE[*]}"
    else ipt -I DOCKER-USER 1 "${RULE[@]}" >/dev/null || die "Não consegui escrever a regra de $1 na cadeia DOCKER-USER." "Rode à mão: $SUDO iptables -I DOCKER-USER 1 ${RULE[*]}"; fi
  done
  if [ "$missing" = 0 ]; then dim "já estava fechada: $1"
  elif [ "$DRY_RUN_RULE" != 1 ]; then ok "porta fechada: $1"; fi
  # A forma antiga sai depois de a nova estar escrita: a porta não fica aberta entre as duas. Ela
  # pode ter sido escrita à mão (a documentação ensinava essa), e a nova não barra tudo o que ela
  # barrava: por isso a troca é dita, nunca calada.
  ipt -C DOCKER-USER "${LEGACY[@]}" >/dev/null 2>&1 || return 0
  if [ "$DRY_RUN_RULE" = 1 ]; then
    info "[simulação] faria: trocar a regra antiga de $1 (${LEGACY[*]}) pela nova"
  else
    delete_all "${LEGACY[@]}"
    warn "Troquei a regra antiga de $1 (${LEGACY[*]}) pela nova. A antiga também barrava a conexão que um contêiner abre para fora com destino a essa porta e o tráfego entre contêineres da mesma rede; a nova só barra o que é roteado para dentro de uma ponte do Docker (docker0, br-*)."
  fi
}

remove_unit() {
  [ -f "$UNIT_FILE" ] || return 0
  if [ "$DRY_RUN_RULE" = 1 ]; then info "[simulação] faria: desligar e parar $UNIT_NAME.service e apagar $UNIT_FILE"; return 0; fi
  # Desligar e parar antes de apagar: depois do rm, a unidade ficaria na memória do systemd como
  # "active (exited)", com o arquivo não encontrado, até o próximo boot.
  if have systemctl; then $SUDO systemctl disable --now "$UNIT_NAME.service" >/dev/null 2>&1 || true; fi
  $SUDO rm -f "$UNIT_FILE" || die "Não consegui apagar $UNIT_FILE." "Rode à mão: $SUDO rm -f $UNIT_FILE"
  if have systemctl; then $SUDO systemctl daemon-reload >/dev/null 2>&1 || true; fi
}

install_unit() {  # install_unit <portas...>: o serviço que repõe a regra depois do boot e do Docker
  if [ $# -eq 0 ]; then remove_unit; return 0; fi
  if [ "$DRY_RUN_RULE" = 1 ]; then
    info "[simulação] faria: gravar $UNIT_FILE com 'apply $*' e ligá-lo agora e no boot (systemctl enable --now)"
    return 0
  fi
  if ! { have systemctl && [ -d "$SYSTEMD_RUN_DIR" ]; }; then
    warn "Esta máquina não tem systemd: a regra vale até o próximo reinício, e o comando para repor é: bash $KIT_DIR/docker-user.sh apply $*"
    return 0
  fi
  # O caminho entra num arquivo de unidade, sem aspas.
  case "$KIT_DIR" in *[!A-Za-z0-9_./-]*)
    warn "O caminho desta instalação ($KIT_DIR) tem espaço ou caractere especial, e a regra não foi agendada: depois de reiniciar, reponha com bash $KIT_DIR/docker-user.sh apply $*"
    return 0 ;;
  esac
  local tmp
  tmp="$(mktemp)"
  DOCKER_USER_SCRIPT="$KIT_DIR/docker-user.sh" DOCKER_USER_PORTS="$*" TEMPLATE_VARS="DOCKER_USER_SCRIPT DOCKER_USER_PORTS" \
    render_template "$KIT_DIR/$UNIT_NAME.service.tmpl" "$tmp"
  if ! cmp -s "$tmp" "$UNIT_FILE"; then
    root_install "$tmp" "$UNIT_FILE" || { rm -f "$tmp"; warn "Não consegui gravar $UNIT_FILE (precisa de administrador): a regra vale até o próximo reinício. Rode uma vez: $SUDO bash $KIT_DIR/docker-user.sh apply $*"; return 0; }
    root_systemctl daemon-reload >/dev/null 2>&1 || true
  fi
  rm -f "$tmp"
  # --now: o PartOf só chama de novo uma unidade ativa; sem ele, entre o apply e o boot, um reinício do
  # Docker não chamaria o serviço. --no-block é obrigatório: o próprio serviço roda este script e chega
  # aqui, e um start da unidade de dentro do ExecStart dela esperaria por ele mesmo (oneshot, sem
  # prazo), travando o boot. Com ele, o pedido entra na fila do systemd e o script segue.
  # A corrida do serviço rodando enquanto este apply termina é benigna: todas as regras já estão
  # escritas, e ele só confere ("já estava fechada").
  root_systemctl enable --now --no-block "$UNIT_NAME.service" >/dev/null 2>&1 || { warn "Gravei $UNIT_FILE, mas não consegui ligá-lo. Rode uma vez: $SUDO systemctl enable --now $UNIT_NAME.service"; return 0; }
  ok "regra reposta no boot e ao reiniciar o Docker ($UNIT_NAME.service)"
}

case "$VERB" in
  show)
    current_rules | sed 's/^-A DOCKER-USER //' | sed 's/^/  /'
    if [ -f "$UNIT_FILE" ]; then info "no boot, o serviço repõe: $(docker_user_unit_specs)"; fi
    ;;
  apply)
    # As portas de antes que saíram da lista perdem a regra: o serviço passa a ser a lista nova.
    for old in $(docker_user_unit_specs); do
      case " $SPECS " in *" $old "*) continue ;; esac
      if [ "$DRY_RUN_RULE" = 1 ]; then info "[simulação] faria: reabrir $old (saiu da lista)"
      else remove_rule "$old"; ok "porta reaberta: $old (saiu da lista)"; fi
    done
    for spec in $SPECS; do apply_rule "$spec"; done
    # shellcheck disable=SC2086  # cada porta é um argumento: a lista é separada por espaço de propósito
    install_unit $SPECS
    ;;
esac

[ "$DRY_RUN_RULE" = 1 ] && exit 0
# A conferência é a mesma que o teste usa: as regras de cada porta estão lá.
for spec in $SPECS; do for bridge in $BRIDGES; do
  rule_args "$spec" "$bridge"
  ipt -C DOCKER-USER "${RULE[@]}" >/dev/null 2>&1 || die "Escrevi a regra de $spec, mas ela não está na cadeia DOCKER-USER." "Rode de novo e, se repetir, veja: $SUDO iptables -S DOCKER-USER"
done; done
