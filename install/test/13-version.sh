#!/usr/bin/env bash
# Versão e imagens: a instalação grava um número (nunca um canal), a versão mais recente vem das
# tags do clone, e depois da primeira versão publicada ninguém constrói imagem na VPS sem pedir.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
source "$KIT/_common.sh"; set +e; trap - ERR
D="$DESKVOICE_DEPLOY_DIR"; E="$D/.env"; A="$D/app.env"
export DESKVOICE_DOMAIN="" DESKVOICE_ORG_NAME="Clínica Exemplo" DESKVOICE_OWNER_NAME="Ana Exemplo" DESKVOICE_OWNER_EMAIL=ana@exemplo.com.br DESKVOICE_OWNER_PASSWORD="senha-de-teste-123"
export DESKVOICE_HEALTH_TIMEOUT=0
echo 1 > "$FAKE_DIR/users_count"
printf 'asterisk|ok|PJSIP 20.20.1\n' > "$FAKE_DIR/voice_health"
printf '%s\n' 'panel|ok|respondendo' 'trunk|warn|sem linha' 'engine|warn|sem chave' > "$FAKE_DIR/panel_health"
printf '%s\n' postgres asterisk panel voice routines caddy > "$FAKE_DIR/running"
printf 'agents=3\ncalls=120\nusers=1\n' > "$FAKE_DIR/counts_backup"; cp "$FAKE_DIR/counts_backup" "$FAKE_DIR/counts_restore"
install() { : > "$FAKE_DIR/calls.log"; bash "$KIT/install.sh" --yes --force "$@" 2>&1; }
update() { : > "$FAKE_DIR/calls.log"; bash "$KIT/update.sh" --yes "$@" 2>&1; }
calls() { grep -c -- "$1" "$FAKE_DIR/calls.log"; }
version() { env_get "$E" DESKVOICE_VERSION; }
fresh() { rm -f "$E" "$A" "$D/migrate.env" "$D/docker-compose.override.yml"; }
# O endereço vem da fonte única: nenhum teste o escreve de novo.
prefix="$(env_get "$REPO/deploy/images.env" DESKVOICE_IMAGE_PREFIX)"
check "images.env traz o endereço das imagens" test -n "$prefix"
with_versions() { printf '%s\n' v0.2.1-rc.1 v0.2.0 v0.1.0 > "$FAKE_DIR/git_tags"; }

# ── Formato único: uma conversão entre a tag do git e o número ──
equal "tag do git vira número" 0.3.0 "$(version_of_tag v0.3.0)"
equal "número fica como está" 0.3.0 "$(version_of_tag 0.3.0)"
equal "número vira tag do git" v0.3.0 "$(tag_of_version 0.3.0)"
check "número de versão vale" is_version 0.3.0
check "pré-versão vale" is_version 1.2.0-rc.1
refuse "canal não é número de versão" is_version stable
refuse "número com v não é o formato gravado" is_version v0.3.0
refuse "versão pela metade não vale" is_version 0.3
equal "nome da imagem: endereço da fonte única, sem v" "$prefix/deskvoice-panel:0.3.0" "$(image_ref panel 0.3.0)"
: > "$FAKE_DIR/git_tags"; equal "clone sem tag: nenhuma versão" "" "$(latest_version)"
with_versions; equal "a mais recente é a maior versão final; pré-versão não conta" 0.2.0 "$(latest_version)"

# ── Antes da primeira versão: constrói aqui, e não grava canal ──
: > "$FAKE_DIR/git_tags"
out="$(install)"; equal "sem versão publicada: instala" 0 "$?"
equal "sem versão publicada: grava local, nunca um canal" local "$(version)"
contains "sem versão publicada: avisa que vai construir aqui" "$out" "ainda não tem nenhuma versão publicada"
equal "sem versão publicada: constrói" 1 "$(calls ' build panel voice routines')"
equal "sem versão publicada: não tenta baixar o que não existe" 0 "$(calls ' pull -q panel')"
lacks "o endereço das imagens não é gravado por instalação" "$(cat "$E")" "DESKVOICE_IMAGE_PREFIX"
check "o Compose recebe a fonte única" grep -q -- "--env-file $D/images.env --env-file $E" "$FAKE_DIR/calls.log"

