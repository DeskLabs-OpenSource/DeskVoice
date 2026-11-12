#!/usr/bin/env bash
# WhatsApp por QR Code: a chave do WAHA nasce no instalador e chega só a quem fala com ele. O
# serviço fica num perfil do Compose: não sobe nem é baixado por padrão, e quem o liga e desliga
# é o agente, a partir de UM sim ou não do painel.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
fake_install
source "$KIT/_common.sh"; set +e; trap - ERR
D="$DESKVOICE_DEPLOY_DIR"; E="$D/.env"; A="$D/app.env"; C="$REPO/deploy/docker-compose.yml"
export DESKVOICE_HEALTH_TIMEOUT=0
printf 'agents=3\ncalls=120\nusers=1\n' > "$FAKE_DIR/counts_backup"; cp "$FAKE_DIR/counts_backup" "$FAKE_DIR/counts_restore"
position() { grep -n -- "$1" "$FAKE_DIR/calls.log" | head -n 1 | cut -d: -f1; }
sha512_hex() { if command -v sha512sum >/dev/null 2>&1; then printf '%s' "$1" | sha512sum | awk '{print $1}'; else printf '%s' "$1" | shasum -a 512 | awk '{print $1}'; fi; }

# ── A chave é do instalador ──
key="$(env_get "$E" WAHA_API_KEY)"
check "o instalador gera a chave do WAHA" test "${#key}" = 64
equal "o WAHA recebe só o hash SHA-512 da chave" "$(sha512_hex "$key")" "$(env_get "$E" WAHA_API_KEY_SHA512)"
equal "o hash tem 128 caracteres hexadecimais" 128 "$(env_get "$E" WAHA_API_KEY_SHA512 | tr -cd '0-9a-f' | wc -c | tr -d ' ')"
lacks "a chave fica fora do app.env, que o migrate também recebe" "$(cat "$A")" "WAHA_API_KEY"
( source "$KIT/_common.sh"; write_env_files "https://voz.exemplo.com.br" 203.0.113.10 voz.exemplo.com.br 10000 10200 )
equal "rodar o instalador de novo não troca a chave" "$key" "$(env_get "$E" WAHA_API_KEY)"
equal "nenhuma chave duplicada no .env" "" "$(sed 's/=.*//' "$E" | sort | uniq -d)"
equal "o .env continua só do dono" 600 "$(mode_of "$E")"
check "a chave entra na lista do que nunca aparece em tela" test "$(printf 'x %s y\n' "$key" | mask_secrets)" = "x *** y"
( source "$KIT/_common.sh"; if ensure_waha; then exit 0; else exit 1; fi ); equal "ensure_waha diz que a chave já existia" 1 "$?"
# Hash que não bate com a chave (arquivo mexido à mão) volta a bater, sem trocar a chave.
env_set "$E" WAHA_API_KEY_SHA512 errado; ( source "$KIT/_common.sh"; ensure_waha || true ) >/dev/null
equal "hash divergente é recalculado a partir da chave" "$(sha512_hex "$key")" "$(env_get "$E" WAHA_API_KEY_SHA512)"

