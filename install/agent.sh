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
# Junto vêm mais dois sim ou não, um por serviço opcional: se esta instalação quer o serviço de
# WhatsApp (WAHA) e se quer o de ligação pelo WhatsApp (WaCalls). O agente converge a cada passada:
# com sim e o serviço fora, baixa a imagem e sobe só ele; com não e o serviço de pé, para e remove o
# contêiner (o volume com o pareamento fica). O estado de cada serviço vai ao painel na fala seguinte.
#
# O que o agente NUNCA recebe do painel: um comando, um número de versão, um endereço, uma imagem.
# Para qual versão ir, ele mesmo descobre nas versões publicadas no repositório, e anuncia ao
# painel antes. As imagens dos serviços são as que o Compose e o kit desta instalação fixam.
#
# O registro do que deu errado fica em deploy/agent/agent.log (e a cópia anterior em agent.log.1).
# A saída inteira de cada atualização fica em deploy/agent/last-update.log (e as duas anteriores
# em last-update.log.1 e .2).
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
    -h|--help) sed -n '2,25p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
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
UPDATE_LOG="$AGENT_STATE_DIR/last-update.log"  # a saída inteira das três últimas atualizações: esta, .1 e .2
KEPT="$PENDING.kept"                        # existe = a saída inteira do resultado pendente ficou em $UPDATE_LOG
DEADLINE="${DESKVOICE_AGENT_DEADLINE:-30}"  # segundos de espera por uma resposta do painel
WA_FAILURE="$AGENT_STATE_DIR/whatsapp-failure"  # linha 1: código da última falha ao ligar ou desligar o serviço de WhatsApp; linha 2: MB livres, em no_disk
WA_WARNING="$AGENT_STATE_DIR/whatsapp-warning"  # código do aviso que acompanha o estado (pouca memória; imagem que não saiu do disco)
WC_FAILURE="$AGENT_STATE_DIR/whatsapp-calls-failure"  # o mesmo, para o serviço de ligação pelo WhatsApp
WC_WARNING="$AGENT_STATE_DIR/whatsapp-calls-warning"
# Prazo do download de uma imagem de serviço dentro de uma passada. Menor que os 15 minutos em que um pedido de
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
# A saída inteira do atualizador fica no servidor (o painel recebe só o fim dela), com a mesma
# máscara do que vai para a tela e só o dono lê. Guarda as três últimas: a mais nova sem número.
keep_update_output() {  # keep_update_output <saída>
  ( umask 077; printf '%s\n' "$1" | mask_secrets > "$UPDATE_LOG.tmp" ) || return 1
  chmod 600 "$UPDATE_LOG.tmp" || return 1
  if [ -f "$UPDATE_LOG.1" ]; then mv -f "$UPDATE_LOG.1" "$UPDATE_LOG.2"; fi
  if [ -f "$UPDATE_LOG" ]; then mv -f "$UPDATE_LOG" "$UPDATE_LOG.1"; fi
  mv -f "$UPDATE_LOG.tmp" "$UPDATE_LOG"
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
    if speak >/dev/null 2>&1; then rm -f "$PENDING" "$KEPT"; else note "não consegui entregar o resultado agora; ele segue em $PENDING e vai na próxima passada"; fi
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
      project_dir="$(foreign_install_dir)"
      if [ -n "$project_dir" ]; then
        not_owner="o DeskVoice que roda nesta máquina foi instalado a partir de $project_dir, e este agente está em $DEPLOY_DIR; ele não mexe na instalação de outra pasta"
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
const [token,version,target,outcome,toVersion,failureAt,failureDetail,wa,waReason,waWarning,waFree,waNeed,wc,wcReason,wcWarning,wcFree,wcNeed,kept,...rest]=s.split("\n");
const body={version,target};
const service=(state,reason,warning,free,need)=>({state,...(reason&&{reason}),...(warning&&{warning}),...(free&&{freeDiskMb:Number(free),neededDiskMb:Number(need)})});
if(wa)body.whatsapp=service(wa,waReason,waWarning,waFree,waNeed);
if(wc)body.whatsappCalls=service(wc,wcReason,wcWarning,wcFree,wcNeed);
if(outcome)body.result={outcome,...(toVersion&&{toVersion}),...(kept&&{outputKept:true}),detail:rest.join("\n")};
if(failureAt)body.lastFailure={at:failureAt,detail:failureDetail};
try{const r=await fetch("http://127.0.0.1:3000/api/v1/system/agent",{method:"POST",headers:{"content-type":"application/json",authorization:"Bearer "+token},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
const j=await r.json().catch(()=>null);
const yes=(v)=>v===true?"true":v===false?"false":"unknown";
if(r.ok&&j&&j.ok===true&&j.data&&typeof j.data.update==="boolean"){console.log("update="+j.data.update+" whatsapp="+yes(j.data.whatsapp)+" whatsappCalls="+yes(j.data.whatsappCalls));return}
console.log("error=o painel respondeu HTTP "+r.status+" "+String((j&&j.error&&j.error.code)||""));process.exitCode=1}
catch(e){console.log("error="+String(e&&e.message).replace(/\n/g," "));process.exitCode=1}})'
# Para qual versão este servidor iria agora: a maior versão final publicada, se for diferente da
# instalada. O agente a ANUNCIA (a tela mostra e a pessoa confirma essa) e, se o painel disser
# sim, é para ela que ele vai. Nada disso vem do painel. A consulta ao repositório é feita no
# máximo a cada 10 minutos; entre uma e outra vale o que o clone já conhece. A tela de versão cita
# esse intervalo (`unseen`, em apps/panel/src/i18n/*/update.ts): mudou aqui, mude lá.
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
# ── Serviços opcionais ──
# Dois, cada um com nome próprio e um campo próprio na resposta do painel (registro 0010): o WhatsApp
# por QR Code (WAHA) e a ligação pelo WhatsApp (WaCalls). O que é de cada um está em `svc`; o que o
# agente faz com eles é o mesmo. O perfil vai explícito: o serviço pode ainda não estar ligado.
svc() {  # svc <waha|wacalls>
  case "$1" in
    waha) SVC=waha; SVC_PROFILE=whatsapp; SVC_MARK=DESKVOICE_WHATSAPP; SVC_LABEL="serviço de WhatsApp"
          SVC_DISK="$WAHA_DISK_NEEDED_MB"; SVC_MEMORY="$WAHA_MEMORY_CEILING_MB"; SVC_FAILURE="$WA_FAILURE"; SVC_WARNING="$WA_WARNING" ;;
    wacalls) SVC=wacalls; SVC_PROFILE=whatsapp-calls; SVC_MARK=DESKVOICE_WHATSAPP_CALLS; SVC_LABEL="serviço de ligação pelo WhatsApp"
          SVC_DISK="$WACALLS_DISK_NEEDED_MB"; SVC_MEMORY="$WACALLS_MEMORY_CEILING_MB"; SVC_FAILURE="$WC_FAILURE"; SVC_WARNING="$WC_WARNING" ;;
  esac
}
dcs() { dc --profile "$SVC_PROFILE" "$@"; }
svc_running() { [ -n "$(dcs ps -q --status running "$SVC" 2>/dev/null)" ]; }
svc_enabled() { [ "$(env_get "$ENV_FILE" "$SVC_MARK")" = on ]; }
svc_keys() { if [ "$SVC" = waha ]; then ensure_waha; else ensure_wacalls; fi; }
svc_image_ref() { if [ "$SVC" = waha ]; then waha_image_ref; else wacalls_image_ref; fi; }
# O que o agente conta ao painel, em códigos fechados: `running`, `failed <código>` ou `absent`.
service_state() {  # service_state <waha|wacalls>
  svc "$1"
  if svc_running; then echo running
  elif [ -s "$SVC_FAILURE" ]; then echo "failed $(head -n 1 "$SVC_FAILURE")"
  else echo absent; fi
}
service_failed() { printf '%s\n%s\n' "$1" "${3:-}" > "$SVC_FAILURE"; note "$SVC_LABEL: $1 ($2)"; }
# Tira do disco a imagem FIXADA desta instalação, e só ela: um `prune` apagaria imagem de outros
# sistemas da mesma máquina. Imagem que não sai (outra coisa usando) não é falha do pedido: vira
# aviso, e cada passada tenta de novo.
remove_service_image() {  # devolve 0 se algo mudou (a imagem saiu, ou o aviso é novo) e 1 se não
  local ref
  ref="$(svc_image_ref)"
  if [ -z "$ref" ] || ! docker image inspect "$ref" >/dev/null 2>&1; then
    if [ "$(cat "$SVC_WARNING" 2>/dev/null)" = image_kept ]; then rm -f "$SVC_WARNING"; return 0; fi
    return 1
  fi
  if docker image rm "$ref" >/dev/null 2>&1; then rm -f "$SVC_WARNING"; note "imagem do $SVC_LABEL removida do disco ($ref)"; return 0; fi
  if [ "$(cat "$SVC_WARNING" 2>/dev/null)" = image_kept ]; then return 1; fi
  echo image_kept > "$SVC_WARNING"
  note "a imagem do $SVC_LABEL não saiu do disco ($ref): outra coisa a usa. Cada passada tenta de novo; para tentar agora: bash install/agent.sh"
  return 0
}
# Leva o serviço ao que o painel disse. Só `true` liga e só `false` desliga: qualquer outra coisa
# (painel de versão sem o campo, resposta estranha) não muda nada. Devolve 0 se mexeu em algo, para
# a passada contar o estado novo ao painel na volta seguinte.
converge_service() {  # converge_service <waha|wacalls> <true|false|unknown>
  local created=1 free memory pull
  svc "$1"
  case "$2" in
    true)
      if svc_running; then rm -f "$SVC_FAILURE"; return 1; fi
      # Falhou há pouco: não repete o download a cada minuto.
      if [ -n "$(find "$SVC_FAILURE" -mmin -10 2>/dev/null)" ]; then return 1; fi
      # O custo é conferido aqui, antes de baixar: um clique na tela não pode encher o disco e
      # derrubar o banco. Sem espaço, nada é baixado. Pouca memória não bloqueia: vira aviso.
      free="$(docker_free_mb)"
      case "$free" in ''|*[!0-9]*) free="" ;; esac
      if [ -n "$free" ] && [ "$free" -lt "$SVC_DISK" ]; then
        service_failed no_disk "há $free MB livres e o serviço pede $SVC_DISK; nada foi baixado; nova conferência em 10 minutos" "$free"; return 0
      fi
      memory="$(available_memory_mb)"
      if [ -n "$memory" ] && [ "$memory" -lt "$SVC_MEMORY" ]; then
        echo low_memory > "$SVC_WARNING"; note "há $memory MB de memória disponível, menos que o teto do $SVC_LABEL ($SVC_MEMORY MB): instalo assim mesmo, com aviso"
      else rm -f "$SVC_WARNING"; fi
      note "o painel pediu o $SVC_LABEL: baixando a imagem e subindo o serviço"
      if svc_keys; then created=0; fi
      pull=0; with_deadline "$WA_PULL_DEADLINE" dcs pull -q "$SVC" >/dev/null 2>&1 </dev/null || pull=$?
      # Estourou o prazo: não é falha. A passada termina para ouvir o painel, e a seguinte continua.
      if [ "$pull" = 124 ]; then note "o download da imagem do $SVC_LABEL passou de ${WA_PULL_DEADLINE}s; continuo na próxima passada"; return 0; fi
      if [ "$pull" != 0 ]; then service_failed pull_failed "a imagem não baixou; nova tentativa em 10 minutos"; return 0; fi
      env_set "$ENV_FILE" "$SVC_MARK" on
      # Instalação que ainda não tinha a chave: quem a recebe sobe de novo para recebê-la.
      if [ "$created" = 0 ]; then dc up -d >/dev/null 2>&1 || { service_failed start_failed "o serviço não subiu"; return 0; }
      else dc up -d "$SVC" >/dev/null 2>&1 || { service_failed start_failed "o serviço não subiu"; return 0; }; fi
      rm -f "$SVC_FAILURE"; note "$SVC_LABEL no ar"
      return 0 ;;
    false)
      if ! svc_enabled && [ -z "$(dcs ps -aq "$SVC" 2>/dev/null)" ]; then
        rm -f "$SVC_FAILURE"
        # Sem contêiner: sobra conferir se a imagem ainda está no disco (pedido de instalação
        # desfeito no meio do download, ou imagem que não saiu da outra vez).
        if [ "$(cat "$SVC_WARNING" 2>/dev/null)" = low_memory ]; then rm -f "$SVC_WARNING"; fi
        if remove_service_image; then return 0; fi
        return 1
      fi
      note "o painel não quer mais o $SVC_LABEL: parando e removendo o contêiner e a imagem (o volume com o pareamento fica)"
      if ! dcs rm -sf "$SVC" >/dev/null 2>&1; then service_failed remove_failed "o contêiner não saiu"; return 0; fi
      env_unset "$ENV_FILE" "$SVC_MARK"
      rm -f "$SVC_FAILURE" "$SVC_WARNING"; note "$SVC_LABEL removido"
      remove_service_image || true
      return 0 ;;
  esac
  return 1
}
# O relato de um serviço para a fala: cinco linhas (estado, código, aviso, MB livres, MB exigidos).
service_report() {  # service_report <waha|wacalls>
  local state reason="" warning="" free="" need=""
  svc "$1"
  state="$(service_state "$1")"
  case "$state" in "failed "*) reason="${state#failed }"; state=failed ;; esac
  if [ -s "$SVC_WARNING" ]; then warning="$(head -n 1 "$SVC_WARNING")"; fi
  if [ "$reason" = no_disk ]; then free="$(sed -n 2p "$SVC_FAILURE")"; need="$SVC_DISK"; fi
  printf '%s\n' "$state" "$reason" "$warning" "$free" "$need"
}