# ── Com versão publicada: grava o número e baixa; não constrói ──
fresh; with_versions
out="$(install)"; equal "com versão publicada: instala" 0 "$?"
equal "grava o número da versão mais recente" 0.2.0 "$(version)"
check "a instalação agenda o agente de atualização" test -f "$DESKVOICE_SYSTEMD_DIR/deskvoice-agent.timer"
check "a instalação gera o segredo do agente" test -n "$(env_get "$E" UPDATE_AGENT_TOKEN)"
contains "diz qual versão instalou" "$out" "Versão: 0.2.0, a publicada mais recente"
equal "baixa as imagens" 1 "$(calls ' pull -q panel voice routines')"
equal "não constrói" 0 "$(calls ' build ')"
equal "consultou as versões antes de escolher" 1 "$(calls '^git .* fetch --tags')"
# Rodar de novo não troca de versão (isso é do update.sh) nem depende da rede para saber qual é.
printf '%s\n' v0.3.0 v0.2.0 v0.1.0 > "$FAKE_DIR/git_tags"; touch "$FAKE_DIR/git_fetch_fail"
out="$(install)"; equal "reinstalar com número gravado: zero, mesmo sem rede para o git" 0 "$?"
equal "reinstalar não troca de versão" 0.2.0 "$(version)"
rm "$FAKE_DIR/git_fetch_fail"

# ── Com versão publicada e sem imagem: erro claro, sem construir ──
fresh; with_versions; touch "$FAKE_DIR/pull_fail"
out="$(install)"; equal "imagem não baixa: sai com erro" 1 "$?"
equal "imagem não baixa: NÃO constrói no lugar" 0 "$(calls ' build ')"
equal "imagem não baixa: não sobe nada" 0 "$(calls ' up -d')"
equal "imagem não baixa: a versão não fica gravada" "" "$(version)"
contains "imagem não baixa: mostra a resposta do Docker" "$out" "manifest unknown"
contains "imagem não baixa: diz o comando para testar" "$out" "docker pull $prefix/deskvoice-panel:0.2.0"
contains "imagem não baixa: diz como construir de propósito" "$out" "bash install/install.sh --build"
# Pedido explícito de quem desenvolve: constrói, e grava local.
out="$(install --build)"; equal "--build: instala" 0 "$?"
equal "--build: grava local" local "$(version)"
equal "--build: constrói" 1 "$(calls ' build panel voice routines')"
equal "--build: não baixa as imagens do DeskVoice" 0 "$(calls ' pull -q panel')"
rm "$FAKE_DIR/pull_fail"
# Uma versão pedida junto de --build: uma das duas seria ignorada. Para antes de gravar qualquer coisa.
fresh; out="$(DESKVOICE_VERSION=0.2.0 install --build)"; equal "versão pedida com --build: recusa" 1 "$?"
contains "versão pedida com --build: nomeia as duas" "$out" "DESKVOICE_VERSION=0.2.0 e --build pedem coisas diferentes"
refuse "versão pedida com --build: não grava nada" test -e "$E"
equal "versão pedida com --build: não pede nada ao Docker além de quem é a instalação" 0 "$(grep -vc 'ps -a --filter label=' "$FAKE_DIR/calls.log")"

