#!/usr/bin/env bash
# arm-hooks.sh: arma, neste clone, os hooks de git do contribuidor (uma vez por clone).
#
#   pre-commit  recusa segredo com formato conhecido e `.env` no commit; recusa migration fora do
#               padrão AAAAMMDDTHHMMSS_slug.sql ou com carimbo já usado
#   pre-push    recusa push direto na main; avisa (sem bloquear) ramo atrasado
#
# Hook de git é configuração local do clone e não viaja no repositório: por isso este passo existe.
#
# Uso: bash .agents/skills/deskvoice-contribuir/scripts/arm-hooks.sh [--disarm]
set -euo pipefail

root="$(git rev-parse --show-toplevel)"
cd "$root"
target=".agents/skills/deskvoice-contribuir/scripts/hooks"
current="$(git config --get core.hooksPath || true)"

if [ "${1:-}" = "--disarm" ]; then
  if [ "$current" = "$target" ]; then
    git config --unset core.hooksPath
    echo "ok: hooks do contribuidor desarmados."
  else
    echo "nada a fazer: core.hooksPath=${current:-<vazio>} não é o dos hooks do contribuidor."
  fi
  exit 0
fi

if [ -n "$current" ] && [ "$current" != "$target" ]; then
  echo "core.hooksPath já aponta para '$current': este clone tem hooks próprios e eu não sobrescrevo." >&2
  echo "Se quiser trocar mesmo assim: git config core.hooksPath $target" >&2
  exit 2
fi

chmod +x "$target/pre-commit" "$target/pre-push"
git config core.hooksPath "$target"
echo "ok: core.hooksPath=$target"
echo "  pre-commit: segredo e .env no commit; nome e carimbo de migration"
echo "  pre-push:   push direto na main é recusado; ramo atrasado gera aviso"
echo "Desarmar: bash .agents/skills/deskvoice-contribuir/scripts/arm-hooks.sh --disarm"
