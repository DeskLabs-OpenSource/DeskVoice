#!/usr/bin/env bash
# healthcheck.sh: uma linha por peça; "falta configurar" é aviso, "quebrado" é falha.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
fake_install
H="$KIT/healthcheck.sh"
line() { printf '%s\n' "$out" | grep "$1" | head -n 1; }

# Instalação nova: tudo no ar, linha e motor ainda por configurar.
out="$(bash "$H" 2>&1)"; equal "instalação nova sem linha nem chave: sai com zero" 0 "$?"
equal "uma linha por peça (13 peças)" 13 "$(printf '%s\n' "$out" | grep -cE '^  (ok|aviso|falha) ')"
for piece in Painel Banco Asterisk "Worker de voz" Rotinas "Linha telefônica" "Motor de voz" WhatsApp "Portas UDP locais" Disco; do contains "tem a linha de: $piece" "$out" "$piece"; done
contains "linha não cadastrada é aviso, não falha" "$(line 'Linha telefônica')" "aviso"
contains "linha não cadastrada traz o detalhe" "$(line 'Linha telefônica')" "nenhuma linha cadastrada ainda"
contains "motor sem chave é aviso, não falha" "$(line 'Motor de voz')" "aviso"
contains "portas: honesto sobre o que não prova" "$(line 'Portas UDP')" "não prova que o provedor deixa passar"
lacks "não resume tudo num ok" "$out" "tudo ok"

# Linha cadastrada e quebrada: falha, mas não é peça essencial.
printf '%s\n' 'panel|ok|respondendo' 'trunk|fail|registro recusado pela operadora (401)' 'engine|ok|gemini-live' > "$FAKE_DIR/panel_health"
out="$(bash "$H" 2>&1)"; equal "linha quebrada: código 2" 2 "$?"
contains "linha quebrada é falha" "$(line 'Linha telefônica')" "falha "
contains "linha quebrada traz o motivo" "$(line 'Linha telefônica')" "registro recusado pela operadora (401)"
bash "$H" --essential >/dev/null 2>&1; equal "linha quebrada não derruba a checagem essencial" 0 "$?"

# Painel fora: essencial.
printf '%s\n' postgres asterisk voice routines caddy > "$FAKE_DIR/running"
out="$(bash "$H" 2>&1)"; equal "painel parado: código 1" 1 "$?"
contains "painel parado é falha" "$(line 'Painel')" "falha"
contains "sem painel, a linha fica como não consultada" "$(line 'Linha telefônica')" "não deu para consultar"
contains "banco continua sendo conferido direto" "$(line 'Banco')" "ok"
bash "$H" --essential >/dev/null 2>&1; equal "painel parado derruba a checagem essencial" 1 "$?"
printf '%s\n' postgres asterisk panel voice routines caddy > "$FAKE_DIR/running"

# Painel no ar mas sem responder.
echo 'unreachable|fail|connect ECONNREFUSED 127.0.0.1:3000' > "$FAKE_DIR/panel_health"
out="$(bash "$H" 2>&1)"; equal "painel mudo: código 1" 1 "$?"
contains "painel mudo traz o erro" "$(line 'Painel')" "ECONNREFUSED"
printf '%s\n' 'panel|ok|respondendo' 'trunk|ok|registrado' 'engine|ok|gemini-live' > "$FAKE_DIR/panel_health"

# Cada peça essencial, uma a uma.
echo 1 > "$FAKE_DIR/pg_isready_exit"; bash "$H" >/dev/null 2>&1; equal "banco sem aceitar conexão: código 1" 1 "$?"; echo 0 > "$FAKE_DIR/pg_isready_exit"
echo 1 > "$FAKE_DIR/voice_exit"; out="$(bash "$H" 2>&1)"; equal "worker de voz mudo: código 1" 1 "$?"; echo 0 > "$FAKE_DIR/voice_exit"
contains "worker de voz mudo é falha" "$(line 'Worker de voz')" "falha"

