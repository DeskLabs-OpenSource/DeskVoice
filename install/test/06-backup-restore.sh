#!/usr/bin/env bash
# Ciclo backup → restore: o manifesto guarda as contagens, e o restore só diz
# "restaurado" quando o banco restaurado bate com elas.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
fake_install
source "$KIT/_common.sh"; set +e; trap - ERR
B="$DESKVOICE_BACKUP_DIR"
calls() { grep -c -- "$1" "$FAKE_DIR/calls.log"; }

# ── compare_counts, a decisão pura ──
printf 'deskvoice_backup=1\ntable:agents=3\ntable:calls=120\ntable:users=1\n' > "$SANDBOX/m.txt"
printf 'agents=3\ncalls=120\nusers=1\n' > "$SANDBOX/same.txt"
check "contagens iguais: aprova" compare_counts "$SANDBOX/m.txt" "$SANDBOX/same.txt"
printf 'agents=3\ncalls=119\nusers=1\n' > "$SANDBOX/diff.txt"
out="$(compare_counts "$SANDBOX/m.txt" "$SANDBOX/diff.txt")"; equal "contagem diferente: reprova" 1 "$?"
equal "diz exatamente qual tabela e os dois números" "tabela calls: o backup tinha 120 linhas, o banco restaurado tem 119" "$out"
printf 'agents=3\nusers=1\n' > "$SANDBOX/missing.txt"
out="$(compare_counts "$SANDBOX/m.txt" "$SANDBOX/missing.txt")"; equal "tabela sumida: reprova" 1 "$?"
contains "diz qual tabela sumiu" "$out" "tabela calls: o backup tinha 120 linhas e ela não existe"
printf 'agents=3\ncalls=120\nusers=1\nintrusa=9\n' > "$SANDBOX/extra.txt"
refuse "tabela a mais: reprova" compare_counts "$SANDBOX/m.txt" "$SANDBOX/extra.txt"
printf 'deskvoice_backup=1\n' > "$SANDBOX/empty.txt"
refuse "manifesto sem tabelas: reprova" compare_counts "$SANDBOX/empty.txt" "$SANDBOX/same.txt"

# ── backup ──
printf 'agents=3\ncalls=120\nusers=1\n' > "$FAKE_DIR/counts_backup"
out="$(bash "$KIT/backup.sh" 2>&1)"; equal "backup sai com zero" 0 "$?"
dir="$(printf '%s\n' "$out" | tail -n 1)"
check "última linha é a pasta do backup" test -d "$dir"
manifest="$(cat "$dir/manifest.txt")"
contains "manifesto: contagem por tabela" "$manifest" "table:calls=120"
equal "manifesto: três tabelas" 3 "$(grep -c '^table:' "$dir/manifest.txt")"
equal "manifesto: sha256 do dump confere" "$(sha256_of "$dir/db.dump")" "$(env_get "$dir/manifest.txt" dump_sha256)"
for f in env app.env migrate.env asterisk/ari.conf asterisk/rtp.conf asterisk/pjsip.conf; do check "backup inclui $f" test -s "$dir/$f"; done
equal "pasta de backups só o dono lê" 700 "$(mode_of "$B")"
equal "dump só o dono lê" 600 "$(mode_of "$dir/db.dump")"
equal "o dump foi restaurado num banco de rascunho antes do 'concluído'" 1 "$(calls 'pg_restore -U deskvoice -d deskvoice_verify_')"
check "o banco de rascunho foi apagado" grep -q "dropdb -U deskvoice --if-exists deskvoice_verify_" "$FAKE_DIR/calls.log"
refuse "a trava foi solta" test -e "$B/.lock"

# dump que não restaura: não vira backup
echo 1 > "$FAKE_DIR/pg_restore_exit"
out="$(bash "$KIT/backup.sh" 2>&1)"; equal "dump corrompido: backup falha" 1 "$?"
lacks "dump corrompido: não diz concluído" "$out" "Backup concluído"
equal "dump corrompido: não deixa pasta de backup nem resto" 1 "$(ls -A "$B" | wc -l | tr -d ' ')"
echo 0 > "$FAKE_DIR/pg_restore_exit"
touch "$FAKE_DIR/pg_dump_fail"
refuse "pg_dump que falha: backup falha" bash "$KIT/backup.sh"
rm "$FAKE_DIR/pg_dump_fail"
: > "$FAKE_DIR/counts_backup"
refuse "banco sem tabela nenhuma: backup falha" bash "$KIT/backup.sh"
printf 'agents=3\ncalls=120\nusers=1\n' > "$FAKE_DIR/counts_backup"

# trava: outro backup vivo impede; trava de processo morto é assumida
mkdir "$B/.lock"; echo $$ > "$B/.lock/pid"
out="$(bash "$KIT/backup.sh" 2>&1)"; equal "segundo backup ao mesmo tempo é recusado" 1 "$?"
contains "diz que já há um backup rodando" "$out" "Já existe um backup rodando"
check "a trava do outro processo fica intacta" test -f "$B/.lock/pid"
echo 999999 > "$B/.lock/pid"
check "trava de processo morto não bloqueia para sempre" bash "$KIT/backup.sh"