# ── Firewall: DESKVOICE_APPLY_UFW só vale com yes, conferido antes de gravar qualquer coisa ──
fresh; out="$(DESKVOICE_APPLY_UFW=talvez install)"; equal "ufw com valor errado: recusa" 1 "$?"
contains "ufw com valor errado: diz o valor aceito" "$out" "DESKVOICE_APPLY_UFW=yes"
refuse "ufw com valor errado: não grava nada" test -e "$E"
touch "$FAKE_DIR/ufw_active"
out="$(DESKVOICE_APPLY_UFW=yes install)"; equal "ufw ativo e yes: instala" 0 "$?"
equal "ufw ativo e yes: aplica as regras de telefonia" 1 "$(calls '^ufw allow 5060/udp')"
contains "ufw ativo e yes: diz que aplicou" "$out" "Regras aplicadas no ufw"
# O Docker publica as portas por fora do ufw (medido em docs/fundacao/ufw-e-docker.md): a mensagem
# não pode vender a regra como proteção nem prometer ligação muda sem ela.
contains "ufw: diz que o ufw não filtra as portas publicadas pelo Docker" "$out" "não filtra as portas que o Docker publica"
lacks "ufw: não promete ligação muda sem a regra" "$out" "pode ficar muda"
lacks "ufw: não chama de necessárias as regras que não filtram nada" "$out" "Regras necessárias"
out="$(install)"; equal "ufw ativo, sem a opção e sem terminal: instala" 0 "$?"
equal "ufw ativo, sem a opção: não aplica nada" 0 "$(calls '^ufw allow')"
contains "ufw ativo, sem a opção: diz que não aplicou" "$out" "Regras NÃO aplicadas"
lacks "ufw ativo, sem a opção: não promete ligação muda" "$out" "pode ficar muda"
contains "ufw ativo, sem a opção: aponta o DOCKER-USER além do provedor" "$out" "DOCKER-USER"
rm "$FAKE_DIR/ufw_active"
out="$(DESKVOICE_APPLY_UFW=yes install)"; equal "ufw inativo e yes: instala" 0 "$?"
contains "ufw inativo e yes: diz que a opção não teve efeito" "$out" "DESKVOICE_APPLY_UFW=yes não teve efeito"

# ── Falha ao descobrir a versão: erro com o comando, nunca um canal calado ──
fresh; with_versions; touch "$FAKE_DIR/git_fetch_fail"
out="$(install)"; equal "git sem rede: sai com erro" 1 "$?"
contains "git sem rede: diz o comando para conferir" "$out" "fetch --tags origin"
contains "git sem rede: diz como informar a versão" "$out" "DESKVOICE_VERSION=<número> bash install/install.sh"
refuse "git sem rede: nada é gravado" test -e "$E"
equal "git sem rede: o Docker não baixa nem sobe nada" 0 "$(grep -cE ' (pull|build|up) ' "$FAKE_DIR/calls.log")"
rm "$FAKE_DIR/git_fetch_fail" "$FAKE_DIR/git_tags"
out="$(install)"; equal "pasta que não é clone: sai com erro" 1 "$?"
contains "pasta que não é clone: diz como informar a versão" "$out" "DESKVOICE_VERSION=<número> bash install/install.sh"
refuse "pasta que não é clone: nada é gravado" test -e "$E"
out="$(DESKVOICE_VERSION=v0.3.0 install)"; equal "versão pedida, sem clone: instala" 0 "$?"
equal "versão pedida: grava o número, sem v" 0.3.0 "$(version)"
out="$(DESKVOICE_VERSION=stable install)"; equal "canal pedido como versão: recusa" 1 "$?"
contains "canal pedido como versão: diz o que vale" "$out" "DESKVOICE_VERSION"

# ── Simulação: diz a versão que instalaria, sem buscar nem gravar nada ──
fresh; with_versions
out="$(install --dry-run)"; equal "simulação com versão publicada: zero" 0 "$?"
contains "simulação: diz a versão que baixaria" "$out" "baixar as imagens da versão 0.2.0"
equal "simulação: não busca no repositório" 0 "$(calls '^git .* fetch')"
refuse "simulação: não grava nada" test -e "$E"

