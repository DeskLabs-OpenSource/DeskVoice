#!/usr/bin/env bash
# Backup: dump do banco + os três arquivos de ambiente + arquivos gerados do Asterisk, numa pasta por backup.
#
#   bash install/backup.sh            faz o backup e mantém os 14 mais recentes
#   bash install/backup.sh --keep 30  muda a rotação (ou DESKVOICE_BACKUP_KEEP=30)
#
# Só diz "concluído" depois de RESTAURAR o dump num banco de rascunho e contar as linhas
# de cada tabela. Essas contagens vão para o manifesto, e é contra elas que o restore.sh
# confere. Backup que ninguém consegue abrir não é backup.
#
# Agendar todo dia às 3h:  crontab -e  →  0 3 * * * cd /caminho/DeskVoice && bash install/backup.sh
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

keep="${DESKVOICE_BACKUP_KEEP:-14}"
while [ $# -gt 0 ]; do
  case "$1" in
    --keep) keep="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,11p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "Não conheço a opção $1." "Use --keep <quantidade> ou nenhuma opção." ;;
  esac
done
case "$keep" in ''|*[!0-9]*|0) die "A rotação precisa ser um número a partir de 1 (recebi: '$keep')." "Exemplo: bash install/backup.sh --keep 14" ;; esac
require_install

# O backup tem o banco inteiro e os arquivos de ambiente: só o dono lê.
umask 077
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR" 2>/dev/null || warn "Não consegui fechar a pasta $BACKUP_DIR só para você; os arquivos dentro dela saem protegidos mesmo assim."

# ── Trava: dois backups ao mesmo tempo disputariam o banco de rascunho ──
lock="$BACKUP_DIR/.lock"
if ! mkdir "$lock" 2>/dev/null; then
  other="$(cat "$lock/pid" 2>/dev/null || true)"
  if [ -n "$other" ] && kill -0 "$other" 2>/dev/null; then
    die "Já existe um backup rodando (processo $other)." "Espere ele terminar e rode de novo."
  fi
  warn "Achei a trava de um backup que não terminou (processo ${other:-desconhecido} não existe mais). Assumindo a trava."
fi
echo $$ > "$lock/pid"

stamp="$(date +%Y%m%d-%H%M%S)"
# Dois backups no mesmo segundo teriam o mesmo nome: espera o relógio virar.
while [ -e "$BACKUP_DIR/$stamp" ]; do sleep 1; stamp="$(date +%Y%m%d-%H%M%S)"; done
dest="$BACKUP_DIR/$stamp"
partial="$BACKUP_DIR/.partial-$stamp"
scratch="deskvoice_verify_$$"
finished=0
cleanup() {
  dc exec -T postgres dropdb -U "$DB_USER" --if-exists "$scratch" >/dev/null 2>&1 || true
  # Caminhos montados neste script, a partir de BACKUP_DIR conferido acima.
  if [ "$finished" = 0 ] && [ -n "$partial" ] && [ -d "$partial" ]; then rm -rf "$partial"; fi
  rm -f "$lock/pid"; rmdir "$lock" 2>/dev/null || true
}
trap cleanup EXIT

mkdir "$partial"

step "Copiando o banco"
if ! dc exec -T postgres pg_dump -U "$DB_USER" -d "$DB_NAME" -Fc --no-owner > "$partial/db.dump"; then
  die "O dump do banco falhou no meio; apaguei o arquivo incompleto." "Confira se o banco está no ar (bash install/healthcheck.sh) e se há espaço em disco (df -h)."
fi
[ -s "$partial/db.dump" ] || die "O dump do banco saiu vazio; apaguei o arquivo." "Confira se o banco está no ar: bash install/healthcheck.sh"
ok "dump gravado ($(du -h "$partial/db.dump" | awk '{print $1}'))"

step "Conferindo se o backup abre"
dc exec -T postgres createdb -U "$DB_USER" "$scratch" \
  || die "Não consegui criar o banco de rascunho para conferir o backup." "Confira o espaço em disco (df -h) e rode de novo."
if ! dc exec -T postgres pg_restore -U "$DB_USER" -d "$scratch" --no-owner --exit-on-error < "$partial/db.dump" >/dev/null; then
  die "O dump foi gravado mas não restaura: está corrompido. Apaguei para ninguém confiar nele." "Rode o backup de novo. Se repetir, rode bash install/diagnose.sh e peça ajuda."
fi
counts="$(table_counts "$scratch")" || die "Não consegui contar as linhas do backup restaurado." "Rode o backup de novo."
[ -n "$counts" ] || die "O backup restaurou sem nenhuma tabela: o banco de origem está vazio ou o dump está errado." "Confira se a instalação terminou (bash install/healthcheck.sh) antes de fazer backup."
ok "restaurado num banco de rascunho: $(printf '%s\n' "$counts" | wc -l | tr -d ' ') tabelas contadas"

step "Guardando a configuração"
cp "$ENV_FILE" "$partial/env"
cp "$APP_ENV_FILE" "$partial/app.env"
cp "$MIGRATE_ENV_FILE" "$partial/migrate.env"
if [ -d "$GENERATED_DIR" ]; then mkdir "$partial/asterisk" && cp "$GENERATED_DIR"/*.conf "$partial/asterisk/" 2>/dev/null || true; fi
if [ -f "$PROXY_OVERRIDE" ]; then cp "$PROXY_OVERRIDE" "$partial/"; fi

{
  echo "deskvoice_backup=1"
  echo "created_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "version=$(env_get "$ENV_FILE" DESKVOICE_VERSION)"
  echo "dump_sha256=$(sha256_of "$partial/db.dump")"
  echo "dump_bytes=$(wc -c < "$partial/db.dump" | tr -d ' ')"
  printf '%s\n' "$counts" | sed 's/^/table:/'
} > "$partial/manifest.txt"

mv "$partial" "$dest"
finished=1

# ── Rotação: só pastas com cara de backup nosso, dentro de BACKUP_DIR ──
removed=0
for old in $(cd "$BACKUP_DIR" && ls -1d [0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9][0-9][0-9] 2>/dev/null | sort -r | tail -n +"$((keep + 1))"); do
  if [ -n "$old" ] && [ -f "$BACKUP_DIR/$old/manifest.txt" ]; then rm -rf "${BACKUP_DIR:?}/$old"; removed=$((removed + 1)); fi
done
[ "$removed" -gt 0 ] && info "Rotação: removi $removed backup(s) antigo(s); ficam os $keep mais recentes."

ok "Backup concluído e conferido: $dest"
# A última linha é o caminho: o update.sh lê daqui.
echo "$dest"
