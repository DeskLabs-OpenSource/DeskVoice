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
# Junto vem um segundo sim ou não: se esta instalação quer o serviço de WhatsApp. O agente
# converge a cada passada: com sim e o serviço fora, baixa a imagem e sobe só ele; com não e o
# serviço de pé, para e remove o contêiner (o volume com o pareamento fica). O estado do serviço
# vai ao painel na fala seguinte.
#
# O que o agente NUNCA recebe do painel: um comando, um número de versão, um endereço, uma imagem.
# Para qual versão ir, ele mesmo descobre nas versões publicadas no repositório, e anuncia ao
# painel antes. A imagem do WhatsApp é a que o Compose e o kit desta instalação fixam.
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
    -h|--help) sed -n '2,23p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
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
    if [ -z "$(env_get "$ENV_FILE" UPDATE_AGENT_TOKEN)" ]; then info "[simulação] faria: gerar o segredo do agente em deploy/.env e recriar o painel para ele recebê-lo"; fi
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
WA_FAILURE="$AGENT_STATE_DIR/whatsapp-failure"  # linha 1: código da última falha ao ligar ou desligar o serviço de WhatsApp; linha 2: MB livres, em no_disk
WA_WARNING="$AGENT_STATE_DIR/whatsapp-warning"  # código do aviso que acompanha o estado (pouca memória; imagem que não saiu do disco)
# Prazo do download da imagem dentro de uma passada. Menor que os 15 minutos em que um pedido de
# atualização vence sem ser pego: download lento para, a passada termina (e ouve o painel), e a
# seguinte continua de onde parou, porque o Docker guarda as camadas já baixadas.
WA_PULL_DEADLINE="${DESKVOICE_WHATSAPP_PULL_DEADLINE:-600}"
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
# Limite conhecido: trava com mais de 120 minutos é tratada como sobra MESMO com o processo vivo
# (é a defesa contra um pid reaproveitado depois de reiniciar a máquina). Com o timer do systemd
# isso não abre brecha, porque ele não começa outra passada enquanto a anterior roda. Com o cron,
# uma atualização presa por mais de duas horas deixaria uma segunda passada entrar por cima dela.
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
const [token,version,target,outcome,toVersion,failureAt,failureDetail,wa,waReason,waWarning,waFree,waNeed,...rest]=s.split("\n");
const body={version,target};
if(wa)body.whatsapp={state:wa,...(waReason&&{reason:waReason}),...(waWarning&&{warning:waWarning}),...(waFree&&{freeDiskMb:Number(waFree),neededDiskMb:Number(waNeed)})};
if(outcome)body.result={outcome,...(toVersion&&{toVersion}),detail:rest.join("\n")};
if(failureAt)body.lastFailure={at:failureAt,detail:failureDetail};
try{const r=await fetch("http://127.0.0.1:3000/api/v1/system/agent",{method:"POST",headers:{"content-type":"application/json",authorization:"Bearer "+token},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
const j=await r.json().catch(()=>null);
if(r.ok&&j&&j.ok===true&&j.data&&typeof j.data.update==="boolean"){console.log("update="+j.data.update+" whatsapp="+(j.data.whatsapp===true?"true":j.data.whatsapp===false?"false":"unknown"));return}
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
# ── Serviço de WhatsApp ──
# O perfil vai explícito: o serviço pode ainda não estar ligado nesta instalação.
dcw() { dc --profile whatsapp "$@"; }
whatsapp_running() { [ -n "$(dcw ps -q --status running waha 2>/dev/null)" ]; }
# O que o agente conta ao painel, em códigos fechados: `running`, `failed <código>` ou `absent`.
whatsapp_state() {
  if whatsapp_running; then echo running
  elif [ -s "$WA_FAILURE" ]; then echo "failed $(head -n 1 "$WA_FAILURE")"
  else echo absent; fi
}
whatsapp_failed() { printf '%s\n%s\n' "$1" "${3:-}" > "$WA_FAILURE"; note "serviço de WhatsApp: $1 ($2)"; }
# Tira do disco a imagem FIXADA desta instalação, e só ela: um `prune` apagaria imagem de outros
# sistemas da mesma máquina. Imagem que não sai (outra coisa usando) não é falha do pedido: vira
# aviso, e cada passada tenta de novo.
remove_whatsapp_image() {  # devolve 0 se algo mudou (a imagem saiu, ou o aviso é novo) e 1 se não
  local ref
  ref="$(waha_image_ref)"
  if [ -z "$ref" ] || ! docker image inspect "$ref" >/dev/null 2>&1; then
    if [ "$(cat "$WA_WARNING" 2>/dev/null)" = image_kept ]; then rm -f "$WA_WARNING"; return 0; fi
    return 1
  fi
  if docker image rm "$ref" >/dev/null 2>&1; then rm -f "$WA_WARNING"; note "imagem do serviço de WhatsApp removida do disco ($ref)"; return 0; fi
  if [ "$(cat "$WA_WARNING" 2>/dev/null)" = image_kept ]; then return 1; fi
  echo image_kept > "$WA_WARNING"
  note "a imagem do serviço de WhatsApp não saiu do disco ($ref): outra coisa a usa. Cada passada tenta de novo; para tentar agora: bash install/agent.sh"
  return 0
}
# Leva o serviço ao que o painel disse. Só `true` liga e só `false` desliga: qualquer outra coisa
# (painel de versão sem o campo, resposta estranha) não muda nada. Devolve 0 se mexeu em algo, para
# a passada contar o estado novo ao painel na volta seguinte.
converge_whatsapp() {  # converge_whatsapp <true|false|unknown>
  local created=1 free memory pull
  case "$1" in
    true)
      if whatsapp_running; then rm -f "$WA_FAILURE"; return 1; fi
      # Falhou há pouco: não repete um download de gigabytes a cada minuto.
      if [ -n "$(find "$WA_FAILURE" -mmin -10 2>/dev/null)" ]; then return 1; fi
      # O custo é conferido aqui, antes de baixar: um clique na tela não pode encher o disco e
      # derrubar o banco. Sem espaço, nada é baixado. Pouca memória não bloqueia: vira aviso.
      free="$(docker_free_mb)"
      case "$free" in ''|*[!0-9]*) free="" ;; esac
      if [ -n "$free" ] && [ "$free" -lt "$WAHA_DISK_NEEDED_MB" ]; then
        whatsapp_failed no_disk "há $free MB livres e o serviço pede $WAHA_DISK_NEEDED_MB; nada foi baixado; nova conferência em 10 minutos" "$free"; return 0
      fi
      memory="$(available_memory_mb)"
      if [ -n "$memory" ] && [ "$memory" -lt "$WAHA_MEMORY_CEILING_MB" ]; then
        echo low_memory > "$WA_WARNING"; note "há $memory MB de memória disponível, menos que o teto do serviço de WhatsApp ($WAHA_MEMORY_CEILING_MB MB): instalo assim mesmo, com aviso"
      else rm -f "$WA_WARNING"; fi
      note "o painel pediu o serviço de WhatsApp: baixando a imagem e subindo o serviço"
      if ensure_waha; then created=0; fi
      pull=0; with_deadline "$WA_PULL_DEADLINE" dcw pull -q waha >/dev/null 2>&1 </dev/null || pull=$?
      # Estourou o prazo: não é falha. A passada termina para ouvir o painel, e a seguinte continua.
      if [ "$pull" = 124 ]; then note "o download da imagem do serviço de WhatsApp passou de ${WA_PULL_DEADLINE}s; continuo na próxima passada"; return 0; fi
      if [ "$pull" != 0 ]; then whatsapp_failed pull_failed "a imagem não baixou; nova tentativa em 10 minutos"; return 0; fi
      env_set "$ENV_FILE" DESKVOICE_WHATSAPP on
      # Instalação que ainda não tinha a chave: painel, voz e rotinas sobem de novo para recebê-la.
      if [ "$created" = 0 ]; then dc up -d >/dev/null 2>&1 || { whatsapp_failed start_failed "o serviço não subiu"; return 0; }
      else dc up -d waha >/dev/null 2>&1 || { whatsapp_failed start_failed "o serviço não subiu"; return 0; }; fi
      rm -f "$WA_FAILURE"; note "serviço de WhatsApp no ar"
      return 0 ;;
    false)
      if ! whatsapp_enabled && [ -z "$(dcw ps -aq waha 2>/dev/null)" ]; then
        rm -f "$WA_FAILURE"
        # Sem contêiner: sobra conferir se a imagem ainda está no disco (pedido de instalação
        # desfeito no meio do download, ou imagem que não saiu da outra vez).
        if [ "$(cat "$WA_WARNING" 2>/dev/null)" = low_memory ]; then rm -f "$WA_WARNING"; fi
        if remove_whatsapp_image; then return 0; fi
        return 1
      fi
      note "o painel não quer mais o serviço de WhatsApp: parando e removendo o contêiner e a imagem (o volume com o pareamento fica)"
      if ! dcw rm -sf waha >/dev/null 2>&1; then whatsapp_failed remove_failed "o contêiner não saiu"; return 0; fi
      env_unset "$ENV_FILE" DESKVOICE_WHATSAPP
      rm -f "$WA_FAILURE" "$WA_WARNING"; note "serviço de WhatsApp removido"
      remove_whatsapp_image || true
      return 0 ;;
  esac
  return 1
}