# ── Quem recebe a chave no Compose ──
services_with_key() { awk '/^  [a-z-]+:/ { s = $1 } /WAHA_API_KEY: "\$\{WAHA_API_KEY:-\}"/ { print s }' "$C" | tr -d ':' | tr '\n' ' '; }
equal "só painel, voz e rotinas recebem a chave em texto puro" "panel voice routines " "$(services_with_key)"
# shellcheck disable=SC2016  # procura o texto literal do Compose
contains "o WAHA recebe o hash, com o prefixo que o faz comparar por hash" "$(cat "$C")" 'WAHA_API_KEY: "sha512:${WAHA_API_KEY_SHA512:-}"'
waha_block="$(awk '/^  waha:/ { on = 1; next } on && /^  [a-z-]+:/ { on = 0 } on' "$C")"
contains "o WAHA fica num perfil: não sobe por padrão" "$waha_block" 'profiles: ["whatsapp"]'
equal "é o único serviço em perfil" 1 "$(grep -c 'profiles:' "$C")"
lacks "o WAHA não publica porta" "$waha_block" "ports:"
lacks "o WAHA não lê o app.env" "$waha_block" "env_file"
contains "o WAHA tem teto de memória" "$waha_block" "mem_limit: 1280m"
contains "motor sem navegador, pelo nome de variável certo" "$waha_block" "WHATSAPP_DEFAULT_ENGINE: NOWEB"
contains "painel do WAHA desligado" "$waha_block" 'WAHA_DASHBOARD_ENABLED: "false"'
contains "Swagger do WAHA desligado" "$waha_block" 'WHATSAPP_SWAGGER_ENABLED: "false"'
contains "retomada das sessões ligada" "$waha_block" 'WAHA_WORKER_RESTART_SESSIONS: "true"'
contains "o QR Code não vai para o log" "$waha_block" 'WAHA_PRINT_QR: "false"'
lacks "nenhum webhook nesta fatia" "$waha_block" "WHATSAPP_HOOK"
contains "o pareamento mora num volume nomeado" "$waha_block" "waha-sessions:/app/.sessions"
contains "tem checagem de saúde" "$waha_block" "healthcheck:"
contains "log no padrão dos outros serviços" "$waha_block" "logging: *logging"
equal "ninguém espera o WAHA para subir" "" "$(grep -n 'waha: { condition' "$C")"

# ── A imagem: uma etiqueta por arquitetura, a mesma versão nas duas ──
amd="$(sed -n 's/.*WAHA_IMAGE:-\(.*\)}$/\1/p' "$C")"
version_in() { printf '%s\n' "$1" | sed -n 's/.*:noweb-\(arm-\)\{0,1\}\([0-9.]*\)@sha256:[0-9a-f]\{64\}$/\2/p'; }
check "a imagem de amd64 está fixada por versão e resumo" test -n "$(version_in "$amd")"
check "a imagem de ARM está fixada por versão e resumo" test -n "$(version_in "$WAHA_IMAGE_ARM64")"
equal "as duas arquiteturas usam a mesma versão do WAHA" "$(version_in "$amd")" "$(version_in "$WAHA_IMAGE_ARM64")"
check "os resumos são diferentes (são imagens diferentes)" test "${amd##*@}" != "${WAHA_IMAGE_ARM64##*@}"
equal "em amd64 vale o padrão do Compose: WAHA_IMAGE não é gravada" "" "$(env_get "$E" WAHA_IMAGE)"
( export FAKE_ARCH=aarch64; source "$KIT/_common.sh"; ensure_waha || true ) >/dev/null
equal "em ARM o instalador grava a imagem de ARM" "$WAHA_IMAGE_ARM64" "$(env_get "$E" WAHA_IMAGE)"
( source "$KIT/_common.sh"; ensure_waha || true ) >/dev/null
equal "de volta a amd64 (disco movido de máquina), a imagem de ARM sai" "" "$(env_get "$E" WAHA_IMAGE)"

# ── Por padrão o serviço não existe: nada é baixado, nada sobe ──
profile_calls() { grep -c -- '--profile whatsapp' "$FAKE_DIR/calls.log"; }
equal "instalação nova: o WhatsApp não está ligado" "" "$(env_get "$E" DESKVOICE_WHATSAPP)"
env_unset "$E" WAHA_API_KEY; env_unset "$E" WAHA_API_KEY_SHA512; : > "$FAKE_DIR/calls.log"
out="$(bash "$KIT/update.sh" --to 0.3.0 --yes 2>&1)"; equal "atualização a partir de versão sem WhatsApp: zero" 0 "$?"
check "quem atualiza ganha a chave (uma linha no .env), sem fazer nada" test "$(env_get "$E" WAHA_API_KEY | wc -c | tr -d ' ')" = 65
equal "e o hash dela" "$(sha512_hex "$(env_get "$E" WAHA_API_KEY)")" "$(env_get "$E" WAHA_API_KEY_SHA512)"
equal "sem WhatsApp ligado, a atualização NÃO baixa a imagem do WAHA" 0 "$(grep -c 'pull -q waha' "$FAKE_DIR/calls.log")"
equal "sem WhatsApp ligado, nenhum comando enxerga o perfil" 0 "$(profile_calls)"
equal "sem WhatsApp ligado, a atualização não liga o serviço" "" "$(env_get "$E" DESKVOICE_WHATSAPP)"
lacks "a chave não aparece na saída do atualizador" "$out" "$(env_get "$E" WAHA_API_KEY)"
# Mesmo com a imagem do WAHA impossível de baixar, quem não usa WhatsApp atualiza normalmente.
touch "$FAKE_DIR/waha_pull_fail"
out="$(bash "$KIT/update.sh" --to 0.4.0 --yes 2>&1)"; equal "Docker Hub fora não atrapalha quem não usa WhatsApp" 0 "$?"
rm -f "$FAKE_DIR/waha_pull_fail"

