#!/usr/bin/env bash
# Checagem de saúde: uma linha por peça, cada uma com estado e detalhe.
# Nunca resume tudo em um "ok": o que importa é saber QUAL peça está fora.
#
#   bash install/healthcheck.sh            relatório para pessoas
#   bash install/healthcheck.sh --json     o mesmo, para máquinas
#   bash install/healthcheck.sh --essential  só as peças sem as quais nada funciona
#
# Estados: ok | aviso (falta configurar, não é defeito) | falha (quebrado).
# Código de saída: 0 = nenhuma falha; 1 = falhou peça essencial (painel, banco, painel → banco,
# Asterisk, worker de voz, controle da telefonia, rotinas); 2 = falhou outra peça (rotinas → fila,
# linha, motor de voz, entrada única, WhatsApp, ligação pelo WhatsApp, portas, disco). O agente de atualização nunca é
# falha: no máximo, aviso.
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

as_json=0; only_essential=0
for arg in "$@"; do
  case "$arg" in
    --json) as_json=1 ;;
    --essential) only_essential=1 ;;
    -h|--help) sed -n '2,12p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "Não conheço a opção $arg." "Use --json, --essential ou nenhuma opção." ;;
  esac
done
require_install

RESULTS=""   # linhas `id|nome|essencial|estado|detalhe`
add() { RESULTS="$RESULTS$1|$2|$3|$4|$(printf '%s' "$5" | tr '\n|' '  ')"$'\n'; }

running() { [ -n "$(dc ps -q --status running "$1" 2>/dev/null)" ]; }
# Pergunta de DENTRO do contêiner: a rota não é publicada sem passar pelo proxy.
# Com prazo: painel que aceita a conexão e não responde não pode travar a checagem.
# Linha que falta numa resposta 200 é aviso, não falha: é um painel de versão anterior à linha
# (a checagem de uma versão rodando contra o painel de outra, numa volta sem git), e não defeito.
probe_js() {
  cat <<JS
fetch('$1',{signal:AbortSignal.timeout(8000)}).then(async r=>{const j=await r.json().catch(()=>null);const d=(j&&j.data)||{};
for(const k of [$2]){const p=d[k]||{};const old=r.ok&&j&&!p.status;console.log(k+'|'+(p.status||(old?'warn':'fail'))+'|'+String(p.detail||(old?'o painel desta versão não informa esta linha':'sem resposta para '+k+' (HTTP '+r.status+')')).replace(/[\\n|]/g,' '))}
}).catch(e=>{console.log('unreachable|fail|'+String(e.message).replace(/[\\n|]/g,' '))})
JS
}
# Pede ao Caddy, de dentro da rede, o painel e o /voice-ws. Devolve `panel|<HTTP>` e
# `voice|<HTTP>`; em erro de conexão, `erro <motivo>` no lugar do número. O serviço de voz
# responde 426 a quem chega sem WebSocket: é a prova de que o caminho vai até ele.
# Devolve também `agent|<HTTP>|<bytes do corpo>` para a rota do agente de atualização: quem a
# recusa tem de ser o Caddy (404 de corpo vazio). Se o 404 vem com corpo, quem respondeu foi o
# painel: o Caddy está rodando um Caddyfile antigo, sem a regra.
#   entry_probe_js <http|https> <porta> <nome do site>
entry_probe_js() {
  cat <<JS
const m=require('$1');
const hit=(p,size)=>new Promise(done=>{const q=m.request({host:'caddy',port:$2,path:p,servername:'$3',headers:{Host:'$3'},rejectUnauthorized:false,timeout:8000},r=>{let n=0;r.on('data',d=>n+=d.length).on('end',()=>done(r.statusCode+(size?'|'+n:'')))});
q.on('timeout',()=>q.destroy(new Error('sem resposta em 8s')));q.on('error',e=>done('erro '+String(e.code||e.message).replace(/[\\n|]/g,' ')));q.end()});
(async()=>{console.log('panel|'+await hit('/api/v1/system/health'));console.log('voice|'+await hit('/voice-ws'));console.log('agent|'+await hit('/api/v1/system/agent',1))})();
JS
}
label() { case "$1" in ok) echo ok ;; warn) echo aviso ;; *) echo falha ;; esac; }

