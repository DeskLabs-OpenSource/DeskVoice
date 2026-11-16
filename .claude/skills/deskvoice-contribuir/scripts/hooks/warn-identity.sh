#!/usr/bin/env bash
# warn-identity.sh: o crédito do commit é da pessoa, não da máquina.
#
# Commit feito direto numa VPS sai assinado como `root@vps-…`, e o GitHub não associa isso a conta
# nenhuma: o trabalho não aparece no perfil de quem fez. Aviso, nunca bloqueio: o commit é válido,
# só o crédito se perde. Sai sempre com 0. Chamado pelo pre-commit.
set -uo pipefail

name="$(git config user.name 2>/dev/null || true)"
email="$(git config user.email 2>/dev/null || true)"

if [ -z "$email" ]; then
  echo "aviso: git config user.email está vazio. O commit sai sem e-mail e não aparece no seu perfil do GitHub." >&2
  echo "       git config --global user.email \"<e-mail da sua conta do GitHub>\"" >&2
  exit 0
fi
case "$email" in
  root@* | *@localhost | *@vps* | *@srv* | *@*.local)
    echo "aviso: o commit vai sair como '${name:-?} <$email>', assinatura de máquina e não de pessoa." >&2
    echo "       Para o trabalho aparecer no seu perfil: git config --global user.email \"<e-mail da sua conta do GitHub>\"" >&2
    ;;
esac
exit 0