# Chegou à versão por um atualizador antigo, que não gerou a chave: rodar o update.sh de novo entrega.
env_unset "$E" WAHA_API_KEY; env_unset "$E" WAHA_API_KEY_SHA512; : > "$FAKE_DIR/calls.log"
out="$(bash "$KIT/update.sh" --to 0.4.0 --yes 2>&1)"; equal "mesma versão, sem a chave: zero" 0 "$?"
check "mesma versão, sem a chave: gera" test -n "$(env_get "$E" WAHA_API_KEY)"
equal "mesma versão, sem a chave: recria quem recebe a chave" 1 "$(grep -c ' up -d$' "$FAKE_DIR/calls.log")"
: > "$FAKE_DIR/calls.log"; bash "$KIT/update.sh" --to 0.4.0 --yes >/dev/null 2>&1
equal "mesma versão, já com a chave: não recria nada" 0 "$(grep -c ' up -d$' "$FAKE_DIR/calls.log")"

# ── Checagem de saúde: "não instalado" é o estado normal ──
H="$KIT/healthcheck.sh"
line() { printf '%s\n' "$out" | grep "$1" | head -n 1; }
out="$(bash "$H" 2>&1)"; equal "serviço não instalado: zero" 0 "$?"
contains "serviço não instalado é ok, nunca falha" "$(line 'WhatsApp')" "ok "
contains "diz que não está instalado e onde se instala" "$(line 'WhatsApp')" "não instalado nesta máquina (é o padrão)"

# ── O agente liga e desliga o serviço, a partir de UM sim ou não ──
S="$D/agent"
agent() { bash "$KIT/agent.sh" 2>&1; }
fresh() { rm -f "$FAKE_DIR"/agent_call.* "$FAKE_DIR/agent_replies"; : > "$FAKE_DIR/calls.log"; }
said() { sed -n "${2}p" "$FAKE_DIR/agent_call.$1" 2>/dev/null; }   # said <chamada> <linha>
calls_made() { n=0; while [ -e "$FAKE_DIR/agent_call.$((n + 1))" ]; do n=$((n + 1)); done; echo "$n"; }
waha_running() { grep -cx waha "$FAKE_DIR/running"; }
# Disco e memória de mentira: folgados, salvo quando o teste é sobre eles.
export DESKVOICE_MEMINFO="$SANDBOX/meminfo"
plenty() { echo 20000 > "$FAKE_DIR/df_free_mb"; printf 'MemTotal: 8000000 kB\nMemAvailable: 6000000 kB\n' > "$DESKVOICE_MEMINFO"; }
plenty
pinned="devlikeapro/waha@${amd##*@}"   # a referência por resumo, como o Docker guarda

# O painel de uma versão que não manda o segundo booleano: nada muda.
fresh; printf 'update=false\n' > "$FAKE_DIR/agent_replies"
agent >/dev/null; equal "resposta sem o segundo booleano: a passada termina bem" 0 "$?"
equal "resposta sem o segundo booleano: nada é baixado nem sobe" 0 "$(grep -cE 'pull -q waha|up -d waha|rm -sf waha' "$FAKE_DIR/calls.log")"
equal "o agente conta ao painel que o serviço não existe" absent "$(said 1 8)"

