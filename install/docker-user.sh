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
#     reiniciar o Docker também esvazia a cadeia, e o mesmo serviço é chamado de novo (PartOf);
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
    -h|--help) sed -n '2,29p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    apply|show) [ -z "$VERB" ] || die "Só um comando por vez: recebi '$1' depois de '$VERB'." "Rode: bash install/docker-user.sh --help"
                VERB="$1" ;;
    -*) die "Não conheço a opção $1." "Veja as opções com: bash install/docker-user.sh --help" ;;
    *) [ -n "$VERB" ] || die "Falta o comando antes das portas ('$1')." "Rode: bash install/docker-user.sh apply $1"
       SPECS="$SPECS $1" ;;
  esac
  shift
done
[ -n "$VERB" ] || { sed -n '2,29p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0; }

SUDO=""; if [ "$(id -u)" != 0 ] && have sudo; then SUDO="sudo"; fi
UNIT_NAME="deskvoice-docker-user"
UNIT_FILE="$SYSTEMD_DIR/$UNIT_NAME.service"

for spec in $SPECS; do
  docker_user_spec_valid "$spec" || die "A porta '$spec' não vale." "Use a forma do ufw: 5060/udp, ou uma faixa 10000:10200/udp."
done

have iptables || die "Não achei o comando iptables nesta máquina." "Instale o pacote do iptables (no AlmaLinux: $SUDO dnf install -y iptables) e rode de novo."
if have iptables && ! iptables -w 5 -S DOCKER-USER >/dev/null 2>&1; then
  die "A cadeia DOCKER-USER não existe nesta máquina: quem a cria é o Docker, quando sobe." "Ligue o Docker e rode de novo: $SUDO systemctl start docker"
fi

ipt() { $SUDO iptables -w 5 "$@"; }
rule_args() {  # em RULE: os argumentos da regra de uma porta. O --ctorigdstport é o que enxerga a
               # porta de fora: na DOCKER-USER o pacote já passou pelo DNAT do Docker.
  RULE=(-p "$(printf '%s' "${1#*/}")" -m conntrack --ctorigdstport "$(printf '%s' "${1%/*}")" --ctdir ORIGINAL -j DROP)
}
current_rules() {  # as regras desta máquina na DOCKER-USER, uma por linha
  $SUDO iptables -w 5 -S DOCKER-USER 2>/dev/null | grep -- '--ctorigdstport' || true
}
unit_specs() {  # as portas gravadas no serviço: é a lista que ele repõe no boot
  [ -f "$UNIT_FILE" ] || return 0
  sed -n 's|^ExecStart=.*/docker-user\.sh apply \(.*\)$|\1|p' "$UNIT_FILE"
}
remove_rule() {  # remove_rule <spec>, todas as cópias; a criada à mão pode ter mais de uma
  rule_args "$1"
  while ipt -C DOCKER-USER "${RULE[@]}" >/dev/null 2>&1; do
    ipt -D DOCKER-USER "${RULE[@]}" >/dev/null || break
  done
}
apply_rule() {  # apply_rule <spec>: fecha a porta, uma regra só
  rule_args "$1"
  if ipt -C DOCKER-USER "${RULE[@]}" >/dev/null 2>&1; then
    dim "já estava fechada: $1"
  elif [ "$DRY_RUN_RULE" = 1 ]; then
    info "[simulação] faria: $SUDO iptables -I DOCKER-USER 1 ${RULE[*]}"
  else
    ipt -I DOCKER-USER 1 "${RULE[@]}" >/dev/null || die "Não consegui escrever a regra de $1 na cadeia DOCKER-USER." "Rode à mão: $SUDO iptables -I DOCKER-USER 1 ${RULE[*]}"
    ok "porta fechada: $1"
  fi
}

remove_unit() {
  [ -f "$UNIT_FILE" ] || return 0
  if [ "$DRY_RUN_RULE" = 1 ]; then info "[simulação] faria: apagar $UNIT_FILE e desligar $UNIT_NAME.service"; return 0; fi
  if have systemctl; then $SUDO systemctl disable "$UNIT_NAME.service" >/dev/null 2>&1 || true; fi
  $SUDO rm -f "$UNIT_FILE" || die "Não consegui apagar $UNIT_FILE." "Rode à mão: $SUDO rm -f $UNIT_FILE"
  if have systemctl; then $SUDO systemctl daemon-reload >/dev/null 2>&1 || true; fi
}

install_unit() {  # install_unit <portas...>: o serviço que repõe a regra depois do boot e do Docker
  if [ $# -eq 0 ]; then remove_unit; return 0; fi
  if [ "$DRY_RUN_RULE" = 1 ]; then
    info "[simulação] faria: gravar $UNIT_FILE com 'apply $*' e ligá-lo no boot (systemd)"
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
  root_systemctl enable "$UNIT_NAME.service" >/dev/null 2>&1 || { warn "Gravei $UNIT_FILE, mas não consegui ligá-lo no boot. Rode uma vez: $SUDO systemctl enable $UNIT_NAME.service"; return 0; }
  ok "regra reposta no boot e ao reiniciar o Docker ($UNIT_NAME.service)"
}

case "$VERB" in
  show)
    current_rules | sed 's/^-A DOCKER-USER //' | sed 's/^/  /'
    if [ -f "$UNIT_FILE" ]; then info "no boot, o serviço repõe: $(unit_specs)"; fi
    ;;
  apply)
    # As portas de antes que saíram da lista perdem a regra: o serviço passa a ser a lista nova.
    for old in $(unit_specs); do
      case " $SPECS " in *" $old "*) ;; *) remove_rule "$old"; [ "$DRY_RUN_RULE" = 1 ] || ok "porta reaberta: $old (saiu da lista)";; esac
    done
    for spec in $SPECS; do apply_rule "$spec"; done
    # shellcheck disable=SC2086  # cada porta é um argumento: a lista é separada por espaço de propósito
    install_unit $SPECS
    ;;
esac

[ "$DRY_RUN_RULE" = 1 ] && exit 0
# A conferência é a mesma que o teste usa: uma regra por porta, e a regra está lá.
for spec in $SPECS; do
  rule_args "$spec"
  ipt -C DOCKER-USER "${RULE[@]}" >/dev/null 2>&1 || die "Escrevi a regra de $spec, mas ela não está na cadeia DOCKER-USER." "Rode de novo e, se repetir, veja: $SUDO iptables -S DOCKER-USER"
done
