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
contains "diz que agendaria o agente de atualização" "$out" "agendar o agente de atualização (timer do systemd deskvoice-agent.timer"
refuse "simulação não grava o agendamento do agente" test -e "$DESKVOICE_SYSTEMD_DIR/deskvoice-agent.timer"
equal "simulação não chama o systemd" 0 "$(grep -c '^systemctl ' "$FAKE_DIR/calls.log")"
contains "explica o NAT" "$out" "atrás de um roteador do provedor (NAT)"
contains "manda liberar as portas UDP no provedor" "$out" "5060/udp   e   10000-10200/udp"
contains "não disputa 80/443" "$out" "Não vou disputar essas portas"
contains "escolhe porta local livre, pulando a ocupada" "$out" "127.0.0.1:3081"
lacks "com domínio atrás de outro proxy: não há segunda porta" "$out" "3082"
contains "com domínio atrás de outro proxy: uma porta para painel e voz" "$out" "a única porta publicada"
contains "com domínio atrás de outro proxy: o domínio inteiro vai para a porta única" "$out" "encaminhe voz.exemplo.com.br inteiro para 127.0.0.1:3081, repassando WebSocket"
contains "é honesto sobre o que não consegue provar" "$out" "a prova final é a primeira ligação"
contains "anuncia o endereço do painel" "$out" "https://voz.exemplo.com.br"
lacks "senha do dono não aparece na saída" "$out" "senha-de-teste-123"

# Caso 2: IP direto, portas livres, sem domínio.
echo 203.0.113.10 > "$FAKE_DIR/iface_ip"; : > "$FAKE_DIR/ss_tcp"
out="$(DESKVOICE_DOMAIN="" bash "$KIT/install.sh" --dry-run --yes 2>&1)"
contains "IP direto na placa" "$out" "direto na placa de rede"
# O padrão sem domínio é o seguro: a tela de entrada não vai para a internet sem HTTPS.
contains "sem domínio, 80/443 livres: o padrão publica só nesta máquina" "$out" "só com HTTP em 127.0.0.1:3080"
lacks "sem domínio, 80/443 livres: o padrão não usa a porta 80" "$out" "na porta 80, só com HTTP"
contains "sem domínio: o endereço é o do túnel" "$out" "Endereço que o painel teria: http://localhost:3080"
lacks "sem domínio: o padrão não anuncia o IP" "$out" "http://203.0.113.10"
contains "sem domínio: ensina o túnel" "$out" "ssh -L 3080:127.0.0.1:3080 <usuário>@203.0.113.10"
contains "sem domínio: diz como ter HTTPS" "$out" "aponte um domínio para 203.0.113.10"
contains "diz que vai provar o login antes de dizer pronto" "$out" "entrar de verdade pela tela de entrada"
# Publicar por HTTP pelo IP só pedindo de propósito, e o risco é nomeado.
out="$(DESKVOICE_DOMAIN="" DESKVOICE_PANEL_PUBLIC_HTTP=yes bash "$KIT/install.sh" --dry-run --yes 2>&1)"; equal "HTTP pedido de propósito: zero" 0 "$?"
contains "HTTP pedido de propósito: publica a 80" "$out" "na porta 80, só com HTTP e aberto para a internet"
contains "HTTP pedido de propósito: nomeia o risco" "$out" "a senha trafega sem criptografia"
contains "HTTP pedido de propósito: usa o IP" "$out" "Endereço que o painel teria: http://203.0.113.10"
# A opção vale em todo modo: aqui (80/443 livres) ela era ignorada em silêncio.
out="$(DESKVOICE_DOMAIN="" DESKVOICE_PANEL_LOCAL_ONLY=yes bash "$KIT/install.sh" --dry-run --yes 2>&1)"; equal "só local com 80/443 livres: zero" 0 "$?"
contains "só local com 80/443 livres: publica só nesta máquina" "$out" "só com HTTP em 127.0.0.1:3080"
for bad in 1 true sim no YES; do
  out="$(DESKVOICE_DOMAIN="" DESKVOICE_PANEL_LOCAL_ONLY="$bad" bash "$KIT/install.sh" --dry-run --yes 2>&1)"; equal "80/443 livres: o valor '$bad' é recusado, e não ignorado" 1 "$?"
  contains "80/443 livres, valor '$bad': diz o valor aceito" "$out" "DESKVOICE_PANEL_LOCAL_ONLY=yes"
