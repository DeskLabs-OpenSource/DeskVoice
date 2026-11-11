#!/usr/bin/env bash
# Restaura um backup feito pelo backup.sh. SUBSTITUI o banco atual.
#
#   bash install/restore.sh latest                      o backup mais recente
#   bash install/restore.sh backups/20261110-030000     um backup específico
#   --with-config   restaura também os três arquivos de ambiente e os do Asterisk do backup
#                   (necessário ao mudar de VPS: sem a chave antiga os segredos não abrem)
#   --yes           não pede a confirmação digitada (uso do update.sh e de automação)
#
# Ordem de segurança: o backup é restaurado primeiro num banco ao lado, as contagens de
# cada tabela são comparadas com o manifesto, e só então ele toma o lugar do banco atual.
# Se algo divergir, o banco atual fica como estava.
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

source_arg=""; ASSUME_YES=0; with_config=0
for arg in "$@"; do
  case "$arg" in
    --yes) ASSUME_YES=1 ;;
    --with-config) with_config=1 ;;
    -h|--help) sed -n '2,12p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) die "Não conheço a opção $arg." "Veja as opções com: bash install/restore.sh --help" ;;
    *) source_arg="$arg" ;;
  esac
done
require_install

if [ -z "$source_arg" ] || [ "$source_arg" = latest ]; then
  latest="$(cd "$BACKUP_DIR" 2>/dev/null && ls -1d [0-9]*-[0-9]* 2>/dev/null | sort | tail -n 1 || true)"
  [ -n "$latest" ] || die "Não há nenhum backup em $BACKUP_DIR." "Faça um com: bash install/backup.sh"
  src="$BACKUP_DIR/$latest"
else
  src="$source_arg"
fi
manifest="$src/manifest.txt"; dump="$src/db.dump"
[ -f "$manifest" ] && [ -f "$dump" ] || die "A pasta $src não tem um backup completo (faltam manifest.txt ou db.dump)." "Liste os backups com: ls $BACKUP_DIR"

step "Conferindo o arquivo do backup"
expected_sha="$(env_get "$manifest" dump_sha256)"
actual_sha="$(sha256_of "$dump")"
[ "$expected_sha" = "$actual_sha" ] || die "O arquivo db.dump não bate com o manifesto: foi alterado ou corrompeu depois do backup." "Use outro backup de $BACKUP_DIR."
ok "arquivo íntegro (sha256 confere)"

if [ "$with_config" = 0 ] && [ -f "$src/app.env" ] && [ "$(env_get "$src/app.env" DESKVOICE_SECRET_KEY)" != "$(env_get "$APP_ENV_FILE" DESKVOICE_SECRET_KEY)" ]; then
  die "Este backup foi feito com outra chave de segredos: restaurado só o banco, a senha da linha e a chave de IA não abririam." "Rode de novo com --with-config para restaurar também a configuração do backup."
fi

if [ "$ASSUME_YES" != 1 ]; then
  printf '\n%sIsto vai SUBSTITUIR o banco do DeskVoice desta máquina pelo backup de %s.%s\n' "$C_BLD" "$(env_get "$manifest" created_at)" "$C_OFF"
  printf '  Tudo o que entrou depois desse backup (chamadas, agentes, configurações) será perdido.\n'
  printf '  Para confirmar, digite RESTAURAR: '
  read -r typed || typed=""
  [ "$typed" = RESTAURAR ] || die "Restauração cancelada: nada foi alterado." "Para restaurar, rode de novo e digite RESTAURAR em maiúsculas."
fi

scratch="deskvoice_restore"; old="deskvoice_before_restore"
admin() { dc exec -T postgres psql -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 -q -c "set client_min_messages = warning" -c "$1"; }
restart_apps() { dc up -d >/dev/null 2>&1 || warn "Não consegui religar os serviços. Rode: docker compose -f deploy/docker-compose.yml up -d"; }

step "Parando painel, voz e rotinas"
# shellcheck disable=SC2086
dc stop $APP_SERVICES >/dev/null || die "Não consegui parar os serviços." "Confira o Docker (docker ps) e rode de novo. Nada foi alterado."

step "Restaurando num banco ao lado"
admin "drop database if exists $scratch with (force)" && admin "create database $scratch owner $DB_USER" \
  || { restart_apps; die "Não consegui criar o banco de trabalho." "Confira o espaço em disco (df -h). O banco atual não foi alterado."; }
