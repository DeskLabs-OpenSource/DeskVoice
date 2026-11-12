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

# ── A instalação desta máquina é de outra pasta, que existe ──
OUTRA="$SANDBOX/outra/pasta"; mkdir -p "$OUTRA/deploy"
echo "$OUTRA/deploy" > "$FAKE_DIR/project_dir"
before="$(snapshot)"
for cmd in "install.sh --yes --force" "install.sh --dry-run --yes --force" "update.sh --to 0.9.0 --yes" "restore.sh --yes latest" "backup.sh" "healthcheck.sh"; do
  script="${cmd%% *}"; : > "$FAKE_DIR/calls.log"
  # shellcheck disable=SC2086  # o comando e as opções, de propósito
  out="$(bash "$KIT"/$cmd 2>&1)"; equal "$cmd, de outra pasta: para com erro" 1 "$?"
  contains "$cmd, de outra pasta: diz qual pasta é a dona" "$out" "instalado a partir de outra pasta ($OUTRA/deploy)"
  contains "$cmd, de outra pasta: diz o comando a rodar de lá" "$out" "cd $OUTRA && bash install/$script"
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
contains "segundo clone sem instalação: aponta a pasta dona" "$out" "cd $OUTRA && bash install/update.sh"
lacks "segundo clone sem instalação: não manda rodar o instalador aqui" "$out" "ainda não foi instalado nesta pasta"

# Adotar com a dona viva: duas pastas mandariam nos mesmos contêineres. (Pela opção da linha de
# comando; os casos adiante usam a variável.)
: > "$FAKE_DIR/calls.log"
out="$(bash "$KIT/install.sh" --adopt --yes --force 2>&1)"; equal "adotar com a dona existente: para" 1 "$?"
contains "adotar com a dona existente: diz que ela existe" "$out" "pertence a $OUTRA/deploy, que existe"
contains "adotar com a dona existente: manda rodar de lá" "$out" "cd $OUTRA && bash install/install.sh"
equal "adotar com a dona existente: não tira nenhum contêiner" 0 "$(grep -c ' down ' "$FAKE_DIR/calls.log")"
equal "adotar com a dona existente: não grava nem apaga arquivo" "$before" "$(snapshot)"

# ── A pasta dona não existe mais (instalação movida, ou outro usuário) ──
GONE="$SANDBOX/apagada/deploy"; echo "$GONE" > "$FAKE_DIR/project_dir"
for cmd in "backup.sh" "healthcheck.sh" "install.sh --yes --force"; do
  # shellcheck disable=SC2086  # o comando e as opções, de propósito
  out="$(bash "$KIT"/$cmd 2>&1)"; equal "$cmd, dona inexistente, sem a opção: para" 1 "$?"
  contains "$cmd, dona inexistente: diz que a pasta não existe mais" "$out" "$GONE, que não existe mais"
  contains "$cmd, dona inexistente: diz como adotar" "$out" "DESKVOICE_ADOPT=yes bash $KIT/install.sh"
  lacks "$cmd, dona inexistente: não manda para a pasta que não existe" "$out" "cd $SANDBOX/apagada"
done

# Um clone novo, para onde a instalação foi "movida": o repositório, sem os arquivos de ambiente.
# A versão vai dita, e a instalação antiga está parada (a 5060 livre): sem isso, a pasta sem .env
# pararia adiante, por não saber a versão ou pela porta em uso, e esconderia a falta da conferência.
# Parada é o caso perigoso: nada impede o instalador de gerar segredos novos e subir o banco antigo.
N="$SANDBOX/novo/deploy"; mkdir -p "$N"
cp -R "$D/asterisk" "$N/"; rm -rf "$N/asterisk/generated"; cp "$D/docker-compose.yml" "$D/images.env" "$D/Caddyfile" "$N/"
adopt() { DESKVOICE_DEPLOY_DIR="$N" DESKVOICE_ADOPT=yes DESKVOICE_VERSION=0.1.0 bash "$KIT/install.sh" --yes --force 2>&1; }
: > "$FAKE_DIR/calls.log"; cp "$FAKE_DIR/ss_udp" "$FAKE_DIR/ss_udp.antes"; : > "$FAKE_DIR/ss_udp"
out="$(adopt)"; equal "adotar sem os arquivos de ambiente: para" 1 "$?"
contains "adotar sem os arquivos de ambiente: diz que vêm da pasta antiga" "$out" "precisa ser o da pasta antiga ($GONE)"
equal "adotar sem os arquivos de ambiente: nenhum segredo novo gravado" "" "$(ls -A "$N"/.env "$N"/app.env "$N"/migrate.env 2>/dev/null)"
equal "adotar sem os arquivos de ambiente: não tira nenhum contêiner" 0 "$(grep -c ' down ' "$FAKE_DIR/calls.log")"
mv "$FAKE_DIR/ss_udp.antes" "$FAKE_DIR/ss_udp"

