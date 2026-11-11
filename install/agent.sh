#!/usr/bin/env bash
# Agente de atualização do DeskVoice: é ele que deixa o painel oferecer "atualizar pela tela".
# O painel roda em contêiner e não toca no Docker desta máquina; ele só registra o pedido. Este
# script passa a cada minuto, anuncia ao painel a versão instalada e lê de volta UM sim ou não.
# Se for sim, roda o atualizador (install/update.sh) e devolve o resultado.
#
#   bash install/agent.sh                 uma passada (é o que o agendamento chama)
#   bash install/agent.sh --install       instala ou atualiza o agendamento (systemd, ou cron)
#   bash install/agent.sh --install --dry-run   só diz o que faria
#
# O que o agente NUNCA recebe do painel: um comando, um número de versão, um endereço. Para qual
# versão ir, ele mesmo descobre nas versões publicadas no repositório, e anuncia ao painel antes.
#
# O registro do que deu errado fica em deploy/agent/agent.log (e a cópia anterior em agent.log.1).
#
# Regra para quem altera este arquivo: o agente que roda numa atualização é o da versão ANTERIOR.
# Tudo o que uma versão nova precisar fazer de diferente cabe no update.sh dela, não aqui.
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

# Tudo dentro de uma função: a atualização troca este arquivo no meio da execução.
main() {

mode=pass; dry_run=0; jitter=0
while [ $# -gt 0 ]; do
  case "$1" in
    --install) mode=install ;;
    --dry-run) dry_run=1 ;;
    --jitter) jitter=1 ;;
    -h|--help) sed -n '2,17p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "Não conheço a opção $1." "Use --install, --install --dry-run ou nenhuma opção." ;;
  esac
  shift
done

if [ "$mode" = install ]; then
  require_install
  if [ "$dry_run" = 1 ]; then
    case "$(agent_scheduler)" in
      systemd) info "[simulação] faria: gravar $SYSTEMD_DIR/$AGENT_UNIT.service e $AGENT_UNIT.timer e ligar o timer (uma passada por minuto, como $(owner_of "$REPO_DIR"))" ;;
      cron) info "[simulação] faria: gravar $CRON_DIR/$AGENT_UNIT (uma passada por minuto, como $(owner_of "$REPO_DIR"))" ;;
      *) info "[simulação] esta máquina não tem systemd nem cron: não agendaria nada, e a atualização continuaria pelo terminal" ;;
    esac
    if [ -z "$(env_get "$APP_ENV_FILE" UPDATE_AGENT_TOKEN)" ]; then info "[simulação] faria: gerar o segredo do agente em deploy/app.env e recriar o painel para ele recebê-lo"; fi
    exit 0
  fi
  converge_agent
  exit 0
fi

LOG="$AGENT_STATE_DIR/agent.log"
LOCK="$AGENT_STATE_DIR/lock"
PENDING="$AGENT_STATE_DIR/pending-result"   # linha 1: desfecho; linha 2: versão de destino; resto: saída
FAILURE="$AGENT_STATE_DIR/last-failure"     # linha 1: quando; linha 2: o que falhou
LAST_OK="$AGENT_STATE_DIR/last-ok"          # quando o painel ouviu pela última vez (o healthcheck lê)
LAST_FETCH="$AGENT_STATE_DIR/last-fetch"    # quando as versões publicadas foram consultadas
DEADLINE="${DESKVOICE_AGENT_DEADLINE:-30}"  # segundos de espera por uma resposta do painel
( umask 077; mkdir -p "$AGENT_STATE_DIR" )

stamp() { date -u +%Y-%m-%dT%H:%M:%SZ; }
# Registro que persiste, com rotação simples: passou de 512 KB, vira agent.log.1.
note() {
  if [ -f "$LOG" ] && [ "$(wc -c < "$LOG")" -gt 524288 ]; then mv -f "$LOG" "$LOG.1"; fi
  printf '%s %s\n' "$(stamp)" "$*" >> "$LOG"
}
# Falha de comunicação: fica no registro e vai ao painel na próxima passada que der certo.
fail_pass() {
  note "FALHA: $1"
  printf '%s\n%s\n' "$(stamp)" "$(printf '%s' "$1" | tr '\n' ' ' | mask_secrets)" > "$FAILURE"
  printf 'agente do DeskVoice: %s\n' "$1" >&2
  exit 1
}

# Duas passadas nunca se sobrepõem. Trava de pasta (o flock não existe em toda máquina); se o
# processo que a criou morreu, ou ela tem mais de duas horas, é sobra e sai.
# ponytail: há um instante entre criar a pasta e gravar o pid; com uma passada por minuto não colide.
take_lock() {
  local pid
  if mkdir "$LOCK" 2>/dev/null; then echo $$ > "$LOCK/pid"; return 0; fi
  pid="$(cat "$LOCK/pid" 2>/dev/null || true)"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null && [ -z "$(find "$LOCK" -maxdepth 0 -mmin +120 2>/dev/null)" ]; then return 1; fi
  rm -rf "$LOCK"
  mkdir "$LOCK" 2>/dev/null || return 1
  echo $$ > "$LOCK/pid"
}
if [ "$jitter" = 1 ]; then sleep $((RANDOM % 15)); fi
take_lock || exit 0

