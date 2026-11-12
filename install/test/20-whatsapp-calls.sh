#!/usr/bin/env bash
# Ligação pelo WhatsApp (WaCalls): as chaves nascem no instalador e chegam só a quem fala com ele. O
# serviço fica num perfil próprio, e quem o liga e desliga é o agente, a partir do TERCEIRO sim ou
# não do painel (`whatsappCalls`), sem mexer no serviço de WhatsApp por QR Code.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
fake_install
source "$KIT/_common.sh"; set +e; trap - ERR
D="$DESKVOICE_DEPLOY_DIR"; E="$D/.env"; A="$D/app.env"; C="$REPO/deploy/docker-compose.yml"
export DESKVOICE_HEALTH_TIMEOUT=0
printf 'agents=3\ncalls=120\nusers=1\n' > "$FAKE_DIR/counts_backup"; cp "$FAKE_DIR/counts_backup" "$FAKE_DIR/counts_restore"
position() { grep -n -- "$1" "$FAKE_DIR/calls.log" | head -n 1 | cut -d: -f1; }

# ── As chaves são do instalador ──
token="$(env_get "$E" WACALLS_API_TOKEN)"; user="$(env_get "$E" WACALLS_ADMIN_USER)"; pass="$(env_get "$E" WACALLS_ADMIN_PASSWORD)"
check "o instalador gera o token do WaCalls" test "${#token}" = 64
check "e o usuário do administrador" test -n "$user"
check "e a senha do administrador" test "${#pass}" = 48
lacks "nada disso fica no app.env, que o migrate também recebe" "$(cat "$A")" "WACALLS_"
( source "$KIT/_common.sh"; write_env_files "https://voz.exemplo.com.br" 203.0.113.10 voz.exemplo.com.br 10000 10200 )
equal "rodar o instalador de novo não troca nada" "$token $user $pass" "$(env_get "$E" WACALLS_API_TOKEN) $(env_get "$E" WACALLS_ADMIN_USER) $(env_get "$E" WACALLS_ADMIN_PASSWORD)"
equal "nenhuma chave duplicada no .env" "" "$(sed 's/=.*//' "$E" | sort | uniq -d)"
check "o token entra na lista do que nunca aparece em tela" test "$(printf 'x %s y\n' "$token" | mask_secrets)" = "x *** y"
check "a senha também" test "$(printf 'x %s y\n' "$pass" | mask_secrets)" = "x *** y"
( source "$KIT/_common.sh"; if ensure_wacalls; then exit 0; else exit 1; fi ); equal "ensure_wacalls diz que as chaves já existiam" 1 "$?"
env_unset "$E" WACALLS_ADMIN_PASSWORD
( source "$KIT/_common.sh"; if ensure_wacalls; then exit 0; else exit 1; fi ); equal "faltando uma, ensure_wacalls cria só ela e diz que criou" "0 $token" "$? $(env_get "$E" WACALLS_API_TOKEN)"

# ── O Compose ──
block="$(awk '/^  wacalls:/ { on = 1; next } on && /^  [a-z-]+:/ { on = 0 } on' "$C")"
contains "o WaCalls fica no perfil próprio: não sobe por padrão" "$block" 'profiles: ["whatsapp-calls"]'
contains "imagem do canal develop, fixada pelo resumo que o DeskcommCRM também fixa" "$block" "image: ghcr.io/jotadev66/wacalls@sha256:9ff52ef9455cf42125a911c38bb8c855f0cc205516cada2054e5c05546909022"
lacks "não publica porta nenhuma, nem TCP nem UDP" "$block" "ports:"
lacks "não fixa porta UDP de áudio nesta fatia" "$block" "WACALLS_WEBRTC_UDP_PORT"
lacks "não anuncia IP público: o par do áudio é o processo de voz, na rede interna" "$block" "WACALLS_PUBLIC_IP"
lacks "não lê o app.env" "$block" "env_file"
contains "tem teto de memória" "$block" "mem_limit: 256m"
contains "o pareamento mora num volume nomeado" "$block" "wacalls-data:/data"
contains "só na rede interna" "$block" "networks: [internal]"
contains "log no padrão dos outros serviços" "$block" "logging: *logging"
services_with() { awk -v key="$1" '/^  [a-z-]+:/ { s = $1 } index($0, key ": \"${" key ":-}\"") { print s }' "$C" | tr -d ':' | tr '\n' ' '; }
equal "o token chega só à voz e ao WaCalls" "voice wacalls " "$(services_with WACALLS_API_TOKEN)"
equal "o usuário do administrador, só ao WaCalls" "wacalls " "$(services_with WACALLS_ADMIN_USER)"
equal "a senha do administrador, só ao WaCalls" "wacalls " "$(services_with WACALLS_ADMIN_PASSWORD)"
equal "ninguém espera o WaCalls para subir" "" "$(grep -n 'wacalls: { condition' "$C")"
equal "a imagem que o kit remove é a do Compose" "ghcr.io/jotadev66/wacalls@sha256:9ff52ef9455cf42125a911c38bb8c855f0cc205516cada2054e5c05546909022" "$(wacalls_image_ref)"