# rotação
for stamp in 20200101-000001 20200101-000002 20200101-000003; do mkdir "$B/$stamp"; echo x > "$B/$stamp/manifest.txt"; done
mkdir "$B/20200101-000000"   # pasta com cara de backup mas sem manifesto: não é nossa, não apaga
mkdir "$B/minhas-coisas"
dir="$(bash "$KIT/backup.sh" --keep 2 2>/dev/null | tail -n 1)"
check "rotação mantém o backup mais novo" test -f "$dir/manifest.txt"
equal "rotação deixa exatamente dois backups com manifesto" 2 "$(ls "$B"/*/manifest.txt | wc -l | tr -d ' ')"
refuse "rotação remove os antigos" test -e "$B/20200101-000003"
check "rotação não apaga pasta sem manifesto" test -d "$B/20200101-000000"
check "rotação não apaga pasta alheia" test -d "$B/minhas-coisas"
refuse "rotação inválida é recusada" bash "$KIT/backup.sh" --keep 0
rmdir "$B/20200101-000000" "$B/minhas-coisas"

# ── restore com contagens iguais ──
printf 'agents=3\ncalls=120\nusers=1\n' > "$FAKE_DIR/counts_restore"
: > "$FAKE_DIR/calls.log"
out="$(bash "$KIT/restore.sh" --yes "$dir" 2>&1)"; equal "restore com contagens iguais sai com zero" 0 "$?"
contains "diz restaurado" "$out" "Restaurado:"
contains "diz que conferiu as três tabelas" "$out" "todas as 3 tabelas com a mesma contagem"
equal "trocou o banco de lugar" 1 "$(calls 'alter database deskvoice_restore rename to deskvoice')"
check "parou os serviços antes" grep -q "stop panel voice routines" "$FAKE_DIR/calls.log"

# ── restore com contagens divergentes ──
printf 'agents=3\ncalls=97\nusers=1\n' > "$FAKE_DIR/counts_restore"
: > "$FAKE_DIR/calls.log"
out="$(bash "$KIT/restore.sh" --yes "$dir" 2>&1)"; equal "restore divergente sai com erro" 1 "$?"
lacks "divergente: não diz restaurado" "$out" "Restaurado:"
contains "divergente: diz exatamente qual tabela" "$out" "tabela calls: o backup tinha 120 linhas, o banco restaurado tem 97"
equal "divergente: o banco atual NÃO é trocado" 0 "$(calls 'rename to')"
check "divergente: religa os serviços" grep -q " up -d" "$FAKE_DIR/calls.log"

# divergência só depois da troca (banco valendo diferente do conferido)
printf 'agents=3\ncalls=120\nusers=1\n' > "$FAKE_DIR/counts_restore"
printf 'agents=3\ncalls=120\nusers=0\n' > "$FAKE_DIR/counts_live"
out="$(bash "$KIT/restore.sh" --yes "$dir" 2>&1)"; equal "divergência depois da troca sai com erro" 1 "$?"
contains "depois da troca: diz a tabela" "$out" "tabela users: o backup tinha 1 linhas, o banco restaurado tem 0"
lacks "depois da troca: não diz restaurado" "$out" "Restaurado:"
rm "$FAKE_DIR/counts_live"

# ── guardas ──
: > "$FAKE_DIR/calls.log"
out="$(echo "sim" | bash "$KIT/restore.sh" "$dir" 2>&1)"; equal "confirmação errada cancela" 1 "$?"
contains "confirmação errada: diz que nada mudou" "$out" "nada foi alterado"
equal "confirmação errada: nada foi executado no Docker (só a pergunta de quem é a instalação)" 0 "$(grep -vc 'ps -a --filter label=com.docker.compose.project=deskvoice' "$FAKE_DIR/calls.log")"
check "confirmação digitada certa restaura" bash -c "echo RESTAURAR | bash '$KIT/restore.sh' '$dir'"
check "latest acha o backup mais recente" bash "$KIT/restore.sh" --yes latest

cp -R "$dir" "$SANDBOX/tampered"; echo "lixo" >> "$SANDBOX/tampered/db.dump"
: > "$FAKE_DIR/calls.log"
out="$(bash "$KIT/restore.sh" --yes "$SANDBOX/tampered" 2>&1)"; equal "dump alterado depois do backup é recusado" 1 "$?"
contains "dump alterado: diz o motivo" "$out" "não bate com o manifesto"
equal "dump alterado: nada foi executado no Docker (só a pergunta de quem é a instalação)" 0 "$(grep -vc 'ps -a --filter label=com.docker.compose.project=deskvoice' "$FAKE_DIR/calls.log")"

cp -R "$dir" "$SANDBOX/otherkey"; env_set "$SANDBOX/otherkey/app.env" DESKVOICE_SECRET_KEY "outra-chave-de-outra-vps"
out="$(bash "$KIT/restore.sh" --yes "$SANDBOX/otherkey" 2>&1)"; equal "backup de outra chave sem --with-config é recusado" 1 "$?"
contains "outra chave: manda usar --with-config" "$out" "--with-config"
check "outra chave com --with-config restaura" bash "$KIT/restore.sh" --yes --with-config "$SANDBOX/otherkey"
equal "--with-config traz a chave do backup" "outra-chave-de-outra-vps" "$(env_get "$DESKVOICE_DEPLOY_DIR/app.env" DESKVOICE_SECRET_KEY)"
check "--with-config guarda a configuração anterior" test -f "$DESKVOICE_DEPLOY_DIR/app.env.before-restore"
refuse "pasta sem backup é recusada" bash "$KIT/restore.sh" --yes "$SANDBOX"
finish
