#!/usr/bin/env bash
# healthcheck.sh: uma linha por peça; "falta configurar" é aviso, "quebrado" é falha.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
fake_install
H="$KIT/healthcheck.sh"
line() { printf '%s\n' "$out" | grep "$1" | head -n 1; }

# Instalação nova: tudo no ar, linha e motor ainda por configurar.
out="$(bash "$H" 2>&1)"; equal "instalação nova sem linha nem chave: sai com zero" 0 "$?"
equal "uma linha por peça (20 peças)" 20 "$(printf '%s\n' "$out" | grep -cE '^  (ok|aviso|falha) ')"
for piece in Painel Banco "Painel → banco" "Login do painel" Asterisk "Módulos SIP" "Worker de voz" Rotinas "Rotinas → fila" "Linha telefônica" "Motor de voz" WhatsApp "Portas UDP locais" Disco "Log do Asterisk"; do contains "tem a linha de: $piece" "$out" "$piece"; done
contains "linha não cadastrada é aviso, não falha" "$(line 'Linha telefônica')" "aviso"
contains "linha não cadastrada traz o detalhe" "$(line 'Linha telefônica')" "nenhuma linha cadastrada ainda"
contains "motor sem chave é aviso, não falha" "$(line 'Motor de voz')" "aviso"
contains "portas: honesto sobre o que não prova" "$(line 'Portas UDP')" "não prova que o provedor deixa passar"
lacks "não resume tudo num ok" "$out" "tudo ok"