# ── Por padrão o serviço não existe ──
profile_calls() { grep -c -- '--profile whatsapp-calls' "$FAKE_DIR/calls.log"; }
equal "instalação nova: a ligação pelo WhatsApp não está ligada" "" "$(env_get "$E" DESKVOICE_WHATSAPP_CALLS)"
env_unset "$E" WACALLS_API_TOKEN; env_unset "$E" WACALLS_ADMIN_USER; env_unset "$E" WACALLS_ADMIN_PASSWORD; : > "$FAKE_DIR/calls.log"
out="$(bash "$KIT/update.sh" --to 0.3.0 --yes 2>&1)"; equal "atualização a partir de versão sem o WaCalls: zero" 0 "$?"
check "quem atualiza ganha o token, sem fazer nada" test -n "$(env_get "$E" WACALLS_API_TOKEN)"
equal "sem o serviço ligado, a atualização NÃO baixa a imagem do WaCalls" 0 "$(grep -c 'pull -q wacalls' "$FAKE_DIR/calls.log")"
equal "sem o serviço ligado, nenhum comando enxerga o perfil" 0 "$(profile_calls)"
lacks "o token não aparece na saída do atualizador" "$out" "$(env_get "$E" WACALLS_API_TOKEN)"
env_unset "$E" WACALLS_API_TOKEN; : > "$FAKE_DIR/calls.log"
bash "$KIT/update.sh" --to 0.3.0 --yes >/dev/null 2>&1; equal "mesma versão, sem o token: zero" 0 "$?"
check "mesma versão, sem o token: gera" test -n "$(env_get "$E" WACALLS_API_TOKEN)"
equal "mesma versão, sem o token: recria quem recebe as chaves" 1 "$(grep -c ' up -d$' "$FAKE_DIR/calls.log")"

H="$KIT/healthcheck.sh"
line() { printf '%s\n' "$out" | grep "$1" | head -n 1; }
out="$(bash "$H" 2>&1)"; equal "serviço não instalado: zero" 0 "$?"
contains "não instalado é ok e diz onde se instala" "$(line 'Ligação pelo WhatsApp')" "não instalado nesta máquina (é o padrão)"

# ── O agente liga e desliga pelo terceiro sim ou não ──
S="$D/agent"
agent() { bash "$KIT/agent.sh" 2>&1; }
fresh() { rm -f "$FAKE_DIR"/agent_call.* "$FAKE_DIR/agent_replies"; : > "$FAKE_DIR/calls.log"; }
said() { sed -n "${2}p" "$FAKE_DIR/agent_call.$1" 2>/dev/null; }   # said <chamada> <linha>: 13 a 17 são do WaCalls
calls_made() { n=0; while [ -e "$FAKE_DIR/agent_call.$((n + 1))" ]; do n=$((n + 1)); done; echo "$n"; }
up_count() { grep -cx "$1" "$FAKE_DIR/running"; }
export DESKVOICE_MEMINFO="$SANDBOX/meminfo"
plenty() { echo 20000 > "$FAKE_DIR/df_free_mb"; printf 'MemTotal: 8000000 kB\nMemAvailable: 6000000 kB\n' > "$DESKVOICE_MEMINFO"; }
plenty