# O Asterisk responde a comandos, mas o processo de voz não consegue falar com ele (ARI fechada):
# nenhuma ligação é atendida. Isso é falha essencial, com a causa provável, e não um "ok".
printf 'asterisk|fail|connect ECONNREFUSED 10.0.9.3:8088\n' > "$FAKE_DIR/voice_health"
out="$(bash "$H" 2>&1)"; equal "voz sem conversar com o Asterisk: código 1" 1 "$?"
contains "voz sem conversar com o Asterisk: diz que é falha" "$out" "falha  Controle da telefonia"
contains "voz sem conversar com o Asterisk: mostra o motivo" "$out" "ECONNREFUSED"
contains "voz sem conversar com o Asterisk: aponta a causa provável" "$out" "não leu a configuração"
bash "$H" --essential >/dev/null 2>&1; equal "voz sem conversar com o Asterisk: reprova também no modo essencial" 1 "$?"
printf 'asterisk|ok|PJSIP 20.20.1\n' > "$FAKE_DIR/voice_health"
out="$(bash "$H" 2>&1)"; equal "voz conversando com o Asterisk: código 0" 0 "$?"
contains "voz conversando com o Asterisk: diz ok" "$out" "ok     Controle da telefonia"
printf '%s\n' postgres panel voice routines caddy > "$FAKE_DIR/running"; bash "$H" >/dev/null 2>&1; equal "Asterisk parado: código 1" 1 "$?"
printf '%s\n' postgres asterisk panel voice routines caddy > "$FAKE_DIR/running"

# Portas UDP.
: > "$FAKE_DIR/ss_udp"
out="$(bash "$H" 2>&1)"; equal "5060 fechada na máquina: código 2" 2 "$?"
contains "5060 fechada é falha" "$(line 'Portas UDP')" "falha"
printf 'UNCONN 0 0 0.0.0.0:5060 0.0.0.0:*\n' > "$FAKE_DIR/ss_udp"
sed -i.bak 's/^rtpend=.*/rtpend=10100/' "$DESKVOICE_DEPLOY_DIR/asterisk/generated/rtp.conf"
out="$(bash "$H" 2>&1)"; equal "faixa de áudio diferente da publicada: código 2" 2 "$?"
contains "faixa divergente explica a ligação muda" "$(line 'Portas UDP')" "fica muda"
mv "$DESKVOICE_DEPLOY_DIR/asterisk/generated/rtp.conf.bak" "$DESKVOICE_DEPLOY_DIR/asterisk/generated/rtp.conf"

# Entrada única: painel e voz do navegador pelo mesmo endereço.
O="$DESKVOICE_DEPLOY_DIR/docker-compose.override.yml"
out="$(bash "$H" 2>&1)"; equal "entrada respondendo nos dois caminhos: zero" 0 "$?"
contains "entrada ok diz onde está publicada" "$(line 'Entrada única')" "80:80 443:443"
check "a entrada é perguntada ao Caddy em HTTPS quando há domínio" grep -q "exec -T panel node -e const m=require('https');" "$FAKE_DIR/calls.log"
check "... pelo nome do domínio, na 443 de dentro" grep -q "host:'caddy',port:443,path:p,servername:'voz.exemplo.com.br'" "$FAKE_DIR/calls.log"
printf 'panel|200\nvoice|502\n' > "$FAKE_DIR/entry_probe"
out="$(bash "$H" 2>&1)"; equal "painel responde e a voz não: código 2" 2 "$?"
contains "painel responde e a voz não: é falha" "$(line 'Entrada única')" "falha"
contains "painel responde e a voz não: diz a causa" "$(line 'Entrada única')" "o painel responde, mas /voice-ws não chega ao serviço de voz (HTTP 502)"
contains "painel responde e a voz não: diz o efeito para quem usa" "$(line 'Entrada única')" "Falar com o agente"
contains "painel responde e a voz não: o painel em si continua ok" "$(line 'Painel ')" "ok"
bash "$H" --essential >/dev/null 2>&1; equal "voz do navegador fora não derruba a checagem essencial (não provoca volta de atualização)" 0 "$?"
printf 'panel|200\nvoice|404\n' > "$FAKE_DIR/entry_probe"
contains "/voice-ws caindo no painel: falha com a causa" "$(bash "$H" 2>&1 | grep 'Entrada única')" "não foi entregue ao serviço de voz (veio HTTP 404"
printf 'panel|502\nvoice|426\n' > "$FAKE_DIR/entry_probe"
contains "Caddy sem alcançar o painel: falha" "$(bash "$H" 2>&1 | grep 'Entrada única')" "não alcança o painel (HTTP 502)"
printf 'panel|erro ECONNREFUSED\nvoice|erro ECONNREFUSED\n' > "$FAKE_DIR/entry_probe"
contains "HTTPS sem resposta: aponta o certificado e o domínio" "$(bash "$H" 2>&1 | grep 'Entrada única')" "o domínio não aponta para esta VPS"
rm "$FAKE_DIR/entry_probe"
printf '%s\n' postgres asterisk panel voice routines > "$FAKE_DIR/running"
out="$(bash "$H" 2>&1)"; equal "Caddy parado: código 2" 2 "$?"
contains "Caddy parado: falha dizendo que o painel não abre de fora" "$(line 'Entrada única')" "não está rodando: o painel não abre de fora"
printf '%s\n' postgres asterisk panel voice routines caddy > "$FAKE_DIR/running"
cp "$O" "$SANDBOX/override.ok"
printf 'services:\n  panel:\n    ports:\n      - "127.0.0.1:3080:3000"\n  voice:\n    ports:\n      - "127.0.0.1:3081:8091"\n' > "$O"
contains "instalação antiga de duas portas: falha mandando reinstalar" "$(bash "$H" 2>&1 | grep 'Entrada única')" "formato antigo"
rm "$O"
contains "sem arquivo de publicação: falha, o painel não abre de fora" "$(bash "$H" 2>&1 | grep 'Entrada única')" "não tem porta publicada"
( source "$KIT/_common.sh"; apply_entry external "" 127.0.0.1 3080 ); : > "$FAKE_DIR/calls.log"
out="$(bash "$H" 2>&1)"; equal "porta local única respondendo: zero" 0 "$?"
contains "porta local única: diz a porta" "$(line 'Entrada única')" "127.0.0.1:3080:80"
check "sem domínio a entrada é perguntada em HTTP" grep -q "exec -T panel node -e const m=require('http');" "$FAKE_DIR/calls.log"
check "... na 80 de dentro" grep -q "host:'caddy',port:80,path:p" "$FAKE_DIR/calls.log"
cp "$SANDBOX/override.ok" "$O"

