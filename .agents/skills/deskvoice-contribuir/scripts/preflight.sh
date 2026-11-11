#!/usr/bin/env bash
# preflight.sh: mede, antes do PR, o que a revisão e o CI vão medir depois.
#
# SÓ MEDE. Não altera nada e sai sempre com 0: quem decide o que fazer com a medição é você.
# Cada linha traz o estado e o comando que a produziu, para você conferir sem confiar em mim.
#
# Uso: bash .agents/skills/deskvoice-contribuir/scripts/preflight.sh
#      (rode `git fetch origin` antes: o pré-voo compara com a origin/main que está no seu disco)
set -uo pipefail

root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$root" ]; then
  echo "NÃO MEDIDO: rode de dentro de um clone do DeskVoice."
  exit 0
fi
cd "$root" || exit 0

ok()   { printf '  ok      %s\n' "$1"; }
warn() { printf '  ATENÇÃO %s\n' "$1"; }
info() { printf '  -       %s\n' "$1"; }
cmd()  { printf '          $ %s\n' "$1"; }

echo "Pré-voo do DeskVoice (só mede; nada foi alterado)"
echo

if ! git rev-parse -q --verify origin/main >/dev/null 2>&1; then
  echo "NÃO MEDIDO: não existe origin/main neste clone. Rode: git fetch origin"
  exit 0
fi
base="$(git merge-base origin/main HEAD 2>/dev/null || true)"
if [ -z "$base" ]; then
  echo "NÃO MEDIDO: este ramo não tem ancestral comum com origin/main."
  exit 0
fi
# O que o PR vai propor: commits do ramo mais o que ainda não foi commitado.
changed="$(git diff --name-only "$base" -- ; git ls-files --others --exclude-standard)"
changed="$(printf '%s\n' "$changed" | sort -u | sed '/^$/d')"
added_lines() { git diff "$base" -U0 -- "$@" | grep -E '^\+[^+]' || true; }

echo "1. Ramo"
branch="$(git branch --show-current)"
behind="$(git rev-list --count "$base..origin/main")"
ahead="$(git rev-list --count "$base..HEAD")"
case "$branch" in
  main | master) warn "você está em '$branch'. PR sai de um ramo com nome: git switch -c fix/o-que-conserta" ;;
  *) ok "ramo '$branch', $ahead commit(s) próprios" ;;
esac
if [ "$behind" -gt 0 ]; then
  warn "$behind commit(s) atrás de origin/main. Traga a main: git merge origin/main (nunca reset --hard nem push --force)"
  overlap="$(comm -12 <(git diff --name-only "$base" origin/main | sort) <(printf '%s\n' "$changed"))"
  [ -n "$overlap" ] && warn "arquivos que a main também mudou (onde nasce conflito): $(echo "$overlap" | tr '\n' ' ')"
else
  ok "em dia com origin/main"
fi
cmd "git rev-list --count \$(git merge-base origin/main HEAD)..origin/main"
echo

echo "2. Segredo no diff"
env_files="$(printf '%s\n' "$changed" | grep -E '(^|/)\.env(\.|$)' | grep -v '\.env\.example$' || true)"
# Varredura simples sobre TUDO o que o PR proporia (commits do ramo e o que ainda não foi commitado).
secrets="$(added_lines . ':(exclude)fences/__fixtures__' | grep -Ec -e '-----BEGIN [A-Z ]*PRIVATE KEY-----|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|sk-[A-Za-z0-9_-]{32,}|gh[pousr]_[A-Za-z0-9]{36,}|xox[baprs]-[A-Za-z0-9-]{20,}' || true)"
if [ "${secrets:-0}" -gt 0 ]; then warn "$secrets linha(s) nova(s) com formato de segredo. Se for chave real, revogue-a antes de tudo"; else ok "nenhum formato conhecido de segredo nas linhas novas (varredura simples)"; fi
# O gitleaks é o que o CI roda; ele só enxerga o que já foi commitado.
if command -v gitleaks >/dev/null 2>&1; then
  if gitleaks git --no-banner --redact --log-opts="$base..HEAD" . >/dev/null 2>&1; then ok "gitleaks não achou segredo nos commits do ramo"; else warn "o gitleaks achou algo nos commits do ramo: o job secrets do CI vai reprovar. Veja com o comando abaixo"; fi
  cmd "gitleaks git --redact --log-opts=\"\$(git merge-base origin/main HEAD)..HEAD\" ."