# ── Banco ──
if ! running postgres; then
  add database "Banco" 1 falha "o contêiner do Postgres não está rodando. Veja: docker compose -f deploy/docker-compose.yml logs --tail 50 postgres"
elif dc exec -T postgres pg_isready -q -U "$DB_USER" -d "$DB_NAME" >/dev/null 2>&1; then
  add database "Banco" 1 ok "Postgres aceitando conexões"
else
  add database "Banco" 1 falha "o Postgres está rodando mas não aceita conexão (pode estar iniciando ou sem disco)"
fi

# ── Asterisk ──
if ! running asterisk; then
  add asterisk "Asterisk" 1 falha "o contêiner do Asterisk não está rodando. Veja: docker compose -f deploy/docker-compose.yml logs --tail 50 asterisk"
elif uptime="$(dc exec -T asterisk asterisk -rx 'core show uptime' 2>/dev/null | head -n 1)" && [ -n "$uptime" ]; then
  add asterisk "Asterisk" 1 ok "$uptime"
else
  add asterisk "Asterisk" 1 falha "o Asterisk está rodando mas não responde a comandos"
fi

# ── Painel (e, por ele, as ligações painel → banco e rotinas → fila, a linha telefônica e o motor
#    de voz). A rota responde essas linhas sem sessão. ──
panel_lines=""
if running panel; then
  panel_lines="$(dc exec -T panel node -e "$(probe_js http://127.0.0.1:3000/api/v1/system/health "'panel','database','routines','trunk','engine'")" 2>/dev/null || true)"
fi
piece() { printf '%s\n' "$panel_lines" | awk -F'|' -v k="$1" -v f="$2" '$1 == k { print $f; exit }'; }
# Uma linha que quem sabe é o painel. Sem resposta dele, aviso: a linha "Painel" já acusa a falha.
#   from_panel <id> <nome> <essencial: 0|1> <chave na rota de saúde>
from_panel() {
  if [ -n "$(piece "$4" 1)" ]; then add "$1" "$2" "$3" "$(label "$(piece "$4" 2)")" "$(piece "$4" 3)"
  else add "$1" "$2" "$3" aviso "não deu para consultar porque o painel não respondeu; resolva o painel primeiro"; fi
}
if ! running panel; then
  add panel "Painel" 1 falha "o contêiner do painel não está rodando. Veja: docker compose -f deploy/docker-compose.yml logs --tail 50 panel"
elif [ -z "$panel_lines" ] || [ -n "$(piece unreachable 1)" ]; then
  add panel "Painel" 1 falha "o painel está rodando mas não respondeu à checagem (${panel_lines:-sem saída}). Pode estar iniciando: espere 30 segundos e repita"
else
  add panel "Painel" 1 "$(label "$(piece panel 2)")" "$(piece panel 3)"
fi
# O Postgres aceitar conexão (linha "Banco") não prova que o painel entra nele: a senha do papel da
# aplicação, que as migrations redefinem, ou a rede podem estar erradas. Sem isso não há nem login.
from_panel panel_database "Painel → banco" 1 database

# ── Worker de voz e rotinas ──
if ! running voice; then
  add voice "Worker de voz" 1 falha "o contêiner de voz não está rodando; nenhuma ligação é atendida. Veja: docker compose -f deploy/docker-compose.yml logs --tail 50 voice"
elif voice_line="$(dc exec -T voice node -e "fetch('http://127.0.0.1:8090/health',{signal:AbortSignal.timeout(8000)}).then(async r=>{if(!r.ok)process.exit(1);const j=await r.json().catch(()=>({}));const a=j.asterisk||{};console.log('asterisk|'+(a.status||'fail')+'|'+String(a.detail||'sem detalhe').replace(/[\\n|]/g,' '))}).catch(()=>process.exit(1))" 2>/dev/null)"; then
  add voice "Worker de voz" 1 ok "respondendo"
  # O Asterisk responder a comandos não basta: é por esta conexão que a ligação chega ao agente.
  # Sem ela o Asterisk fica de pé e nenhuma chamada é atendida.
  ari_status="$(printf '%s\n' "$voice_line" | awk -F'|' '$1 == "asterisk" { print $2; exit }')"
  ari_detail="$(printf '%s\n' "$voice_line" | awk -F'|' '$1 == "asterisk" { print $3; exit }')"
  if [ "$ari_status" = ok ]; then
    add telephony "Controle da telefonia" 1 ok "o processo de voz está conectado ao Asterisk${ari_detail:+ ($ari_detail)}"
  else
    add telephony "Controle da telefonia" 1 falha "o processo de voz não consegue falar com o Asterisk (${ari_detail:-sem resposta}). Causa mais comum: o Asterisk não leu a configuração. Rode de novo: bash install/install.sh. Se continuar: docker compose -f deploy/docker-compose.yml logs --tail 50 asterisk"
  fi
else
  add voice "Worker de voz" 1 falha "o worker de voz está rodando mas não responde; costuma ser falta de conexão com o Asterisk"
fi
if running routines; then add routines "Rotinas" 1 ok "processo rodando"
else add routines "Rotinas" 1 falha "o contêiner de rotinas não está rodando; resumos e avisos pós-chamada ficam parados"; fi

if [ "$only_essential" = 0 ]; then
  # ── Rotinas → fila: o processo de rotinas escuta a fila no banco, e a fila anda. Não é essencial
  #    (e por isso não provoca a volta da atualização): sem ele as ligações seguem sendo atendidas,
  #    e o que ele faria (resumos, avisos) espera na fila, gravada no banco, até ele voltar. A volta
  #    restauraria o banco do backup, perdendo o que entrou durante a tentativa, para um defeito que
  #    pode ser anterior à atualização: a fila atrasada mede o que esperou, de antes dela também.
  #    O processo de rotinas parado continua sendo falha essencial, na linha "Rotinas". ──
  from_panel routines_queue "Rotinas → fila" 0 routines
  # ── Linha telefônica e motor de voz: quem sabe é o painel ──
  from_panel trunk "Linha telefônica" 0 trunk
  from_panel engine "Motor de voz" 0 engine

  # ── Entrada única: painel e voz do navegador pelo mesmo endereço ──
  # Pergunta de dentro da rede, ao Caddy, pelos dois caminhos. É a ligação que faltava:
  # "o painel abre e a voz não conecta" tem que aparecer aqui, não na tela de quem ligou.
  entry_at="$(entry_target)"; entry_lines=""
  entry_ports="$(sed -n 's/^ *- "\(.*\)"$/\1/p' "$PROXY_OVERRIDE" 2>/dev/null | tr '\n' ' ' || true)"
  if [ -f "$PROXY_OVERRIDE" ] && grep -q ':3000"' "$PROXY_OVERRIDE"; then
    add entry "Entrada única" 0 falha "esta instalação ainda publica painel e voz em duas portas (formato antigo): \"Falar com o agente\" não conecta. Rode: bash install/install.sh (mantém a mesma porta do painel)"
  elif [ -z "$entry_at" ] || [ -z "$entry_ports" ]; then
    add entry "Entrada única" 0 falha "o Caddy do DeskVoice não tem porta publicada: o painel não abre de fora. Rode: bash install/install.sh"
  elif ! running caddy; then
    add entry "Entrada única" 0 falha "o Caddy do DeskVoice não está rodando: o painel não abre de fora. Veja: docker compose -f deploy/docker-compose.yml logs --tail 50 caddy"
  elif ! running panel; then
    add entry "Entrada única" 0 aviso "não deu para conferir porque o painel não está rodando; resolva o painel primeiro"
  else
    entry_scheme="${entry_at%% *}"; entry_site="${entry_at##* }"
    # shellcheck disable=SC2086  # entry_target devolve três palavras, de propósito
    entry_lines="$(dc exec -T panel node -e "$(entry_probe_js $entry_at)" 2>/dev/null || true)"
    entry_panel="$(printf '%s\n' "$entry_lines" | awk -F'|' '$1 == "panel" { print $2; exit }')"
    entry_voice="$(printf '%s\n' "$entry_lines" | awk -F'|' '$1 == "voice" { print $2; exit }')"
    case "$entry_panel" in
      200)
        case "$entry_voice" in
          426|400) add entry "Entrada única" 0 ok "painel e voz do navegador respondem pelo mesmo endereço (publicado em: ${entry_ports% })" ;;
          502|503|504) add entry "Entrada única" 0 falha "o painel responde, mas /voice-ws não chega ao serviço de voz (HTTP $entry_voice): \"Falar com o agente\" não conecta. Veja: docker compose -f deploy/docker-compose.yml logs --tail 50 voice" ;;
          [1-5][0-9][0-9]) add entry "Entrada única" 0 falha "o painel responde, mas /voice-ws não foi entregue ao serviço de voz (veio HTTP $entry_voice em vez de um pedido de WebSocket): \"Falar com o agente\" não conecta. Rode: bash install/install.sh" ;;
          *) add entry "Entrada única" 0 falha "o painel responde, mas /voice-ws não respondeu (${entry_voice:-sem saída}): \"Falar com o agente\" não conecta" ;;
        esac ;;
      [1-4][0-9][0-9]) add entry "Entrada única" 0 falha "o Caddy do DeskVoice respondeu, mas não entregou o pedido ao painel (HTTP $entry_panel em vez de 200): o endereço configurado no Caddy não é o que está sendo usado. Rode: bash install/install.sh" ;;
      5[0-9][0-9]) add entry "Entrada única" 0 falha "o Caddy do DeskVoice não alcança o painel (HTTP $entry_panel). Veja: docker compose -f deploy/docker-compose.yml logs --tail 50 caddy" ;;
      *)
        if [ "$entry_scheme" = https ]; then add entry "Entrada única" 0 falha "o Caddy não respondeu em HTTPS para $entry_site (${entry_panel:-sem saída}). Causa mais comum: o certificado ainda não saiu porque o domínio não aponta para esta VPS. Veja: docker compose -f deploy/docker-compose.yml logs --tail 50 caddy"
        else add entry "Entrada única" 0 falha "o Caddy do DeskVoice não respondeu (${entry_panel:-sem saída}). Veja: docker compose -f deploy/docker-compose.yml logs --tail 50 caddy"; fi ;;
    esac
  fi

  # ── WhatsApp por QR Code: o serviço, que só existe na instalação que o pediu pela tela ──
  # "Não instalado" é o estado normal, nunca falha. Instalado, é perguntado a partir do painel,
  # que é quem fala com ele; qualquer resposta HTTP abaixo de 500 conta. Se há um número conectado,
  # só a tela diz.
  if ! whatsapp_enabled; then
    add whatsapp "WhatsApp" 0 ok "serviço não instalado nesta máquina (é o padrão). Para conectar um número, instale-o pela tela: Configurações → WhatsApp"
  elif ! running waha; then
    add whatsapp "WhatsApp" 0 falha "o serviço de WhatsApp (WAHA) foi instalado pela tela e o contêiner não está rodando: avisos e mensagens por WhatsApp não saem. Veja: docker compose -f deploy/docker-compose.yml --profile whatsapp logs --tail 50 waha"
  elif [ -z "$(env_get "$ENV_FILE" WAHA_API_KEY)" ]; then
    add whatsapp "WhatsApp" 0 falha "o serviço de WhatsApp está rodando, mas esta instalação não tem a chave dele: o painel não consegue conectar um número. Rode: bash install/update.sh"
  elif ! running panel; then
    add whatsapp "WhatsApp" 0 aviso "não deu para conferir porque o painel não está rodando; resolva o painel primeiro"
  elif dc exec -T panel node -e "fetch('http://waha:3000/ping',{signal:AbortSignal.timeout(8000)}).then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
    add whatsapp "WhatsApp" 0 ok "serviço instalado e respondendo. Se há um número conectado, e qual, aparece em Configurações"
  else
    add whatsapp "WhatsApp" 0 falha "o serviço de WhatsApp (WAHA) está rodando, mas não responde ao painel. Veja: docker compose -f deploy/docker-compose.yml --profile whatsapp logs --tail 50 waha"
  fi

  # ── Ligação pelo WhatsApp (WaCalls): o mesmo molde ──
  # Perguntado a partir do processo de voz, que é o único que fala com ele. `/healthz` é a rota sem
  # token do WaCalls. Se há um número conectado, e qual, só a tela diz.
  if ! whatsapp_calls_enabled; then
    add whatsapp_calls "Ligação pelo WhatsApp" 0 ok "serviço não instalado nesta máquina (é o padrão). Para conectar um número, instale-o pela tela: Configurações → Ligação pelo WhatsApp"
  elif ! running wacalls; then
    add whatsapp_calls "Ligação pelo WhatsApp" 0 falha "o serviço de ligação pelo WhatsApp (WaCalls) foi instalado pela tela e o contêiner não está rodando. Veja: docker compose -f deploy/docker-compose.yml --profile whatsapp-calls logs --tail 50 wacalls"
  elif [ -z "$(env_get "$ENV_FILE" WACALLS_API_TOKEN)" ]; then
    add whatsapp_calls "Ligação pelo WhatsApp" 0 falha "o serviço de ligação pelo WhatsApp está rodando, mas esta instalação não tem a chave dele: o processo de voz não consegue falar com ele. Rode: bash install/update.sh"
  elif ! running voice; then
    add whatsapp_calls "Ligação pelo WhatsApp" 0 aviso "não deu para conferir porque o processo de voz não está rodando; resolva a voz primeiro"
  elif dc exec -T voice node -e "fetch('http://wacalls:8080/healthz',{signal:AbortSignal.timeout(8000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
    add whatsapp_calls "Ligação pelo WhatsApp" 0 ok "serviço instalado e respondendo. Se há um número conectado, e qual, aparece em Configurações"
  else
    add whatsapp_calls "Ligação pelo WhatsApp" 0 falha "o serviço de ligação pelo WhatsApp (WaCalls) está rodando, mas não responde ao processo de voz. Veja: docker compose -f deploy/docker-compose.yml --profile whatsapp-calls logs --tail 50 wacalls"
  fi

  # ── Portas UDP na máquina ──
  rtp_start="$(env_get "$ENV_FILE" RTP_START)"; rtp_end="$(env_get "$ENV_FILE" RTP_END)"
  conf_start="$(sed -n 's/^rtpstart=//p' "$GENERATED_DIR/rtp.conf" 2>/dev/null || true)"
  conf_end="$(sed -n 's/^rtpend=//p' "$GENERATED_DIR/rtp.conf" 2>/dev/null || true)"
  if [ "$rtp_start" != "$conf_start" ] || [ "$rtp_end" != "$conf_end" ]; then
    add udp "Portas UDP locais" 0 falha "a faixa de áudio publicada ($rtp_start-$rtp_end) é diferente da que o Asterisk usa (${conf_start:-?}-${conf_end:-?}): a ligação conecta e fica muda. Rode bash install/install.sh para regerar"
  elif ! have ss; then
    add udp "Portas UDP locais" 0 aviso "não consegui conferir (comando ss ausente nesta máquina)"
  elif udp_ports_in_use | grep -qx 5060; then
    add udp "Portas UDP locais" 0 ok "5060/udp aberta nesta máquina, áudio em $rtp_start-$rtp_end/udp. Isto não prova que o provedor deixa passar: a prova é uma ligação"
  else
    add udp "Portas UDP locais" 0 falha "a porta 5060/udp não está aberta nesta máquina: a operadora não consegue entregar ligação"
  fi

  # ── Agente de atualização: é ele que deixa o painel oferecer "atualizar" ──
  # Nunca é falha: sem ele a instalação funciona inteira, e a atualização continua pelo terminal.
  agent_sched=""
  case "$(agent_scheduler)" in
    systemd) if [ -f "$SYSTEMD_DIR/$AGENT_UNIT.timer" ] && systemctl is-enabled --quiet "$AGENT_UNIT.timer" 2>/dev/null; then agent_sched="timer do systemd"; fi ;;
    cron) if [ -f "$CRON_DIR/$AGENT_UNIT" ]; then agent_sched="cron"; fi ;;
  esac
  agent_last="$(cat "$AGENT_STATE_DIR/last-ok" 2>/dev/null || true)"
  # Pela entrada, a rota do agente tem de ser recusada pelo Caddy: 404 sem corpo.
  agent_route="$(printf '%s\n' "$entry_lines" | awk -F'|' '$1 == "agent" { print $2 "|" $3; exit }')"
  case "$agent_route" in
    ""|"404|0"|erro*) agent_layer="" ;;   # sem resposta da entrada não há o que dizer aqui: a linha "Entrada única" já acusa
    "404|"*) agent_layer="pela entrada, quem recusa a rota do agente é o PAINEL, e não o Caddy: o Caddy está rodando um Caddyfile antigo, de antes da atualização (o arquivo só é relido ao reiniciar). Reinicie o Caddy: docker restart deskvoice-caddy-1" ;;
    *) agent_layer="pela entrada, a rota do agente respondeu HTTP ${agent_route%%|*} em vez de \"não existe\" (404): o Caddy não está aplicando a regra que a esconde da internet. Reinicie o Caddy: docker restart deskvoice-caddy-1  — e, se continuar, rode bash install/diagnose.sh" ;;
  esac
  if [ -n "$agent_layer" ]; then
    add agent "Agente de atualização" 0 aviso "$agent_layer"
  elif [ -z "$agent_sched" ]; then
    add agent "Agente de atualização" 0 aviso "não está agendado: a atualização pela tela não funciona (pelo terminal, sim). Rode: sudo bash install/agent.sh --install"
  elif [ -n "$(find "$AGENT_STATE_DIR/last-ok" -mmin -5 2>/dev/null)" ]; then
    add agent "Agente de atualização" 0 ok "agendado ($agent_sched); falou com o painel pela última vez em $agent_last"
  elif [ -n "$agent_last" ]; then
    add agent "Agente de atualização" 0 aviso "agendado ($agent_sched), mas não fala com o painel desde $agent_last. O motivo está em deploy/agent/agent.log"
  else
    add agent "Agente de atualização" 0 aviso "agendado ($agent_sched), mas ainda não falou com o painel. Espere um minuto; se continuar, veja deploy/agent/agent.log"
  fi

  # ── Disco ──
  free_mb="$(free_disk_mb "$DEPLOY_DIR")"
  if [ "$free_mb" -lt 1024 ]; then add disk "Disco" 0 falha "só ${free_mb} MB livres: o banco pode parar de gravar. Apague backups antigos em backups/ ou aumente o disco"
  elif [ "$free_mb" -lt 5120 ]; then add disk "Disco" 0 aviso "${free_mb} MB livres: pouco espaço para backups e atualização"
  else add disk "Disco" 0 ok "$((free_mb / 1024)) GB livres"; fi
