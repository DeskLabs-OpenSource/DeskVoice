#!/usr/bin/env bash
# Atualiza o DeskVoice. Nunca roda sem backup, e desfaz tudo se a versão nova não ficar saudável.
#
#   bash install/update.sh                atualiza para a versão publicada mais recente
#   bash install/update.sh --to 0.3.0     atualiza para uma versão específica
#   --yes                                 não pede confirmação
#
# Ordem: mostra versão atual e alvo → backup conferido → troca a versão → migrations →
# checagem de saúde. Se alguma peça essencial não responder, volta para a versão anterior
# e restaura o banco do backup, dizendo o que aconteceu.
#
# O atualizador nunca constrói imagem: se a versão alvo não baixa, ele para antes de mexer em
# qualquer coisa e diz o que fazer.
#
# Quem atualiza é o atualizador da versão de DESTINO. Este script (o da versão instalada) decide o
# alvo, faz o backup, troca o código e então passa a vez ao update.sh que acabou de chegar, com
# --resume. Assim, o que uma versão nova precisa fazer de diferente ao ser instalada (uma
# migração de configuração, o agendamento do agente) roda de fato, em vez de ficar no script
# antigo que já estava na memória. O que passa de um para o outro são as variáveis
# DESKVOICE_UPDATE_*: quem as grava é sempre a versão ANTERIOR, então elas nunca mudam de nome
# nem de sentido; variável nova entra com padrão.
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

# Tudo dentro de uma função: o bash lê o arquivo aos poucos, e a troca de versão reescreve
# este próprio script no meio da execução. Assim ele já está inteiro na memória.
# shellcheck disable=SC2034  # ASSUME_YES é lida por confirm(), no _common.sh
main() {

target=""; ASSUME_YES=0; resume=0
while [ $# -gt 0 ]; do
  case "$1" in
    --to) target="${2:-}"; shift ;;
    --yes|-y) ASSUME_YES=1 ;;
    # Uso interno: é como o atualizador da versão anterior passa a vez a este.
    --resume) resume=1 ;;
    -h|--help) sed -n '2,13p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "Não conheço a opção $1." "Use --to <versão> e/ou --yes." ;;
  esac
  shift
done
require_install
docker info >/dev/null 2>&1 || die "Não consegui falar com o Docker." "Confira se ele está rodando: sudo systemctl start docker"

is_git=0; if is_clone; then is_git=1; fi
previous_commit=""; backup_dir=""; entry_was_ok=0

if [ "$resume" = 1 ]; then
  # Continuação: o backup, a troca do código e as conferências já foram feitos pela versão anterior.
  current="${DESKVOICE_UPDATE_FROM:-}"; previous_commit="${DESKVOICE_UPDATE_FROM_REF:-}"
  backup_dir="${DESKVOICE_UPDATE_BACKUP:-}"; entry_was_ok="${DESKVOICE_UPDATE_ENTRY_WAS_OK:-0}"
  target="$(version_of_tag "$target")"
  { [ -n "$current" ] && is_version "$target" && [ -f "$backup_dir/manifest.txt" ]; } \
    || die "--resume é de uso interno do atualizador e veio sem o que ele precisa (versão de origem, alvo e backup)." "Rode sem essa opção: bash install/update.sh"
else

# Pode ser um número, `local` (imagens construídas aqui) ou o que uma instalação de antes do
# formato único gravou (um canal, ou o número com `v`). Qualquer coisa diferente do alvo converge.
current="$(env_get "$ENV_FILE" DESKVOICE_VERSION)"

step "Versões"
if [ -z "$target" ]; then
  [ "$is_git" = 1 ] || die "Não sei qual é a versão mais recente: esta pasta não é um clone do repositório." "Diga a versão: bash install/update.sh --to <versão>"
  fetch_versions || die "Não consegui consultar as versões publicadas." "Confira a internet da VPS (git -C $REPO_DIR fetch --tags origin) ou diga a versão: bash install/update.sh --to <versão>"
  target="$(latest_version)"
  [ -n "$target" ] || die "Ainda não há nenhuma versão publicada para atualizar." "Quando houver, rode de novo; ou diga a versão: bash install/update.sh --to <versão>"
fi
# Aceita o número (0.3.0) e a tag do git (v0.3.0); daqui em diante é sempre o número.
target="$(version_of_tag "$target")"
is_version "$target" || die "O nome de versão '$target' não vale." "Use o número da versão, como 0.3.0."
target_tag="$(tag_of_version "$target")"
info "Atual: $current"
info "Alvo:  $target"
if [ "$current" = "$target" ]; then
  # Quem chegou a esta versão pelo atualizador de uma versão sem agente ganha o agente aqui.
  converge_agent
  ok "Esta instalação já está na versão $target. Nada a fazer."
  exit 0
