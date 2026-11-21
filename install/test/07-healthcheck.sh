#!/usr/bin/env bash
# healthcheck.sh: uma linha por peça; "falta configurar" é aviso, "quebrado" é falha.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
fake_install
H="$KIT/healthcheck.sh"
line() { printf '%s\n' "$out" | grep "$1" | head -n 1; }

# Instalação nova: tudo no ar, linha e motor ainda por configurar.
out="$(bash "$H" 2>&1)"; equal "instalação nova sem linha nem chave: sai com zero" 0 "$?"
equal "uma linha por peça (19 peças)" 19 "$(printf '%s\n' "$out" | grep -cE '^  (ok|aviso|falha) ')"
for piece in Painel Banco "Painel → banco" "Login do painel" Asterisk "SIP atrás de NAT" "Worker de voz" Rotinas "Rotinas → fila" "Linha telefônica" "Motor de voz" WhatsApp "Portas UDP locais" Disco; do contains "tem a linha de: $piece" "$out" "$piece"; done
contains "linha não cadastrada é aviso, não falha" "$(line 'Linha telefônica')" "aviso"
contains "linha não cadastrada traz o detalhe" "$(line 'Linha telefônica')" "nenhuma linha cadastrada ainda"
contains "motor sem chave é aviso, não falha" "$(line 'Motor de voz')" "aviso"
contains "portas: honesto sobre o que não prova" "$(line 'Portas UDP')" "não prova que o provedor deixa passar"
lacks "não resume tudo num ok" "$out" "tudo ok"

# Rede do proxy: máquina sem proxy de outro sistema é o caso normal; com rede existente e NÃO gravada,
# aparece o aviso — é a instalação anterior à 0.11.0, em que a ligação se perde no recreate.
OV="$DESKVOICE_DEPLOY_DIR/docker-compose.override.yml"
cp "$OV" "$SANDBOX/override.before" 2>/dev/null || true
contains "rede do proxy: máquina sem proxy de outro sistema é o caso normal" "$(line 'Rede do proxy')" "não usa o proxy de outro sistema"
printf '%s\n' deskcommcrm_caddy-sites > "$FAKE_DIR/networks"
out="$(bash "$H" 2>&1)"
contains "rede de proxy fora do arquivo de publicação é aviso, não falha" "$(line 'Rede do proxy')" "aviso"
contains "o aviso nomeia a rede" "$(line 'Rede do proxy')" "existe a rede deskcommcrm_caddy-sites"
contains "o aviso manda rodar o instalador com a rede" "$(line 'Rede do proxy')" "DESKVOICE_PROXY_NETWORK=deskcommcrm_caddy-sites bash install/install.sh"
contains "o aviso traz a consequência como condição" "$(line 'Rede do proxy')" "Se o painel é publicado pelo proxy dessa rede"
bash "$H" --essential >/dev/null 2>&1; equal "o aviso da rede não derruba a checagem essencial" 0 "$?"
# Gravada no arquivo de publicação (o que o install.sh faz), a mesma rede fica ok.
( source "$KIT/_common.sh"; DESKVOICE_PROXY_NETWORK=deskcommcrm_caddy-sites apply_entry caddy voz.exemplo.com.br ) >/dev/null 2>&1
out="$(bash "$H" 2>&1)"
contains "rede gravada é ok" "$(line 'Rede do proxy')" "o Caddy entra em deskcommcrm_caddy-sites"
lacks "rede gravada não avisa sobre ligação manual" "$(line 'Rede do proxy')" "não está gravada"
# Gravada e ausente do Docker (o outro sistema foi derrubado): o próximo início não sobe nada.
: > "$FAKE_DIR/networks"
out="$(bash "$H" 2>&1)"
contains "rede gravada que sumiu é aviso" "$(line 'Rede do proxy')" "aviso"
contains "o aviso nomeia a rede gravada que sumiu" "$(line 'Rede do proxy')" "a rede gravada deskcommcrm_caddy-sites não existe mais"
lacks "rede gravada que sumiu não diz que sobrevive" "$(line 'Rede do proxy')" "sobrevive"
bash "$H" --essential >/dev/null 2>&1; equal "a rede que sumiu não derruba a checagem essencial" 0 "$?"
cp "$SANDBOX/override.before" "$OV" 2>/dev/null || true
rm -f "$FAKE_DIR/networks"

