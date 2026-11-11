#!/usr/bin/env bash
# Roda todos os testes do kit. Não precisa de Docker: usa programas de mentira e pastas
# temporárias. Sai com código diferente de zero se qualquer teste falhar.
#
#   bash install/test/run.sh            todos
#   bash install/test/run.sh backup     só os arquivos cujo nome contém "backup"
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")" || exit 1

echo "bash ${BASH_VERSION}"
case "${BASH_VERSION%%.*}" in
  [0-3]) echo "aviso: bash anterior ao 4. O kit é escrito para rodar aqui também; a VPS usa bash 5." ;;
esac

files=0; broken=0; passed=0; failed=0; broken_names=""
for test_file in [0-9]*.sh; do
  case "$test_file" in *"${1:-}"*) ;; *) continue ;; esac
  files=$((files + 1))
  output="$("$BASH" "$test_file" 2>&1 </dev/null)"; status=$?
  printf '%s\n' "$output"
  summary="$(printf '%s\n' "$output" | tail -n 1)"
  p="$(printf '%s' "$summary" | sed -n 's/.*: \([0-9]*\) passaram, \([0-9]*\) falharam$/\1/p')"
  f="$(printf '%s' "$summary" | sed -n 's/.*: \([0-9]*\) passaram, \([0-9]*\) falharam$/\2/p')"
  passed=$((passed + ${p:-0})); failed=$((failed + ${f:-0}))
  # Arquivo que morreu antes do resumo conta como quebrado, mesmo sem asserção reprovada.
  if [ "$status" != 0 ] || [ -z "$p" ]; then broken=$((broken + 1)); broken_names="$broken_names $test_file"; fi
done

echo
echo "Resumo: $files arquivos de teste, $passed verificações passaram, $failed falharam."
if [ "$files" = 0 ]; then echo "Nenhum teste encontrado: isso é uma falha."; exit 1; fi
if [ "$broken" != 0 ]; then echo "Arquivos com falha:$broken_names"; exit 1; fi
echo "Tudo passou."