# O agente não morre calado: depois de o painel aceitar o pedido, TODA saída passa por aqui e
# entrega o resultado que estiver pendente (o verdadeiro, ou o de "parou no meio").
report_on_exit=0
on_exit() {
  local code=$?
  trap - EXIT
  if [ "$report_on_exit" = 1 ] && [ -f "$PENDING" ]; then
    if speak >/dev/null 2>&1; then rm -f "$PENDING"; else note "não consegui entregar o resultado agora; ele segue em $PENDING e vai na próxima passada"; fi
  fi
  rm -rf "$LOCK"
  exit "$code"
}
trap on_exit EXIT
trap 'exit 143' TERM
trap 'exit 130' INT
trap 'exit 129' HUP

# Antes de qualquer coisa: esta pasta é a dona da instalação que está rodando? Um segundo clone
# na mesma máquina (ou uma cópia antiga) não pode anunciar versão nem atualizar a instalação de
# outra pasta.
not_owner=""
for f in "$ENV_FILE" "$APP_ENV_FILE" "$MIGRATE_ENV_FILE"; do
  [ -f "$f" ] || not_owner="não achei $f: esta pasta não tem uma instalação do DeskVoice"
done
if [ -z "$not_owner" ]; then
  if ! have docker || ! docker info >/dev/null 2>&1; then not_owner="não consegui falar com o Docker"
  else
    panel_id="$(dc ps -q --status running panel 2>/dev/null | head -n 1 || true)"
    if [ -z "$panel_id" ]; then not_owner="o painel não está rodando, então não há a quem anunciar a versão"
    else
      project_dir="$(docker inspect --format '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}' "$panel_id" 2>/dev/null || true)"
      if [ -z "$project_dir" ] || [ "$(cd "$project_dir" 2>/dev/null && pwd -P)" != "$(cd "$DEPLOY_DIR" && pwd -P)" ]; then
        not_owner="o DeskVoice que roda nesta máquina foi instalado a partir de ${project_dir:-outra pasta}, e este agente está em $DEPLOY_DIR; ele não mexe na instalação de outra pasta"
      fi
    fi
  fi
fi
[ -z "$not_owner" ] || fail_pass "$not_owner"

# A conversa acontece de DENTRO do contêiner do painel, direto na porta dele: a rota do agente
# não passa pelo Caddy, então quem está na internet não chega a ela. O segredo e o relato vão
# pela entrada padrão, nunca na linha de comando (que aparece na lista de processos).
# shellcheck disable=SC2016  # é JavaScript, não bash: nada aqui deve ser expandido
SPEAK_JS='let s="";process.stdin.on("data",d=>s+=d).on("end",async()=>{
const [token,version,target,outcome,toVersion,failureAt,failureDetail,...rest]=s.split("\n");
const body={version,target};
if(outcome)body.result={outcome,...(toVersion&&{toVersion}),detail:rest.join("\n")};
if(failureAt)body.lastFailure={at:failureAt,detail:failureDetail};
try{const r=await fetch("http://127.0.0.1:3000/api/v1/system/agent",{method:"POST",headers:{"content-type":"application/json",authorization:"Bearer "+token},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
const j=await r.json().catch(()=>null);
if(r.ok&&j&&j.ok===true&&j.data&&typeof j.data.update==="boolean"){console.log("update="+j.data.update);return}
console.log("error=o painel respondeu HTTP "+r.status+" "+String((j&&j.error&&j.error.code)||""));process.exitCode=1}
catch(e){console.log("error="+String(e&&e.message).replace(/\n/g," "));process.exitCode=1}})'
# Para qual versão este servidor iria agora: a maior versão final publicada, se for diferente da
# instalada. O agente a ANUNCIA (a tela mostra e a pessoa confirma essa) e, se o painel disser
# sim, é para ela que ele vai. Nada disso vem do painel. A consulta ao repositório é feita no
# máximo a cada 10 minutos; entre uma e outra vale o que o clone já conhece.
target=""
discover_target() {
  local installed latest
  target=""; installed="$(env_get "$ENV_FILE" DESKVOICE_VERSION)"
  is_version "$installed" && is_clone || return 0
  if [ -z "$(find "$LAST_FETCH" -mmin -10 2>/dev/null)" ]; then
    if fetch_versions 2>/dev/null; then : > "$LAST_FETCH"; else note "não consegui consultar as versões publicadas (git fetch); sigo com as que este clone já conhece"; fi
  fi
  latest="$(latest_version)"
  if [ -n "$latest" ] && [ "$latest" != "$installed" ]; then target="$latest"; fi
}
# Roda um comando com prazo. Estourou, mata o comando (e o que ele abriu) e devolve 124.
# Vigia em bash de propósito: o `timeout` do coreutils não existe em toda máquina e não roda função.
with_deadline() {  # with_deadline <segundos> comando...
  local secs="$1" pid watcher code=0 hit="$AGENT_STATE_DIR/deadline-hit"; shift
  rm -f "$hit"
  "$@" <&0 & pid=$!
  # O vigia deixa um sinal ANTES de matar: é por ele, e não pelo código de saída, que se sabe que foi o prazo.
  # (O `&&` importa: ao desarmar o vigia o `sleep` dele é morto, e nada depois pode rodar.)
  ( sleep "$secs" && { : > "$hit"; pkill -TERM -P "$pid" 2>/dev/null; kill -TERM "$pid" 2>/dev/null; } ) >/dev/null 2>&1 & watcher=$!
  wait "$pid" 2>/dev/null || code=$?
  pkill -P "$watcher" 2>/dev/null || true; kill "$watcher" 2>/dev/null || true
  wait "$watcher" 2>/dev/null || true
  if [ -e "$hit" ]; then rm -f "$hit"; code=124; fi
  return "$code"
}
# speak → escreve `update=true`, `update=false` ou `error=<motivo>`; devolve 0 só se o painel ouviu.
speak() {
  local token outcome="" to="" failure_at="" failure_detail=""
  token="$(env_get "$APP_ENV_FILE" UPDATE_AGENT_TOKEN)"
  [ -n "$token" ] || { echo "error=falta o segredo do agente em deploy/app.env; rode: bash install/agent.sh --install"; return 1; }
  if [ -f "$PENDING" ]; then outcome="$(sed -n 1p "$PENDING")"; to="$(sed -n 2p "$PENDING")"; fi
  if [ -f "$FAILURE" ]; then failure_at="$(sed -n 1p "$FAILURE")"; failure_detail="$(sed -n 2p "$FAILURE")"; fi
  local code=0
  {
    printf '%s\n' "$token" "$(env_get "$ENV_FILE" DESKVOICE_VERSION)" "$target" "$outcome" "$to" "$failure_at" "$failure_detail"
    if [ -f "$PENDING" ]; then sed 1,2d "$PENDING"; fi
  } | with_deadline "$DEADLINE" dc exec -T panel node -e "$SPEAK_JS" 2>/dev/null || code=$?
  if [ "$code" = 124 ]; then echo "error=o painel não respondeu em ${DEADLINE}s"; fi
  return "$code"
}