fi

# ── Saída ──
exit_code=0
while IFS='|' read -r _ _ essential state _; do
  [ "$state" = falha ] || continue
  if [ "$essential" = 1 ]; then exit_code=1; elif [ "$exit_code" = 0 ]; then exit_code=2; fi
done <<EOF
$RESULTS
EOF

if [ "$as_json" = 1 ]; then
  printf '%s' "$RESULTS" | awk -F'|' -v code="$exit_code" '
    function esc(s) { gsub(/\\/, "\\\\", s); gsub(/"/, "\\\"", s); gsub(/[\001-\037]/, " ", s); return s }
    BEGIN { printf "{\"exit_code\":%s,\"checks\":[", code }
    NF >= 5 { printf "%s{\"id\":\"%s\",\"name\":\"%s\",\"essential\":%s,\"status\":\"%s\",\"detail\":\"%s\"}", (n++ ? "," : ""), $1, esc($2), ($3 == 1 ? "true" : "false"), $4, esc($5) }
    END { print "]}" }'
else
  printf '%s' "$RESULTS" | while IFS='|' read -r _ name _ state detail; do
    case "$state" in ok) color="$C_GRN" ;; aviso) color="$C_YLW" ;; *) color="$C_RED" ;; esac
    printf '  %s%-6s%s %-18s %s\n' "$color" "$state" "$C_OFF" "$name" "$detail"
  done
  case "$exit_code" in
    1) printf '\n  Há peça essencial fora do ar. Para pedir ajuda com tudo junto: bash install/diagnose.sh\n' ;;
    2) printf '\n  O sistema está no ar, com um item quebrado acima.\n' ;;
  esac
fi
exit "$exit_code"