# Linha cadastrada e quebrada: falha, mas não é peça essencial.
printf '%s\n' 'panel|ok|respondendo' 'trunk|fail|registro recusado pela operadora (401)' 'engine|ok|gemini-live' > "$FAKE_DIR/panel_health"
out="$(bash "$H" 2>&1)"; equal "linha quebrada: código 2" 2 "$?"
contains "linha quebrada é falha" "$(line 'Linha telefônica')" "falha "
contains "linha quebrada traz o motivo" "$(line 'Linha telefônica')" "registro recusado pela operadora (401)"
bash "$H" --essential >/dev/null 2>&1; equal "linha quebrada não derruba a checagem essencial" 0 "$?"

# Chave do motor recusada no último teste (o painel guarda o resultado; a checagem não testa): falha,
# sem derrubar a checagem essencial. Sem sessão o painel não diz qual motor, modelo nem data.
printf '%s\n' 'panel|ok|respondendo' 'trunk|ok|registrado' 'engine|fail|o último teste da chave de um motor de voz não deu certo: as ligações com esse motor podem ser recusadas. Veja o resultado no painel, em Configurações → Inteligência artificial' > "$FAKE_DIR/panel_health"
out="$(bash "$H" 2>&1)"; equal "chave recusada: código 2" 2 "$?"
contains "chave recusada é falha" "$(line 'Motor de voz')" "falha "
contains "chave recusada traz o motivo" "$(line 'Motor de voz')" "o último teste da chave de um motor de voz não deu certo"
contains "chave recusada diz onde ver" "$(line 'Motor de voz')" "Configurações → Inteligência artificial"
bash "$H" --essential >/dev/null 2>&1; equal "chave recusada não derruba a checagem essencial" 0 "$?"

# Painel fora: essencial.
printf '%s\n' postgres asterisk voice routines caddy > "$FAKE_DIR/running"
out="$(bash "$H" 2>&1)"; equal "painel parado: código 1" 1 "$?"
contains "painel parado é falha" "$(line 'Painel')" "falha"
contains "sem painel, a linha fica como não consultada" "$(line 'Linha telefônica')" "não deu para consultar"
contains "sem painel, o login não é conferido" "$(line 'Login do painel')" "não deu para conferir porque o painel não respondeu"
contains "banco continua sendo conferido direto" "$(line 'Banco')" "ok"
bash "$H" --essential >/dev/null 2>&1; equal "painel parado derruba a checagem essencial" 1 "$?"
printf '%s\n' postgres asterisk panel voice routines caddy > "$FAKE_DIR/running"

# Painel no ar mas sem responder.
echo 'unreachable|fail|connect ECONNREFUSED 127.0.0.1:3000' > "$FAKE_DIR/panel_health"
out="$(bash "$H" 2>&1)"; equal "painel mudo: código 1" 1 "$?"
contains "painel mudo traz o erro" "$(line 'Painel')" "ECONNREFUSED"
printf '%s\n' 'panel|ok|respondendo' 'trunk|ok|registrado' 'engine|ok|gemini-live' > "$FAKE_DIR/panel_health"

# Painel → banco e rotinas → fila: o kit lê as duas da rota de saúde do painel, como lê a linha e o motor.
ok_lines() { printf '%s\n' 'panel|ok|respondendo' 'database|ok|respondendo' 'routines|ok|em dia' 'trunk|ok|registrado' 'engine|ok|gemini-live'; }
: > "$FAKE_DIR/calls.log"; ok_lines > "$FAKE_DIR/panel_health"
out="$(bash "$H" 2>&1)"; equal "painel e rotinas conectados: zero" 0 "$?"
check "pede à rota de saúde as linhas database e routines" grep -q "'panel','database','routines','trunk','engine'" "$FAKE_DIR/calls.log"
contains "painel → banco ok" "$(line 'Painel → banco')" "ok"
contains "rotinas → fila ok" "$(line 'Rotinas → fila')" "ok"
ok_lines | sed 's/^database|ok|respondendo$/database|fail|o banco não respondeu ao painel/' > "$FAKE_DIR/panel_health"
out="$(bash "$H" 2>&1)"; equal "painel sem chegar ao banco (Postgres aceitando conexão): código 1" 1 "$?"
contains "painel sem chegar ao banco: é falha" "$(line 'Painel → banco')" "falha "
contains "painel sem chegar ao banco: diz o motivo" "$(line 'Painel → banco')" "o banco não respondeu ao painel"
contains "painel sem chegar ao banco: o Postgres em si segue ok" "$(line 'Banco')" "ok"
bash "$H" --essential >/dev/null 2>&1; equal "painel sem chegar ao banco: reprova no modo essencial (provoca a volta da atualização)" 1 "$?"