# ── A instalação que existia antes do formato único: canal gravado, imagem construída aqui,
#    endereço das imagens repetido no .env. Reinstalar e atualizar convergem para o número. ──
legacy() {  # legacy <o que estava gravado como versão>
  fresh; with_versions
  write_env_files "http://203.0.113.10" 203.0.113.10 ":80" 10000 10200; apply_entry caddy ""
  env_set "$E" DESKVOICE_VERSION "$1"; env_set "$E" DESKVOICE_IMAGE_PREFIX "$prefix"
  secrets="$(secrets_now)"
}
secrets_now() { grep -hE '^(POSTGRES_PASSWORD|APP_DB_PASSWORD|SYSTEM_DB_PASSWORD|DESKVOICE_SECRET_KEY|INTERNAL_TOKEN|ARI_PASSWORD)=' "$E" "$A" "$D/migrate.env"; }
kept() { equal "$1: nenhum segredo mudou" "$secrets" "$(secrets_now)"; }
legacy stable
out="$(install)"; equal "reinstalar sobre canal: zero" 0 "$?"
equal "reinstalar sobre canal: converge para o número" 0.2.0 "$(version)"
lacks "reinstalar sobre canal: a cópia do endereço sai do .env" "$(cat "$E")" "DESKVOICE_IMAGE_PREFIX"
equal "reinstalar sobre canal: baixa, não constrói" "1 0" "$(calls ' pull -q panel') $(calls ' build ')"
kept "reinstalar sobre canal"
equal "reinstalar sobre canal: nada derruba serviço nem apaga volume" 0 "$(grep -cE ' (down|volume|rm) ' "$FAKE_DIR/calls.log")"
check "reinstalar sobre canal: aplica as migrations sobre o banco que já existia" grep -q 'run --rm migrate' "$FAKE_DIR/calls.log"
# Se a imagem não baixa, a instalação antiga fica exatamente como estava.
legacy stable; touch "$FAKE_DIR/pull_fail"
out="$(install)"; equal "reinstalar sobre canal, sem imagem: erro" 1 "$?"
equal "reinstalar sobre canal, sem imagem: a versão gravada não muda" stable "$(version)"
equal "reinstalar sobre canal, sem imagem: nada sobe nem migra" 0 "$(grep -cE ' (up -d|run --rm migrate|build) ' "$FAKE_DIR/calls.log")"
rm "$FAKE_DIR/pull_fail"

position() { grep -n -- "$1" "$FAKE_DIR/calls.log" | head -n 1 | cut -d: -f1; }
legacy stable
out="$(update)"; equal "atualizar a partir de canal: zero" 0 "$?"
contains "atualizar a partir de canal: mostra de onde sai" "$out" "Atual: stable"
contains "atualizar a partir de canal: o alvo é o número mais recente" "$out" "Alvo:  0.2.0"
equal "atualizar a partir de canal: grava o número" 0.2.0 "$(version)"
check "atualizar a partir de canal: o código vai para a tag do git, com v" grep -q 'checkout --quiet refs/tags/v0.2.0' "$FAKE_DIR/calls.log"
check "atualizar a partir de canal: backup antes das migrations" test "$(position ' pg_dump ')" -lt "$(position 'run --rm migrate')"
check "atualizar a partir de canal: guarda a imagem antiga para a volta" grep -q "tag $prefix/deskvoice-panel:stable $prefix/deskvoice-panel:rollback" "$FAKE_DIR/calls.log"
equal "atualizar a partir de canal: baixa, não constrói" "1 0" "$(calls ' pull -q panel') $(calls ' build ')"
lacks "atualizar a partir de canal: a cópia do endereço sai do .env" "$(cat "$E")" "DESKVOICE_IMAGE_PREFIX"
kept "atualizar a partir de canal"
out="$(update)"; equal "já no número mais recente: zero" 0 "$?"
contains "já no número mais recente: nada a fazer" "$out" "já está na versão 0.2.0"

# Instalação que o atualizador antigo deixou com o v da tag: converge para o número.
legacy v0.2.0
out="$(update)"; equal "gravado com v: atualiza" 0 "$?"
equal "gravado com v: converge para o número" 0.2.0 "$(version)"
legacy v0.1.0
out="$(install)"; equal "reinstalar com v gravado: zero" 0 "$?"
equal "reinstalar com v gravado: mesmo número, sem v" 0.1.0 "$(version)"