fi

if [ "$is_git" = 1 ]; then
  [ -z "$(git -C "$REPO_DIR" status --porcelain --untracked-files=no)" ] \
    || die "Há arquivos do DeskVoice alterados à mão nesta pasta; atualizar por cima poderia perder essas mudanças." "Veja quais com: git status  — desfaça (git checkout -- <arquivo>) ou guarde uma cópia, e rode de novo."
  previous_commit="$(git -C "$REPO_DIR" symbolic-ref -q --short HEAD || git -C "$REPO_DIR" rev-parse HEAD)"
  git -C "$REPO_DIR" fetch --tags --quiet origin || warn "Não consegui buscar as versões no GitHub; sigo com o que já está nesta máquina."
  git -C "$REPO_DIR" rev-parse --verify --quiet "refs/tags/$target_tag" >/dev/null \
    || die "A versão $target não existe no repositório (procurei a tag $target_tag)." "Veja as versões com: git tag --list  — e rode de novo com --to <versão>."
fi
confirm "Atualizar de $current para $target? (faço um backup antes; se algo falhar, volto sozinho)" \
  || die "Atualização cancelada: nada foi alterado." "Quando quiser, rode de novo."

step "Backup antes de mexer"
backup_dir="$(bash "$KIT_DIR/backup.sh" | tee /dev/stderr | tail -n 1)" \
  || die "O backup falhou, então a atualização NÃO começou. Nada foi alterado." "Resolva o problema do backup acima (bash install/backup.sh) e rode de novo."
[ -f "$backup_dir/manifest.txt" ] || die "O backup não deixou manifesto em '$backup_dir'; sem backup conferido eu não atualizo." "Rode bash install/backup.sh e veja o erro."

# Guarda as imagens atuais com outro nome, para a volta não depender de baixar nem de reconstruir.
for service in $APP_SERVICES; do
  docker tag "$(image_ref "$service" "$current")" "$(image_ref "$service" rollback)" 2>/dev/null || true
done
fi   # fim do que só a versão anterior faz

apply_version() {  # apply_version <versão> <commit ou tag do código>
  if [ "$is_git" = 1 ] && [ -n "$2" ]; then git -C "$REPO_DIR" checkout --quiet "$2" || return 1; fi
  env_set "$ENV_FILE" DESKVOICE_VERSION "$1"
}
# A entrada única não é peça essencial em termos absolutos (certificado que ainda não saiu daria
# volta falsa). Mas se ela respondia ANTES da atualização e parou DEPOIS, a atualização quebrou o
# caminho de quem usa o painel: conta como falha e volta.
entry_ok() { NO_COLOR=1 bash "$KIT_DIR/healthcheck.sh" --json 2>/dev/null | grep -q '"id":"entry"[^}]*"status":"ok"'; }
wait_healthy() {
  local waited=0 timeout="${DESKVOICE_HEALTH_TIMEOUT:-240}"
  until NO_COLOR=1 bash "$KIT_DIR/healthcheck.sh" --essential >/dev/null 2>&1 && { [ "$entry_was_ok" = 0 ] || entry_ok; }; do
    [ "$waited" -lt "$timeout" ] || return 1
    sleep 5; waited=$((waited + 5))
  done
}
roll_back() {  # roll_back "<o que falhou>"
  fail "$1"
  step "Voltando para a versão $current"
  NO_COLOR=1 bash "$KIT_DIR/healthcheck.sh" --essential 2>&1 | sed 's/^/  /' >&2 || true
  local problems=""
  apply_version "$current" "$previous_commit" || problems="$problems não consegui voltar o código para $previous_commit;"
  for service in $APP_SERVICES; do
    docker tag "$(image_ref "$service" rollback)" "$(image_ref "$service" "$current")" 2>/dev/null || true
  done
  # O banco pode já ter recebido migrations da versão nova: volta ao estado do backup.
  bash "$KIT_DIR/restore.sh" --yes "$backup_dir" || problems="$problems a restauração do banco falhou;"
  dc up -d --remove-orphans >/dev/null 2>&1 || problems="$problems os serviços não subiram;"
  if [ -z "$problems" ] && wait_healthy; then
    die "A atualização para $target não deu certo e foi desfeita: você está de volta na versão $current, com o banco do backup de antes da atualização ($backup_dir) e tudo respondendo." "Nada se perdeu além do que entrou durante a tentativa. Rode bash install/diagnose.sh e abra uma issue com o arquivo, dizendo que a atualização para $target voltou."
  fi
  die "A atualização para $target falhou E a volta para $current não terminou bem:${problems:- a versão anterior não respondeu depois de voltar.}" "Seus dados estão no backup $backup_dir. Não rode mais nada: gere o diagnóstico (bash install/diagnose.sh) e peça ajuda."
}

