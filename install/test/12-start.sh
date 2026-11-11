#!/usr/bin/env bash
# start.sh: a entrada que roda no computador da pessoa, antes de existir servidor. O link da
# parceira vem de partner.env, é declarado como de parceria, e o navegador só abre com um "s".
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
source "$KIT/_common.sh"; set +e; trap - ERR
url="$(partner_value PARTNER_URL)"
contains "partner.env traz um endereço https" "$url" "https://"
check "partner.env traz o nome e o texto da oferta" test -n "$(partner_value PARTNER_NAME)" -a -n "$(partner_value PARTNER_OFFER)"
opened() { grep -c '^abrir ' "$FAKE_DIR/calls.log"; }
# A entrada padrão nunca é o teclado aqui; a resposta vem do arquivo que faz as vezes de terminal.
start() { DESKVOICE_TTY="$1" bash "$KIT/start.sh" 2>&1 </dev/null; }

# Sem terminal: só imprime.
out="$(start "$SANDBOX/nao-existe")"; equal "sem terminal: sai com zero" 0 "$?"
contains "nomeia o tamanho da máquina" "$out" "2 GB de memória ou mais e 10 GB de disco livre"
contains "mostra o endereço de partner.env, inteiro" "$out" "    $url"
contains "diz que o link é de parceria" "$out" "link de parceria"
contains "diz que não é obrigatório" "$out" "Não é obrigatório"
contains "diz que outra VPS funciona igual" "$out" "Qualquer outra VPS com Docker funciona"
contains "entrega o comando seguinte" "$out" "install/get.sh | bash"
lacks "sem terminal: não pergunta" "$out" "[s/N]"
equal "sem terminal: não abre o navegador" 0 "$(opened)"

# Com terminal: pergunta depois de dizer o que o link é, e obedece à resposta.
echo n > "$SANDBOX/tty"; out="$(start "$SANDBOX/tty")"
contains "com terminal: pergunta" "$out" "[s/N]"
equal "resposta n: não abre" 0 "$(opened)"
: > "$SANDBOX/tty"; out="$(start "$SANDBOX/tty")"
equal "resposta vazia: não abre" 0 "$(opened)"
echo s > "$SANDBOX/tty"; out="$(start "$SANDBOX/tty")"; equal "resposta s: sai com zero" 0 "$?"
equal "resposta s: abre exatamente o endereço de partner.env, uma vez" "abrir $url" "$(grep '^abrir ' "$FAKE_DIR/calls.log")"
case "$out" in *"link de parceria"*"[s/N]"*) pass ;; *) flunk "a declaração de parceria vem antes da pergunta" ;; esac

# Por cano, como `curl | bash`: partner.env não está ao lado, então é baixado. O curl de mentira
# devolve um IP, que não é endereço: o script não inventa link e não oferece abrir nada.
: > "$FAKE_DIR/calls.log"; echo s > "$SANDBOX/tty"
out="$(cd "$KIT" && DESKVOICE_TTY="$SANDBOX/tty" bash -s < "$KIT/start.sh" 2>&1)"; equal "download sem endereço: sai com zero" 0 "$?"
lacks "download sem endereço: não mostra link de parceira" "$out" "$url"
contains "download sem endereço: aponta o README" "$out" "github.com/DeskLabs-OpenSource/DeskVoice"
contains "download sem endereço: ainda entrega o comando seguinte" "$out" "install/get.sh | bash"
equal "download sem endereço: não abre nada, nem lê o partner.env da pasta atual" 0 "$(opened)"

# Por cano, com o curl de verdade lendo o partner.env deste repositório: o mesmo endereço.
REAL_PATH="${PATH#"$TEST_DIR/fake:"}"
if PATH="$REAL_PATH" command -v curl >/dev/null 2>&1; then
  out="$(PATH="$REAL_PATH" DESKVOICE_RAW="file://$REPO" DESKVOICE_TTY="$SANDBOX/nao-existe" bash -s < "$KIT/start.sh" 2>&1)"
  contains "download: mostra o endereço de partner.env" "$out" "    $url"
  contains "download: declara a parceria" "$out" "link de parceria"
fi
finish
