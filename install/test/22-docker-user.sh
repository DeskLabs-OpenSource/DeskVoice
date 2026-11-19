#!/usr/bin/env bash
# A regra da cadeia DOCKER-USER (issue #142): uma regra por porta, e ela volta depois do boot, que
# recria a cadeia vazia, e do reinício do Docker, se ele a esvaziar (o 29.9.3 não esvaziou). O reload do
# firewalld não a apaga (medido em 15/11/2026), então o caso do reload aqui é o de depois dele: a
# cadeia ainda tem a regra, e aplicar de novo não duplica.
# O iptables e o systemctl são de mentira: o teste não toca no firewall nem no systemd da máquina.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
source "$KIT/_common.sh"; set +e; trap - ERR
UNIT="$DESKVOICE_SYSTEMD_DIR/deskvoice-docker-user.service"
STATE="$FAKE_DIR/iptables_DOCKER-USER"
# Cada porta tem duas regras, uma por família de ponte do Docker (docker0 e as br-* do Compose).
rules() { if [ -f "$STATE" ]; then grep -c -- '--ctorigdstport' "$STATE" || true; else echo 0; fi; }
calls() { grep -c -- "$1" "$FAKE_DIR/calls.log"; }
tool() { bash "$KIT/docker-user.sh" "$@" 2>&1; }
# O que as regras da cadeia fazem com um pacote, lido das próprias regras: o iptables de mentira só
# guarda texto, e é aqui que a direção é posta à prova. Entende só o que o kit escreve; o resto para.
#   drops <entra por> <sai por> <passado na ponte: sim|nao> <proto> <porta de destino original>
iface_is() { case "$2" in "${1%+}"*) [ "${1%+}" != "$1" ] || [ "$1" = "$2" ] ;; *) return 1 ;; esac; }
drops() {
  local in="$1" out="$2" bridged="$3" proto="$4" port="$5" line neg hit t
  [ -f "$STATE" ] || return 1
  while IFS= read -r line; do
    # shellcheck disable=SC2086  # a regra se divide em palavras de propósito; o set -f evita curinga
    set -f; set -- $line; set +f
    neg=0; hit=1
    while [ $# -gt 0 ]; do
      t=1
      case "$1" in
        '!') neg=1; shift; continue ;;
        -i) iface_is "$2" "$in" || t=0; shift ;;
        -o) iface_is "$2" "$out" || t=0; shift ;;
        -p) [ "$2" = "$proto" ] || t=0; shift ;;
        --physdev-is-bridged) [ "$bridged" = sim ] || t=0 ;;
        --ctorigdstport) [ "$port" -ge "${2%:*}" ] && [ "$port" -le "${2#*:}" ] || t=0; shift ;;
        --ctdir) [ "$2" = ORIGINAL ] || t=0; shift ;;
        -m|-j) shift ;;
        *) echo "drops: não entendo '$1'" >&2; return 2 ;;
      esac
      if [ "$neg" = 1 ]; then t=$((1 - t)); neg=0; fi
      [ "$t" = 1 ] || hit=0
      shift
    done
    [ "$hit" = 0 ] || return 0
  done < "$STATE"
  return 1
}
boot() {  # o que o systemd faz no boot: roda o ExecStart do serviço gravado
  local line; line="$(sed -n 's/^ExecStart=//p' "$UNIT")"
  [ -n "$line" ] || { echo "sem ExecStart em $UNIT"; return 1; }
  eval "$line" 2>&1
}