# Com os três arquivos copiados da pasta antiga: adota.
cp -p "$D/.env" "$D/app.env" "$D/migrate.env" "$N/"
secrets_before="$(cat "$N/.env" "$N/app.env" "$N/migrate.env" | grep -E 'PASSWORD|SECRET|TOKEN' | cksum)"
echo 1 > "$FAKE_DIR/users_count"; : > "$FAKE_DIR/calls.log"
out="$(adopt)"; equal "adotar com os arquivos de ambiente: termina bem" 0 "$?"
contains "adotar: diz de que pasta adotou" "$out" "feita a partir de $GONE"
equal "adotar: os segredos são os da pasta antiga" "$secrets_before" "$(cat "$N/.env" "$N/app.env" "$N/migrate.env" | grep -E 'PASSWORD|SECRET|TOKEN' | cksum)"
equal "adotar: tira os contêineres antigos uma vez" 1 "$(grep -c ' down --remove-orphans' "$FAKE_DIR/calls.log")"
equal "adotar: nenhum volume é apagado" 0 "$(grep -cE ' volume rm| down .*(-v|--volumes)' "$FAKE_DIR/calls.log")"
# Os volumes têm o nome do projeto, e não da pasta: ninguém troca o nome do projeto, que é fixo.
equal "adotar: o nome do projeto é o fixo" 1 "$(grep -cx 'name: deskvoice' "$N/docker-compose.yml")"
equal "adotar: nenhum comando troca o nome do projeto" 0 "$(grep -cE ' -p | --project-name' "$FAKE_DIR/calls.log")"
first_down="$(grep -n ' down ' "$FAKE_DIR/calls.log" | head -n 1 | cut -d: -f1)"
first_up="$(grep -n ' up -d' "$FAKE_DIR/calls.log" | head -n 1 | cut -d: -f1)"
check "adotar: os contêineres são tirados antes de subirem daqui" test "${first_down:-0}" -gt 0 -a "${first_down:-0}" -lt "${first_up:-0}"
check "adotar: o Compose sobe a partir da pasta nova" grep -q -- "-f $N/docker-compose.yml .*up -d" "$FAKE_DIR/calls.log"
equal "adotar: não cria outro dono" 0 "$(grep -c 'create-owner' "$FAKE_DIR/calls.log")"
# Depois da adoção, a pasta nova é a dona: os outros comandos rodam dela.
DESKVOICE_DEPLOY_DIR="$N" bash "$KIT/healthcheck.sh" >/dev/null 2>&1; equal "depois de adotar: a checagem roda da pasta nova" 0 "$?"
out="$(DESKVOICE_DEPLOY_DIR="$N" DESKVOICE_ADOPT=yes bash "$KIT/install.sh" --yes --force 2>&1)"; equal "adotar de novo, já sendo a dona: para" 1 "$?"
contains "adotar de novo: diz para rodar sem a opção" "$out" "Rode sem a opção"

# ── A instalação é desta pasta, escrita por outro caminho (link simbólico): segue ──
ln -s "$D" "$SANDBOX/atalho"; echo "$SANDBOX/atalho" > "$FAKE_DIR/project_dir"
bash "$KIT/backup.sh" >/dev/null 2>&1; equal "a mesma pasta por um link: o backup roda" 0 "$?"
bash "$KIT/healthcheck.sh" >/dev/null 2>&1; equal "a mesma pasta por um link: a checagem roda" 0 "$?"

# ── Máquina sem nenhum contêiner do DeskVoice: instalação nova, segue normal ──
rm -f "$FAKE_DIR/project_dir"; : > "$FAKE_DIR/running"; rm -f "$D/.env" "$D/app.env" "$D/migrate.env"
out="$(bash "$KIT/install.sh" --dry-run --yes --force 2>&1)"; equal "instalação nova: a simulação vai até o fim" 0 "$?"
lacks "instalação nova: nenhuma recusa por pasta" "$out" "outra pasta"
finish