else
  info "gitleaks não instalado: o CI roda a varredura completa nos commits"
fi
[ -n "$env_files" ] && warn "arquivo de ambiente no diff: $(echo "$env_files" | tr '\n' ' ')"
echo

echo "3. console.log"
logs="$(added_lines '*.ts' '*.tsx' ':(exclude)fences/__fixtures__' | grep -Ec 'console\.(log|debug|info)\(' || true)"
if [ "${logs:-0}" -gt 0 ]; then warn "$logs linha(s) nova(s) com console.*: o lint reprova. O que acontece numa chamada vira evento (recordEvent); script de linha de comando usa process.stdout.write"; else ok "nenhum console.* novo"; fi
cmd "pnpm lint"
echo

echo "4. Variável de ambiente nova"
envs="$(added_lines 'packages/*' 'apps/*' | grep -oE '\benv(\?\.|\.|\[["'"'"'])[A-Z][A-Z0-9_]+' | grep -oE '[A-Z][A-Z0-9_]+$' | sort -u || true)"
new_envs=""
for name in $envs; do
  grep -Eq "^\s+${name}:" fences/env-allowlist.ts 2>/dev/null || new_envs="$new_envs $name"
done
if [ -n "$new_envs" ]; then
  warn "variável(is) fora de fences/env-allowlist.ts:$new_envs"
  info "recurso não se liga por .env: configuração de operador mora em settings e tem tela"
else
  ok "nenhuma variável de ambiente nova"
fi
cmd "pnpm vitest run --project fences fences/env-vars-have-defaults.test.ts"
echo

echo "5. Migration"
migrations="$(printf '%s\n' "$changed" | grep -E '^db/migrations/' || true)"
if [ -z "$migrations" ]; then
  info "o diff não toca db/migrations"
else
  for file in $migrations; do
    if git cat-file -e "origin/main:$file" 2>/dev/null; then
      warn "$file já está publicada na main: migration publicada nunca é editada. Corrija com uma nova"
    elif ! echo "$file" | grep -Eq '^db/migrations/[0-9]{8}T[0-9]{6}_[a-z0-9]+(_[a-z0-9]+)*\.sql$'; then
      warn "$file fora do padrão AAAAMMDDTHHMMSS_slug.sql"
    elif git ls-tree -r --name-only origin/main -- db/migrations/ | grep -q "/$(basename "$file" | cut -d_ -f1)_"; then
      warn "$file usa um carimbo que já existe na main: gere um novo com date -u +%Y%m%dT%H%M%S"
    else
      ok "$file (nome e carimbo livres na main; colisão com PR aberto é trabalho dos mantenedores)"
    fi
  done
  info "migration nova pede: organization_id em tabela nova, e pnpm test:db verde (pede Docker)"
fi
cmd "pnpm fences && pnpm db:test:up && pnpm test:db"
echo

echo "6. Notas de versão"
if printf '%s\n' "$changed" | grep -qx 'CHANGELOG.md'; then
  warn "CHANGELOG.md editado à mão: ele é montado dos fragmentos na release. Desfaça e escreva um fragmento em .changes/"
else
  ok "CHANGELOG.md intocado"
fi
fragments="$(printf '%s\n' "$changed" | grep -E '^\.changes/.+\.md$' | grep -v 'README.md' || true)"
if [ -n "$fragments" ]; then
  ok "fragmento presente: $(echo "$fragments" | tr '\n' ' ')"
elif printf '%s\n' "$changed" | grep -Eq '^(packages|apps|db|install|deploy)/'; then
  warn "o diff toca o produto e não traz fragmento em .changes/. Se quem opera uma instalação percebe a mudança, escreva um (formato: .changes/README.md). Se não souber, mande sem: é trabalho dos mantenedores"
else
  info "sem fragmento, e o diff não toca o produto: não precisa"
fi
cmd "pnpm release:check"
echo

echo "7. Skills"
if printf '%s\n' "$changed" | grep -q '^\.claude/skills/' && ! printf '%s\n' "$changed" | grep -q '^\.agents/skills/'; then
  warn ".claude/skills é espelho gerado: edite .agents/skills e rode pnpm skills:sync"
elif printf '%s\n' "$changed" | grep -q '^\.agents/skills/'; then
  info "skill alterada: rode pnpm skills:sync antes de commitar"
else
  info "o diff não toca skills"
fi
echo

echo "Agora rode o que o CI roda:  pnpm verify   (e pnpm test:db se tocou em banco)"
exit 0