# ── Aplicar fecha a porta, e aplicar de novo não duplica ──
: > "$FAKE_DIR/calls.log"
out="$(tool apply 5060/udp)"; equal "apply: sai com zero" 0 "$?"
equal "apply: duas regras, uma por ponte" 2 "$(rules)"
contains "apply: diz que fechou" "$out" "porta fechada: 5060/udp"
# A direção: o que chega de fora é barrado venha pela interface que vier, inclusive por uma ponte do
# host chamada br-host, que não é do Docker; o que o contêiner abre para fora, e o que passa entre
# contêineres da mesma rede, não. br-0123456789ab é a ponte de uma rede do Compose.
check "direção: de fora pela eth0 até o contêiner, barrado" drops eth0 br-0123456789ab nao udp 5060
check "direção: de fora por uma ponte do host br-host até o contêiner, barrado" drops br-host br-0123456789ab nao udp 5060
check "direção: de fora até um contêiner da docker0, barrado" drops eth0 docker0 nao udp 5060
refuse "direção: o contêiner abrindo para fora, na mesma porta, passa" drops br-0123456789ab eth0 nao udp 5060
# O limite, que falha fechado: se a saída da máquina para fora é ela mesma uma ponte chamada br-algo,
# a conexão do contêiner para essa porta também é barrada. Não abre entrada; corta só essa saída.
check "limite: com a saída para fora numa ponte br-host, a conexão do contêiner é barrada" drops br-0123456789ab br-host nao udp 5060
refuse "direção: entre contêineres da mesma rede, passa" drops br-0123456789ab br-0123456789ab sim udp 5060
refuse "direção: outra porta, de fora, passa" drops eth0 br-0123456789ab nao udp 5061
check "apply: gravou o serviço do boot" test -f "$UNIT"
contains "serviço: roda depois do Docker" "$(cat "$UNIT")" "After=docker.service"
contains "serviço: é chamado de novo quando o Docker reinicia" "$(cat "$UNIT")" "PartOf=docker.service"
contains "serviço: repõe a mesma porta" "$(cat "$UNIT")" "apply 5060/udp"
# Conta a chamada de dentro (o `sudo` de mentira também loga a dele: "sudo -n systemctl ..."),
# assim o teste mede o mesmo com o kit rodando como root e como quem precisa de sudo.
# --now: o serviço fica ativo já, e o PartOf o chama num reinício do Docker antes do próximo boot.
# --no-block: o serviço roda este mesmo apply, e um start de dentro dele esperaria por ele mesmo.
equal "serviço: ligado no boot e já ativo, sem esperar pelo start" 1 "$(calls '^systemctl enable --now --no-block deskvoice-docker-user.service$')"

out="$(tool apply 5060/udp)"; equal "apply duas vezes: sai com zero" 0 "$?"
equal "apply duas vezes: continua com as duas" 2 "$(rules)"
contains "apply duas vezes: diz que já estava" "$out" "já estava fechada: 5060/udp"

# ── Depois de reiniciar a máquina: a cadeia volta vazia, e o serviço do boot repõe ──
rm -f "$STATE"; equal "reinício: a cadeia volta vazia" 0 "$(rules)"
out="$(boot)"; equal "reinício: o serviço do boot repõe a regra" 0 "$?"
equal "reinício: as duas, de novo" 2 "$(rules)"

# ── Reload do firewalld: a regra fica (medido), e aplicar de novo não duplica ──
out="$(tool apply 5060/udp)"; equal "reload: aplicar de novo sai com zero" 0 "$?"
equal "reload: continua com as duas" 2 "$(rules)"

# ── Um Docker que esvazie a cadeia ao reiniciar: o mesmo serviço é chamado de novo e repõe ──
rm -f "$STATE"; out="$(boot)"; equal "docker reiniciado: o serviço repõe a regra" 0 "$?"
equal "docker reiniciado: as duas" 2 "$(rules)"

# ── Duas portas: uma regra cada, e a que sai da lista é reaberta ──
out="$(tool apply 5060/udp 10000:10200/udp)"; equal "duas portas: sai com zero" 0 "$?"
equal "duas portas: quatro regras" 4 "$(rules)"
contains "duas portas: a faixa foi para conntrack como min:max" "$(cat "$STATE")" "--ctorigdstport 10000:10200"
out="$(tool apply 5060/udp)"; equal "porta que sai da lista: sai com zero" 0 "$?"
equal "porta que sai da lista: ficam as duas da 5060" 2 "$(rules)"
contains "porta que sai da lista: diz que reabriu" "$out" "porta reaberta: 10000:10200/udp"
contains "serviço: passa a repor só a que ficou" "$(cat "$UNIT")" "apply 5060/udp"

# ── A regra criada à mão, mais de uma vez, não ganha uma terceira: aplicar confere antes ──
rm -f "$STATE"
for bridge in docker+ br-+ docker+ br-+; do
  iptables -w 5 -I DOCKER-USER 1 -o "$bridge" -p udp -m physdev ! --physdev-is-bridged -m conntrack --ctorigdstport 5060 --ctdir ORIGINAL -j DROP >/dev/null 2>&1
done
equal "cópias da regra à mão: duas de cada" 4 "$(rules)"
out="$(tool apply 5060/udp)"; equal "cópias da regra à mão: sai com zero" 0 "$?"
contains "cópias da regra à mão: diz que já estava" "$out" "já estava fechada"
equal "cópias da regra à mão: o kit não soma uma terceira" 4 "$(rules)"

# ── show: lista a regra e o que o serviço repõe ──
out="$(tool show)"; equal "show: sai com zero" 0 "$?"
contains "show: mostra a porta" "$out" "--ctorigdstport 5060"
contains "show: diz o que o boot repõe" "$out" "no boot, o serviço repõe: 5060/udp"

