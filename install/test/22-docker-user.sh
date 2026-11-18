#!/usr/bin/env bash
# A regra da cadeia DOCKER-USER (issue #142): uma regra por porta, e ela volta depois do que
# esvazia a cadeia — o reinício da máquina e o reinício do Docker, que a recriam vazia. O reload do
# firewalld não a apaga (medido em 15/11/2026), então o caso do reload aqui é o de depois dele: a
# cadeia ainda tem a regra, e aplicar de novo não duplica.
# O iptables e o systemctl são de mentira: o teste não toca no firewall nem no systemd da máquina.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
source "$KIT/_common.sh"; set +e; trap - ERR
UNIT="$DESKVOICE_SYSTEMD_DIR/deskvoice-docker-user.service"
STATE="$FAKE_DIR/iptables_DOCKER-USER"
rules() { if [ -f "$STATE" ]; then grep -c -- '--ctorigdstport' "$STATE" || true; else echo 0; fi; }
calls() { grep -c -- "$1" "$FAKE_DIR/calls.log"; }
tool() { bash "$KIT/docker-user.sh" "$@" 2>&1; }
boot() {  # o que o systemd faz no boot: roda o ExecStart do serviço gravado
  local line; line="$(sed -n 's/^ExecStart=//p' "$UNIT")"
  [ -n "$line" ] || { echo "sem ExecStart em $UNIT"; return 1; }
  eval "$line" 2>&1
}

# ── Aplicar fecha a porta, e aplicar de novo não duplica ──
: > "$FAKE_DIR/calls.log"
out="$(tool apply 5060/udp)"; equal "apply: sai com zero" 0 "$?"
equal "apply: uma regra" 1 "$(rules)"
contains "apply: diz que fechou" "$out" "porta fechada: 5060/udp"
check "apply: gravou o serviço do boot" test -f "$UNIT"
contains "serviço: roda depois do Docker" "$(cat "$UNIT")" "After=docker.service"
contains "serviço: é chamado de novo quando o Docker reinicia" "$(cat "$UNIT")" "PartOf=docker.service"
contains "serviço: repõe a mesma porta" "$(cat "$UNIT")" "apply 5060/udp"
# Conta a chamada de dentro (o `sudo` de mentira também loga a dele: "sudo -n systemctl ..."),
# assim o teste mede o mesmo com o kit rodando como root e como quem precisa de sudo.
equal "serviço: ligado no boot" 1 "$(calls '^systemctl enable deskvoice-docker-user.service')"

out="$(tool apply 5060/udp)"; equal "apply duas vezes: sai com zero" 0 "$?"
equal "apply duas vezes: continua uma regra" 1 "$(rules)"
contains "apply duas vezes: diz que já estava" "$out" "já estava fechada: 5060/udp"

# ── Depois de reiniciar a máquina: a cadeia volta vazia, e o serviço do boot repõe ──
rm -f "$STATE"; equal "reinício: a cadeia volta vazia" 0 "$(rules)"
out="$(boot)"; equal "reinício: o serviço do boot repõe a regra" 0 "$?"
equal "reinício: uma regra, de novo" 1 "$(rules)"

# ── Reload do firewalld: a regra fica (medido), e aplicar de novo não duplica ──
out="$(tool apply 5060/udp)"; equal "reload: aplicar de novo sai com zero" 0 "$?"
equal "reload: continua uma regra" 1 "$(rules)"

# ── Reiniciar o Docker também esvazia a cadeia: o mesmo serviço é chamado de novo ──
rm -f "$STATE"; out="$(boot)"; equal "docker reiniciado: o serviço repõe a regra" 0 "$?"
equal "docker reiniciado: uma regra" 1 "$(rules)"

# ── Duas portas: uma regra cada, e a que sai da lista é reaberta ──
out="$(tool apply 5060/udp 10000:10200/udp)"; equal "duas portas: sai com zero" 0 "$?"
equal "duas portas: duas regras" 2 "$(rules)"
contains "duas portas: a faixa foi para conntrack como min:max" "$(cat "$STATE")" "--ctorigdstport 10000:10200"
out="$(tool apply 5060/udp)"; equal "porta que sai da lista: sai com zero" 0 "$?"
equal "porta que sai da lista: fica uma regra" 1 "$(rules)"
contains "porta que sai da lista: diz que reabriu" "$out" "porta reaberta: 10000:10200/udp"
contains "serviço: passa a repor só a que ficou" "$(cat "$UNIT")" "apply 5060/udp"

# ── A regra criada à mão, mais de uma vez, não ganha uma terceira: aplicar confere antes ──
rm -f "$STATE"
iptables -w 5 -I DOCKER-USER 1 -p udp -m conntrack --ctorigdstport 5060 --ctdir ORIGINAL -j DROP >/dev/null 2>&1
iptables -w 5 -I DOCKER-USER 1 -p udp -m conntrack --ctorigdstport 5060 --ctdir ORIGINAL -j DROP >/dev/null 2>&1
equal "cópias da regra à mão: duas" 2 "$(rules)"
out="$(tool apply 5060/udp)"; equal "cópias da regra à mão: sai com zero" 0 "$?"
contains "cópias da regra à mão: diz que já estava" "$out" "já estava fechada"
equal "cópias da regra à mão: o kit não soma uma terceira" 2 "$(rules)"

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

# ── Porta inválida e cadeia que não existe: para com o conserto, sem tocar em nada ──
for bad in 5060 5060/sctp 5060:10200 70000/tcp 10200:10000/udp; do
  out="$(tool apply "$bad")"; equal "porta '$bad': recusa" 1 "$?"
  contains "porta '$bad': diz a forma aceita" "$out" "Use a forma do ufw"
done
equal "porta inválida: nada foi escrito" 2 "$(rules)"
touch "$FAKE_DIR/no_docker_user"
out="$(tool apply 5060/udp)"; equal "sem a cadeia DOCKER-USER: para com erro" 1 "$?"
contains "sem a cadeia DOCKER-USER: aponta o Docker" "$out" "quem a cria é o Docker"
rm -f "$FAKE_DIR/no_docker_user"

# ── Tirar as portas: some a regra e some o serviço ──
out="$(tool apply 5060/udp)"; equal "volta a fechar: zero" 0 "$?"
out="$(tool apply)"; equal "sem portas: sai com zero" 0 "$?"
equal "sem portas: nenhuma regra do kit" 0 "$(rules)"
refuse "sem portas: o serviço do boot foi apagado" test -f "$UNIT"
equal "sem portas: desliga o serviço" 1 "$(calls '^systemctl disable deskvoice-docker-user.service')"

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
