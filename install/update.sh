#!/usr/bin/env bash
# Atualiza o DeskVoice. Nunca roda sem backup, e desfaz tudo se a versão nova não ficar saudável.
#
#   bash install/update.sh                atualiza para a versão publicada mais recente
#   bash install/update.sh --to v0.3.0    atualiza para uma versão específica
#   --yes                                 não pede confirmação
#
# Ordem: mostra versão atual e alvo → backup conferido → troca a versão → migrations →
# checagem de saúde. Se alguma peça essencial não responder, volta para a versão anterior
# e restaura o banco do backup, dizendo o que aconteceu.
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

# Tudo dentro de uma função: o bash lê o arquivo aos poucos, e a troca de versão reescreve
# este próprio script no meio da execução. Assim ele já está inteiro na memória.
# shellcheck disable=SC2034  # ASSUME_YES é lida por confirm(), no _common.sh
main() {

target=""; ASSUME_YES=0
while [ $# -gt 0 ]; do
  case "$1" in
    --to) target="${2:-}"; shift ;;
    --yes|-y) ASSUME_YES=1 ;;
    -h|--help) sed -n '2,10p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "Não conheço a opção $1." "Use --to <versão> e/ou --yes." ;;
  esac
  shift
done
require_install
docker info >/dev/null 2>&1 || die "Não consegui falar com o Docker." "Confira se ele está rodando: sudo systemctl start docker"

is_git=0; if have git && git -C "$REPO_DIR" rev-parse --git-dir >/dev/null 2>&1; then is_git=1; fi
current="$(env_get "$ENV_FILE" DESKVOICE_VERSION)"
prefix="$(env_get "$ENV_FILE" DESKVOICE_IMAGE_PREFIX)"

step "Versões"
if [ -z "$target" ]; then
  [ "$is_git" = 1 ] || die "Não sei qual é a versão mais recente: esta pasta não é um clone do repositório." "Diga a versão: bash install/update.sh --to <versão>"
  git -C "$REPO_DIR" fetch --tags --quiet origin || die "Não consegui consultar as versões publicadas." "Confira a internet da VPS (git fetch) ou diga a versão: bash install/update.sh --to <versão>"
  target="$(git -C "$REPO_DIR" tag --list 'v[0-9]*' --sort=-v:refname | head -n 1)"
  [ -n "$target" ] || die "Ainda não há nenhuma versão publicada para atualizar." "Quando houver, rode de novo; ou diga a versão: bash install/update.sh --to <versão>"
fi
case "$target" in *[!A-Za-z0-9._-]*|'') die "O nome de versão '$target' não vale." "Use algo como v0.3.0." ;; esac
info "Atual: $current"
info "Alvo:  $target"
if [ "$current" = "$target" ]; then ok "Esta instalação já está na versão $target. Nada a fazer."; exit 0; fi

previous_commit=""
if [ "$is_git" = 1 ]; then
  [ -z "$(git -C "$REPO_DIR" status --porcelain --untracked-files=no)" ] \
    || die "Há arquivos do DeskVoice alterados à mão nesta pasta; atualizar por cima poderia perder essas mudanças." "Veja quais com: git status  — desfaça (git checkout -- <arquivo>) ou guarde uma cópia, e rode de novo."
  previous_commit="$(git -C "$REPO_DIR" symbolic-ref -q --short HEAD || git -C "$REPO_DIR" rev-parse HEAD)"
  git -C "$REPO_DIR" fetch --tags --quiet origin || warn "Não consegui buscar as versões no GitHub; sigo com o que já está nesta máquina."
  git -C "$REPO_DIR" rev-parse --verify --quiet "refs/tags/$target" >/dev/null \
    || die "A versão $target não existe no repositório." "Veja as versões com: git tag --list  — e rode de novo com --to <versão>."
fi
confirm "Atualizar de $current para $target? (faço um backup antes; se algo falhar, volto sozinho)" \
  || die "Atualização cancelada: nada foi alterado." "Quando quiser, rode de novo."

