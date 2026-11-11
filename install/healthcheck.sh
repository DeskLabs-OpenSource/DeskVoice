#!/usr/bin/env bash
# Checagem de saúde: uma linha por peça, cada uma com estado e detalhe.
# Nunca resume tudo em um "ok": o que importa é saber QUAL peça está fora.
#
#   bash install/healthcheck.sh            relatório para pessoas
#   bash install/healthcheck.sh --json     o mesmo, para máquinas
#   bash install/healthcheck.sh --essential  só as peças sem as quais nada funciona
#
# Estados: ok | aviso (falta configurar, não é defeito) | falha (quebrado).
# Código de saída: 0 = nenhuma falha; 1 = falhou peça essencial (painel, banco, Asterisk,
# worker de voz, rotinas); 2 = falhou outra peça (linha, motor de voz, portas, disco).
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
probe_js() {
  cat <<JS
fetch('$1',{signal:AbortSignal.timeout(8000)}).then(async r=>{const j=await r.json().catch(()=>null);const d=(j&&j.data)||{};
for(const k of [$2]){const p=d[k]||{};console.log(k+'|'+(p.status||'fail')+'|'+String(p.detail||('sem resposta para '+k+' (HTTP '+r.status+')')).replace(/[\\n|]/g,' '))}
}).catch(e=>{console.log('unreachable|fail|'+String(e.message).replace(/[\\n|]/g,' '))})
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

# ── Painel (e, por ele, linha telefônica e motor de voz) ──
panel_lines=""
if running panel; then
  panel_lines="$(dc exec -T panel node -e "$(probe_js http://127.0.0.1:3000/api/v1/system/health "'panel','trunk','engine'")" 2>/dev/null || true)"
fi
piece() { printf '%s\n' "$panel_lines" | awk -F'|' -v k="$1" -v f="$2" '$1 == k { print $f; exit }'; }
if ! running panel; then
  add panel "Painel" 1 falha "o contêiner do painel não está rodando. Veja: docker compose -f deploy/docker-compose.yml logs --tail 50 panel"
elif [ -z "$panel_lines" ] || [ -n "$(piece unreachable 1)" ]; then
  add panel "Painel" 1 falha "o painel está rodando mas não respondeu à checagem (${panel_lines:-sem saída}). Pode estar iniciando: espere 30 segundos e repita"
else
  add panel "Painel" 1 "$(label "$(piece panel 2)")" "$(piece panel 3)"
fi

# ── Worker de voz e rotinas ──
if ! running voice; then
  add voice "Worker de voz" 1 falha "o contêiner de voz não está rodando; nenhuma ligação é atendida. Veja: docker compose -f deploy/docker-compose.yml logs --tail 50 voice"
elif dc exec -T voice node -e "fetch('http://127.0.0.1:8090/health',{signal:AbortSignal.timeout(8000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
  add voice "Worker de voz" 1 ok "respondendo"
else
  add voice "Worker de voz" 1 falha "o worker de voz está rodando mas não responde; costuma ser falta de conexão com o Asterisk"
fi
if running routines; then add routines "Rotinas" 1 ok "processo rodando"
else add routines "Rotinas" 1 falha "o contêiner de rotinas não está rodando; resumos e avisos pós-chamada ficam parados"; fi

if [ "$only_essential" = 0 ]; then
  # ── Linha telefônica e motor de voz: quem sabe é o painel ──
  for pair in "trunk|Linha telefônica" "engine|Motor de voz"; do
    id="${pair%%|*}"; name="${pair#*|}"
    if [ -n "$(piece "$id" 1)" ]; then add "$id" "$name" 0 "$(label "$(piece "$id" 2)")" "$(piece "$id" 3)"
    else add "$id" "$name" 0 aviso "não deu para consultar porque o painel não respondeu; resolva o painel primeiro"; fi
  done

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

  # ── Disco ──
  free_mb="$(df -Pm "$DEPLOY_DIR" | awk 'NR == 2 { print $4 }')"
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