# Só um `true` exato liga. Qualquer outra coisa no lugar (o que um painel comprometido mandaria) não.
for forged in 'update=false whatsapp=unknown' 'update=false whatsapp=yes' 'update=false whatsapp=devlikeapro/waha:latest' 'update=false whatsapp=true; curl evil'; do
  fresh; printf '%s\n' "$forged" > "$FAKE_DIR/agent_replies"; agent >/dev/null 2>&1
  equal "\"$forged\" não sobe o WAHA" 0 "$(grep -cE 'pull -q waha|up -d' "$FAKE_DIR/calls.log")"
  equal "\"$forged\" não liga o perfil" "" "$(env_get "$E" DESKVOICE_WHATSAPP)"
done

# Sim: baixa a imagem do Compose desta instalação, liga o perfil e sobe SÓ o waha.
fresh; printf 'update=false whatsapp=true\nupdate=false whatsapp=true\n' > "$FAKE_DIR/agent_replies"
agent >/dev/null; equal "sim: a passada termina bem" 0 "$?"
check "sim: baixa a imagem antes de subir" test "$(position ' pull -q waha$')" -lt "$(position ' up -d waha$')"
equal "sim: sobe só o waha, sem recriar o resto" 0 "$(grep -c ' up -d$' "$FAKE_DIR/calls.log")"
equal "sim: o serviço fica de pé" 1 "$(waha_running)"
equal "sim: a marca fica gravada, e todo comando do kit passa a enxergar o serviço" on "$(env_get "$E" DESKVOICE_WHATSAPP)"
equal "sim: nenhuma imagem, etiqueta ou comando veio do painel (o pull não leva argumento além do serviço)" 1 "$(grep -c -- '--profile whatsapp pull -q waha$' "$FAKE_DIR/calls.log")"
equal "sim: fala duas vezes, e na segunda conta que o serviço está de pé" "2 running" "$(calls_made) $(said 2 8)"
contains "sim: fica no registro do agente" "$(cat "$S/agent.log")" "serviço de WhatsApp no ar"
fresh; printf 'update=false whatsapp=true\n' > "$FAKE_DIR/agent_replies"; agent >/dev/null
equal "sim, com o serviço de pé: nada a fazer" 0 "$(grep -cE 'pull -q waha|up -d' "$FAKE_DIR/calls.log")"
equal "sim, com o serviço de pé: uma fala só" 1 "$(calls_made)"

out="$(bash "$H" 2>&1)"; equal "serviço instalado e respondendo: zero" 0 "$?"
contains "serviço instalado e respondendo é ok" "$(line 'WhatsApp')" "serviço instalado e respondendo"
touch "$FAKE_DIR/waha_down"
out="$(bash "$H" 2>&1)"; equal "serviço instalado que não responde: código 2" 2 "$?"
contains "serviço que não responde é falha" "$(line 'WhatsApp')" "falha "
bash "$H" --essential >/dev/null 2>&1; equal "WhatsApp fora não derruba a checagem essencial (não provoca volta de atualização)" 0 "$?"
rm -f "$FAKE_DIR/waha_down"

# Com o WhatsApp ligado, a atualização baixa a imagem do WAHA ANTES de mexer em qualquer coisa.
: > "$FAKE_DIR/calls.log"
out="$(bash "$KIT/update.sh" --to 0.5.0 --yes 2>&1)"; equal "atualização com WhatsApp ligado: zero" 0 "$?"
check "com WhatsApp ligado: a imagem do WAHA é baixada antes de mexer no banco" test "$(position ' pull -q waha$')" -lt "$(position 'run --rm migrate')"
contains "com WhatsApp ligado: o serviço sobe junto com os outros" "$(grep ' up -d --remove-orphans$' "$FAKE_DIR/calls.log" | head -n 1)" "--profile whatsapp"
touch "$FAKE_DIR/waha_pull_fail"; : > "$FAKE_DIR/calls.log"
out="$(bash "$KIT/update.sh" --to 0.6.0 --yes 2>&1)"; equal "com WhatsApp ligado, imagem do WAHA não baixa: sai com erro" 1 "$?"
contains "diz o que não baixou" "$out" "Não consegui baixar a imagem do serviço de WhatsApp (WAHA)"
contains "diz que nada foi alterado" "$out" "Nada foi alterado: a instalação segue na versão 0.5.0"
equal "a versão gravada continua a anterior" 0.5.0 "$(env_get "$E" DESKVOICE_VERSION)"
equal "o banco não foi tocado" 0 "$(grep -c 'run --rm migrate' "$FAKE_DIR/calls.log")"
equal "nenhum serviço foi parado" 0 "$(grep -c ' stop ' "$FAKE_DIR/calls.log")"
rm -f "$FAKE_DIR/waha_pull_fail"