# speak → escreve `update=<true|false> whatsapp=<true|false|unknown> whatsappCalls=<true|false|unknown>`
# ou `error=<motivo>`; devolve 0 só se o painel ouviu.
speak() {
  local token outcome="" to="" kept="" failure_at="" failure_detail=""
  token="$(env_get "$ENV_FILE" UPDATE_AGENT_TOKEN)"
  [ -n "$token" ] || { echo "error=falta o segredo do agente em deploy/.env; rode: bash install/agent.sh --install"; return 1; }
  if [ -f "$PENDING" ]; then outcome="$(sed -n 1p "$PENDING")"; to="$(sed -n 2p "$PENDING")"; fi
  if [ -n "$outcome" ] && [ -f "$KEPT" ]; then kept=1; fi
  if [ -f "$FAILURE" ]; then failure_at="$(sed -n 1p "$FAILURE")"; failure_detail="$(sed -n 2p "$FAILURE")"; fi
  local code=0
  {
    printf '%s\n' "$token" "$(env_get "$ENV_FILE" DESKVOICE_VERSION)" "$target" "$outcome" "$to" "$failure_at" "$failure_detail"
    service_report waha
    service_report wacalls
    printf '%s\n' "$kept"
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
  rm -f "$PENDING" "$KEPT" "$FAILURE"
  stamp > "$LAST_OK"
  # Os sim ou não dos serviços. Painel de uma versão que não manda um deles vale como "não sei":
  # nada muda. Lidos de trás para a frente: cada um sai da linha antes do anterior ser lido.
  wc_want=unknown; wa_want=unknown
  case "$answer" in *" whatsappCalls="*) wc_want="${answer##* whatsappCalls=}"; answer="${answer%% whatsappCalls=*}" ;; esac
  case "$answer" in *" whatsapp="*) wa_want="${answer##* whatsapp=}"; answer="${answer%% whatsapp=*}" ;; esac
  case "$wc_want" in true|false) ;; *) wc_want=unknown ;; esac
  case "$wa_want" in true|false) ;; *) wa_want=unknown ;; esac
  case "$answer" in
    # Sem atualização a fazer, converge os serviços. Se mexeu em algum, a volta seguinte conta ao
    # painel como ficou (e lê a resposta como em qualquer passada).
    update=false)
      moved=1
      if converge_service waha "$wa_want"; then moved=0; fi
      if converge_service wacalls "$wc_want"; then moved=0; fi
      if [ "$moved" = 0 ]; then continue; fi
      exit 0 ;;
    update=true) ;;
    *) fail_pass "o painel respondeu algo que não é um sim nem um não (${answer:-vazio}); nada foi executado" ;;
  esac

  # ── Sim: atualizar ──
  # Daqui em diante o painel espera um resultado. O de "parou no meio" é gravado ANTES de começar:
  # se este processo for morto ou a máquina reiniciar, é ele que a próxima passada entrega.
  before="$(env_get "$ENV_FILE" DESKVOICE_VERSION)"
  rm -f "$KEPT"
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
  kept=0
  if keep_update_output "$output"; then kept=1; else note "não consegui guardar a saída inteira da atualização em $UPDATE_LOG"; fi
  {
    printf '%s\n%s\n' "$outcome" "$to"
    printf '%s\n' "$output" | grep -v '^[[:space:]]*$' | tail -n 40 | mask_secrets | tail -c 6000
  } > "$PENDING.tmp"
  mv -f "$PENDING.tmp" "$PENDING"
  if [ "$kept" = 1 ]; then : > "$KEPT"; fi
  note "atualização terminou: $outcome (de $before para $after; update.sh saiu com $code)"
done
}
main "$@"
