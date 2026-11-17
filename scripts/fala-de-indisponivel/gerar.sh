#!/usr/bin/env bash
# Gera a fala de "indisponível" da organização suspensa (apps/voice/assets/unavailable-notice/<idioma>.wav).
#
# Mesmo molde do aviso da caixa postal (scripts/aviso-da-caixa-postal/gerar.sh): áudio já gravado,
# que não depende de chave nem de provedor, porque a organização suspensa não abre motor de voz. A
# fala não diz o motivo: o motivo é da agência com o cliente, e não de quem liga (desenho
# docs/specs/2026-11-17-varias-organizacoes-e-administracao-da-instalacao.md, 3.3). Este script roda
# fora do produto e do CI: nada daqui vai para a imagem além dos três WAV.
#
# Ferramenta e vozes: as mesmas do aviso da caixa postal (Piper, pacote piper-tts 1.8.0, GPL-3.0,
# fora do repositório; vozes de huggingface.co/rhasspy/piper-voices, licenças lá anotadas).
#   pt-BR  pt_BR-cadu-medium     es  es_ES-davefx-medium     en  en_US-ljspeech-medium
#
# Pede: ffmpeg, acesso a huggingface.co e, para o Piper, Docker (com acesso a pypi.org) ou o
# programa já instalado, apontado por PIPER_BIN (um venv com `pip install piper-tts==1.8.0`).
#   bash scripts/fala-de-indisponivel/gerar.sh
#   PIPER_BIN=/caminho/do/venv/bin/piper bash scripts/fala-de-indisponivel/gerar.sh
set -euo pipefail

repo=$(cd "$(dirname "$0")/../.." && pwd)
out="$repo/apps/voice/assets/unavailable-notice"
work=${AVISO_WORK:-$(mktemp -d)}
voices="https://huggingface.co/rhasspy/piper-voices/resolve/main"

piper() { # modelo, saída; a frase vem pela entrada
  if [ -n "${PIPER_BIN:-}" ]; then
    (cd "$work" && "$PIPER_BIN" -m "$1" -f "$2")
    return
  fi
  docker run --rm -i -v "$work:/work" -w /work python:3.12-slim \
    sh -c "pip install -q --root-user-action=ignore piper-tts==1.8.0 >/dev/null && piper -m '$1' -f '$2'"
}

say() { # idioma, caminho da voz, frase
  local lang=$1 voice=$2 text=$3 name
  name=$(basename "$voice")
  for ext in onnx onnx.json; do
    [ -f "$work/$name.$ext" ] || curl -sfL -o "$work/$name.$ext" "$voices/$voice.$ext"
  done
  printf '%s' "$text" | piper "$name.onnx" "$lang.wav"
  # A linha telefônica: PCM16 mono a 8 kHz, cabeçalho de 44 bytes, sem metadados.
  ffmpeg -loglevel error -y -i "$work/$lang.wav" -ac 1 -ar 8000 -c:a pcm_s16le -map_metadata -1 -fflags +bitexact -flags:a +bitexact "$out/$lang.wav"
}

mkdir -p "$out"
say pt-BR pt/pt_BR/cadu/medium/pt_BR-cadu-medium "Este número está temporariamente indisponível. Por favor, tente mais tarde."
say en en/en_US/ljspeech/medium/en_US-ljspeech-medium "This number is temporarily unavailable. Please try again later."
say es es/es_ES/davefx/medium/es_ES-davefx-medium "Este número no está disponible temporalmente. Por favor, inténtelo más tarde."
ls -l "$out"
