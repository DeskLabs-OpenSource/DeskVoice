#!/usr/bin/env bash
# AlmaLinux e Rocky Linux: o Docker instalado com o serviço desligado (como veio numa VPS AlmaLinux
# em 12/11/2026), o firewalld e o SELinux. O sistema em si (os_supported) está em 01-validators.sh.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
source "$KIT/_common.sh"; set +e; trap - ERR
D="$DESKVOICE_DEPLOY_DIR"; E="$D/.env"
export DESKVOICE_DOMAIN="" DESKVOICE_ORG_NAME="Clínica Exemplo" DESKVOICE_OWNER_NAME="Ana Exemplo" DESKVOICE_OWNER_EMAIL=ana@exemplo.com.br DESKVOICE_OWNER_PASSWORD="senha-de-teste-123"
export DESKVOICE_HEALTH_TIMEOUT=0 DESKVOICE_VERSION=0.3.0
echo 1 > "$FAKE_DIR/users_count"
printf 'asterisk|ok|PJSIP 20.20.1\n' > "$FAKE_DIR/voice_health"
printf '%s\n' 'panel|ok|respondendo' 'trunk|warn|sem linha' 'engine|warn|sem chave' > "$FAKE_DIR/panel_health"
printf '%s\n' postgres asterisk panel voice routines caddy > "$FAKE_DIR/running"
install() { : > "$FAKE_DIR/calls.log"; bash "$KIT/install.sh" --yes --force "$@" 2>&1; }
# Como root o instalador não usa sudo; os testes podem rodar das duas formas.
SUDO_SHOWN="sudo "; if [ "$(id -u)" = 0 ]; then SUDO_SHOWN=""; fi
calls() { grep -c -- "$1" "$FAKE_DIR/calls.log"; }
fresh() { rm -f "$E" "$D/app.env" "$D/migrate.env" "$D/docker-compose.override.yml"; }

# ── Docker instalado e parado, com systemd: o instalador liga o serviço e segue ──
touch "$FAKE_DIR/docker_down"
out="$(install)"; equal "Docker parado: instala" 0 "$?"
equal "Docker parado: liga o serviço uma vez" 1 "$(calls '^systemctl enable --now docker')"
contains "Docker parado: diz na tela que ligou" "$out" "Ligando o serviço dele: ${SUDO_SHOWN}systemctl enable --now docker"
lacks "Docker parado: não manda ligar à mão" "$out" "Seu usuário não consegue falar com o Docker"
check "Docker parado: a instalação foi gravada" test -f "$E"
# Com o serviço já de pé, não mexe no systemd.
out="$(install)"; equal "Docker de pé: instala" 0 "$?"
equal "Docker de pé: não chama o systemctl para o Docker" 0 "$(calls 'enable --now docker')"

# ── Ligar o serviço falha: a mensagem de sempre, e nada é gravado ──
fresh; touch "$FAKE_DIR/docker_down" "$FAKE_DIR/systemctl_fail"
out="$(install)"; equal "systemctl falha: para com erro" 1 "$?"
equal "systemctl falha: tentou ligar o serviço" 1 "$(calls '^systemctl enable --now docker')"
contains "systemctl falha: a mensagem de hoje" "$out" "Seu usuário não consegue falar com o Docker (ou o serviço do Docker está parado)."
contains "systemctl falha: o conserto de hoje" "$out" "systemctl start docker"
refuse "systemctl falha: nada é gravado" test -e "$E"
rm -f "$FAKE_DIR/systemctl_fail"

# ── Sem systemd: não tenta ligar nada, e a mensagem de hoje aparece ──
out="$(DESKVOICE_SYSTEMD_RUN_DIR="$SANDBOX/sem-systemd" install)"; equal "sem systemd: para com erro" 1 "$?"
equal "sem systemd: não chama o systemctl" 0 "$(calls '^systemctl ')"
contains "sem systemd: a mensagem de hoje" "$out" "Seu usuário não consegue falar com o Docker"

# ── Simulação com o Docker parado: diz que ligaria, e não liga ──
out="$(install --dry-run)"; equal "simulação, Docker parado: zero" 0 "$?"
contains "simulação, Docker parado: diz que ligaria o serviço" "$out" "ligar o serviço do Docker, que não respondeu"
equal "simulação, Docker parado: não chama o systemctl" 0 "$(calls '^systemctl ')"
rm -f "$FAKE_DIR/docker_down"

# ── firewalld ativo: avisa que ele não filtra as portas do Docker, sem receita de firewall-cmd ──
fresh; touch "$FAKE_DIR/firewalld_active"
out="$(install)"; equal "firewalld ativo: instala" 0 "$?"
contains "firewalld ativo: avisa" "$out" "O firewall firewalld está ativo"
contains "firewalld ativo: diz que não filtra as portas do Docker" "$out" "não filtra as portas que o Docker publica"
contains "firewalld ativo: diz as portas e a faixa de áudio" "$out" "5060/udp e 10000-10200/udp chegam aos contêineres"
contains "firewalld ativo: aponta o firewall do provedor" "$out" "use o firewall do provedor da VPS"
contains "firewalld ativo: não vende o DOCKER-USER como medido com ele" "$out" "medida com o ufw, não com o firewalld"
lacks "firewalld ativo: não diz mais que não foi provado" "$out" "com o firewalld ativo não foi provado"
lacks "firewalld ativo: não manda diagnosticar a ligação muda pelo firewalld" "$out" "comece o diagnóstico pelo firewalld"
contains "firewalld ativo: aponta a prova de fora" "$out" "teste da tela Linha"
lacks "firewalld ativo: não imprime receita" "$out" "--add-port"
equal "firewalld ativo: só consulta o estado, não muda nada" "$(calls '^firewall-cmd ')" "$(calls '^firewall-cmd --state')"
rm "$FAKE_DIR/firewalld_active"
out="$(install)"; lacks "firewalld parado: nenhum aviso" "$out" "firewalld"

# ── SELinux: avisa só com Enforcing E o Docker rodando com ele ligado ──
echo Enforcing > "$FAKE_DIR/selinux_mode"; echo '[name=seccomp,profile=builtin name=selinux name=cgroupns]' > "$FAKE_DIR/docker_security"
out="$(install)"; equal "SELinux Enforcing no Docker: instala (não bloqueia)" 0 "$?"
contains "SELinux Enforcing no Docker: avisa" "$out" "O SELinux está em modo Enforcing"
contains "SELinux Enforcing no Docker: diz que não foi provado" "$out" "não foi provado"
echo '[name=seccomp,profile=builtin name=cgroupns]' > "$FAKE_DIR/docker_security"
out="$(install)"; lacks "SELinux Enforcing, Docker sem selinux-enabled: não avisa" "$out" "SELinux"
echo Permissive > "$FAKE_DIR/selinux_mode"; echo '[name=seccomp,profile=builtin name=selinux]' > "$FAKE_DIR/docker_security"
out="$(install)"; lacks "SELinux Permissive: não avisa" "$out" "SELinux"
rm -f "$FAKE_DIR/selinux_mode" "$FAKE_DIR/docker_security"
finish
