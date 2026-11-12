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

# ── 6. O atualizador de destino carrega, mas recusa o que recebeu (uma versão futura que passe a
#       exigir algo que o atualizador anterior não entrega). O que acontece, registrado: o código
#       fica na versão nova com as imagens antigas rodando; nada mais é tocado; o agente relata
#       "não aplicada" com o motivo; e a rodada seguinte, já com o atualizador novo, converge. ──
S="$DESKVOICE_DEPLOY_DIR/agent"
said() { sed -n "${2}p" "$FAKE_DIR/agent_call.$1" 2>/dev/null; }
agent_pass() { rm -f "$FAKE_DIR"/agent_call.*; echo 'update=true' > "$FAKE_DIR/agent_replies"; cp "$WORK/install/update.sh" "$FAKE_DIR/git_checkout/main/install/update.sh"; : > "$FAKE_DIR/calls.log"; bash "$WORK/install/agent.sh" 2>&1; }
printf '%s\n' v0.5.0 v0.3.0 v0.2.0 v0.1.0 > "$FAKE_DIR/git_tags"
version_tree v0.5.0
# shellcheck disable=SC2016  # as variáveis são do script gerado, não deste
sed -e 's/^  { \[ -n "\$current" \] \&\& /  { [ -n "${DESKVOICE_UPDATE_EXTRA:-}" ] \&\& [ -n "$current" ] \&\& /' \
    -e 's/^      export DESKVOICE_UPDATE_FROM=/      export DESKVOICE_UPDATE_EXTRA=1 DESKVOICE_UPDATE_FROM=/' "$KIT/update.sh" > "$FAKE_DIR/git_checkout/v0.5.0/install/update.sh"
check "o atualizador futuro exige algo novo na continuação" grep -q 'DESKVOICE_UPDATE_EXTRA:-' "$FAKE_DIR/git_checkout/v0.5.0/install/update.sh"
check "o atualizador futuro entrega esse algo quando é ele quem passa a vez" grep -q 'export DESKVOICE_UPDATE_EXTRA=1' "$FAKE_DIR/git_checkout/v0.5.0/install/update.sh"
out="$(agent_pass)"; equal "continuação recusada: a passada do agente termina" 0 "$?"
equal "continuação recusada: a versão gravada não muda" 0.1.0 "$(env_get "$E" DESKVOICE_VERSION)"
equal "continuação recusada: nenhuma imagem baixada" 0 "$(calls ' pull -q panel')"
equal "continuação recusada: nenhuma migration" 0 "$(calls 'run --rm migrate')"
equal "continuação recusada: nenhum serviço parado" 0 "$(calls ' stop panel')"
check "continuação recusada: o código ficou na versão nova (as imagens que rodam são as antigas)" grep -q 'DESKVOICE_UPDATE_EXTRA' "$WORK/install/update.sh"
check "continuação recusada: não fica calado, o agente relata" test -e "$FAKE_DIR/agent_call.2"
equal "continuação recusada: relato de não aplicada, com o sistema de pé" rolled_back "$(said 2 4)"
contains "continuação recusada: o relato leva o motivo" "$(sed 1,7d "$FAKE_DIR/agent_call.2")" "uso interno do atualizador"
contains "continuação recusada: fica no registro do agente" "$(cat "$S/agent.log")" "atualização terminou: rolled_back (de 0.1.0 para 0.1.0"
refuse "continuação recusada: nada pendente, nenhuma trava" test -e "$S/pending-result" -o -e "$S/lock"
# A rodada seguinte: o atualizador no disco já é o novo, que entrega o que ele mesmo exige.
out="$(agent_pass)"; equal "rodada seguinte: a passada termina" 0 "$?"
equal "rodada seguinte: converge para a versão nova" 0.5.0 "$(env_get "$E" DESKVOICE_VERSION)"
equal "rodada seguinte: relato de sucesso" succeeded "$(said 2 4)"
equal "rodada seguinte: um backup e uma migration" "1 1" "$(calls ' pg_dump ') $(calls 'run --rm migrate')"

# ── 7. A limpeza das imagens antigas é do atualizador de destino: a primeira atualização para a
#       versão que a traz já limpa, mesmo vindo de um atualizador que não a conhece. ──
images_of() { local v s; for v in "$@"; do for s in $APP_SERVICES; do image_ref "$s" "$v"; done; done; }
grep -v '^remove_old_images ' "$KIT/update.sh" > "$WORK/install/update.sh"
refuse "o atualizador instalado não conhece a limpeza" grep -q '^remove_old_images ' "$WORK/install/update.sh"
printf '%s\n' v0.6.0 v0.5.0 v0.3.0 v0.2.0 v0.1.0 > "$FAKE_DIR/git_tags"
version_tree v0.6.0; cp "$KIT/update.sh" "$FAKE_DIR/git_checkout/v0.6.0/install/update.sh"
images_of 0.1.0 0.5.0 0.6.0 > "$FAKE_DIR/images"
out="$(update)"; equal "limpeza na passagem de vez: zero" 0 "$?"
equal "limpeza na passagem de vez: chega à versão nova" 0.6.0 "$(env_get "$E" DESKVOICE_VERSION)"
equal "limpeza na passagem de vez: o atualizador de destino remove a mais velha" "$(images_of 0.5.0 0.6.0)" "$(cat "$FAKE_DIR/images")"
finish
