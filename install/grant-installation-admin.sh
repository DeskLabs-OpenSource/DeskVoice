#!/usr/bin/env bash
# Dá a uma conta a marca de quem administra a instalação: atualizar e, quando houver mais de uma
# organização, cuidar de todas. É a saída de emergência para quando ninguém mais administra.
#
#   bash install/grant-installation-admin.sh                 pergunta o e-mail
#   bash install/grant-installation-admin.sh voce@empresa.com.br
#
# Só funciona de dentro da VPS: quem tem acesso ao servidor já é dono da instalação.
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

email="${1:-}"
case "$email" in
  -h|--help) sed -n '2,8p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
esac
require_install

if [ -z "$email" ]; then
  [ -t 0 ] || die "Faltou o e-mail." "Passe o e-mail como argumento: bash install/grant-installation-admin.sh voce@empresa.com.br"
  read -r -p "  E-mail da conta que vai administrar a instalação: " email || die "Não consegui ler a resposta." "Passe o e-mail como argumento: bash install/grant-installation-admin.sh voce@empresa.com.br"
fi
reason="$(valid_email "$email")" || die "O e-mail não vale: $reason." "Confira e rode de novo. Nada foi alterado."

# Roda no serviço `migrate`, o mesmo de `reset-password.sh`: é o que tem a conexão certa.
status=0
dc run --rm -T migrate pnpm --filter @deskvoice/routines run grant-installation-admin -- --email "$email" </dev/null || status=$?

case "$status" in
  0) ok "A conta $email passou a administrar a instalação. Fica gravado na auditoria da instalação." ;;
  3) ok "A conta $email já administrava a instalação. Nada foi alterado." ;;
  2) die "Não existe conta com o e-mail $email nesta instalação." "Confira o e-mail. Nada foi alterado." ;;
  *) die "Não consegui dar a marca à conta." "Confira se o banco está no ar com bash install/healthcheck.sh e rode de novo." ;;
esac