# Não: para e remove o contêiner. O volume com o pareamento fica.
fresh; printf 'update=false whatsapp=false\nupdate=false whatsapp=false\n' > "$FAKE_DIR/agent_replies"
agent >/dev/null; equal "não: a passada termina bem" 0 "$?"
equal "não: o contêiner é parado e removido" 1 "$(grep -c ' rm -sf waha$' "$FAKE_DIR/calls.log")"
equal "não: nenhum volume é apagado" 0 "$(grep -cE ' volume rm| down | rm -sfv| -v ' "$FAKE_DIR/calls.log")"
equal "não: a imagem FIXADA sai do disco, pela referência por resumo do Compose" 1 "$(grep -cx -- "image rm $pinned" "$FAKE_DIR/calls.log")"
check "não: a imagem sai depois do contêiner" test "$(position ' rm -sf waha$')" -lt "$(position '^image rm ')"
equal "não: nenhuma limpeza genérica, que apagaria imagem de outros sistemas" 0 "$(grep -cE 'prune|rmi|image rm -|image rm .* ' "$FAKE_DIR/calls.log")"
check "não: a imagem não está mais no disco" test ! -e "$FAKE_DIR/waha_image"
equal "não: o serviço sai" 0 "$(waha_running)"
equal "não: a marca sai" "" "$(env_get "$E" DESKVOICE_WHATSAPP)"
equal "não: conta ao painel que o serviço não existe mais" "2 absent" "$(calls_made) $(said 2 8)"
fresh; printf 'update=false whatsapp=false\n' > "$FAKE_DIR/agent_replies"; agent >/dev/null
equal "não, sem serviço: nada a fazer" 0 "$(grep -c ' rm -sf waha$' "$FAKE_DIR/calls.log")"

# A imagem não baixa: o agente conta o código da falha e não repete o download a cada minuto.
touch "$FAKE_DIR/waha_pull_fail"
fresh; printf 'update=false whatsapp=true\nupdate=false whatsapp=true\n' > "$FAKE_DIR/agent_replies"
agent >/dev/null; equal "download falhou: a passada não morre" 0 "$?"
equal "download falhou: o serviço não sobe" 0 "$(grep -c ' up -d' "$FAKE_DIR/calls.log")"
equal "download falhou: o perfil não é ligado" "" "$(env_get "$E" DESKVOICE_WHATSAPP)"
equal "download falhou: conta ao painel o estado e o código" "failed pull_failed" "$(said 2 8) $(said 2 9)"
equal "download falhou: a volta seguinte não tenta de novo" 1 "$(grep -c ' pull -q waha$' "$FAKE_DIR/calls.log")"
fresh; printf 'update=false whatsapp=true\n' > "$FAKE_DIR/agent_replies"; agent >/dev/null
equal "falhou há pouco: a passada seguinte não baixa de novo" 0 "$(grep -c ' pull -q waha$' "$FAKE_DIR/calls.log")"
rm -f "$FAKE_DIR/waha_pull_fail"; touch -t 202001010000 "$S/whatsapp-failure"
fresh; printf 'update=false whatsapp=true\nupdate=false whatsapp=true\n' > "$FAKE_DIR/agent_replies"; agent >/dev/null
equal "falha antiga: tenta de novo e sobe" "1 on" "$(waha_running) $(env_get "$E" DESKVOICE_WHATSAPP)"
check "subiu: o registro da falha sai" test ! -e "$S/whatsapp-failure"