# Imagens construídas aqui (antes da primeira versão) também convergem pelo atualizador.
legacy local
out="$(update --to v0.1.0)"; equal "de local para um número, pedido com v: zero" 0 "$?"
equal "--to aceita a tag e grava o número" 0.1.0 "$(version)"
out="$(update --to 0.2.0)"; equal "--to aceita o número" 0 "$?"
equal "--to com número grava o número" 0.2.0 "$(version)"
refuse "--to com versão que não existe é recusado" bash "$KIT/update.sh" --yes --to 9.9.9
refuse "--to com canal é recusado" bash "$KIT/update.sh" --yes --to stable

# ── Atualizar sem imagem: para antes de mexer no banco, volta o código e não constrói ──
legacy 0.1.0; touch "$FAKE_DIR/pull_fail"
out="$(update)"; equal "atualizar sem imagem: sai com erro" 1 "$?"
equal "atualizar sem imagem: a versão não muda" 0.1.0 "$(version)"
equal "atualizar sem imagem: NÃO constrói no lugar" 0 "$(calls ' build ')"
equal "atualizar sem imagem: banco e serviços intocados" 0 "$(grep -cE ' (run --rm migrate|up -d|stop) |rename to deskvoice' "$FAKE_DIR/calls.log")"
check "atualizar sem imagem: o código volta para onde estava" grep -q 'checkout --quiet main' "$FAKE_DIR/calls.log"
contains "atualizar sem imagem: diz que nada foi alterado" "$out" "Nada foi alterado: a instalação segue na versão 0.1.0"
contains "atualizar sem imagem: diz o comando para testar" "$out" "docker pull $prefix/deskvoice-panel:0.2.0"
lacks "atualizar sem imagem: não diz atualizado" "$out" "Atualizado para"
rm "$FAKE_DIR/pull_fail"

# ── Sem nenhuma versão publicada não há para onde atualizar; rede fora é dita com o comando ──
legacy local; : > "$FAKE_DIR/git_tags"
out="$(update)"; equal "atualizar sem versão publicada: sai com erro" 1 "$?"
contains "atualizar sem versão publicada: diz por quê" "$out" "Ainda não há nenhuma versão publicada"
equal "atualizar sem versão publicada: a versão não muda" local "$(version)"
with_versions; touch "$FAKE_DIR/git_fetch_fail"
out="$(update)"; equal "atualizar com o git sem rede: sai com erro" 1 "$?"
contains "atualizar com o git sem rede: diz o comando" "$out" "fetch --tags origin"
# ── Código e imagens da mesma versão: clone na ponta da main não instala imagem de versão anterior ──
rm -f "$FAKE_DIR/git_fetch_fail"; fresh; with_versions; echo commit-da-ponta-da-main > "$FAKE_DIR/git_head"
out="$(install)"; equal "clone fora da versão: não instala" 1 "$?"
contains "clone fora da versão: diz o checkout a fazer" "$out" "checkout v0.2.0 && bash install/install.sh"
contains "clone fora da versão: lembra do --build para rodar a main de propósito" "$out" "--build"
equal "clone fora da versão: nada foi baixado nem subiu" 0 "$(calls ' pull \| up -d')"
out="$(install --build)"; equal "clone fora da versão, com --build: instala o código da pasta" 0 "$?"
rm -f "$FAKE_DIR/git_head"

# ── ARM: ainda não há imagem publicada; só construindo aqui ──
fresh; with_versions
out="$(FAKE_ARCH=aarch64 install)"; equal "ARM com versão publicada: não instala" 1 "$?"
contains "ARM com versão publicada: diz que não há imagem e aponta o --build" "$out" "bash install/install.sh --build"
equal "ARM com versão publicada: nada foi baixado" 0 "$(calls ' pull ')"
finish
