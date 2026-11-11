#!/usr/bin/env bash
# apply-ruleset.sh: cria (ou atualiza) a proteção da `main` no GitHub.
#
# O dono roda UMA vez, depois de publicar o repositório. Precisa do `gh` logado como
# administrador do repositório.
#
#   bash scripts/github/apply-ruleset.sh --dry-run             só imprime o JSON; não fala com o GitHub
#   bash scripts/github/apply-ruleset.sh                       aplica em DeskLabs-OpenSource/DeskVoice
#   bash scripts/github/apply-ruleset.sh --repo dono/repo      aplica em outro repositório (um fork de teste)
#
# O que a regra impõe na `main`:
#   - mudança só por PR, com 1 aprovação;
#   - o check `ready` (agregador do ci.yml) é o ÚNICO exigido: job novo entra no `needs` dele,
#     e esta regra não muda;
#   - fila de merge ligada: cada PR é testado sobre a main do momento, um de cada vez. É o que
#     acaba com "verde no ramo atrasado, vermelho na main";
#   - sem force-push e sem apagar o ramo.
#
# Quem administra a organização pode dar merge no próprio PR sem a aprovação de outra pessoa
# (`bypass_mode: pull_request`): continua obrigado a abrir PR, e o projeto não para enquanto
# houver um mantenedor só. Com dois ou mais mantenedores, apague o bloco `bypass_actors`.
set -euo pipefail

repo="DeskLabs-OpenSource/DeskVoice"
dry_run=false
name="main"

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) dry_run=true ;;
    --repo)
      repo="${2:?--repo pede dono/repositório}"
      shift
      ;;
    *)
      echo "uso: $0 [--dry-run] [--repo dono/repositório]" >&2
      exit 2
      ;;
  esac
  shift
done

payload="$(cat <<JSON
{
  "name": "${name}",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "bypass_actors": [
    { "actor_id": 1, "actor_type": "OrganizationAdmin", "bypass_mode": "pull_request" }
  ],
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 1,
        "dismiss_stale_reviews_on_push": true,
        "require_code_owner_review": true,
        "require_last_push_approval": false,
        "required_review_thread_resolution": false
      }
    },
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": false,
        "required_status_checks": [{ "context": "ready" }]
      }
    },
    {
      "type": "merge_queue",
      "parameters": {
        "merge_method": "SQUASH",
        "grouping_strategy": "ALLGREEN",
        "max_entries_to_build": 5,
        "min_entries_to_merge": 1,
        "max_entries_to_merge": 5,
        "min_entries_to_merge_wait_minutes": 1,
        "check_response_timeout_minutes": 60
      }
    }
  ]
}
JSON
)"

if [ "${dry_run}" = true ]; then
  printf '%s\n' "${payload}"
  exit 0
fi

command -v gh >/dev/null 2>&1 || { echo "este script precisa do gh (https://cli.github.com)" >&2; exit 1; }

# Idempotente: se a regra já existe, atualiza em vez de criar uma segunda.
existing="$(gh api "repos/${repo}/rulesets" --jq ".[] | select(.name == \"${name}\") | .id" | head -n 1)"
if [ -n "${existing}" ]; then
  printf '%s' "${payload}" | gh api --method PUT "repos/${repo}/rulesets/${existing}" --input - --jq '"regra atualizada: \(.name) (id \(.id), \(.enforcement))"'
else
  printf '%s' "${payload}" | gh api --method POST "repos/${repo}/rulesets" --input - --jq '"regra criada: \(.name) (id \(.id), \(.enforcement))"'
fi
echo "Confira em https://github.com/${repo}/settings/rules"