# ── Simulação: diz o que faria e não altera nada ──
before="$(cat "$STATE")"; : > "$FAKE_DIR/calls.log"
out="$(tool --dry-run apply 5060/udp 5061/tcp)"; equal "simulação: sai com zero" 0 "$?"
contains "simulação: mostra a regra que escreveria" "$out" "[simulação] faria:"
equal "simulação: não mexeu nas regras" "$before" "$(cat "$STATE")"
equal "simulação: não chamou o systemd" 0 "$(calls '^systemctl ')"
# A porta que sai da lista também: na simulação, a reabertura só é dita.
out="$(tool --dry-run apply 5061/tcp)"; equal "simulação, porta saindo da lista: sai com zero" 0 "$?"
equal "simulação, porta saindo da lista: a regra da 5060/udp continua" "$before" "$(cat "$STATE")"
contains "simulação, porta saindo da lista: diz que reabriria" "$out" "[simulação] faria: reabrir 5060/udp"
equal "simulação, porta saindo da lista: nenhum -D" 0 "$(calls '^iptables .*-D ')"

# ── Quem instala sem ser root, pelo sudo: conferir a cadeia e achar o comando pedem o mesmo
# privilégio de escrever. Como root não há sudo a simular, e o caso não roda. ──
if [ "$(id -u)" != 0 ]; then
  saved="$(cat "$STATE")"; touch "$FAKE_DIR/iptables_needs_root"
  out="$(tool apply 5060/udp)"; equal "sem root: sai com zero" 0 "$?"
  lacks "sem root: não acha que a cadeia falta" "$out" "não existe nesta máquina"
  # No Debian o iptables mora em /usr/sbin, fora do PATH de quem não é root; o sudo o acha.
  SBIN="$SANDBOX/sbin"; NOSBIN="$SANDBOX/nosbin"; mkdir -p "$SBIN" "$NOSBIN"
  ln -s "$TEST_DIR/fake/iptables" "$SBIN/iptables"
  for f in "$TEST_DIR"/fake/*; do [ "${f##*/}" = iptables ] || ln -s "$f" "$NOSBIN/"; done
  echo "$SBIN" > "$FAKE_DIR/sudo_path"
  out="$(PATH="$NOSBIN:${PATH#"$TEST_DIR/fake:"}" tool apply 5060/udp)"; equal "sem /usr/sbin no PATH: sai com zero" 0 "$?"
  lacks "sem /usr/sbin no PATH: acha o iptables pelo sudo" "$out" "Não achei o comando iptables"
  rm -f "$FAKE_DIR/iptables_needs_root" "$FAKE_DIR/sudo_path"
  printf '%s\n' "$saved" > "$STATE"
fi

# ── Porta inválida e cadeia que não existe: para com o conserto, sem tocar em nada ──
for bad in 5060 5060/sctp 5060:10200 70000/tcp 10200:10000/udp; do
  out="$(tool apply "$bad")"; equal "porta '$bad': recusa" 1 "$?"
  contains "porta '$bad': diz a forma aceita" "$out" "Use a forma do ufw"
done
equal "porta inválida: nada foi escrito" 4 "$(rules)"
touch "$FAKE_DIR/no_docker_user"
out="$(tool apply 5060/udp)"; equal "sem a cadeia DOCKER-USER: para com erro" 1 "$?"
contains "sem a cadeia DOCKER-USER: aponta o Docker" "$out" "quem a cria é o Docker"
rm -f "$FAKE_DIR/no_docker_user"

# ── A regra no formato de antes (sem as interfaces), de quem já a tinha: o kit põe a nova no lugar, e diz ──
legacy() { grep -c -- '^-p udp -m conntrack --ctorigdstport' "$STATE" || true; }
LEGACY_RULE="-p udp -m conntrack --ctorigdstport 5060 --ctdir ORIGINAL -j DROP"
rm -f "$STATE"
# shellcheck disable=SC2086  # a regra é uma lista de argumentos, de propósito
{ iptables -w 5 -I DOCKER-USER 1 $LEGACY_RULE; iptables -w 5 -I DOCKER-USER 1 $LEGACY_RULE; } >/dev/null 2>&1
equal "formato antigo: duas cópias" 2 "$(legacy)"
before="$(cat "$STATE")"
out="$(tool --dry-run apply 5060/udp)"; equal "formato antigo, simulação: sai com zero" 0 "$?"
equal "formato antigo, simulação: não mexeu nas regras" "$before" "$(cat "$STATE")"
contains "formato antigo, simulação: diz que trocaria" "$out" "[simulação] faria: trocar a regra antiga de 5060/udp"
out="$(tool apply 5060/udp)"; equal "formato antigo: sai com zero" 0 "$?"
equal "formato antigo: nenhuma cópia antiga fica" 0 "$(legacy)"
equal "formato antigo: ficam as duas novas" 2 "$(rules)"
contains "formato antigo: diz que trocou" "$out" "Troquei a regra antiga de 5060/udp"

# ── Tirar as portas: some a regra e some o serviço, e a do formato antigo junto ──
out="$(tool apply 5060/udp)"; equal "volta a fechar: zero" 0 "$?"
# shellcheck disable=SC2086
iptables -w 5 -I DOCKER-USER 1 $LEGACY_RULE >/dev/null 2>&1
# O systemctl de mentira, embrulhado só aqui: anota se o arquivo da unidade ainda existia quando o
# disable chegou. Parar depois do rm deixa a unidade na memória do systemd, sem arquivo.
SHIM="$SANDBOX/shim"; mkdir -p "$SHIM"
cat > "$SHIM/systemctl" <<SHIM_EOF
#!/usr/bin/env bash
case " \$* " in *" disable "*) if [ -f "$UNIT" ]; then echo "unidade com arquivo no disable" >> "\$FAKE_DIR/calls.log"; fi ;; esac
exec "$TEST_DIR/fake/systemctl" "\$@"
SHIM_EOF
chmod +x "$SHIM/systemctl"
: > "$FAKE_DIR/calls.log"
out="$(PATH="$SHIM:$PATH" tool apply)"; equal "sem portas: sai com zero" 0 "$?"
equal "sem portas: nenhuma regra do kit" 0 "$(rules)"
refuse "sem portas: o serviço do boot foi apagado" test -f "$UNIT"
equal "sem portas: desliga e para o serviço" 1 "$(calls '^systemctl disable --now deskvoice-docker-user.service$')"
equal "sem portas: o disable chega com o arquivo da unidade ainda lá" 1 "$(calls '^unidade com arquivo no disable$')"
# A ordem no log: o disable vem antes do daemon-reload que segue o rm.
disable_at="$(grep -n -m1 '^systemctl disable --now ' "$FAKE_DIR/calls.log" | cut -d: -f1)"
reload_at="$(grep -n '^systemctl daemon-reload' "$FAKE_DIR/calls.log" | tail -n 1 | cut -d: -f1)"
check "sem portas: o disable vem antes do daemon-reload" test "${disable_at:-999999}" -lt "${reload_at:-0}"

