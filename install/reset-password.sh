#!/usr/bin/env bash
# Troca a senha de um usuário do painel e encerra as sessões abertas dele.
#
#   bash install/reset-password.sh                 pergunta o e-mail e a senha nova
#   bash install/reset-password.sh voce@empresa.com.br
#
# Só funciona de dentro da VPS: quem tem acesso ao servidor já é dono da instalação.
# A senha nunca vai por argumento nem aparece em log: segue pela entrada padrão.
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

email="${1:-}"
case "$email" in
  -h|--help) sed -n '2,8p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
esac
require_install

# Com DESKVOICE_RESET_PASSWORD definida, não pergunta nada (uso por script).
interactive=1; [ -n "${DESKVOICE_RESET_PASSWORD:-}" ] && interactive=0
cannot_read() { die "Não consegui ler a resposta." "Rode num terminal interativo, ou defina DESKVOICE_RESET_PASSWORD e passe o e-mail como argumento."; }

if [ -z "$email" ]; then
  [ "$interactive" = 1 ] || die "Faltou o e-mail." "Passe o e-mail como argumento: bash install/reset-password.sh voce@empresa.com.br"
  read -r -p "  E-mail do usuário que vai ter a senha trocada: " email || cannot_read
fi
reason="$(valid_email "$email")" || die "O e-mail não vale: $reason." "Confira e rode de novo. Nada foi alterado."

new_password="${DESKVOICE_RESET_PASSWORD:-}"
if [ "$interactive" = 1 ]; then
  read -r -s -p "  Senha nova (10 caracteres ou mais; não aparece na tela): " new_password || cannot_read; echo
  read -r -s -p "  Repita a senha nova: " again || cannot_read; echo
  [ "$again" = "$new_password" ] || die "As duas senhas não são iguais." "Rode de novo. Nada foi alterado."
  unset again
fi
reason="$(valid_password "$new_password")" || die "A senha não vale: $reason." "Escolha outra e rode de novo. Nada foi alterado."

# Roda no serviço `migrate`, o mesmo que cria o primeiro usuário: é o que tem a conexão certa.
status=0
printf '%s' "$new_password" | dc run --rm -T migrate pnpm --filter @deskvoice/routines run reset-password -- \
    --email "$email" --password-stdin || status=$?
# Só diz que trocou depois de entrar com a senha nova, pela tela de entrada (uma tentativa; a
# senha segue pela entrada padrão). Se o painel ainda segura tentativas para o e-mail (até 15
# minutos naquele endereço, até uma hora no e-mail inteiro), não há como testar, e a mensagem diz isso.
login=""
if [ "$status" = 0 ]; then login="$(try_login "$email" "$new_password")"; fi
unset new_password DESKVOICE_RESET_PASSWORD

case "$status" in
  0)
    case "${login%%|*}" in
      ok) ok "Senha trocada e conferida: entrei pela tela de entrada com a senha nova. Quem estava com o painel aberto nessa conta precisa entrar de novo." ;;
      rejected|session) die "O comando de troca terminou sem erro, mas a tela de entrada não aceitou a senha nova para $email ($login)." "Rode de novo. Se repetir: bash install/diagnose.sh e peça ajuda com o arquivo." ;;
      limited) warn "Senha trocada no banco, mas NÃO testei o login: o painel está no limite de tentativas de entrada para $email (senhas erradas recentes: o painel segura o endereço de onde vieram por até 15 minutos, e o e-mail inteiro por até uma hora quando vieram muitas, de vários lugares). Espere esse tempo e entre com a senha nova." ;;
      *) warn "Senha trocada no banco, mas NÃO testei o login: não cheguei à tela de entrada pelo Caddy do DeskVoice (${login:-sem resposta}). Confira com: bash install/healthcheck.sh" ;;
    esac ;;
  2) die "Não existe usuário com o e-mail $email nesta instalação." "Confira o e-mail. Nada foi alterado." ;;
  *) die "Não consegui trocar a senha." "Confira se o banco está no ar com bash install/healthcheck.sh e rode de novo." ;;
esac
