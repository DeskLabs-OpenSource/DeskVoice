#!/usr/bin/env bash
# healthcheck.sh: uma linha por peça; "falta configurar" é aviso, "quebrado" é falha.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
fake_install
H="$KIT/healthcheck.sh"
line() { printf '%s\n' "$out" | grep "$1" | head -n 1; }

# Instalação nova: tudo no ar, linha e motor ainda por configurar.
out="$(bash "$H" 2>&1)"; equal "instalação nova sem linha nem chave: sai com zero" 0 "$?"
equal "uma linha por peça (10 peças)" 10 "$(printf '%s\n' "$out" | grep -cE '^  (ok|aviso|falha) ')"
for piece in Painel Banco Asterisk "Worker de voz" Rotinas "Linha telefônica" "Motor de voz" "Portas UDP locais" Disco; do contains "tem a linha de: $piece" "$out" "$piece"; done
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
printf '%s\n' postgres asterisk voice routines > "$FAKE_DIR/running"
out="$(bash "$H" 2>&1)"; equal "painel parado: código 1" 1 "$?"
contains "painel parado é falha" "$(line 'Painel')" "falha"
contains "sem painel, a linha fica como não consultada" "$(line 'Linha telefônica')" "não deu para consultar"
contains "banco continua sendo conferido direto" "$(line 'Banco')" "ok"
bash "$H" --essential >/dev/null 2>&1; equal "painel parado derruba a checagem essencial" 1 "$?"
printf '%s\n' postgres asterisk panel voice routines > "$FAKE_DIR/running"

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
printf '%s\n' postgres panel voice routines > "$FAKE_DIR/running"; bash "$H" >/dev/null 2>&1; equal "Asterisk parado: código 1" 1 "$?"
printf '%s\n' postgres asterisk panel voice routines > "$FAKE_DIR/running"

# Portas UDP.
: > "$FAKE_DIR/ss_udp"
out="$(bash "$H" 2>&1)"; equal "5060 fechada na máquina: código 2" 2 "$?"
contains "5060 fechada é falha" "$(line 'Portas UDP')" "falha"
printf 'UNCONN 0 0 0.0.0.0:5060 0.0.0.0:*\n' > "$FAKE_DIR/ss_udp"
sed -i.bak 's/^rtpend=.*/rtpend=10100/' "$DESKVOICE_DEPLOY_DIR/asterisk/generated/rtp.conf"
out="$(bash "$H" 2>&1)"; equal "faixa de áudio diferente da publicada: código 2" 2 "$?"
contains "faixa divergente explica a ligação muda" "$(line 'Portas UDP')" "fica muda"
mv "$DESKVOICE_DEPLOY_DIR/asterisk/generated/rtp.conf.bak" "$DESKVOICE_DEPLOY_DIR/asterisk/generated/rtp.conf"

# Tudo certo, e a saída para máquinas.
out="$(bash "$H" 2>&1)"; equal "tudo configurado e no ar: zero" 0 "$?"
lacks "tudo certo: nenhuma falha" "$out" "falha "
json="$(bash "$H" --json 2>&1)"
contains "json: código de saída" "$json" '{"exit_code":0,"checks":['
contains "json: peça com estado e detalhe" "$json" '{"id":"trunk","name":"Linha telefônica","essential":false,"status":"ok","detail":"registrado"}'
equal "json: dez peças" 10 "$(printf '%s' "$json" | grep -o '"id":' | wc -l | tr -d ' ')"
if command -v python3 >/dev/null 2>&1; then check "json: é JSON válido" python3 -c 'import json,sys; json.loads(sys.argv[1])' "$json"; fi
printf '%s\n' 'panel|ok|diz "aspas" e \barra' 'trunk|ok|x' 'engine|ok|y' > "$FAKE_DIR/panel_health"
if command -v python3 >/dev/null 2>&1; then check "json: escapa aspas e barra" python3 -c 'import json,sys; json.loads(sys.argv[1])' "$(bash "$H" --json 2>&1)"; fi

rm "$DESKVOICE_DEPLOY_DIR/app.env"
out="$(bash "$H" 2>&1)"; equal "sem instalação: sai com erro" 1 "$?"
contains "sem instalação: manda instalar" "$out" "bash install/install.sh"
finish
