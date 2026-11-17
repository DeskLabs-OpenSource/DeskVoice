#!/usr/bin/env bash
# fence-soak.sh — roda as cercas em laço SOB CARGA e guarda a saída inteira da rodada que falhar.
#
# POR QUE EXISTE: em 13/11/2026 o `pnpm fences` reprovou duas vezes em 57 testes, sem mudança de
# código, logo depois de um comando pesado no mesmo shell — e não deixou rastro: a saída não foi
# guardada, então ninguém sabe QUAL cerca caiu. Cerca intermitente deixa PR bom vermelho por causa
# alheia (antipadrão 3 do AGENTS.md), e sem o nome do teste a causa não tem onde ser procurada.
# Este script transforma a próxima ocorrência em diagnóstico: nome do teste, rc e a saída verbosa
# completa, arquivados.
#
# USO:
#   bash scripts/fence-soak.sh [rodadas] [comando-de-carga]
#   bash scripts/fence-soak.sh                        # 40 rodadas, carga = `pnpm typecheck`
#   bash scripts/fence-soak.sh 120                    # laço maior, para taxa de falha baixa
#   bash scripts/fence-soak.sh 40 "pnpm build"        # outra carga, a mesma ideia
#
# O que ele faz, por rodada:
#   1. dispara `pnpm vitest run --project fences --reporter=verbose` — o mesmo comando do CI
#      (`pnpm fences`, dentro de `pnpm verify`), só que verboso para o nome do teste aparecer;
#   2. mede o tempo da rodada e conta quantos arquivos estão sujos na árvore;
#   3. se a rodada reprovar, copia a saída INTEIRA para <saída>/falhas/rodada-N.log e uma foto do
#      ambiente (load, memória, HEAD, árvore suja, processos pesados) para rodada-N.ambiente.txt.
# Em paralelo, um laço com o comando de carga ocupa a máquina do começo ao fim — é a condição em
# que a falha foi vista: a cerca rodando enquanto outro comando pesado martela CPU e disco.
#
# ARTEFATOS (fora do repositório de propósito — ver nota abaixo):
#   <saída>/rodada-N.log            saída de cada rodada
#   <saída>/falhas/rodada-N.log     só as rodadas vermelhas, saída inteira: é o que se anexa na issue
#   <saída>/falhas/rodada-N.ambiente.txt   estado da máquina e da árvore naquela rodada
#   <saída>/carga.log               saída do comando de carga em paralelo
#   <saída>/resumo.txt              rodadas, falhas, tempos, ambiente
# A saída padrão fica em ${TMPDIR:-/tmp}/fence-soak/<carimbo>. Ela NÃO fica dentro do repositório
# porque as cercas `no-conflict-markers`, `partner-address-has-one-spelling` e
# `docs-point-to-existing-files` varrem a árvore inteira: um log de rodada vermelha guardado ali
# dentro seria lido pela rodada seguinte e a contaminaria. Para escolher outro lugar:
#   FENCE_SOAK_OUT=/caminho/dos/artefatos bash scripts/fence-soak.sh
#
# ESTE LAÇO NÃO É DO CI: quarenta rodadas custam minutos de CPU e existem para caçar uma falha rara
# numa máquina de desenvolvimento. O CI roda as cercas uma vez, dentro de `pnpm verify` — não ligue
# este script em workflow nenhum.
#
# Saída: 0 se todas as rodadas passaram; 1 se alguma reprovou (e aí os logs dizem qual teste).
set -u

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RODADAS="${1:-${FENCE_SOAK_ROUNDS:-40}}"
CARGA="${2:-${FENCE_SOAK_LOAD:-pnpm typecheck}}"
CARIMBO="$(date -u +%Y%m%dT%H%M%SZ)"
BASE="${FENCE_SOAK_OUT:-${TMPDIR:-/tmp}/fence-soak}"
SAIDA="$BASE/$CARIMBO"
FALHAS="$SAIDA/falhas"

if [ ! -d "$RAIZ/fences" ]; then
  echo "erro: $RAIZ não parece a raiz do repositório (não achei fences/)" >&2
  exit 2
fi
if [ ! -d "$RAIZ/node_modules" ]; then
  echo "erro: falta node_modules — rode 'pnpm install' antes" >&2
  exit 2
fi

mkdir -p "$FALHAS"

# Um laço de carga por vez, do começo ao fim das rodadas. `setsid` faz o laço virar líder do
# próprio grupo; o trap mata o grupo inteiro (pnpm, tsc, node filhos), senão sobra `tsc` ocupando
# a máquina depois do script terminar.
setsid bash -c '
  cd "$1" || exit 0
  while :; do
    bash -c "$2" >>"$3/carga.log" 2>&1
    sleep 1
  done
' _ "$RAIZ" "$CARGA" "$SAIDA" &
CARGA_PID=$!
trap 'kill -TERM -"$CARGA_PID" 2>/dev/null; sleep 1; kill -KILL -"$CARGA_PID" 2>/dev/null' EXIT INT TERM

