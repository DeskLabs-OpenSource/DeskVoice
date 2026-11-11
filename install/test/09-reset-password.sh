#!/usr/bin/env bash
# reset-password.sh: a senha vai pela entrada padrão, nunca por argumento; cada desfecho diz o que houve.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
fake_install
source "$KIT/_common.sh"; set +e; trap - ERR

# Troca que dá certo.
: > "$FAKE_DIR/calls.log"
out="$(DESKVOICE_RESET_PASSWORD='senha-nova-bem-longa' bash "$KIT/reset-password.sh" dono@empresa.com.br 2>&1)"
equal "troca certa sai com zero" 0 "$?"
contains "avisa que trocou" "$out" "Senha trocada"
contains "chama o comando no serviço migrate" "$(cat "$FAKE_DIR/calls.log")" "run --rm -T migrate pnpm --filter @deskvoice/routines run reset-password"
contains "passa o e-mail" "$(cat "$FAKE_DIR/calls.log")" "--email dono@empresa.com.br --password-stdin"
equal "a senha chega pela entrada padrão" "senha-nova-bem-longa" "$(cat "$FAKE_DIR/reset_stdin")"
lacks "a senha não aparece nos argumentos" "$(cat "$FAKE_DIR/calls.log")" "senha-nova-bem-longa"
lacks "a senha não aparece na saída" "$out" "senha-nova-bem-longa"

# E-mail que não existe: o comando sai com 2.
echo 2 > "$FAKE_DIR/reset_exit"
out="$(DESKVOICE_RESET_PASSWORD='senha-nova-bem-longa' bash "$KIT/reset-password.sh" ninguem@empresa.com.br 2>&1)"
equal "e-mail desconhecido sai com erro" 1 "$?"
contains "e-mail desconhecido: diz que não existe" "$out" "Não existe usuário com o e-mail ninguem@empresa.com.br"

# Falha de outro tipo (banco fora, por exemplo).
echo 1 > "$FAKE_DIR/reset_exit"
out="$(DESKVOICE_RESET_PASSWORD='senha-nova-bem-longa' bash "$KIT/reset-password.sh" dono@empresa.com.br 2>&1)"
equal "falha do comando sai com erro" 1 "$?"
contains "falha do comando: aponta a checagem de saúde" "$out" "install/healthcheck.sh"
rm -f "$FAKE_DIR/reset_exit"

# Entradas ruins são barradas antes de chamar o Docker.
: > "$FAKE_DIR/calls.log"
out="$(DESKVOICE_RESET_PASSWORD='curta' bash "$KIT/reset-password.sh" dono@empresa.com.br 2>&1)"
equal "senha curta sai com erro" 1 "$?"
contains "senha curta: diz o motivo" "$out" "pelo menos 10 caracteres"
lacks "senha curta: não chama o comando" "$(cat "$FAKE_DIR/calls.log")" "reset-password"

out="$(DESKVOICE_RESET_PASSWORD='senha-nova-bem-longa' bash "$KIT/reset-password.sh" isto-nao-e-email 2>&1)"
equal "e-mail inválido sai com erro" 1 "$?"
lacks "e-mail inválido: não chama o comando" "$(cat "$FAKE_DIR/calls.log")" "reset-password"

out="$(DESKVOICE_RESET_PASSWORD='senha-nova-bem-longa' bash "$KIT/reset-password.sh" 2>&1)"
equal "sem e-mail e sem terminal sai com erro" 1 "$?"
contains "sem e-mail: diz como passar" "$out" "Passe o e-mail como argumento"

finish