# Login do painel: a rota de saúde pode responder "painel ok, banco ok" e o login dar 500 — foi
# assim que uma volta de versão quebrou a entrada e a instalação disse "com todas as peças
# essenciais respondendo" (issue #392). A sonda pede o login de verdade, com uma credencial que
# não existe, e o certo é 401 (recusa), nunca 5xx.
ok_lines > "$FAKE_DIR/panel_health"
out="$(bash "$H" 2>&1)"; equal "login recusando credencial que não existe: zero" 0 "$?"
contains "login recusado é ok" "$(line 'Login do painel')" "ok"
contains "login ok diz o que provou" "$(line 'Login do painel')" "recusa credencial que não existe (HTTP 401)"
check "a sonda do login pergunta à rota de login do próprio painel" grep -q "127.0.0.1:3000/api/v1/auth/login" "$FAKE_DIR/calls.log"
echo 'login|500' > "$FAKE_DIR/login_health"
out="$(bash "$H" 2>&1)"; equal "login com erro de servidor: código 1" 1 "$?"
contains "login com erro de servidor é falha" "$(line 'Login do painel')" "falha "
contains "login com erro de servidor diz o código" "$(line 'Login do painel')" "erro de servidor (HTTP 500)"
contains "login com erro de servidor diz que ninguém entra" "$(line 'Login do painel')" "ninguém consegue entrar"
contains "o painel segue ok: a rota de saúde não vê o login" "$(line 'Painel ')" "ok"
bash "$H" --essential >/dev/null 2>&1; equal "login quebrado reprova no modo essencial (provoca a volta da atualização)" 1 "$?"
echo 'login|429' > "$FAKE_DIR/login_health"
out="$(bash "$H" 2>&1)"; equal "login limitado não é falha" 0 "$?"
contains "login limitado é aviso, e diz o que não provou" "$(line 'Login do painel')" "aviso"
contains "login limitado não finge ter conferido" "$(line 'Login do painel')" "não deu para conferir se ele chega ao banco"
echo 'login|400' > "$FAKE_DIR/login_health"
out="$(bash "$H" 2>&1)"; equal "login recusando o formato da sonda não é falha" 0 "$?"
contains "login recusando o formato é aviso" "$(line 'Login do painel')" "aviso"
contains "login recusando o formato não finge ter conferido" "$(line 'Login do painel')" "não deu para conferir o login"
echo 'login|200' > "$FAKE_DIR/login_health"
out="$(bash "$H" 2>&1)"; equal "login aceitando credencial que não existe: código 1" 1 "$?"
contains "login aberto é falha" "$(line 'Login do painel')" "aceitou uma credencial que não existe"
echo 'login|0|connect ECONNREFUSED 127.0.0.1:3000' > "$FAKE_DIR/login_health"
out="$(bash "$H" 2>&1)"; equal "rota de login muda: código 1" 1 "$?"
contains "rota de login muda diz o motivo" "$(line 'Login do painel')" "ECONNREFUSED"
rm "$FAKE_DIR/login_health"
ok_lines > "$FAKE_DIR/panel_health"
ok_lines | sed 's/^routines|ok|em dia$/routines|fail|nenhum processo de rotinas está conectado ao banco esperando tarefas/' > "$FAKE_DIR/panel_health"
out="$(bash "$H" 2>&1)"; equal "rotinas sem escutar a fila: código 2" 2 "$?"
contains "rotinas sem escutar a fila: é falha" "$(line 'Rotinas → fila')" "falha "
contains "rotinas sem escutar a fila: diz o motivo" "$(line 'Rotinas → fila')" "nenhum processo de rotinas está conectado"
contains "rotinas sem escutar a fila: o processo em si segue ok" "$(line 'Rotinas ')" "ok"
bash "$H" --essential >/dev/null 2>&1; equal "rotinas sem escutar a fila: não reprova no modo essencial (não provoca volta)" 0 "$?"
ok_lines | sed 's/^routines|ok|em dia$/routines|warn|a fila está atrasada/' > "$FAKE_DIR/panel_health"
contains "fila atrasada é aviso" "$(bash "$H" 2>&1 | grep 'Rotinas → fila')" "aviso"
echo 'unreachable|fail|connect ECONNREFUSED 127.0.0.1:3000' > "$FAKE_DIR/panel_health"
out="$(bash "$H" 2>&1)"
contains "painel mudo: painel → banco não consultado" "$(line 'Painel → banco')" "não deu para consultar"
contains "painel mudo: rotinas → fila não consultado" "$(line 'Rotinas → fila')" "não deu para consultar"
ok_lines > "$FAKE_DIR/panel_health"

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
# SIP atrás de NAT: sem o res_pjsip_nat em execução, force_rport e rewrite_contact das linhas não
# valem, e o Asterisk segue respondendo "ok". É essencial: o install.sh e a volta da atualização
# esperam por ela. "Not Running" contém "Running": o caso precisa reprovar mesmo assim.
out="$(bash "$H" 2>&1)"
contains "módulo de NAT em execução: ok" "$(line 'SIP atrás de NAT')" "ok "
check "a checagem pergunta ao Asterisk pelo módulo" grep -q "exec -T asterisk asterisk -rx module show like res_pjsip_nat" "$FAKE_DIR/calls.log"
json="$(bash "$H" --json 2>&1)"
contains "json: sip_nat ok, essencial" "$json" '{"id":"sip_nat","name":"SIP atrás de NAT","essential":true,"status":"ok",'
touch "$FAKE_DIR/asterisk_nat_down"
out="$(bash "$H" 2>&1)"; equal "módulo de NAT parado: código 1" 1 "$?"
contains "módulo de NAT parado é falha" "$(line 'SIP atrás de NAT')" "falha "
contains "módulo de NAT parado diz o efeito" "$(line 'SIP atrás de NAT')" "uma linha atrás de NAT liga e fica muda"
contains "módulo de NAT parado diz o que fazer" "$(line 'SIP atrás de NAT')" "grep -i 'too many modules'"
contains "módulo de NAT parado: o Asterisk em si segue ok" "$(line 'Asterisk ')" "ok "
json="$(bash "$H" --json 2>&1)"; equal "json com o módulo de NAT parado: código 1" 1 "$?"
contains "json: sip_nat falha" "$json" '{"id":"sip_nat","name":"SIP atrás de NAT","essential":true,"status":"falha",'
contains "json: o código de saída diz 1" "$json" '{"exit_code":1,'
bash "$H" --essential >/dev/null 2>&1; equal "módulo de NAT parado reprova no modo essencial (provoca a volta da atualização)" 1 "$?"
rm "$FAKE_DIR/asterisk_nat_down"
printf '%s\n' postgres panel voice routines caddy > "$FAKE_DIR/running"; bash "$H" >/dev/null 2>&1; equal "Asterisk parado: código 1" 1 "$?"
contains "Asterisk parado: a linha de NAT não é perguntada" "$(bash "$H" 2>&1)" "Asterisk"
lacks "Asterisk parado: sem linha de NAT" "$(bash "$H" 2>&1)" "SIP atrás de NAT"
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
equal "json: dezenove peças" 19 "$(printf '%s' "$json" | grep -o '"id":' | wc -l | tr -d ' ')"
if command -v python3 >/dev/null 2>&1; then check "json: é JSON válido" python3 -c 'import json,sys; json.loads(sys.argv[1])' "$json"; fi
printf '%s\n' 'panel|ok|diz "aspas" e \barra' 'trunk|ok|x' 'engine|ok|y' > "$FAKE_DIR/panel_health"
if command -v python3 >/dev/null 2>&1; then check "json: escapa aspas e barra" python3 -c 'import json,sys; json.loads(sys.argv[1])' "$(bash "$H" --json 2>&1)"; fi

rm "$DESKVOICE_DEPLOY_DIR/app.env"
out="$(bash "$H" 2>&1)"; equal "sem instalação: sai com erro" 1 "$?"
contains "sem instalação: manda instalar" "$out" "bash install/install.sh"
finish
