#!/usr/bin/env bash
# arm-hooks.sh: arma, neste clone, os hooks de git do contribuidor (uma vez por clone).
#
#   pre-commit  recusa segredo com formato conhecido e `.env` no commit; recusa migration fora do
#               padrão AAAAMMDDTHHMMSS_slug.sql ou com carimbo já usado; avisa (sem bloquear)
#               commit assinado pela máquina (root@…, @vps…, @localhost)
#   pre-push    recusa push direto na main; avisa (sem bloquear) ramo atrasado
#
# Hook de git é configuração local do clone e não viaja no repositório: por isso este passo existe.
#
# Os hooks são COPIADOS da árvore de trabalho para uma pasta dentro do diretório git comum
# (`<.git>/deskvoice-hooks`), e o `core.hooksPath` aponta para ela com caminho absoluto. Assim os
# hooks armados não mudam com o ramo em que você está, e toda worktree do clone vê os mesmos.
# A cópia é congelada: quando os hooks mudarem na main, rode este script de novo estando na main
# atualizada.
#
# Uso: bash .agents/skills/deskvoice-contribuir/scripts/arm-hooks.sh [--disarm]
set -euo pipefail

root="$(git rev-parse --show-toplevel)"
cd "$root"
src=".agents/skills/deskvoice-contribuir/scripts/hooks"
# Caminho relativo gravado pelas versões antigas deste script: também é nosso.
legacy="$src"
dest="$(cd "$(git rev-parse --git-common-dir)" && pwd)/deskvoice-hooks"
current="$(git config --get core.hooksPath || true)"
# O mesmo caminho pode vir escrito de outro jeito (no Git Bash, `C:/...` em vez de `/c/...`; ou com
# barra no fim): compara também a forma que o `cd` + `pwd` desta shell devolve. Se a pasta sumiu, só
# a comparação literal vale.
cur_abs="$( [ -n "$current" ] && cd "$current" 2>/dev/null && pwd || true )"
ours() { [ "$current" = "$legacy" ] || [ "$current" = "$dest" ] || [ "$cur_abs" = "$dest" ]; }

if [ "${1:-}" = "--disarm" ]; then
  if ours; then
    git config --unset core.hooksPath
    rm -rf "$dest"
    echo "ok: hooks do contribuidor desarmados."
  else
    echo "nada a fazer: core.hooksPath=${current:-<vazio>} não é o dos hooks do contribuidor."
  fi
  exit 0
fi

if [ -n "$current" ] && ! ours; then
  echo "core.hooksPath já aponta para '$current': este clone tem hooks próprios e eu não sobrescrevo." >&2
  echo "Se quiser trocar mesmo assim: git config --unset core.hooksPath e rode este script de novo" >&2
  exit 2
fi

# O pre-commit chama `$(dirname "$0")/warn-identity.sh`: a cópia leva os dois juntos. O session.sh
# é hook de sessão do assistente, não de git, e fica onde está.
mkdir -p "$dest"
for hook in pre-commit pre-push warn-identity.sh; do
  cp "$src/$hook" "$dest/$hook"
  chmod +x "$dest/$hook"
done
git config core.hooksPath "$dest"
echo "ok: core.hooksPath=$dest"
echo "  pre-commit: segredo e .env no commit; nome e carimbo de migration; e-mail de máquina gera aviso"
echo "  pre-push:   push direto na main é recusado; ramo atrasado gera aviso"
echo "A cópia é congelada e vale para qualquer ramo: quando os hooks mudarem na main, rode este"
echo "script de novo estando na main atualizada."
echo "Desarmar: bash .agents/skills/deskvoice-contribuir/scripts/arm-hooks.sh --disarm"