# ── --help: o cabeçalho inteiro, e só ele ──
for help in --help ""; do
  # shellcheck disable=SC2086  # sem argumento nenhum, de propósito, no segundo caso
  out="$(tool $help)"; equal "ajuda '${help:-sem comando}': sai com zero" 0 "$?"
  contains "ajuda '${help:-sem comando}': começa no cabeçalho" "$out" "A regra da cadeia DOCKER-USER"
  contains "ajuda '${help:-sem comando}': vai até a última linha dele" "$out" "não fecha o que não foi medido (issue #142)."
  lacks "ajuda '${help:-sem comando}': não passa do cabeçalho" "$out" "source"
  lacks "ajuda '${help:-sem comando}': não mostra o shebang" "$out" "#!/usr/bin/env"
done

# ── install.sh: a variável fecha a porta, e a simulação não fecha nada ──
export DESKVOICE_DOMAIN="" DESKVOICE_ORG_NAME="Clínica Exemplo" DESKVOICE_OWNER_NAME="Ana Exemplo"
export DESKVOICE_OWNER_EMAIL=ana@exemplo.com.br DESKVOICE_OWNER_PASSWORD="senha-de-teste-123"
export DESKVOICE_HEALTH_TIMEOUT=0
echo 1 > "$FAKE_DIR/users_count"
printf 'asterisk|ok|PJSIP 20.20.1\n' > "$FAKE_DIR/voice_health"
printf '%s\n' 'panel|ok|respondendo' 'trunk|warn|sem linha' 'engine|warn|sem chave' > "$FAKE_DIR/panel_health"
printf '%s\n' postgres asterisk panel voice routines caddy > "$FAKE_DIR/running"
printf 'UNCONN 0 0 0.0.0.0:5060 0.0.0.0:*\n' > "$FAKE_DIR/ss_udp"
rm -rf "$STATE" "$UNIT"
out="$(DESKVOICE_DOCKER_USER_DROP="5060/tcp" bash "$KIT/install.sh" --dry-run --yes 2>&1)"
equal "install.sh, simulação: sai com zero" 0 "$?"
contains "install.sh, simulação: diz o que faria" "$out" "fechar no DOCKER-USER 5060/tcp"
equal "install.sh, simulação: não fechou nada" 0 "$(rules 2>/dev/null || echo 0)"
out="$(DESKVOICE_DOCKER_USER_DROP="5060/tcp 5061" bash "$KIT/install.sh" --dry-run --yes 2>&1)"
equal "install.sh, porta inválida na lista: recusa" 1 "$?"
contains "install.sh, porta inválida: nomeia a porta" "$out" "A porta '5061' em DESKVOICE_DOCKER_USER_DROP não vale"
finish
