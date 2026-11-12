#!/usr/bin/env bash
# O projeto do Compose tem nome fixo: um segundo clone na mesma máquina manda nos mesmos
# contêineres. Todo script que mexe na instalação para, antes de tocar em qualquer coisa, se a
# instalação desta máquina foi feita a partir de outra pasta.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
fake_install
source "$KIT/_common.sh"; set +e; trap - ERR
D="$DESKVOICE_DEPLOY_DIR"
export DESKVOICE_HEALTH_TIMEOUT=0 DESKVOICE_DOMAIN="" DESKVOICE_ORG_NAME="Clínica Exemplo" DESKVOICE_OWNER_NAME="Ana Exemplo"
export DESKVOICE_OWNER_EMAIL=ana@exemplo.com.br DESKVOICE_OWNER_PASSWORD="senha-de-teste-123"
printf 'agents=3\ncalls=120\nusers=1\n' > "$FAKE_DIR/counts_backup"; cp "$FAKE_DIR/counts_backup" "$FAKE_DIR/counts_restore"
snapshot() { (cd "$SANDBOX" && find deploy backups -type f 2>/dev/null | sort | while read -r f; do echo "$f $(cksum < "$f")"; done); }
# Tudo o que o Docker de mentira ouviu, menos a pergunta de quem é a instalação.
other_calls() { grep -vc 'ps -a --filter label=com.docker.compose.project=deskvoice' "$FAKE_DIR/calls.log"; }

# Um backup feito pela pasta dona, para a restauração ter o que restaurar.
bash "$KIT/backup.sh" >/dev/null 2>&1; equal "pasta dona: o backup roda" 0 "$?"

# ── A instalação desta máquina é de outra pasta ──
echo /outra/pasta/deploy > "$FAKE_DIR/project_dir"
before="$(snapshot)"
for cmd in "install.sh --yes --force" "install.sh --dry-run --yes --force" "update.sh --to 0.9.0 --yes" "restore.sh --yes latest" "backup.sh" "healthcheck.sh"; do
  script="${cmd%% *}"; : > "$FAKE_DIR/calls.log"
  # shellcheck disable=SC2086  # o comando e as opções, de propósito
  out="$(bash "$KIT"/$cmd 2>&1)"; equal "$cmd, de outra pasta: para com erro" 1 "$?"
  contains "$cmd, de outra pasta: diz qual pasta é a dona" "$out" "instalado a partir de outra pasta (/outra/pasta/deploy)"
  contains "$cmd, de outra pasta: diz o comando a rodar de lá" "$out" "cd /outra/pasta && bash install/$script"
  equal "$cmd, de outra pasta: não pede mais nada ao Docker" 0 "$(other_calls)"
  equal "$cmd, de outra pasta: não grava nem apaga arquivo" "$before" "$(snapshot)"
done
equal "de outra pasta: a versão gravada não muda" 0.1.0 "$(env_get "$D/.env" DESKVOICE_VERSION)"

# Instalação parada também tem dona: o rótulo vem de contêiner parado.
: > "$FAKE_DIR/running"
out="$(bash "$KIT/install.sh" --yes --force 2>&1)"; equal "instalação de outra pasta, parada: o instalador também para" 1 "$?"
printf '%s\n' postgres asterisk panel voice routines caddy > "$FAKE_DIR/running"

# Um segundo clone ainda sem nenhum arquivo de ambiente: o conselho é ir à pasta dona, e não instalar.
mkdir -p "$SANDBOX/segundo/deploy"; cp "$D/docker-compose.yml" "$D/images.env" "$SANDBOX/segundo/deploy/"
out="$(DESKVOICE_DEPLOY_DIR="$SANDBOX/segundo/deploy" bash "$KIT/update.sh" --to 0.9.0 --yes 2>&1)"; equal "segundo clone sem instalação: para" 1 "$?"
contains "segundo clone sem instalação: aponta a pasta dona" "$out" "cd /outra/pasta && bash install/update.sh"
lacks "segundo clone sem instalação: não manda rodar o instalador aqui" "$out" "ainda não foi instalado nesta pasta"

# A pasta dona apagada (o rótulo aponta para uma pasta que não existe mais) também não é esta.
echo "$SANDBOX/apagada/deploy" > "$FAKE_DIR/project_dir"
bash "$KIT/backup.sh" >/dev/null 2>&1; equal "pasta dona que não existe mais: para" 1 "$?"

# ── A instalação é desta pasta, escrita por outro caminho (link simbólico): segue ──
ln -s "$D" "$SANDBOX/atalho"; echo "$SANDBOX/atalho" > "$FAKE_DIR/project_dir"
bash "$KIT/backup.sh" >/dev/null 2>&1; equal "a mesma pasta por um link: o backup roda" 0 "$?"
bash "$KIT/healthcheck.sh" >/dev/null 2>&1; equal "a mesma pasta por um link: a checagem roda" 0 "$?"

# ── Máquina sem nenhum contêiner do DeskVoice: instalação nova, segue normal ──
rm -f "$FAKE_DIR/project_dir"; : > "$FAKE_DIR/running"; rm -f "$D/.env" "$D/app.env" "$D/migrate.env"
out="$(bash "$KIT/install.sh" --dry-run --yes --force 2>&1)"; equal "instalação nova: a simulação vai até o fim" 0 "$?"
lacks "instalação nova: nenhuma recusa por pasta" "$out" "outra pasta"
finish
