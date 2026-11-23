#!/usr/bin/env bash
# Gera as falas de falha do menu por teclas (apps/voice/assets/ivr-notice/<idioma>/{no-choice,failed}.wav).
#
# Mesmo molde da fala de indisponível (scripts/fala-de-indisponivel/gerar.sh): áudio já gravado, que
# não depende de chave nem de provedor, porque a URA atende sem chave de IA. Toda falha da URA tem
# uma fala (apps/voice/src/ivr-session.ts):
#   no-choice  quem ligou não escolheu uma opção válida, e o menu manda desligar;
#   failed     o menu não pôde atender (anúncio que não se lê, menu sem saída para uma pessoa,
#              agente desligado na hora da escolha).
# Este script roda fora do produto e do CI: nada daqui vai para a imagem além dos seis WAV.
#
# Ferramenta e vozes: as mesmas do aviso da caixa postal (Piper, pacote piper-tts 1.8.0, GPL-3.0,
# fora do repositório; vozes de huggingface.co/rhasspy/piper-voices, licenças lá anotadas).
#   pt-BR  pt_BR-cadu-medium     es  es_ES-davefx-medium     en  en_US-ljspeech-medium
#
# Pede: ffmpeg, acesso a huggingface.co e, para o Piper, Docker (com acesso a pypi.org) ou o
# programa já instalado, apontado por PIPER_BIN (um venv com `pip install piper-tts==1.8.0`).
#   bash scripts/fala-da-ura/gerar.sh
#   PIPER_BIN=/caminho/do/venv/bin/piper bash scripts/fala-da-ura/gerar.sh
set -euo pipefail

repo=$(cd "$(dirname "$0")/../.." && pwd)
out="$repo/apps/voice/assets/ivr-notice"
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

say() { # idioma, caminho da voz, nome da fala, frase
  local lang=$1 voice=$2 kind=$3 text=$4 name
  name=$(basename "$voice")
  for ext in onnx onnx.json; do
    [ -f "$work/$name.$ext" ] || curl -sfL -o "$work/$name.$ext" "$voices/$voice.$ext"
  done
  printf '%s' "$text" | piper "$name.onnx" "$lang-$kind.wav"
  mkdir -p "$out/$lang"
  # A linha telefônica: PCM16 mono a 8 kHz, cabeçalho de 44 bytes, sem metadados.
  ffmpeg -loglevel error -y -i "$work/$lang-$kind.wav" -ac 1 -ar 8000 -c:a pcm_s16le -map_metadata -1 -fflags +bitexact -flags:a +bitexact "$out/$lang/$kind.wav"
}

pt=pt/pt_BR/cadu/medium/pt_BR-cadu-medium
en=en/en_US/ljspeech/medium/en_US-ljspeech-medium
es=es/es_ES/davefx/medium/es_ES-davefx-medium

say pt-BR "$pt" no-choice "Não recebemos uma opção válida. A ligação vai ser encerrada."
say pt-BR "$pt" failed "Não foi possível completar a sua ligação agora. Por favor, tente mais tarde."
say en "$en" no-choice "We did not receive a valid option. The call will now end."
say en "$en" failed "We could not complete your call right now. Please try again later."
say es "$es" no-choice "No recibimos una opción válida. La llamada va a terminar."
say es "$es" failed "No fue posible completar su llamada ahora. Por favor, inténtelo más tarde."
ls -lR "$out"