fresh; printf 'update=false whatsapp=false\n' > "$FAKE_DIR/agent_replies"
agent >/dev/null; equal "painel sem o terceiro campo: a passada termina bem" 0 "$?"
equal "painel sem o terceiro campo: nada do WaCalls se mexe (só se olha se ele está de pé)" 0 "$(grep -cE 'pull -q wacalls|up -d|rm -sf wacalls|image rm' "$FAKE_DIR/calls.log")"
equal "o agente conta ao painel que o serviço não existe" absent "$(said 1 13)"

for forged in 'update=false whatsapp=false whatsappCalls=unknown' 'update=false whatsapp=false whatsappCalls=yes' 'update=false whatsapp=false whatsappCalls=true; curl evil' 'update=false whatsapp=false whatsappCalls=ghcr.io/evil:latest'; do
  fresh; printf '%s\n' "$forged" > "$FAKE_DIR/agent_replies"; agent >/dev/null 2>&1
  equal "\"$forged\" não sobe o WaCalls" 0 "$(grep -cE 'pull -q wacalls|up -d' "$FAKE_DIR/calls.log")"
  equal "\"$forged\" não liga o perfil" "" "$(env_get "$E" DESKVOICE_WHATSAPP_CALLS)"
done

# Sim: confere o disco, baixa a imagem do Compose e sobe SÓ o wacalls. O WAHA não é tocado.
fresh; printf 'update=false whatsapp=false whatsappCalls=true\nupdate=false whatsapp=false whatsappCalls=true\n' > "$FAKE_DIR/agent_replies"
agent >/dev/null; equal "sim: a passada termina bem" 0 "$?"
check "sim: baixa a imagem antes de subir" test "$(position ' pull -q wacalls$')" -lt "$(position ' up -d wacalls$')"
equal "sim: nenhuma imagem veio do painel (o pull leva só o nome do serviço)" 1 "$(grep -c -- '--profile whatsapp-calls pull -q wacalls$' "$FAKE_DIR/calls.log")"
equal "sim: sobe só o wacalls, sem recriar o resto" 0 "$(grep -c ' up -d$' "$FAKE_DIR/calls.log")"
equal "sim: o serviço fica de pé, e o WAHA não" "1 0" "$(up_count wacalls) $(up_count waha)"
equal "sim: a marca fica gravada, e só a dele" "on " "$(env_get "$E" DESKVOICE_WHATSAPP_CALLS) $(env_get "$E" DESKVOICE_WHATSAPP)"
equal "sim: na segunda fala conta que está de pé" "2 running absent" "$(calls_made) $(said 2 13) $(said 2 8)"
contains "sim: fica no registro do agente" "$(cat "$S/agent.log")" "serviço de ligação pelo WhatsApp no ar"
: > "$FAKE_DIR/calls.log"; dc ps -q panel >/dev/null
equal "com a marca, todo comando do kit enxerga o perfil" 1 "$(profile_calls)"
fresh; printf 'update=false whatsapp=false whatsappCalls=true\n' > "$FAKE_DIR/agent_replies"; agent >/dev/null
equal "sim, de pé: nada a fazer, uma fala só" "0 1" "$(grep -cE 'pull -q|up -d' "$FAKE_DIR/calls.log") $(calls_made)"

out="$(bash "$H" 2>&1)"; equal "instalado e respondendo: zero" 0 "$?"
contains "instalado e respondendo é ok" "$(line 'Ligação pelo WhatsApp')" "serviço instalado e respondendo"
touch "$FAKE_DIR/wacalls_down"
out="$(bash "$H" 2>&1)"; equal "instalado e calado: código 2" 2 "$?"
contains "instalado e calado é falha, com o comando dos registros" "$(line 'Ligação pelo WhatsApp')" "--profile whatsapp-calls logs --tail 50 wacalls"
bash "$H" --essential >/dev/null 2>&1; equal "não derruba a checagem essencial (não provoca volta de atualização)" 0 "$?"
rm -f "$FAKE_DIR/wacalls_down"