# ── A passada ──
# No máximo duas voltas: a segunda entrega o resultado da atualização que a primeira rodou (e
# lê a resposta como em qualquer passada). O que sobrar pendente sai pelo on_exit.
turn=0
while [ "$turn" -lt 2 ]; do
  turn=$((turn + 1))
  report_on_exit=0   # esta fala já leva o que estiver pendente
  discover_target
  answer="$(speak)" || { reason="${answer#error=}"; fail_pass "não consegui falar com o painel (${reason:-o contêiner do painel não respondeu})"; }
  # O painel ouviu: o que estava pendente foi entregue.
  rm -f "$PENDING" "$FAILURE"
  stamp > "$LAST_OK"
  case "$answer" in
    update=false) exit 0 ;;
    update=true) ;;
    *) fail_pass "o painel respondeu algo que não é um sim nem um não (${answer:-vazio}); nada foi executado" ;;
  esac

  # ── Sim: atualizar ──
  # Daqui em diante o painel espera um resultado. O de "parou no meio" é gravado ANTES de começar:
  # se este processo for morto ou a máquina reiniciar, é ele que a próxima passada entrega.
  before="$(env_get "$ENV_FILE" DESKVOICE_VERSION)"
  printf 'failed\n\n%s\n' "O agente parou antes de terminar a atualização (o processo foi interrompido ou o servidor reiniciou). Confira no servidor: bash install/healthcheck.sh" > "$PENDING"
  report_on_exit=1
  note "pedido de atualização aceito; versão instalada: $before"

  code=0
  # O alvo é o que este agente acabou de anunciar, e o painel só disse sim porque foi essa a
  # versão que a pessoa confirmou. Sem --to, uma versão publicada neste instante entraria no lugar.
  if [ -z "$target" ]; then output="Não há versão mais nova que a $before para este servidor."
  else output="$(NO_COLOR=1 bash "$KIT_DIR/update.sh" --yes --to "$target" 2>&1 </dev/null)" || code=$?; fi
  after="$(env_get "$ENV_FILE" DESKVOICE_VERSION)"
  # O desfecho vem do estado da instalação, não do texto do atualizador (que muda entre versões).
  if [ "$code" = 0 ] && [ "$after" != "$before" ]; then outcome=succeeded
  elif [ "$code" = 0 ]; then outcome=nothing_to_do
  elif [ "$after" = "$before" ] && NO_COLOR=1 bash "$KIT_DIR/healthcheck.sh" --essential >/dev/null 2>&1; then outcome=rolled_back
  else outcome=failed; fi
  to=""; if [ "$outcome" = succeeded ]; then to="$after"; fi
  {
    printf '%s\n%s\n' "$outcome" "$to"
    printf '%s\n' "$output" | grep -v '^[[:space:]]*$' | tail -n 40 | mask_secrets | tail -c 6000
  } > "$PENDING.tmp"
  mv -f "$PENDING.tmp" "$PENDING"
  note "atualização terminou: $outcome (de $before para $after; update.sh saiu com $code)"
done
}
main "$@"
