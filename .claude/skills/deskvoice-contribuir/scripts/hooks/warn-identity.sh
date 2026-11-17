#!/usr/bin/env bash
# warn-identity.sh: o crédito do commit é da pessoa, não da máquina.
#
# Commit feito direto numa VPS sai assinado como `root@vps-…`, e o GitHub não associa isso a conta
# nenhuma: o trabalho não aparece no perfil de quem fez. Aviso, nunca bloqueio: o commit é válido,
# só o crédito se perde. Sai sempre com 0. Chamado pelo pre-commit.
#
# A identidade vem de `git var GIT_AUTHOR_IDENT`, a mesma que o commit vai gravar: ela já leva em
# conta `GIT_AUTHOR_EMAIL`, `git -c user.email=…` e o `git config`, nessa ordem. Ler só o
# `git config user.email` dava aviso falso para quem passava o e-mail certo pelo ambiente e
# deixava passar o `root@` que vinha dele.
set -uo pipefail

ident="$(git var GIT_AUTHOR_IDENT 2>/dev/null)"
status=$?

name=""
email=""
if [ "$status" -eq 0 ]; then
  # Formato: "Nome <e-mail> 1700000000 -0300". O e-mail é o que está entre o último < e o > seguinte.
  name="${ident%% <*}"
  email="${ident##*<}"
  email="${email%%>*}"
fi

if [ -z "$email" ]; then
  echo "aviso: o commit está sem e-mail de autor (nem GIT_AUTHOR_EMAIL, nem user.email). Sem e-mail, ele não aparece no seu perfil do GitHub." >&2
  echo "       git config --global user.email \"<e-mail da sua conta do GitHub>\"" >&2
  exit 0
fi
case "$email" in
  root@* | *@localhost | *@vps* | *@srv* | *@*.local)
    echo "aviso: o commit vai sair como '${name:-?} <$email>', assinatura de máquina e não de pessoa." >&2
    echo "       Para o trabalho aparecer no seu perfil: git config --global user.email \"<e-mail da sua conta do GitHub>\"" >&2
    echo "       Se o e-mail vem do ambiente (GIT_AUTHOR_EMAIL), corrija lá: ele vale por cima do git config." >&2
    ;;
esac
exit 0
