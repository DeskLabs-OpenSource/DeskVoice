#!/usr/bin/env bash
# grant-installation-admin.sh: chama o comando no serviço migrate e barra o e-mail ruim antes do Docker.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
fake_install
source "$KIT/_common.sh"; set +e; trap - ERR

: > "$FAKE_DIR/calls.log"
out="$(bash "$KIT/grant-installation-admin.sh" dono@empresa.com.br 2>&1)"
equal "marca dada sai com zero" 0 "$?"
contains "diz que a conta passou a administrar" "$out" "passou a administrar a instalação"
contains "chama o comando no serviço migrate" "$(cat "$FAKE_DIR/calls.log")" "run --rm -T migrate pnpm --filter @deskvoice/routines run grant-installation-admin"
contains "passa o e-mail" "$(cat "$FAKE_DIR/calls.log")" "--email dono@empresa.com.br"

: > "$FAKE_DIR/calls.log"
out="$(bash "$KIT/grant-installation-admin.sh" isto-nao-e-email 2>&1)"
equal "e-mail inválido sai com erro" 1 "$?"
lacks "e-mail inválido: não chama o comando" "$(cat "$FAKE_DIR/calls.log")" "grant-installation-admin"

out="$(bash "$KIT/grant-installation-admin.sh" 2>&1)"
equal "sem e-mail e sem terminal sai com erro" 1 "$?"
contains "sem e-mail: diz como passar" "$out" "Passe o e-mail como argumento"

finish