# Com o serviço ligado, a atualização baixa a imagem dele antes de mexer no banco.
: > "$FAKE_DIR/calls.log"
out="$(bash "$KIT/update.sh" --to 0.5.0 --yes 2>&1)"; equal "atualização com o serviço ligado: zero" 0 "$?"
check "a imagem do WaCalls é baixada antes de mexer no banco" test "$(position ' pull -q wacalls$')" -lt "$(position 'run --rm migrate')"
contains "o serviço sobe junto com os outros" "$(grep ' up -d --remove-orphans$' "$FAKE_DIR/calls.log" | head -n 1)" "--profile whatsapp-calls"
touch "$FAKE_DIR/wacalls_pull_fail"; : > "$FAKE_DIR/calls.log"
out="$(bash "$KIT/update.sh" --to 0.6.0 --yes 2>&1)"; equal "imagem do WaCalls não baixa: sai com erro" 1 "$?"
contains "diz o que não baixou" "$out" "Não consegui baixar a imagem do serviço de ligação pelo WhatsApp (WaCalls)"
equal "o banco não foi tocado" 0 "$(grep -c 'run --rm migrate' "$FAKE_DIR/calls.log")"
rm -f "$FAKE_DIR/wacalls_pull_fail"

# Não: remove só o que é do WaCalls. O volume com o pareamento fica; o WAHA, se estiver de pé, também.
echo waha >> "$FAKE_DIR/running"; env_set "$E" DESKVOICE_WHATSAPP on; echo waha > "$FAKE_DIR/waha_image"
fresh; printf 'update=false whatsapp=true whatsappCalls=false\nupdate=false whatsapp=true whatsappCalls=false\n' > "$FAKE_DIR/agent_replies"
agent >/dev/null; equal "não: a passada termina bem" 0 "$?"
equal "não: o contêiner do WaCalls é parado e removido" 1 "$(grep -c ' rm -sf wacalls$' "$FAKE_DIR/calls.log")"
equal "não: a imagem fixada do WaCalls sai, pela referência por resumo" 1 "$(grep -cx -- "image rm $(wacalls_image_ref)" "$FAKE_DIR/calls.log")"
equal "não: nenhum volume é apagado, nenhuma limpeza genérica" 0 "$(grep -cE ' volume rm| down | rm -sfv| -v |prune|rmi' "$FAKE_DIR/calls.log")"
equal "não: o WAHA e a imagem dele ficam" "1 0 on" "$(up_count waha) $(grep -c 'rm -sf waha' "$FAKE_DIR/calls.log") $(env_get "$E" DESKVOICE_WHATSAPP)"
check "não: a imagem do WAHA não sai do disco" test -e "$FAKE_DIR/waha_image"
equal "não: o WaCalls e a marca dele saem" "0 " "$(up_count wacalls) $(env_get "$E" DESKVOICE_WHATSAPP_CALLS)"
equal "não: conta ao painel que o serviço não existe mais" "absent running" "$(said 2 13) $(said 2 8)"
grep -vx waha "$FAKE_DIR/running" > "$FAKE_DIR/running.next"; mv "$FAKE_DIR/running.next" "$FAKE_DIR/running"; env_unset "$E" DESKVOICE_WHATSAPP; rm -f "$FAKE_DIR/waha_image"