# ── O agente confere o custo ANTES de baixar ──
fresh; printf 'update=false whatsapp=false\nupdate=false whatsapp=false\n' > "$FAKE_DIR/agent_replies"; agent >/dev/null
# Disco: sem espaço para a imagem mais a folga, nada é baixado.
echo 4000 > "$FAKE_DIR/df_free_mb"
fresh; printf 'update=false whatsapp=true\nupdate=false whatsapp=true\n' > "$FAKE_DIR/agent_replies"
agent >/dev/null; equal "sem disco: a passada não morre" 0 "$?"
equal "sem disco: NADA é baixado" 0 "$(grep -c 'pull' "$FAKE_DIR/calls.log")"
equal "sem disco: nada sobe e o perfil não liga" "0 " "$(grep -c ' up -d' "$FAKE_DIR/calls.log") $(env_get "$E" DESKVOICE_WHATSAPP)"
equal "sem disco: conta ao painel o código, quanto há e quanto precisa" "failed no_disk 4000 5120" "$(said 2 8) $(said 2 9) $(said 2 11) $(said 2 12)"
contains "sem disco: fica no registro" "$(cat "$S/agent.log")" "há 4000 MB livres e o serviço pede 5120"
echo 5119 > "$FAKE_DIR/df_free_mb"; touch -t 202001010000 "$S/whatsapp-failure"
fresh; printf 'update=false whatsapp=true\n' > "$FAKE_DIR/agent_replies"; agent >/dev/null
equal "um MB abaixo do exigido ainda não baixa" 0 "$(grep -c 'pull' "$FAKE_DIR/calls.log")"
echo 5120 > "$FAKE_DIR/df_free_mb"; touch -t 202001010000 "$S/whatsapp-failure"
# Memória: abaixo do teto do serviço não bloqueia; instala e avisa.
printf 'MemTotal: 2000000 kB\nMemAvailable: 900000 kB\n' > "$DESKVOICE_MEMINFO"
fresh; printf 'update=false whatsapp=true\nupdate=false whatsapp=true\n' > "$FAKE_DIR/agent_replies"; agent >/dev/null
equal "com o espaço exigido e pouca memória: instala" "1 on" "$(waha_running) $(env_get "$E" DESKVOICE_WHATSAPP)"
equal "pouca memória: conta o serviço de pé, com o aviso" "running low_memory" "$(said 2 8) $(said 2 10)"
contains "pouca memória: fica no registro" "$(cat "$S/agent.log")" "menos que o teto do serviço de WhatsApp (1280 MB)"
plenty

# ── Remover devolve o disco; imagem que não sai vira aviso, não falha ──
touch "$FAKE_DIR/waha_image_busy"
fresh; printf 'update=false whatsapp=false\nupdate=false whatsapp=false\n' > "$FAKE_DIR/agent_replies"; agent >/dev/null
equal "imagem em uso: o contêiner sai mesmo assim" "0 " "$(waha_running) $(env_get "$E" DESKVOICE_WHATSAPP)"
equal "imagem em uso: o pedido não falha; o painel ouve o aviso de que o disco não foi devolvido" "absent image_kept" "$(said 2 8) $(said 2 10)"
contains "imagem em uso: o registro diz como tentar de novo" "$(cat "$S/agent.log")" "não saiu do disco"
rm -f "$FAKE_DIR/waha_image_busy"
fresh; printf 'update=false whatsapp=false\nupdate=false whatsapp=false\n' > "$FAKE_DIR/agent_replies"; agent >/dev/null
check "passada seguinte, com a imagem livre: ela sai" test ! -e "$FAKE_DIR/waha_image"
equal "passada seguinte: o aviso some do relato" "absent " "$(said 2 8) $(said 2 10)"
fresh; printf 'update=false whatsapp=false\n' > "$FAKE_DIR/agent_replies"; agent >/dev/null
equal "sem contêiner e sem imagem: uma fala só, nada a fazer" "1 0" "$(calls_made) $(grep -c 'image rm' "$FAKE_DIR/calls.log")"