# A rota do agente, pela entrada, tem de ser recusada pelo Caddy (404 sem corpo). Se o 404 vem com
# corpo, quem respondeu foi o painel: o Caddy ficou com o Caddyfile antigo (a ponte da 0.1.0).
lacks "rota do agente recusada pelo Caddy: nenhum aviso de camada" "$(bash "$H" 2>&1 | grep 'Agente de atualização')" "Caddyfile antigo"
printf 'panel|200\nvoice|426\nagent|404|52\n' > "$FAKE_DIR/entry_probe"
out="$(bash "$H" 2>&1)"; equal "404 da rota do agente vindo do painel: é aviso, não falha (zero)" 0 "$?"
contains "404 vindo do painel: a linha do agente vira aviso" "$(line 'Agente de atualização')" "aviso"
contains "404 vindo do painel: diz que quem recusa é o painel" "$(line 'Agente de atualização')" "quem recusa a rota do agente é o PAINEL"
contains "404 vindo do painel: manda reiniciar o Caddy" "$(line 'Agente de atualização')" "docker restart deskvoice-caddy-1"
contains "404 vindo do painel: a entrada em si continua ok (não provoca volta de atualização)" "$(line 'Entrada única')" "ok"
printf 'panel|200\nvoice|426\nagent|401|30\n' > "$FAKE_DIR/entry_probe"
contains "rota do agente alcançável pela entrada: avisa com o código" "$(bash "$H" 2>&1 | grep 'Agente de atualização')" "respondeu HTTP 401"
rm "$FAKE_DIR/entry_probe"

# Tudo certo, e a saída para máquinas.
out="$(bash "$H" 2>&1)"; equal "tudo configurado e no ar: zero" 0 "$?"
lacks "tudo certo: nenhuma falha" "$out" "falha "
json="$(bash "$H" --json 2>&1)"
contains "json: código de saída" "$json" '{"exit_code":0,"checks":['
contains "json: peça com estado e detalhe" "$json" '{"id":"trunk","name":"Linha telefônica","essential":false,"status":"ok","detail":"registrado"}'
equal "json: treze peças" 13 "$(printf '%s' "$json" | grep -o '"id":' | wc -l | tr -d ' ')"
if command -v python3 >/dev/null 2>&1; then check "json: é JSON válido" python3 -c 'import json,sys; json.loads(sys.argv[1])' "$json"; fi
printf '%s\n' 'panel|ok|diz "aspas" e \barra' 'trunk|ok|x' 'engine|ok|y' > "$FAKE_DIR/panel_health"
if command -v python3 >/dev/null 2>&1; then check "json: escapa aspas e barra" python3 -c 'import json,sys; json.loads(sys.argv[1])' "$(bash "$H" --json 2>&1)"; fi

rm "$DESKVOICE_DEPLOY_DIR/app.env"
out="$(bash "$H" 2>&1)"; equal "sem instalação: sai com erro" 1 "$?"
contains "sem instalação: manda instalar" "$out" "bash install/install.sh"
finish