done
out="$(DESKVOICE_DOMAIN="" DESKVOICE_PANEL_PUBLIC_HTTP=1 bash "$KIT/install.sh" --dry-run --yes 2>&1)"; equal "HTTP com valor estranho: recusa" 1 "$?"
contains "HTTP com valor estranho: diz o valor aceito" "$out" "DESKVOICE_PANEL_PUBLIC_HTTP=yes"
out="$(DESKVOICE_DOMAIN="" DESKVOICE_PANEL_LOCAL_ONLY=yes DESKVOICE_PANEL_PUBLIC_HTTP=yes bash "$KIT/install.sh" --dry-run --yes 2>&1)"; equal "as duas opções juntas: recusa" 1 "$?"
contains "as duas opções juntas: diz que são opostas" "$out" "pedem coisas opostas"
# Com domínio as duas opções não têm efeito: param com erro que nomeia a opção e o modo.
out="$(DESKVOICE_PANEL_LOCAL_ONLY=yes bash "$KIT/install.sh" --dry-run --yes 2>&1)"; equal "só local com domínio (80/443 livres): recusa" 1 "$?"
contains "só local com domínio: nomeia a opção" "$out" "DESKVOICE_PANEL_LOCAL_ONLY=yes não tem efeito"
contains "só local com domínio: nomeia o modo" "$out" "com o domínio voz.exemplo.com.br, 80/443 livres"
out="$(DESKVOICE_PANEL_PUBLIC_HTTP=yes bash "$KIT/install.sh" --dry-run --yes 2>&1)"; equal "HTTP com domínio: recusa" 1 "$?"
contains "HTTP com domínio: nomeia a opção e o modo" "$out" "DESKVOICE_PANEL_PUBLIC_HTTP=yes não tem efeito no modo desta instalação (com o domínio voz.exemplo.com.br, 80/443 livres)"
out="$(DESKVOICE_PANEL_PORT=3090 bash "$KIT/install.sh" --dry-run --yes 2>&1)"; equal "porta local com domínio nas 80/443: recusa" 1 "$?"
contains "porta local sem efeito: nomeia a opção" "$out" "DESKVOICE_PANEL_PORT=3090 não tem efeito"
out="$(DESKVOICE_DOMAIN="" DESKVOICE_PANEL_PORT=3090 bash "$KIT/install.sh" --dry-run --yes 2>&1)"; equal "porta local sem domínio: vale" 0 "$?"
contains "porta local sem domínio: é a pedida" "$out" "127.0.0.1:3090"

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
# Sem domínio, com 80/443 de outro proxy: o padrão também é só local. Aberto pelo IP, só pedindo.
printf 'LISTEN 0 511 0.0.0.0:80 0.0.0.0:*\nLISTEN 0 511 0.0.0.0:443 0.0.0.0:*\n' > "$FAKE_DIR/ss_tcp"
out="$(DESKVOICE_DOMAIN="" bash "$KIT/install.sh" --dry-run --yes 2>&1)"; equal "sem domínio: simulação sai com zero" 0 "$?"
contains "sem domínio, outro proxy: o padrão publica só nesta máquina" "$out" "127.0.0.1:3080"
lacks "sem domínio, outro proxy: o padrão não publica para fora" "$out" "0.0.0.0:3080"
out="$(DESKVOICE_DOMAIN="" DESKVOICE_PANEL_PUBLIC_HTTP=yes bash "$KIT/install.sh" --dry-run --yes 2>&1)"; equal "outro proxy, HTTP pedido: zero" 0 "$?"
contains "outro proxy, HTTP pedido: publica para fora" "$out" "0.0.0.0:3080"
lacks "outro proxy, HTTP pedido: não há segunda porta" "$out" "3081"
contains "outro proxy, HTTP pedido: avisa que o microfone não abre pelo IP" "$out" "microfone"
contains "outro proxy, HTTP pedido: avisa que não há HTTPS" "$out" "SEM HTTPS"
out="$(DESKVOICE_PANEL_LOCAL_ONLY=yes bash "$KIT/install.sh" --dry-run --yes 2>&1)"; equal "só local com domínio (outro proxy): recusa" 1 "$?"
contains "só local com domínio (outro proxy): nomeia o modo" "$out" "com o domínio voz.exemplo.com.br, 80/443 de outro proxy"
out="$(DESKVOICE_DOMAIN="" DESKVOICE_PANEL_LOCAL_ONLY=yes bash "$KIT/install.sh" --dry-run --yes 2>&1)"; equal "só local: simulação sai com zero" 0 "$?"
contains "só local: publica só na própria máquina" "$out" "127.0.0.1:3080"
lacks "só local: não publica para fora" "$out" "0.0.0.0:3080"
contains "só local: ensina o túnel com UMA porta" "$out" "ssh -L 3080:127.0.0.1:3080 <usuário>@"
lacks "só local: o túnel não pede segunda porta" "$out" "3081"
out="$(DESKVOICE_DOMAIN="" DESKVOICE_PANEL_LOCAL_ONLY=talvez bash "$KIT/install.sh" --dry-run --yes 2>&1)"; equal "só local com valor estranho: recusa" 1 "$?"
contains "só local com valor estranho: diz o que vale" "$out" "DESKVOICE_PANEL_LOCAL_ONLY"
equal "nenhuma simulação alterou arquivo" "$before" "$(snapshot)"
equal "nenhuma simulação mandou o Docker alterar nada" 0 "$(mutating_calls)"
finish