if ! dc exec -T postgres pg_restore -U "$DB_USER" -d "$scratch" --no-owner --exit-on-error < "$dump" >/dev/null; then
  admin "drop database if exists $scratch with (force)" || true
  restart_apps
  die "O backup não restaurou por inteiro." "O banco atual não foi alterado. Tente outro backup de $BACKUP_DIR."
fi

step "Comparando as contagens com o manifesto"
actual="$(mktemp)"
table_counts "$scratch" > "$actual"
if ! differences="$(compare_counts "$manifest" "$actual")"; then
  rm -f "$actual"
  admin "drop database if exists $scratch with (force)" || true
  restart_apps
  fail "O banco restaurado NÃO bate com o backup:"
  printf '%s\n' "$differences" | sed 's/^/    /' >&2
  die "Restauração recusada: o banco atual não foi alterado." "Use outro backup, ou rode bash install/diagnose.sh e peça ajuda com a lista acima."
fi
rm -f "$actual"
ok "todas as $(grep -c '^table:' "$manifest") tabelas com a mesma contagem do backup"

step "Trocando o banco"
admin "drop database if exists $old with (force)" \
  && admin "select pg_terminate_backend(pid) from pg_stat_activity where datname in ('$DB_NAME', '$scratch') and pid <> pg_backend_pid()" >/dev/null \
  && admin "alter database $DB_NAME rename to $old" \
  || { restart_apps; die "Não consegui tirar o banco atual do lugar." "O banco atual continua valendo. Rode de novo em um minuto."; }
if ! admin "alter database $scratch rename to $DB_NAME"; then
  admin "alter database $old rename to $DB_NAME" || true
  restart_apps
  die "Não consegui colocar o banco restaurado no lugar; devolvi o banco anterior." "Rode de novo. Se repetir: bash install/diagnose.sh"
fi

if [ "$with_config" = 1 ]; then
  step "Restaurando a configuração"
  for pair in "env|$ENV_FILE" "app.env|$APP_ENV_FILE" "migrate.env|$MIGRATE_ENV_FILE"; do
    from="$src/${pair%%|*}"; to="${pair#*|}"
    [ -f "$from" ] || die "O backup não tem o arquivo ${pair%%|*}: não dá para restaurar a configuração dele." "O banco já foi restaurado. Rode bash install/install.sh para regerar a configuração."
    cp -p "$to" "$to.before-restore"
    cp "$from" "$to"; chmod 600 "$to"
  done
  render_asterisk_config
  ok "configuração do backup no lugar (a anterior ficou nos arquivos .before-restore, em deploy/)"
  # A senha do dono do banco mora no volume do Postgres: iguala à do arquivo que entrou.
  # As dos papéis da aplicação são redefinidas pelo migrate, logo abaixo.
  printf "alter role %s with password '%s';\n" "$DB_USER" "$(env_get "$ENV_FILE" POSTGRES_PASSWORD)" \
    | dc exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -q >/dev/null \
    && dc run --rm migrate >/dev/null \
    || die "A configuração do backup entrou, mas não consegui acertar as senhas do banco com ela." "Rode: bash install/install.sh (ele refaz esse passo sem perder dados)."
fi

# Última conferência, já no banco que está valendo.
final="$(mktemp)"
table_counts "$DB_NAME" > "$final"
if ! differences="$(compare_counts "$manifest" "$final")"; then
  rm -f "$final"
  fail "Depois da troca, o banco não bate com o backup:"
  printf '%s\n' "$differences" | sed 's/^/    /' >&2
  die "O banco anterior está guardado com o nome $old." "Não rode mais nada e peça ajuda com: bash install/diagnose.sh"
fi
rm -f "$final"
admin "drop database if exists $old with (force)" || warn "Ficou uma cópia do banco anterior ($old) ocupando disco; pode ser apagada depois."

step "Religando os serviços"
dc up -d >/dev/null || die "O banco foi restaurado e conferido, mas os serviços não subiram." "Rode: bash install/healthcheck.sh"
ok "Restaurado: o banco agora é o do backup de $(env_get "$manifest" created_at), com as contagens conferidas."
info "Confira o sistema com: bash install/healthcheck.sh"