# speak → escreve `update=<true|false> whatsapp=<true|false|unknown>` ou `error=<motivo>`; devolve
# 0 só se o painel ouviu.
speak() {
  local token outcome="" to="" failure_at="" failure_detail="" wa wa_reason="" wa_warning="" wa_free="" wa_need=""
  token="$(env_get "$ENV_FILE" UPDATE_AGENT_TOKEN)"
  [ -n "$token" ] || { echo "error=falta o segredo do agente em deploy/.env; rode: bash install/agent.sh --install"; return 1; }
  if [ -f "$PENDING" ]; then outcome="$(sed -n 1p "$PENDING")"; to="$(sed -n 2p "$PENDING")"; fi
  if [ -f "$FAILURE" ]; then failure_at="$(sed -n 1p "$FAILURE")"; failure_detail="$(sed -n 2p "$FAILURE")"; fi
  wa="$(whatsapp_state)"
  case "$wa" in "failed "*) wa_reason="${wa#failed }"; wa=failed ;; esac
  if [ -s "$WA_WARNING" ]; then wa_warning="$(head -n 1 "$WA_WARNING")"; fi
  if [ "$wa_reason" = no_disk ]; then wa_free="$(sed -n 2p "$WA_FAILURE")"; wa_need="$WAHA_DISK_NEEDED_MB"; fi
  local code=0
  {
    printf '%s\n' "$token" "$(env_get "$ENV_FILE" DESKVOICE_VERSION)" "$target" "$outcome" "$to" "$failure_at" "$failure_detail" "$wa" "$wa_reason" "$wa_warning" "$wa_free" "$wa_need"
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
  # O segundo sim ou não. Painel de uma versão que não o manda vale como "não sei": nada muda.
  wa_want=unknown
  case "$answer" in *" whatsapp="*) wa_want="${answer##* whatsapp=}"; answer="${answer%% whatsapp=*}" ;; esac
  case "$wa_want" in true|false) ;; *) wa_want=unknown ;; esac
  case "$answer" in
    # Sem atualização a fazer, converge o serviço de WhatsApp. Se mexeu, a volta seguinte conta ao
    # painel como ficou (e lê a resposta como em qualquer passada).
    update=false) if converge_whatsapp "$wa_want"; then continue; fi; exit 0 ;;
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
