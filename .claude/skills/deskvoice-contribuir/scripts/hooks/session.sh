#!/usr/bin/env bash
# session.sh: lembrete de início de sessão para quem CONTRIBUI.
#
# Ligado como hook de SessionStart no Claude Code (.claude/settings.json) e no Codex
# (.codex/hooks.json, depois de a pessoa aprovar em /hooks). O texto vai para o contexto do
# assistente. Regras:
#   - fala UMA vez por dia por clone (retomar ou compactar a sessão não repete o aviso);
#   - o lembrete completo só sai em clone de contribuidor; para mantenedor, só o aviso de hooks
#     armados à moda antiga (eles precisam ser armados de novo por qualquer um);
#   - sai sempre com 0: hook que falha atrapalha quem só queria ler o código.
set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
git_dir="$(git rev-parse --absolute-git-dir 2>/dev/null || true)"
[ -n "$git_dir" ] || exit 0

marker="$git_dir/deskvoice-session-hint"
today="$(date +%Y-%m-%d)"
[ "$(cat "$marker" 2>/dev/null || true)" = "$today" ] && exit 0

who="$(bash "$here/../who-am-i.sh" --short 2>/dev/null || echo contribuidor)"
echo "$today" > "$marker" 2>/dev/null || true

# Detecção exata: a cópia em <.git comum>/deskvoice-hooks (arm-hooks.sh atual) ou o caminho
# relativo das versões antigas, que segue o ramo em que você está e precisa ser armado de novo.
arm="bash .agents/skills/deskvoice-contribuir/scripts/arm-hooks.sh"
dest="$(cd "$(git rev-parse --git-common-dir 2>/dev/null)" 2>/dev/null && pwd)/deskvoice-hooks"
current="$(git config --get core.hooksPath 2>/dev/null || true)"
# Mesmo caminho escrito de outro jeito (Git Bash: `C:/...`; barra no fim) também conta.
cur_abs="$( [ -n "$current" ] && cd "$current" 2>/dev/null && pwd || true )"
hooks="NÃO armados ($arm)"
legacy_armed=0
if [ "$current" = "$dest" ] || [ "$cur_abs" = "$dest" ]; then
  hooks="armados"
elif [ "$current" = ".agents/skills/deskvoice-contribuir/scripts/hooks" ]; then
  hooks="armados à moda antiga: arme de novo ($arm)"
  legacy_armed=1
fi

if [ "$who" != "contribuidor" ]; then
  [ "$legacy_armed" = 1 ] && echo "[DeskVoice] Hooks de git $hooks."
  exit 0
fi

cat <<TXT
[DeskVoice] Clone de contribuidor. Antes de codar ou commitar, carregue a skill deskvoice-contribuir:
ela mede antes do PR o que a revisão mede depois. Hooks de git: $hooks.
Outras skills: deskvoice-doutrina, deskvoice-sistema-vivo, deskvoice-ferramenta, deskvoice-motor-de-voz, deskvoice-instalar, deskvoice-operar, deskvoice-metricas.
TXT
exit 0