step "Backup antes de mexer"
backup_dir="$(bash "$KIT_DIR/backup.sh" | tee /dev/stderr | tail -n 1)" \
  || die "O backup falhou, então a atualização NÃO começou. Nada foi alterado." "Resolva o problema do backup acima (bash install/backup.sh) e rode de novo."
[ -f "$backup_dir/manifest.txt" ] || die "O backup não deixou manifesto em '$backup_dir'; sem backup conferido eu não atualizo." "Rode bash install/backup.sh e veja o erro."

# Guarda as imagens atuais com outro nome: se o alvo usar o mesmo nome (ex.: stable), dá para voltar.
for service in $APP_SERVICES; do
  docker tag "$prefix/deskvoice-$service:$current" "$prefix/deskvoice-$service:rollback" 2>/dev/null || true
done

apply_version() {  # apply_version <versão> <commit ou tag do código>
  if [ "$is_git" = 1 ] && [ -n "$2" ]; then git -C "$REPO_DIR" checkout --quiet "$2" || return 1; fi
  env_set "$ENV_FILE" DESKVOICE_VERSION "$1"
}
wait_healthy() {
  local waited=0 timeout="${DESKVOICE_HEALTH_TIMEOUT:-240}"
  until NO_COLOR=1 bash "$KIT_DIR/healthcheck.sh" --essential >/dev/null 2>&1; do
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
    docker tag "$prefix/deskvoice-$service:rollback" "$prefix/deskvoice-$service:$current" 2>/dev/null || true
  done
  # O banco pode já ter recebido migrations da versão nova: volta ao estado do backup.
  bash "$KIT_DIR/restore.sh" --yes "$backup_dir" || problems="$problems a restauração do banco falhou;"
  dc up -d --remove-orphans >/dev/null 2>&1 || problems="$problems os serviços não subiram;"
  if [ -z "$problems" ] && wait_healthy; then
    die "A atualização para $target não deu certo e foi desfeita: você está de volta na versão $current, com o banco do backup de antes da atualização ($backup_dir) e tudo respondendo." "Nada se perdeu além do que entrou durante a tentativa. Rode bash install/diagnose.sh e abra uma issue com o arquivo, dizendo que a atualização para $target voltou."
  fi
  die "A atualização para $target falhou E a volta para $current não terminou bem:${problems:- a versão anterior não respondeu depois de voltar.}" "Seus dados estão no backup $backup_dir. Não rode mais nada: gere o diagnóstico (bash install/diagnose.sh) e peça ajuda."
}

step "Trocando para a versão $target"
apply_version "$target" "${previous_commit:+refs/tags/$target}" || roll_back "Não consegui trocar o código para a versão $target."
render_asterisk_config
# shellcheck disable=SC2086
if dc pull -q $APP_SERVICES >/dev/null 2>&1; then ok "Imagens da versão $target baixadas"
else
  warn "A versão $target não tem imagem publicada. Construindo aqui: leva alguns minutos."
  # shellcheck disable=SC2086
  dc build $APP_SERVICES || roll_back "A construção das imagens da versão $target falhou."
fi

step "Aplicando as mudanças no banco"
# shellcheck disable=SC2086
dc stop $APP_SERVICES >/dev/null 2>&1 || true
dc run --rm migrate || roll_back "As migrations da versão $target falharam."
ok "Banco atualizado"

step "Subindo e conferindo"
dc up -d --remove-orphans || roll_back "Os serviços da versão $target não subiram."
wait_healthy || roll_back "A versão $target subiu, mas nem toda peça essencial respondeu."

for service in $APP_SERVICES; do docker rmi "$prefix/deskvoice-$service:rollback" >/dev/null 2>&1 || true; done
ok "Atualizado para $target, com todas as peças essenciais respondendo."
info "Backup de antes da atualização: $backup_dir"
info "Relatório completo: bash install/healthcheck.sh"
}
main "$@"