if [ "$resume" = 0 ]; then
  if entry_ok; then entry_was_ok=1; fi
  step "Trocando para a versão $target"
  if [ -n "$previous_commit" ]; then
    git -C "$REPO_DIR" checkout --quiet "refs/tags/$target_tag" || die "Não consegui trocar o código para a versão $target. Nada foi alterado: a instalação segue na versão $current." "Veja o motivo com: git -C $REPO_DIR status  — e rode de novo."
    # O código no disco agora é o da versão de destino: a vez passa ao atualizador dela. Antes,
    # confere que ele ao menos carrega; se não, o código volta e nada mais foi tocado.
    if grep -q 'DESKVOICE_UPDATE_FROM' "$KIT_DIR/update.sh" 2>/dev/null; then
      if ! bash -n "$KIT_DIR/update.sh" || ! bash -n "$KIT_DIR/_common.sh"; then
        git -C "$REPO_DIR" checkout --quiet "$previous_commit" || true
        die "O atualizador da versão $target não carrega (erro de sintaxe acima). Nada foi alterado: a instalação segue na versão $current." "Abra uma issue dizendo a versão de origem e a de destino."
      fi
      export DESKVOICE_UPDATE_FROM="$current" DESKVOICE_UPDATE_FROM_REF="$previous_commit" DESKVOICE_UPDATE_BACKUP="$backup_dir" DESKVOICE_UPDATE_ENTRY_WAS_OK="$entry_was_ok"
      exec bash "$KIT_DIR/update.sh" --resume --to "$target" --yes
    fi
    # Versão de destino anterior a este mecanismo: segue com o que está na memória, como antes.
  fi
fi
env_set "$ENV_FILE" DESKVOICE_VERSION "$target"
# As imagens vêm antes de qualquer outra mudança. Sem elas não há atualização, e construir aqui
# não é saída: até este ponto só a versão foi trocada, então basta voltá-la. O banco e os
# serviços não foram tocados.
# shellcheck disable=SC2086
if pull_output="$(dc pull -q $APP_SERVICES 2>&1)"; then ok "Imagens da versão $target baixadas"
else
  printf '%s\n' "$pull_output" | tail -n 5 | sed 's/^/    /' >&2
  apply_version "$current" "$previous_commit" \
    || die "Não consegui baixar as imagens da versão $target, e também não consegui voltar o código para $previous_commit." "Os serviços seguem rodando na versão anterior e o banco não foi tocado. Rode: git -C $REPO_DIR checkout $previous_commit  — e depois bash install/diagnose.sh para pedir ajuda."
  die "Não consegui baixar as imagens da versão $target (resposta do Docker acima). Nada foi alterado: a instalação segue na versão $current, e o banco não foi tocado." "Causas prováveis: a internet da VPS ou o ghcr.io fora do ar; ou a versão acabou de sair e as imagens ainda estão sendo publicadas (espere alguns minutos). Teste com: docker pull $(image_ref panel "$target")  — e rode bash install/update.sh de novo."
fi
render_asterisk_config
# Instalação de antes da entrada única: o Caddy passa a ser a única porta publicada, na mesma
# porta que o painel já usava. Em instalação já no formato atual, não muda nada.
converge_entry
# O endereço das imagens deixou de ser gravado por instalação: a fonte única é deploy/images.env.
env_unset "$ENV_FILE" DESKVOICE_IMAGE_PREFIX
# O painel que vai subir já recebe o segredo do agente de atualização.
ensure_agent_token || true

step "Aplicando as mudanças no banco"
# shellcheck disable=SC2086
dc stop $APP_SERVICES >/dev/null 2>&1 || true
dc run --rm migrate || roll_back "As migrations da versão $target falharam."
ok "Banco atualizado"

step "Subindo e conferindo"
dc up -d --remove-orphans || roll_back "Os serviços da versão $target não subiram."
# O Caddyfile é montado como arquivo, e a troca de versão o substitui por outro: o contêiner que
# já estava de pé só passa a ler o novo ao reiniciar.
dc restart caddy >/dev/null 2>&1 || true
wait_healthy || roll_back "A versão $target subiu, mas nem toda peça essencial respondeu, ou o painel deixou de abrir pelo endereço que abria antes."

for service in $APP_SERVICES; do docker rmi "$(image_ref "$service" rollback)" >/dev/null 2>&1 || true; done
# Instalação que veio de uma versão sem agente passa a tê-lo; nas outras, só confere.
install_agent_schedule
ok "Atualizado para $target, com todas as peças essenciais respondendo."
info "Backup de antes da atualização: $backup_dir"
info "Relatório completo: bash install/healthcheck.sh"
}
main "$@"