# Log do Asterisk: a pasta pequena é ok; a grande (o messages.log das versões sem teto) é aviso, com o
# comando que a esvazia, e nunca derruba a checagem; medida de dentro do contêiner.
contains "log do Asterisk pequeno é ok" "$(line 'Log do Asterisk')" "ok "
contains "... e diz o tamanho" "$(line 'Log do Asterisk')" "3 MB em /var/log/asterisk"
# Desde quando o log guarda: o carimbo da primeira linha do `docker logs -t` do contêiner. Sem ele
# (nada lido, ou uma linha sem carimbo), o ok fica como estava: nunca vira aviso nem falha.
lacks "sem o log com carimbo, o ok não diz desde quando" "$(line 'Log do Asterisk')" "guarda desde"
contains "... e segue ok, com teto" "$(line 'Log do Asterisk')" "ok "
printf '%s\n' '2026-11-21T12:00:00.123456789Z   == Parsing /etc/asterisk/asterisk.conf' '2026-11-22T08:30:00.000000000Z     -- Executing [s@entrada:1]' > "$FAKE_DIR/asterisk_logs_t"
: > "$FAKE_DIR/calls.log"; out="$(bash "$H" 2>&1)"
contains "com o log, o ok diz desde quando guarda (a primeira linha)" "$(line 'Log do Asterisk')" "com teto, e guarda desde 2026-11-21 12:00 UTC"
contains "... lido do contêiner do Asterisk" "$(cat "$FAKE_DIR/calls.log")" "logs -t cid-asterisk"
contains "... e segue ok" "$(line 'Log do Asterisk')" "ok "
printf '%s\n' 'Error response from daemon: configured logging driver does not support reading' > "$FAKE_DIR/asterisk_logs_t"
out="$(bash "$H" 2>&1)"
lacks "linha sem carimbo: o ok não diz desde quando" "$(line 'Log do Asterisk')" "guarda desde"
contains "... e segue ok" "$(line 'Log do Asterisk')" "ok "
rm -f "$FAKE_DIR/asterisk_logs_t"; out="$(bash "$H" 2>&1)"
check "o log é medido de dentro do contêiner do Asterisk" grep -q "exec -T asterisk du -sm /var/log/asterisk" "$FAKE_DIR/calls.log"
echo 1023 > "$FAKE_DIR/asterisk_log_mb"
contains "log do Asterisk logo abaixo de 1 GB ainda é ok" "$(bash "$H" 2>&1 | grep 'Log do Asterisk')" "ok "
# A fronteira: 1024 MB (1 GB) já é aviso. Um `-gt` no lugar do `-ge` a deixaria passar como ok.
echo 1024 > "$FAKE_DIR/asterisk_log_mb"
out="$(bash "$H" 2>&1)"
equal "log do Asterisk em 1 GB exato é aviso" "aviso Log do Asterisk" "$(line 'Log do Asterisk' | awk '{ print $1, $2, $3, $4 }')"
contains "... com o tamanho" "$(line 'Log do Asterisk')" "ocupa 1024 MB"
echo 9900 > "$FAKE_DIR/asterisk_log_mb"
out="$(bash "$H" 2>&1)"; equal "log do Asterisk grande não é falha: sai com zero" 0 "$?"
contains "log do Asterisk grande é aviso" "$(line 'Log do Asterisk')" "aviso"
contains "... e diz o tamanho" "$(line 'Log do Asterisk')" "ocupa 9900 MB"
contains "... e onde fica o log corrente" "$(line 'Log do Asterisk')" "docker compose -f deploy/docker-compose.yml logs asterisk"
contains "... e o comando que libera o espaço, dizendo que apaga" "$(line 'Log do Asterisk')" "(apaga esse histórico): docker compose -f deploy/docker-compose.yml exec asterisk truncate -s 0 /var/log/asterisk/messages.log"
lacks "a checagem essencial não mede o log" "$(bash "$H" --essential 2>&1)" "Log do Asterisk"
printf 'du: /var/log/asterisk: No such file or directory' > "$FAKE_DIR/asterisk_log_mb"
contains "sem medida, aviso" "$(bash "$H" 2>&1 | grep 'Log do Asterisk')" "aviso"
rm -f "$FAKE_DIR/asterisk_log_mb"
printf '%s\n' postgres panel voice routines caddy > "$FAKE_DIR/running"
contains "Asterisk parado: o log não é medido" "$(bash "$H" 2>&1 | grep 'Log do Asterisk')" "não deu para medir porque o Asterisk não está rodando"
printf '%s\n' postgres asterisk panel voice routines caddy > "$FAKE_DIR/running"
out="$(bash "$H" 2>&1)"

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
# Módulos SIP: o teto de módulos do pjproject estoura na partida e o último módulo PJSIP a registrar
# fica parado, qualquer que seja; o Asterisk segue respondendo "ok". É essencial: o install.sh e a
# volta da atualização esperam por ela. "Not Running" contém "Running": o caso precisa reprovar.
sip() { line 'Módulos SIP'; }
: > "$FAKE_DIR/calls.log"
out="$(bash "$H" 2>&1)"; equal "módulos SIP em execução e log limpo: código 0" 0 "$?"
contains "módulos SIP em execução: ok" "$(sip)" "ok "
contains "módulos SIP em execução: diz quantos" "$(sip)" "17 módulos PJSIP em execução"
contains "módulos SIP em execução: diz que o log está limpo" "$(sip)" 'nenhum "Too many modules" desde a partida'
check "a checagem pergunta ao Asterisk pelos módulos PJSIP, uma vez" test "$(grep -c "exec -T asterisk asterisk -rx module show like pjsip" "$FAKE_DIR/calls.log")" -eq 1
check "a checagem lê a hora de partida do contêiner do Asterisk" grep -qx "inspect -f {{.State.StartedAt}} cid-asterisk" "$FAKE_DIR/calls.log"
check "o log é lido desde a partida atual" grep -qx "logs --since 2026-11-21T12:00:00.123456789Z cid-asterisk" "$FAKE_DIR/calls.log"
printf '2026-11-21T13:14:15.5Z\n' > "$FAKE_DIR/asterisk_started"; : > "$FAKE_DIR/calls.log"; bash "$H" >/dev/null 2>&1
check "o --since segue a hora de partida que o Docker dá" grep -qx "logs --since 2026-11-21T13:14:15.5Z cid-asterisk" "$FAKE_DIR/calls.log"
rm "$FAKE_DIR/asterisk_started"
json="$(bash "$H" --json 2>&1)"
contains "json: sip_modules ok, essencial" "$json" '{"id":"sip_modules","name":"Módulos SIP","essential":true,"status":"ok",'
# Só o NAT parado (o que a imagem fixada mostrava numa máquina).
echo res_pjsip_nat > "$FAKE_DIR/asterisk_pjsip_down"
out="$(bash "$H" 2>&1)"; equal "só o NAT parado: código 1" 1 "$?"
contains "só o NAT parado é falha" "$(sip)" "falha "
contains "só o NAT parado: cita o módulo" "$(sip)" "módulos PJSIP parados: res_pjsip_nat"
contains "só o NAT parado diz o efeito" "$(sip)" "uma linha atrás de NAT liga e fica muda"
contains "só o NAT parado diz o que fazer" "$(sip)" 'Rode bash install/install.sh; se continuar, procure "Too many modules" em: docker compose -f deploy/docker-compose.yml logs asterisk'
contains "só o NAT parado: o Asterisk em si segue ok" "$(line 'Asterisk ')" "ok "
json="$(bash "$H" --json 2>&1)"; equal "json com o NAT parado: código 1" 1 "$?"
contains "json: sip_modules falha" "$json" '{"id":"sip_modules","name":"Módulos SIP","essential":true,"status":"falha",'
contains "json: o código de saída diz 1" "$json" '{"exit_code":1,'
bash "$H" --essential >/dev/null 2>&1; equal "NAT parado reprova no modo essencial (provoca a volta da atualização)" 1 "$?"
# Só o refer parado (outra ordem do diretório de módulos, outro perdedor da vaga).
echo res_pjsip_refer > "$FAKE_DIR/asterisk_pjsip_down"
out="$(bash "$H" 2>&1)"; equal "só o refer parado: código 1" 1 "$?"
contains "só o refer parado é falha e cita só ele" "$(sip)" "módulos PJSIP parados: res_pjsip_refer. Rode"
lacks "só o refer parado: não fala do NAT" "$(sip)" "NAT"
contains "só o refer parado é falha" "$(sip)" "falha "
# Só um não essencial parado: o estouro pegou um módulo fora da lista, e reprova igual.
echo res_pjsip_dlg_options > "$FAKE_DIR/asterisk_pjsip_down"
out="$(bash "$H" 2>&1)"; equal "só um não essencial parado: código 1" 1 "$?"
contains "só um não essencial parado é falha e cita ele" "$(sip)" "módulos PJSIP parados: res_pjsip_dlg_options"
lacks "só um não essencial parado: não o chama de ausente" "$(sip)" "ausentes"
echo res_pjsip_nat > "$FAKE_DIR/asterisk_pjsip_down"; echo res_pjsip_refer >> "$FAKE_DIR/asterisk_pjsip_down"
contains "dois parados: cita os dois" "$(bash "$H" 2>&1 | grep 'Módulos SIP')" "módulos PJSIP parados: res_pjsip_nat, res_pjsip_refer."
rm "$FAKE_DIR/asterisk_pjsip_down"
# Um essencial que nem aparece (noload por engano, ou uma imagem sem ele).
echo res_pjsip_outbound_registration > "$FAKE_DIR/asterisk_pjsip_absent"
out="$(bash "$H" 2>&1)"; equal "essencial ausente: código 1" 1 "$?"
contains "essencial ausente é falha e cita ele" "$(sip)" "módulos PJSIP essenciais ausentes: res_pjsip_outbound_registration"
# Um não essencial ausente é o que o noload faz: não reprova.
echo res_pjsip_dlg_options > "$FAKE_DIR/asterisk_pjsip_absent"
out="$(bash "$H" 2>&1)"; equal "não essencial ausente (noload): código 0" 0 "$?"
contains "não essencial ausente: ok, com a contagem" "$(sip)" "16 módulos PJSIP em execução"
rm "$FAKE_DIR/asterisk_pjsip_absent"
# Tudo Running, mas o log da partida atual tem o estouro.
printf '%s\n' '[Nov 21 12:00:01] ERROR[1]: pjproject: <?>: Assert failed: !"Too many modules registered!"' > "$FAKE_DIR/asterisk_logs"
out="$(bash "$H" 2>&1)"; equal "só o log com o estouro: código 1" 1 "$?"
contains "só o log com o estouro é falha e diz o porquê" "$(sip)" 'o log da partida atual tem "Too many modules registered"'
lacks "só o log com o estouro: nenhum módulo citado como parado" "$(sip)" "parados"
# A linha só acha o estouro se o nível em que ele sai ainda vai para o console (o logger.conf corta
# níveis da saída do contêiner): o nível da linha acima tem de estar no console do repositório.
overflow_level="$(sed -n 's/^\[[^]]*\] \([A-Z]*\)\[.*/\1/p' "$FAKE_DIR/asterisk_logs" | tr 'A-Z' 'a-z')"
equal "o estouro sai em ERROR" error "$overflow_level"
contains "o nível do estouro continua no console do logger.conf" ",$(sed -n 's/^console => //p' "$REPO/deploy/asterisk/logger.conf")," ",$overflow_level,"
rm "$FAKE_DIR/asterisk_logs"
# Sem a hora de partida, o log não é lido (uma partida antiga não pode reprovar a de agora).
printf '' > "$FAKE_DIR/asterisk_started"; : > "$FAKE_DIR/calls.log"
out="$(bash "$H" 2>&1)"; equal "sem a hora de partida: código 0" 0 "$?"
contains "sem a hora de partida: diz que não leu o log" "$(sip)" "o log da partida não pôde ser lido"
lacks "sem a hora de partida: o log não é lido" "$(cat "$FAKE_DIR/calls.log")" "logs --since"
rm "$FAKE_DIR/asterisk_started"
printf '%s\n' postgres panel voice routines caddy > "$FAKE_DIR/running"; bash "$H" >/dev/null 2>&1; equal "Asterisk parado: código 1" 1 "$?"
lacks "Asterisk parado: sem linha de módulos SIP" "$(bash "$H" 2>&1)" "Módulos SIP"
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
equal "json: vinte peças" 20 "$(printf '%s' "$json" | grep -o '"id":' | wc -l | tr -d ' ')"
if command -v python3 >/dev/null 2>&1; then check "json: é JSON válido" python3 -c 'import json,sys; json.loads(sys.argv[1])' "$json"; fi
printf '%s\n' 'panel|ok|diz "aspas" e \barra' 'trunk|ok|x' 'engine|ok|y' > "$FAKE_DIR/panel_health"
if command -v python3 >/dev/null 2>&1; then check "json: escapa aspas e barra" python3 -c 'import json,sys; json.loads(sys.argv[1])' "$(bash "$H" --json 2>&1)"; fi

rm "$DESKVOICE_DEPLOY_DIR/app.env"
out="$(bash "$H" 2>&1)"; equal "sem instalação: sai com erro" 1 "$?"
contains "sem instalação: manda instalar" "$out" "bash install/install.sh"
finish
