#!/usr/bin/env bash
# Quem atualiza é o atualizador da versão de DESTINO. O da versão instalada decide o alvo, faz o
# backup e troca o código; daí em diante roda o update.sh que acabou de chegar. Testado a partir
# da "versão anterior": uma cópia do kit numa pasta, que o git de mentira troca pela versão nova.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
fake_install
source "$KIT/_common.sh"; set +e; trap - ERR
E="$DESKVOICE_DEPLOY_DIR/.env"
export DESKVOICE_HEALTH_TIMEOUT=0
printf 'agents=3\ncalls=120\nusers=1\n' > "$FAKE_DIR/counts_backup"; cp "$FAKE_DIR/counts_backup" "$FAKE_DIR/counts_restore"
calls() { grep -c -- "$1" "$FAKE_DIR/calls.log"; }

# A instalação: o kit da versão anterior, marcado para se saber quando é ele que está rodando.
WORK="$SANDBOX/repo"; mkdir -p "$WORK/install"
cp "$KIT"/*.sh "$KIT"/*.env "$KIT"/deskvoice-agent.* "$WORK/install/"
mark() { sed "s/^ok \"Atualizado para /echo \"$1\"; ok \"Atualizado para /" "$KIT/update.sh"; }   # mark <marca> → o update.sh com a marca
mark ATUALIZADOR-DA-0.1.0 > "$WORK/install/update.sh"
check "a marca entrou no atualizador" grep -q ATUALIZADOR-DA-0.1.0 "$WORK/install/update.sh"
export FAKE_GIT_WORKTREE="$WORK"
# O que o git traz em cada versão: só o que muda de uma para outra.
version_tree() { mkdir -p "$FAKE_DIR/git_checkout/$1/install"; }
version_tree main
# Antes de cada atualização, "onde o clone está" (o git de mentira chama de main) é o que está instalado.
update() { cp "$WORK/install/update.sh" "$FAKE_DIR/git_checkout/main/install/update.sh"; : > "$FAKE_DIR/calls.log"; bash "$WORK/install/update.sh" --yes "$@" 2>&1; }

# ── 1. A versão de destino traz um passo novo: é o atualizador dela que roda ──
printf '%s\n' v0.2.0 v0.1.0 > "$FAKE_DIR/git_tags"
version_tree v0.2.0
# shellcheck disable=SC2016  # o $DEPLOY_DIR é do script gerado, não deste
mark ATUALIZADOR-DA-0.2.0 | sed 's/^install_agent_schedule$/install_agent_schedule; touch "$DEPLOY_DIR\/passo-novo-da-0.2.0"/' > "$FAKE_DIR/git_checkout/v0.2.0/install/update.sh"
out="$(update)"; equal "atualização com troca de atualizador: zero" 0 "$?"
equal "grava a versão nova" 0.2.0 "$(env_get "$E" DESKVOICE_VERSION)"
contains "quem termina a atualização é o atualizador da versão de destino" "$out" "ATUALIZADOR-DA-0.2.0"
lacks "o atualizador anterior não segue depois de trocar o código" "$out" "ATUALIZADOR-DA-0.1.0"
check "o passo que só existe na versão de destino rodou" test -e "$DESKVOICE_DEPLOY_DIR/passo-novo-da-0.2.0"
equal "um backup só, feito antes da troca" 1 "$(calls ' pg_dump ')"
check "o backup vem antes da troca do código" test "$(grep -n ' pg_dump ' "$FAKE_DIR/calls.log" | head -n 1 | cut -d: -f1)" -lt "$(grep -n '^git .* checkout ' "$FAKE_DIR/calls.log" | head -n 1 | cut -d: -f1)"
equal "as migrations rodam uma vez" 1 "$(calls 'run --rm migrate')"
contains "a saída é uma só, do começo ao fim" "$out" "Atual: 0.1.0"

# ── 2. O atualizador de destino não carrega: nada é tocado, e o código volta ──
printf '%s\n' v0.3.0 v0.2.0 v0.1.0 > "$FAKE_DIR/git_tags"
version_tree v0.3.0; printf '# DESKVOICE_UPDATE_FROM\nmain() {\nif then\n' > "$FAKE_DIR/git_checkout/v0.3.0/install/update.sh"
out="$(update)"; equal "atualizador de destino quebrado: sai com erro" 1 "$?"
equal "atualizador quebrado: a versão não muda" 0.2.0 "$(env_get "$E" DESKVOICE_VERSION)"
contains "atualizador quebrado: diz que nada foi alterado" "$out" "Nada foi alterado: a instalação segue na versão 0.2.0"
equal "atualizador quebrado: nenhuma imagem baixada" 0 "$(calls ' pull -q panel')"
equal "atualizador quebrado: nenhuma migration" 0 "$(calls 'run --rm migrate')"
equal "atualizador quebrado: nenhum serviço parado" 0 "$(calls ' stop panel')"
check "atualizador quebrado: o código volta para o de antes" grep -q ATUALIZADOR-DA-0.2.0 "$WORK/install/update.sh"

# ── 3. A versão nova sobe doente: quem desfaz é o atualizador de destino, com o que recebeu ──
mark ATUALIZADOR-DA-0.3.0 > "$FAKE_DIR/git_checkout/v0.3.0/install/update.sh"
echo 1 > "$FAKE_DIR/migrate_exit"
out="$(update)"; equal "migration da versão nova falha: sai com erro" 1 "$?"
equal "migration falha: volta a versão anterior" 0.2.0 "$(env_get "$E" DESKVOICE_VERSION)"
contains "migration falha: diz que foi desfeita" "$out" "foi desfeita: você está de volta na versão 0.2.0"
equal "migration falha: restaura o banco do backup feito pela versão anterior" 1 "$(calls 'alter database deskvoice_restore rename to deskvoice')"
check "migration falha: o código volta para o de antes" test "$(grep -c '^git .* checkout --quiet main' "$FAKE_DIR/calls.log")" -ge 1
check "migration falha: o atualizador no disco volta a ser o anterior" grep -q ATUALIZADOR-DA-0.2.0 "$WORK/install/update.sh"
echo 0 > "$FAKE_DIR/migrate_exit"

# ── 4. Destino anterior a este mecanismo: segue com o que está na memória, como sempre foi ──
version_tree v0.1.0; printf '#!/usr/bin/env bash\necho NAO-DEVIA-RODAR\nexit 1\n' > "$FAKE_DIR/git_checkout/v0.1.0/install/update.sh"
out="$(update --to 0.1.0)"; equal "destino sem o mecanismo: zero" 0 "$?"
lacks "destino sem o mecanismo: o atualizador dele não é chamado" "$out" "NAO-DEVIA-RODAR"
contains "destino sem o mecanismo: quem termina é o anterior" "$out" "ATUALIZADOR-DA-0.2.0"
equal "destino sem o mecanismo: grava a versão" 0.1.0 "$(env_get "$E" DESKVOICE_VERSION)"

# ── 5. --resume é de uso interno: sem o que a versão anterior entrega, recusa ──
cp "$KIT/update.sh" "$WORK/install/update.sh"
out="$(bash "$WORK/install/update.sh" --resume --to 0.9.0 --yes 2>&1)"; equal "--resume solto: recusa" 1 "$?"
contains "--resume solto: diz que é de uso interno" "$out" "uso interno"
equal "--resume solto: não mexe na versão" 0.1.0 "$(env_get "$E" DESKVOICE_VERSION)"
finish
