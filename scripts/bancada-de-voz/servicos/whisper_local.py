"""
Ajudante do serviço `whisper-local` da bancada de voz (scripts/bancada-de-voz/servicos/whisper-local.ts).

Roda faster-whisper em CPU, fora do produto, num venv à parte. Conversa por linhas JSON:
  entrada  {"tipo":"inicio","id":"...","idioma":"pt","vocabulario":["..."]}
           {"tipo":"audio","id":"...","b64":"<PCM16 mono 16 kHz>"}
           {"tipo":"fim","id":"..."}
  saída    {"tipo":"pronto"} | {"tipo":"parcial","id":"...","texto":"..."} | {"tipo":"final","id":"...","texto":"..."}
           {"tipo":"erro","mensagem":"..."}

A família Whisper não é feita para fluxo. Aqui o fluxo é montado assim, sem oráculo (a bancada não
avisa quando a fala acaba):
  - a cada PARCIAL_S segundos de áudio novo com fala, transcreve o trecho pendente inteiro e manda o parcial;
  - o fim da fala é o Silero VAD (o que vem no faster-whisper) sobre o trecho pendente: com fala e
    SILENCIO_MS de silêncio depois dela, transcreve o trecho e manda o final.
A leitura do áudio corre numa linha à parte: o que chega enquanto o modelo trabalha espera na fila,
e a latência medida inclui esse tempo, como numa ligação.
"""
import base64
import json
import os
import queue
import sys
import threading

import numpy as np
from faster_whisper import WhisperModel
from faster_whisper.vad import VadOptions, get_speech_timestamps

TAXA = 16000
MODELO = os.environ.get("BANCADA_WHISPER_MODELO", "small")
COMPUTO = os.environ.get("BANCADA_WHISPER_COMPUTO", "int8")
FEIXE_FINAL = int(os.environ.get("BANCADA_WHISPER_FEIXE", "5"))
PARCIAL_S = 1.0
SILENCIO_MS = 500
VAD_A_CADA_S = 0.1


def falar(objeto):
    sys.stdout.write(json.dumps(objeto, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def ler(fila):
    for linha in sys.stdin:
        linha = linha.strip()
        if linha:
            fila.put(json.loads(linha))
    fila.put(None)


def main():
    modelo = WhisperModel(MODELO, device="cpu", compute_type=COMPUTO, cpu_threads=os.cpu_count() or 4)
    opcoes_vad = VadOptions(min_silence_duration_ms=SILENCIO_MS, speech_pad_ms=100)
    fila = queue.Queue()
    threading.Thread(target=ler, args=(fila,), daemon=True).start()
    falar({"tipo": "pronto"})

    sessao = None  # {"id", "idioma", "prompt", "pendente": np.float32, "desde_parcial", "desde_vad"}

    def transcrever(audio, feixe):
        segmentos, _ = modelo.transcribe(
            audio, language=sessao["idioma"], beam_size=feixe, initial_prompt=sessao["prompt"], vad_filter=False, condition_on_previous_text=False
        )
        return " ".join(s.text.strip() for s in segmentos).strip()

    while True:
        # Drena a fila inteira antes de decidir: a decisão vale para o áudio mais recente.
        mensagens = [fila.get()]
        while True:
            try:
                mensagens.append(fila.get_nowait())
            except queue.Empty:
                break
        for msg in mensagens:
            if msg is None:
                return
            if msg["tipo"] == "inicio":
                vocab = msg.get("vocabulario") or []
                sessao = {
                    "id": msg["id"],
                    "idioma": msg.get("idioma", "pt"),
                    "prompt": ("Nomes e termos: " + ", ".join(vocab) + ".") if vocab else None,
                    "pendente": np.zeros(0, dtype=np.float32),
                    "desde_parcial": 0,
                    "desde_vad": 0,
                }
            elif msg["tipo"] == "fim":
                sessao = None
            elif msg["tipo"] == "audio" and sessao and msg["id"] == sessao["id"]:
                pcm = np.frombuffer(base64.b64decode(msg["b64"]), dtype=np.int16).astype(np.float32) / 32768.0
                sessao["pendente"] = np.concatenate([sessao["pendente"], pcm])
                sessao["desde_parcial"] += len(pcm)
                sessao["desde_vad"] += len(pcm)
        if not sessao or sessao["desde_vad"] < VAD_A_CADA_S * TAXA:
            continue
        sessao["desde_vad"] = 0
        pendente = sessao["pendente"]
        falas = get_speech_timestamps(pendente, opcoes_vad)
        if not falas:
            # Sem fala: guarda só o último segundo, para não transcrever silêncio.
            sessao["pendente"] = pendente[-TAXA:]
            sessao["desde_parcial"] = 0
            continue
        fim_da_fala = falas[-1]["end"]
        if len(pendente) - fim_da_fala >= SILENCIO_MS * TAXA / 1000:
            texto = transcrever(pendente[: fim_da_fala + int(0.1 * TAXA)], FEIXE_FINAL)
            falar({"tipo": "final", "id": sessao["id"], "texto": texto})
            sessao["pendente"] = pendente[fim_da_fala:]
            sessao["desde_parcial"] = 0
        elif sessao["desde_parcial"] >= PARCIAL_S * TAXA:
            sessao["desde_parcial"] = 0
            falar({"tipo": "parcial", "id": sessao["id"], "texto": transcrever(pendente, 1)})


if __name__ == "__main__":
    try:
        main()
    except Exception as erro:  # o processo morre; a bancada registra
        falar({"tipo": "erro", "mensagem": str(erro)})
        raise