# ── O custo é conferido antes de baixar ──
echo 1100 > "$FAKE_DIR/df_free_mb"
fresh; printf 'update=false whatsapp=false whatsappCalls=true\nupdate=false whatsapp=false whatsappCalls=true\n' > "$FAKE_DIR/agent_replies"
agent >/dev/null; equal "sem disco: a passada não morre" 0 "$?"
equal "sem disco: NADA é baixado e o perfil não liga" "0 " "$(grep -c 'pull' "$FAKE_DIR/calls.log") $(env_get "$E" DESKVOICE_WHATSAPP_CALLS)"
equal "sem disco: conta o código, quanto há e quanto precisa" "failed no_disk 1100 1200" "$(said 2 13) $(said 2 14) $(said 2 16) $(said 2 17)"
check "sem disco: a falha fica no arquivo do WaCalls, não no do WAHA" test -s "$S/whatsapp-calls-failure" -a ! -e "$S/whatsapp-failure"
echo 1200 > "$FAKE_DIR/df_free_mb"; touch -t 202001010000 "$S/whatsapp-calls-failure"
printf 'MemTotal: 2000000 kB\nMemAvailable: 200000 kB\n' > "$DESKVOICE_MEMINFO"
fresh; printf 'update=false whatsapp=false whatsappCalls=true\nupdate=false whatsapp=false whatsappCalls=true\n' > "$FAKE_DIR/agent_replies"; agent >/dev/null
equal "com o espaço exigido e pouca memória: instala, com aviso" "1 running low_memory" "$(up_count wacalls) $(said 2 13) $(said 2 15)"
contains "pouca memória: fica no registro, com o teto dele" "$(cat "$S/agent.log")" "menos que o teto do serviço de ligação pelo WhatsApp (256 MB)"
plenty

# Os dois pedidos na mesma fala: os dois serviços convergem.
fresh; printf 'update=false whatsapp=false whatsappCalls=false\nupdate=false whatsapp=false whatsappCalls=false\n' > "$FAKE_DIR/agent_replies"; agent >/dev/null
fresh; printf 'update=false whatsapp=true whatsappCalls=true\nupdate=false whatsapp=true whatsappCalls=true\n' > "$FAKE_DIR/agent_replies"; agent >/dev/null
equal "sim para os dois: os dois sobem" "1 1" "$(up_count waha) $(up_count wacalls)"
equal "sim para os dois: a segunda fala conta os dois de pé" "running running" "$(said 2 8) $(said 2 13)"

# O JavaScript que conversa com o painel, rodado de verdade quando há Node.
if command -v node >/dev/null 2>&1; then
  speak_js="$(awk "/^SPEAK_JS='/ { on = 1; sub(/^SPEAK_JS='/, \"\") } on { print } on && /\\}\\)'\$/ { exit }" "$KIT/agent.sh" | sed "\$ s/'\$//")"
  reads() {  # reads <data da resposta, em JavaScript> → a linha que o agente leria
    printf 'tok\n0.5.0\n\n\n\n\n\nabsent\n\n\n\n\nfailed\nno_disk\n\n1100\n1200\n\nsaída\n' | node -e "globalThis.fetch=async(u,o)=>{process.stderr.write(o.body);return{ok:true,status:200,json:async()=>({ok:true,data:$1})}};$speak_js" 2>"$SANDBOX/sent"
  }
  equal "JS: três booleanos" "update=false whatsapp=false whatsappCalls=true" "$(reads '{update:false,whatsapp:false,whatsappCalls:true}')"
  equal "JS: painel sem o terceiro campo vale como não sei" "update=false whatsapp=true whatsappCalls=unknown" "$(reads '{update:false,whatsapp:true}')"
  equal "JS: texto no lugar do booleano não liga" "update=false whatsapp=false whatsappCalls=unknown" "$(reads '{update:false,whatsapp:false,whatsappCalls:"true"}')"
  contains "JS: o estado do WaCalls vai no relato, em código fechado, no campo dele" "$(cat "$SANDBOX/sent")" '"whatsappCalls":{"state":"failed","reason":"no_disk","freeDiskMb":1100,"neededDiskMb":1200}'
  contains "JS: o do WAHA segue no dele" "$(cat "$SANDBOX/sent")" '"whatsapp":{"state":"absent"}'
  lacks "JS: sem resultado de atualização, a saída não vira resultado" "$(cat "$SANDBOX/sent")" '"result"'
fi

# ── Backup: o pareamento não entra; as chaves, sim (vão com o .env) ──
backup="$(bash "$KIT/backup.sh" 2>/dev/null | tail -n 1)"
contains "o backup leva o token, dentro do .env" "$(cat "$backup/env")" "WACALLS_API_TOKEN="
equal "o backup não tem nada do volume do WaCalls" "" "$(find "$backup" -iname '*wacalls*')"
contains "o backup.sh diz que o pareamento da ligação não entra" "$(bash "$KIT/backup.sh" --help)" "wacalls-data"
finish
