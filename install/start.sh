#!/usr/bin/env bash
# Antes do servidor. Roda no SEU computador (macOS ou Linux), não na VPS: diz o que é preciso
# para instalar o DeskVoice, o tamanho da máquina, onde contratar uma e qual é o comando
# seguinte. Não instala nada, não coleta nada e não envia nada.
#
#   curl -fsSL https://raw.githubusercontent.com/DeskLabs-OpenSource/DeskVoice/main/install/start.sh | bash
#   bash install/start.sh        de dentro de uma cópia do repositório
#
# Num terminal, pergunta se você quer abrir no navegador o link da VPS parceira, depois de dizer
# o que ele é, e só abre se a resposta for "s". Sem terminal, só imprime.
#
# Variáveis opcionais:
#   DESKVOICE_RAW  de onde baixar install/partner.env quando o script chega por `curl | bash`
#   DESKVOICE_TTY  de onde ler a resposta quando a entrada padrão não é o teclado (padrão: /dev/tty)
set -euo pipefail

# Tudo dentro de uma função chamada na última linha: um download cortado não executa metade.
# Lido fora da função: por `curl | bash` não há arquivo, e dentro de uma função o bash devolveria
# um nome que não é caminho, o que faria o script ler um partner.env da pasta atual.
self="${BASH_SOURCE[0]:-}"
main() {

raw="${DESKVOICE_RAW:-https://raw.githubusercontent.com/DeskLabs-OpenSource/DeskVoice/main}"
tty="${DESKVOICE_TTY:-/dev/tty}"
say() { printf '%s\n' "$*"; }

# O endereço da parceira tem uma origem só, install/partner.env: ao lado deste arquivo quando há
# uma cópia do repositório, baixado quando o script chegou por `curl | bash`. Um partner.env
# que por acaso esteja na pasta atual nunca é lido.
if [ -n "$self" ] && [ -f "$(dirname "$self")/partner.env" ]; then
  data="$(cat "$(dirname "$self")/partner.env")"
else
  data="$(curl -fsSL "$raw/install/partner.env" 2>/dev/null || true)"
fi
field() { printf '%s\n' "$data" | sed -n "s/^$1=\"\\(.*\\)\"\$/\\1/p" | head -n 1; }
name="$(field PARTNER_NAME)"; url="$(field PARTNER_URL)"; offer="$(field PARTNER_OFFER)"
# Sem endereço conferido não há link: este script nunca escreve um de memória.
case "$url" in https://*) ;; *) url="" ;; esac

say "DeskVoice: antes de instalar"
say
say "O DeskVoice é instalado num servidor (VPS), não neste computador. Este roteiro só informa:"
say "não instala, não coleta e não envia nada."
say
say "O que ter em mãos"
say "  1. Uma VPS com Ubuntu 22.04 ou mais novo, ou Debian 12 ou mais novo, e acesso por SSH."
say "     Disco: 10 GB livres. Memória: a instalação foi provada numa VPS de 8 GB e 4 vCPU, e o"
say "     DeskVoice parado usa cerca de 380 MiB de memória e ocupa cerca de 2,7 GB de disco (medidos"
say "     na 0.3.0, sem o WhatsApp). O menor tamanho em que a instalação cabe ainda não foi medido;"
say "     ela baixa as imagens prontas da versão publicada, sem construí-las no servidor."
say "  2. Opcional: um domínio apontado para a VPS. Sem domínio não há HTTPS: o painel fica só dentro"
say "     da VPS e você entra por túnel SSH, com o comando que o instalador mostra no fim."
say "  3. Para atender ligação de verdade: um tronco SIP com um número e uma chave de IA de voz"
say "     (Gemini ou OpenAI). Sem eles dá para instalar e ver uma chamada simulada."
say
say "Ainda não tem uma VPS?"
if [ -n "$url" ]; then
  say "  A recomendada pelo projeto é a da $name, parceira de infraestrutura:"
  say "    $url"
  say "  $offer"
else
  say "  Não consegui ler o endereço da VPS recomendada pelo projeto. Ele está na seção Instalar de"
  say "  https://github.com/DeskLabs-OpenSource/DeskVoice. Qualquer VPS com Docker funciona."
fi
say
say "Com a VPS em mãos"
say "  Entre nela por SSH e rode uma linha. Ela baixa o DeskVoice e abre o instalador:"
say "    curl -fsSL https://raw.githubusercontent.com/DeskLabs-OpenSource/DeskVoice/main/install/get.sh | bash"
say "  O passo a passo completo: docs/guides/primeira-ligacao.md, no repositório."

# Abrir o navegador: só com o link conferido, só depois do texto acima, e só se a pessoa disser sim.
[ -n "$url" ] || return 0
case "$(uname -s)" in Darwin) opener=open ;; *) opener=xdg-open ;; esac
command -v "$opener" >/dev/null 2>&1 || return 0
if [ -t 0 ]; then ask=/dev/stdin
elif [ -r "$tty" ] && : <"$tty" 2>/dev/null; then ask="$tty"
else return 0; fi
say
printf 'Quer que eu abra agora no navegador o link de parceria da %s? Não é obrigatório. [s/N] ' "$name"
answer=""; IFS= read -r answer <"$ask" || true
case "$answer" in
  s|S|sim|Sim|SIM) "$opener" "$url" || say "Não consegui abrir o navegador. O link está acima." ;;
  *) say "Não abri. O link está acima, se precisar." ;;
esac
}
main "$@"
