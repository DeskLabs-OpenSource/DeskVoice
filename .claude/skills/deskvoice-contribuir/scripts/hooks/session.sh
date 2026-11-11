#!/usr/bin/env bash
# session.sh: lembrete de início de sessão para quem CONTRIBUI.
#
# Ligado como hook de SessionStart no Claude Code (.claude/settings.json) e no Codex
# (.codex/hooks.json, depois de a pessoa aprovar em /hooks). O texto vai para o contexto do
# assistente. Regras:
#   - fala UMA vez por dia por clone (retomar ou compactar a sessão não repete o aviso);
#   - só em clone de contribuidor: para mantenedor, silêncio;
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
[ "$who" = "contribuidor" ] || exit 0

hooks="NÃO armados (bash .agents/skills/deskvoice-contribuir/scripts/arm-hooks.sh)"
case "$(git config --get core.hooksPath 2>/dev/null || true)" in *deskvoice-contribuir*) hooks="armados" ;; esac

cat <<TXT
[DeskVoice] Clone de contribuidor. Antes de codar ou commitar, carregue a skill deskvoice-contribuir:
ela mede antes do PR o que a revisão mede depois. Hooks de git: $hooks.
Outras skills: deskvoice-doutrina, deskvoice-ferramenta, deskvoice-motor-de-voz, deskvoice-instalar, deskvoice-operar.
TXT
exit 0