# ── Download lento não prende a passada (e a atualização que estiver esperando) ──
touch "$FAKE_DIR/waha_pull_hang"
fresh; printf 'update=false whatsapp=true\nupdate=false whatsapp=true\n' > "$FAKE_DIR/agent_replies"
DESKVOICE_WHATSAPP_PULL_DEADLINE=1 bash "$KIT/agent.sh" >/dev/null 2>&1; equal "download lento: a passada termina bem" 0 "$?"
equal "download lento: não é falha (o Docker guarda o que já baixou, e a próxima passada continua)" "absent " "$(said 2 8) $(said 2 9)"
check "download lento: não fica registro de falha, então a próxima passada tenta de novo" test ! -e "$S/whatsapp-failure"
equal "download lento: a passada volta a ouvir o painel logo depois do prazo" 2 "$(calls_made)"
equal "download lento: nada sobe" 0 "$(grep -c ' up -d' "$FAKE_DIR/calls.log")"
rm -f "$FAKE_DIR/waha_pull_hang"

# Pedido de atualização e de WhatsApp na mesma fala: a atualização vai primeiro, o WhatsApp não se perde.
fresh; printf 'update=false whatsapp=false\nupdate=false whatsapp=false\n' > "$FAKE_DIR/agent_replies"; agent >/dev/null
fresh; printf 'update=true whatsapp=true\nupdate=false whatsapp=true\nupdate=false whatsapp=true\n' > "$FAKE_DIR/agent_replies"
agent >/dev/null 2>&1
equal "sim para os dois: a volta que entrega o resultado da atualização também sobe o serviço" 1 "$(waha_running)"

# O JavaScript que conversa com o painel, rodado de verdade quando há Node: o Docker de mentira
# responde no lugar dele, então é aqui que a leitura da resposta é conferida.
if command -v node >/dev/null 2>&1; then
  speak_js="$(awk "/^SPEAK_JS='/ { on = 1; sub(/^SPEAK_JS='/, \"\") } on { print } on && /\\}\\)'\$/ { exit }" "$KIT/agent.sh" | sed "\$ s/'\$//")"
  reads() {  # reads <data da resposta, em JavaScript> → a linha que o agente leria
    printf 'tok\n0.3.0\n\n\n\n\n\nfailed\nno_disk\nlow_memory\n4000\n5120\n' | node -e "globalThis.fetch=async(u,o)=>{process.stderr.write(o.body);return{ok:true,status:200,json:async()=>({ok:true,data:$1})}};$speak_js" 2>"$SANDBOX/sent"
  }
  equal "JS: dois booleanos" "update=false whatsapp=true" "$(reads '{update:false,whatsapp:true}')"
  equal "JS: não explícito" "update=true whatsapp=false" "$(reads '{update:true,whatsapp:false}')"
  equal "JS: painel antigo, sem o campo, vale como não sei" "update=false whatsapp=unknown" "$(reads '{update:false}')"
  equal "JS: texto no lugar do booleano não liga" "update=false whatsapp=unknown" "$(reads '{update:false,whatsapp:"true"}')"
  equal "JS: objeto no lugar do booleano não liga" "update=false whatsapp=unknown" "$(reads '{update:false,whatsapp:{image:"evil"}}')"
  contains "JS: o estado do serviço vai no relato, em código fechado" "$(cat "$SANDBOX/sent")" '"whatsapp":{"state":"failed","reason":"no_disk","warning":"low_memory","freeDiskMb":4000,"neededDiskMb":5120}'
fi

# ── Backup: o pareamento não entra; a chave, sim (vai com o .env) ──
backup="$(bash "$KIT/backup.sh" 2>/dev/null | tail -n 1)"
contains "o backup leva a chave, dentro do .env" "$(cat "$backup/env")" "WAHA_API_KEY="
equal "o backup não tem nada do volume de sessões" "" "$(find "$backup" -iname '*waha*' -o -iname '*session*')"
contains "o backup.sh diz que o pareamento não entra" "$(bash "$KIT/backup.sh" --help)" "NÃO entra no backup"
finish
