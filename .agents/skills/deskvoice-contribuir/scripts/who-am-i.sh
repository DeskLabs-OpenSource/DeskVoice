#!/usr/bin/env bash
# who-am-i.sh: diz se quem está neste clone é mantenedor do DeskVoice ou contribuidor, e por quê.
# A skill deskvoice-contribuir e o hook de sessão usam a primeira palavra; o resto é para gente ler.
#
# Sinais:
#   1. gh: a conta logada tem permissão de escrita em DeskLabs-OpenSource/DeskVoice? (decide)
#   2. origin: aponta para o repositório principal ou para um fork? (informa)
#
# Uso: bash who-am-i.sh           "mantenedor: ..." ou "contribuidor: ..."
#      bash who-am-i.sh --short   só a palavra
# Sai sempre com 0: identidade é informação, não veredito. Nunca pede login.
set -uo pipefail

UPSTREAM="DeskLabs-OpenSource/DeskVoice"
short=false
[ "${1:-}" = "--short" ] && short=true

answer() { # $1 = palavra, $2 = motivo
  if [ "$short" = true ]; then echo "$1"; else echo "$1: $2"; fi
  exit 0
}

root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
[ -n "$root" ] || answer contribuidor "fora de um clone git"

origin="$(git -C "$root" remote get-url origin 2>/dev/null || true)"
shopt -s nocasematch
case "$origin" in
  "") remote="sem origin configurado" ;;
  *github.com[:/]"$UPSTREAM"|*github.com[:/]"$UPSTREAM".git) remote="origin é o repositório principal" ;;
  *) remote="origin é um fork ou cópia ($origin)" ;;
esac
shopt -u nocasematch

if command -v gh >/dev/null 2>&1; then
  # Sem rede, sem login ou com o repositório ainda não publicado, a resposta é vazia: contribuidor.
  can_push="$(GH_PROMPT_DISABLED=1 gh api "repos/$UPSTREAM" --jq '.permissions.push' 2>/dev/null || true)"
  if [ "$can_push" = "true" ]; then
    answer mantenedor "a conta do gh tem escrita em $UPSTREAM; $remote"
  fi
  answer contribuidor "a conta do gh não tem escrita em $UPSTREAM (ou o gh não está logado); $remote"
fi
answer contribuidor "gh não instalado, não dá para conferir permissão; $remote"
