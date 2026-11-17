#!/usr/bin/env bash
# Gera o aviso falado da caixa postal (apps/voice/assets/voicemail-notice/<idioma>.wav).
#
# O aviso é áudio já gravado (decisão 0018, escolha 1A): o processo de voz não sintetiza fala, e
# o recado não pode depender de chave nem de provedor. Este script é como o áudio foi feito, para
# quem quiser refazê-lo ou mudar a frase. Ele roda fora do produto e do CI: nada daqui vai para a
# imagem além dos três WAV.
#
# Ferramenta: Piper (pacote piper-tts 1.8.0, GPL-3.0), num contêiner Python descartável, fora do
# repositório. Só o áudio que ele produz entra aqui, não o programa. O contêiner é Linux de
# propósito: o pacote para macOS procura os dados do espeak-ng num caminho da máquina que o
# construiu e falha.
# Vozes (huggingface.co/rhasspy/piper-voices, repositório MIT; licença de cada base conferida no
# MODEL_CARD em 15/11/2026):
#   pt-BR  pt_BR-cadu-medium     base OHF-Voice/voice-datasets, CC0 (afinada sobre a rdh, CC0)
#   es     es_ES-davefx-medium   base OHF-Voice/voice-datasets, CC0 (afinada sobre a rdh, CC0)
#   en     en_US-ljspeech-medium base LJ Speech, domínio público
#
# Pede: Docker, ffmpeg e acesso a pypi.org e huggingface.co.
#   bash scripts/aviso-da-caixa-postal/gerar.sh
set -euo pipefail

repo=$(cd "$(dirname "$0")/../.." && pwd)
out="$repo/apps/voice/assets/voicemail-notice"
work=${AVISO_WORK:-$(mktemp -d)}
voices="https://huggingface.co/rhasspy/piper-voices/resolve/main"

piper() { # modelo, saída; a frase vem pela entrada
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

say pt-BR pt/pt_BR/cadu/medium/pt_BR-cadu-medium "No momento, ninguém pode atender. Esta ligação será gravada. Deixe o seu recado depois do sinal."
say en en/en_US/ljspeech/medium/en_US-ljspeech-medium "No one can take your call right now. This call will be recorded. Please leave a message after the tone."
say es es/es_ES/davefx/medium/es_ES-davefx-medium "En este momento, nadie puede atenderle. Esta llamada será grabada. Deje su mensaje después de la señal."
ls -l "$out"
