#!/usr/bin/env bash
# Baixa o DeskVoice e abre o instalador. É o comando de uma linha do README:
#
#   curl -fsSL https://raw.githubusercontent.com/DeskLabs-OpenSource/DeskVoice/main/install/get.sh | bash
#
# Prefere ler antes de rodar? Faça o que este arquivo faz, à mão:
#   git clone https://github.com/DeskLabs-OpenSource/DeskVoice.git && cd DeskVoice && bash install/install.sh
# (se já houver versão publicada, o instalador diz o `git checkout` a fazer antes)
#
# Variáveis opcionais:
#   DESKVOICE_DIR   pasta de destino (padrão: ~/DeskVoice)
#   DESKVOICE_REPO  endereço do repositório (padrão: o oficial)
#   DESKVOICE_REF   ramo ou versão a baixar (padrão: a última versão publicada; sem nenhuma, a main)
set -euo pipefail

repo="${DESKVOICE_REPO:-https://github.com/DeskLabs-OpenSource/DeskVoice.git}"
dir="${DESKVOICE_DIR:-$HOME/DeskVoice}"
ref="${DESKVOICE_REF:-main}"

say() { printf '%s\n' "$*"; }
die() { printf 'Não deu para continuar: %s\n  O que fazer: %s\n' "$1" "$2" >&2; exit 1; }

if ! command -v git >/dev/null 2>&1; then
  say "O git não está instalado. Vou instalar (é o único programa necessário antes do instalador)."
  if command -v apt-get >/dev/null 2>&1; then
    if [ "$(id -u)" = 0 ]; then apt-get update -qq && apt-get install -y -qq git
    elif command -v sudo >/dev/null 2>&1; then sudo apt-get update -qq && sudo apt-get install -y -qq git
    else die "preciso de permissão de administrador para instalar o git." "Entre como root ou instale o git e rode de novo."; fi
  else
    die "não sei instalar o git neste sistema." "Instale o git pelo gerenciador de pacotes do seu sistema e rode de novo."
  fi
  command -v git >/dev/null 2>&1 || die "o git não ficou disponível depois da instalação." "Instale o git à mão e rode de novo."
fi

if [ -d "$dir/.git" ]; then
  say "Já existe um DeskVoice em $dir: vou aproveitar o que está lá (rodar de novo não quebra nada)."
elif [ -e "$dir" ]; then
  die "a pasta $dir já existe e não é um DeskVoice." "Escolha outra pasta: DESKVOICE_DIR=/outro/caminho e rode de novo."
else
  say "Baixando o DeskVoice em $dir..."
  git clone --quiet --branch "$ref" "$repo" "$dir" || die "não consegui baixar o repositório." "Confira a conexão da VPS com a internet e rode de novo."
  # Sem pedido explícito, o código fica na última versão publicada: é dela que o instalador baixa
  # as imagens, e código da main com imagem de versão anterior é uma combinação que ninguém testou.
  if [ -z "${DESKVOICE_REF:-}" ]; then
    latest="$(git -C "$dir" tag --list 'v[0-9]*' --sort=-v:refname | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | head -n 1 || true)"
    if [ -n "$latest" ]; then
      git -C "$dir" checkout --quiet "$latest" || die "não consegui ir para a versão $latest." "Apague a pasta $dir e rode de novo."
      say "Versão baixada: ${latest#v}"
    fi
  fi
fi

[ -f "$dir/install/install.sh" ] || die "o instalador não está em $dir/install/install.sh." "Apague a pasta $dir e rode de novo."
cd "$dir"

# Este script chega por `curl | bash`: a entrada padrão é o próprio download, não o teclado.
# O instalador faz perguntas, então ele precisa ler do terminal de verdade.
unattended=0
for arg in "$@"; do [ "$arg" = "--yes" ] && unattended=1; done

if [ -t 0 ]; then
  exec bash install/install.sh "$@"
elif [ "$unattended" = 1 ]; then
  # Sem perguntas não há o que ler do teclado; a entrada do download não pode vazar para o instalador.
  exec bash install/install.sh "$@" </dev/null
elif [ -r /dev/tty ] && : </dev/tty 2>/dev/null; then
  exec bash install/install.sh "$@" </dev/tty
else
  say "Não há terminal para as perguntas do instalador."
  say "Rode num terminal interativo, ou sem perguntas:  cd $dir && bash install/install.sh --yes"
  say "(as respostas vão por variáveis DESKVOICE_*; a lista está no começo de install/install.sh)"
  exit 1
fi