HEAD_INICIAL=$(git -C "$RAIZ" rev-parse --short HEAD 2>/dev/null || echo "?")
SUJOS_INICIAIS=$(git -C "$RAIZ" status --porcelain 2>/dev/null | wc -l | tr -d ' ')
echo "fence-soak: $RODADAS rodadas de 'vitest run --project fences' com '$CARGA' em paralelo"
echo "fence-soak: HEAD $HEAD_INICIAL, $SUJOS_INICIAIS arquivo(s) sujo(s); saída em $SAIDA"

FALHOU=0
TEMPOS=""
for i in $(seq 1 "$RODADAS"); do
  LOG="$SAIDA/rodada-$i.log"
  INICIO=$(date +%s%N)
  ( cd "$RAIZ" && pnpm vitest run --project fences --reporter=verbose ) >"$LOG" 2>&1
  RC=$?
  FIM=$(date +%s%N)
  MS=$(( (FIM - INICIO) / 1000000 ))
  TEMPOS="$TEMPOS $MS"
  RESUMO=$(grep -E '^ +Tests +' "$LOG" | tail -1 | sed 's/^ *//')
  SUJOS=$(git -C "$RAIZ" status --porcelain 2>/dev/null | wc -l | tr -d ' ')
  if [ "$RC" -ne 0 ]; then
    FALHOU=$((FALHOU + 1))
    cp "$LOG" "$FALHAS/rodada-$i.log"
    {
      echo "rodada: $i"
      echo "rc: $RC"
      echo "duração_ms: $MS"
      echo "comando: pnpm vitest run --project fences --reporter=verbose"
      echo "carga_paralela: $CARGA"
      echo "data: $(date -u +%FT%TZ)"
      echo "head: $(git -C "$RAIZ" rev-parse HEAD 2>/dev/null)"
      echo "loadavg: $(cat /proc/loadavg)"
      echo "--- árvore suja (git status --porcelain) ---"
      git -C "$RAIZ" status --porcelain 2>/dev/null | head -40
      echo "--- memória ---"
      free -m
      echo "--- processos que mais usam CPU no momento ---"
      ps -eo pid,pcpu,pmem,comm --sort=-pcpu | head -8
      echo "--- testes que reprovaram (linhas do reporter verboso) ---"
      grep -E '^ +(×|FAIL)|AssertionError|Error:' "$LOG" | head -40
    } >"$FALHAS/rodada-$i.ambiente.txt"
    echo "  rodada $i: FALHOU (rc=$RC, ${MS}ms) — ${RESUMO:-sem linha de resumo}; saída em falhas/rodada-$i.log"
    grep -E '^ +(×|FAIL)|ENOENT' "$LOG" | head -5 | sed 's/^/    /'
  else
    echo "  rodada $i: ok (${MS}ms, $SUJOS sujo(s)) ${RESUMO}"
  fi
done

# Estatística dos tempos: mínimo, mediana e máximo, em ms.
ESTAT=$(printf '%s\n' "$TEMPOS" | tr ' ' '\n' | grep -E '^[0-9]+$' | sort -n | awk '
  { v[NR] = $1 } END {
    if (NR == 0) { print "0 0 0"; exit }
    mediana = (NR % 2) ? v[(NR + 1) / 2] : int((v[NR / 2] + v[NR / 2 + 1]) / 2)
    print v[1], mediana, v[NR]
  }')
MIN=$(echo "$ESTAT" | cut -d' ' -f1)
MED=$(echo "$ESTAT" | cut -d' ' -f2)
MAX=$(echo "$ESTAT" | cut -d' ' -f3)

{
  echo "rodadas: $RODADAS"
  echo "falhas: $FALHOU"
  echo "duração_ms: min=$MIN mediana=$MED max=$MAX"
  echo "carga_paralela: $CARGA"
  echo "comando_da_rodada: pnpm vitest run --project fences --reporter=verbose"
  echo "comando_do_ci: pnpm vitest run --project fences (dentro de pnpm verify)"
  echo "head: $HEAD_INICIAL"
  echo "árvore_suja_no_início: $SUJOS_INICIAIS arquivo(s)"
  echo "cpu: $(nproc) vCPU"
  echo "loadavg_no_fim: $(cat /proc/loadavg)"
  echo "data: $(date -u +%FT%TZ)"
  if [ "$FALHOU" -gt 0 ]; then
    echo "rodadas_vermelhas: $(ls "$FALHAS"/rodada-*.log 2>/dev/null | tr '\n' ' ')"
    echo "próximo_passo: anexe falhas/rodada-N.log (e o .ambiente.txt) na issue — o nome da cerca está lá"
  fi
} >"$SAIDA/resumo.txt"

echo "fence-soak: $RODADAS rodadas, $FALHOU falha(s); tempos min=${MIN}ms mediana=${MED}ms max=${MAX}ms"
echo "fence-soak: resumo em $SAIDA/resumo.txt"
[ "$FALHOU" -eq 0 ] && exit 0 || exit 1
