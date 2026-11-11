#!/usr/bin/env bash
# install.sh --dry-run: percorre tudo, decide tudo e não altera nada.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

export DESKVOICE_DOMAIN=voz.exemplo.com.br DESKVOICE_ORG_NAME="Clínica Exemplo" DESKVOICE_OWNER_NAME="Ana Exemplo"
export DESKVOICE_OWNER_EMAIL=ana@exemplo.com.br DESKVOICE_OWNER_PASSWORD="senha-de-teste-123"
snapshot() { (cd "$SANDBOX" && find deploy backups -type f 2>/dev/null | sort | while read -r f; do echo "$f $(cksum < "$f")"; done); }
mutating_calls() { grep -cE '(^| )(up|run|pull|build|stop|down|exec|tag|rmi|network) ' "$FAKE_DIR/calls.log"; }

# Caso 1: VPS atrás de NAT, 80/443 de outro proxy.
echo 10.0.0.5 > "$FAKE_DIR/iface_ip"
printf 'LISTEN 0 511 0.0.0.0:80 0.0.0.0:*\nLISTEN 0 511 0.0.0.0:443 0.0.0.0:*\nLISTEN 0 128 0.0.0.0:3080 0.0.0.0:*\n' > "$FAKE_DIR/ss_tcp"
: > "$FAKE_DIR/ss_udp"
before="$(snapshot)"
out="$(bash "$KIT/install.sh" --dry-run --yes 2>&1)"; status=$?
equal "simulação sai com zero" 0 "$status"
equal "simulação não cria nem altera arquivo" "$before" "$(snapshot)"
refuse "simulação não cria deploy/.env" test -e "$DESKVOICE_DEPLOY_DIR/.env"
refuse "simulação não cria app.env" test -e "$DESKVOICE_DEPLOY_DIR/app.env"
refuse "simulação não cria arquivos do Asterisk" test -e "$DESKVOICE_DEPLOY_DIR/asterisk/generated"
equal "simulação não manda o Docker alterar nada" 0 "$(mutating_calls)"
contains "avisa que é simulação" "$out" "nada será alterado"
contains "explica o NAT" "$out" "atrás de um roteador do provedor (NAT)"
contains "manda liberar as portas UDP no provedor" "$out" "5060/udp   e   10000-10200/udp"
contains "não disputa 80/443" "$out" "Não vou disputar essas portas"
contains "escolhe porta local livre, pulando a ocupada" "$out" "127.0.0.1:3081"
contains "com domínio atrás de outro proxy: porta local para a voz do navegador" "$out" "127.0.0.1:3082"
contains "com domínio atrás de outro proxy: manda encaminhar /voice-ws" "$out" "/voice-ws"
contains "é honesto sobre o que não consegue provar" "$out" "a prova final é a primeira ligação"
contains "anuncia o endereço do painel" "$out" "https://voz.exemplo.com.br"
lacks "senha do dono não aparece na saída" "$out" "senha-de-teste-123"

# Caso 2: IP direto, portas livres, sem domínio.
echo 203.0.113.10 > "$FAKE_DIR/iface_ip"; : > "$FAKE_DIR/ss_tcp"
out="$(DESKVOICE_DOMAIN="" bash "$KIT/install.sh" --dry-run --yes 2>&1)"
contains "IP direto na placa" "$out" "direto na placa de rede"
contains "usa o Caddy quando 80/443 estão livres" "$out" "subir o Caddy nas portas 80/443"
contains "sem domínio avisa que não há HTTPS" "$out" "SEM HTTPS"
contains "sem domínio usa o IP" "$out" "http://203.0.113.10"

# Caso 3: porta de telefonia ocupada é dita com a causa.
printf 'UNCONN 0 0 0.0.0.0:5060 0.0.0.0:*\nUNCONN 0 0 0.0.0.0:10100 0.0.0.0:*\n' > "$FAKE_DIR/ss_udp"
out="$(bash "$KIT/install.sh" --dry-run --yes 2>&1)"
contains "acusa a 5060 ocupada" "$out" "5060/udp já está em uso"
contains "acusa porta da faixa de áudio ocupada" "$out" "faixa de áudio em uso por outro programa: 10100"
: > "$FAKE_DIR/ss_udp"

# Caso 4: resposta inválida para sem alterar nada, dizendo qual variável corrigir.
out="$(DESKVOICE_OWNER_EMAIL="nao-e-email" bash "$KIT/install.sh" --dry-run --yes 2>&1)"; status=$?
equal "resposta inválida sai com erro" 1 "$status"
contains "diz qual resposta está errada" "$out" "DESKVOICE_OWNER_EMAIL"
out="$(DESKVOICE_OWNER_PASSWORD="curta" bash "$KIT/install.sh" --dry-run --yes 2>&1)"; status=$?
equal "senha curta sai com erro" 1 "$status"
lacks "a senha recusada não é repetida na tela" "$out" "curta\""

# Caso 5: respostas vindas de arquivo; linha que não é DESKVOICE_* é ignorada, nunca executada.
printf 'DESKVOICE_DOMAIN=arquivo.exemplo.com.br\ntouch %s/pwned\nPATH=/nada\n' "$SANDBOX" > "$SANDBOX/answers.env"
out="$(bash "$KIT/install.sh" --dry-run --yes --answers "$SANDBOX/answers.env" 2>&1)"
contains "lê a resposta do arquivo" "$out" "https://arquivo.exemplo.com.br"
refuse "arquivo de respostas não é executado" test -e "$SANDBOX/pwned"
# Sem domínio, com 80/443 de outro proxy: por padrão o painel abre pelo IP (sem HTTPS, e avisa).
# Quem não quer um login exposto na internet pede acesso só local e entra por túnel SSH.
printf 'LISTEN 0 511 0.0.0.0:80 0.0.0.0:*\nLISTEN 0 511 0.0.0.0:443 0.0.0.0:*\n' > "$FAKE_DIR/ss_tcp"
out="$(DESKVOICE_DOMAIN="" bash "$KIT/install.sh" --dry-run --yes 2>&1)"; equal "sem domínio: simulação sai com zero" 0 "$?"
contains "sem domínio: publica para fora" "$out" "0.0.0.0:3080"
contains "sem domínio: publica também a voz do navegador" "$out" "0.0.0.0:3081"
contains "sem domínio e sem HTTPS: avisa que o microfone não abre pelo IP" "$out" "microfone"
contains "sem domínio: avisa que não há HTTPS" "$out" "SEM HTTPS"
out="$(DESKVOICE_DOMAIN="" DESKVOICE_PANEL_LOCAL_ONLY=yes bash "$KIT/install.sh" --dry-run --yes 2>&1)"; equal "só local: simulação sai com zero" 0 "$?"
contains "só local: publica só na própria máquina" "$out" "127.0.0.1:3080"
lacks "só local: não publica para fora" "$out" "0.0.0.0:3080"
contains "só local: ensina o túnel com as duas portas" "$out" "ssh -L 3080:127.0.0.1:3080 -L 3081:127.0.0.1:3081"
out="$(DESKVOICE_DOMAIN="" DESKVOICE_PANEL_LOCAL_ONLY=talvez bash "$KIT/install.sh" --dry-run --yes 2>&1)"; equal "só local com valor estranho: recusa" 1 "$?"
contains "só local com valor estranho: diz o que vale" "$out" "DESKVOICE_PANEL_LOCAL_ONLY"
equal "nenhuma simulação alterou arquivo" "$before" "$(snapshot)"
equal "nenhuma simulação mandou o Docker alterar nada" 0 "$(mutating_calls)"
finish
