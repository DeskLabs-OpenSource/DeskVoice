"""
Ajudante da medida de redução de ruído da bancada de voz (scripts/bancada-de-voz/reducao-de-ruido.ts).

Roda **um** candidato por processo, em CPU, num venv à parte, fora do repositório e do produto.
Conversa por linhas JSON:
  argumento  o candidato: speexdsp | rnnoise | deepfilternet
  saída 1    {"tipo":"pronto","taxa":8000|48000,"quadro":<amostras>,"lookahead":<amostras>,"versao":"..."}
             ou {"tipo":"nao_instalou","motivo":"..."} (e sai)
  entrada    {"id":"...","b64":"<PCM16 mono na taxa do candidato>"}
  saída      {"id":"...","b64":"<PCM16 mono, mesma taxa>","cpu_s":<segundos de CPU do processo>}

Cada áudio começa com o estado zerado, como uma ligação nova. A CPU é a do processo inteiro
(`time.process_time`), só no processamento: carregar o modelo fica de fora. Uma linha só de
cálculo (`torch.set_num_threads(1)`), para a CPU ser a de um núcleo.

`lookahead` é o que o candidato espera do futuro além do quadro e que não aparece na saída quando o
áudio inteiro é processado de uma vez (o DeepFilterNet alinha a saída por dentro). A bancada o soma
ao atraso medido na correlação.
"""
import base64
import json
import os
import sys
import time

os.environ.setdefault("OMP_NUM_THREADS", "1")
os.environ.setdefault("MKL_NUM_THREADS", "1")

import numpy as np  # noqa: E402


def falar(objeto):
    sys.stdout.write(json.dumps(objeto, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def versao(pacote):
    try:
        from importlib.metadata import version

        return f"{pacote} {version(pacote)}"
    except Exception:  # noqa: BLE001
        return pacote


class Speexdsp:
    """Pré-processador do SpeexDSP, só a supressão de ruído, em 8 kHz nativo. Nível padrão da biblioteca."""

    taxa = 8000
    quadro = 80  # 10 ms
    lookahead = 0

    def __init__(self):
        from speexdsp_ns import NoiseSuppression

        self.criar = lambda: NoiseSuppression.create(self.quadro, self.taxa)
        self.versao = versao("speexdsp-ns")

    def processar(self, x):
        ns = self.criar()
        n = len(x)
        pad = (-n) % self.quadro
        x = np.concatenate([x, np.zeros(pad, dtype=np.int16)])
        out = bytearray()
        for i in range(0, len(x), self.quadro):
            out += ns.process(x[i : i + self.quadro].tobytes())
        return np.frombuffer(bytes(out), dtype=np.int16)[:n]


class Rnnoise:
    """RNNoise (biblioteca em C, pelo `pyrnnoise`), chamado quadro a quadro em 48 kHz."""

    taxa = 48000
    lookahead = 0

    def __init__(self):
        import ctypes

        from pyrnnoise import rnnoise

        self.ctypes = ctypes
        self.lib = rnnoise.lib
        self.quadro = int(rnnoise.FRAME_SIZE)
        self.versao = versao("pyrnnoise")

    def processar(self, x):
        ctypes = self.ctypes
        estado = self.lib.rnnoise_create(None)
        try:
            n = len(x)
            pad = (-n) % self.quadro
            f = np.concatenate([x, np.zeros(pad, dtype=np.int16)]).astype(np.float32)
            out = np.empty_like(f)
            buf = np.empty(self.quadro, dtype=np.float32)
            ptr = buf.ctypes.data_as(ctypes.POINTER(ctypes.c_float))
            for i in range(0, len(f), self.quadro):
                buf[:] = f[i : i + self.quadro]
                self.lib.rnnoise_process_frame(estado, ptr, ptr)
                out[i : i + self.quadro] = buf
            return np.clip(np.round(out[:n]), -32768, 32767).astype(np.int16)
        finally:
            self.lib.rnnoise_destroy(estado)


class Deepfilternet:
    """DeepFilterNet3, pesos padrão do pacote, em 48 kHz, o áudio inteiro de uma vez (sem fluxo)."""

    taxa = 48000

    def __init__(self):
        import torch

        torch.set_num_threads(1)
        torch.set_num_interop_threads(1)
        from df.enhance import enhance, init_df

        self.torch = torch
        self.enhance = enhance
        self.modelo, self.df, _ = init_df(log_level="ERROR")
        self.quadro = int(self.df.hop_size())
        from df.config import config

        la = max(config("conv_lookahead", cast=int, section="deepfilternet", default=0), config("df_lookahead", cast=int, section="df", default=0))
        self.lookahead = la * self.quadro
        self.versao = versao("deepfilternet") + ", DeepFilterNet3"

    def processar(self, x):
        torch = self.torch
        audio = torch.from_numpy(x.astype(np.float32) / 32768.0).unsqueeze(0)
        with torch.no_grad():
            # pad=False: a saída sai atrasada pelo STFT, e a bancada mede esse atraso na correlação.
            y = self.enhance(self.modelo, self.df, audio, pad=False)[0].numpy()
        y = np.concatenate([y, np.zeros(max(0, len(x) - len(y)), dtype=y.dtype)])[: len(x)]
        return np.clip(np.round(y * 32768.0), -32768, 32767).astype(np.int16)


CANDIDATOS = {"speexdsp": Speexdsp, "rnnoise": Rnnoise, "deepfilternet": Deepfilternet}


def main():
    nome = sys.argv[1] if len(sys.argv) > 1 else ""
    if nome not in CANDIDATOS:
        falar({"tipo": "nao_instalou", "motivo": f"candidato desconhecido: {nome}"})
        return
    try:
        candidato = CANDIDATOS[nome]()
    except Exception as erro:  # noqa: BLE001
        falar({"tipo": "nao_instalou", "motivo": f"{type(erro).__name__}: {erro}"})
        return
    falar({"tipo": "pronto", "taxa": candidato.taxa, "quadro": candidato.quadro, "lookahead": candidato.lookahead, "versao": candidato.versao})
    for linha in sys.stdin:
        if not linha.strip():
            continue
        pedido = json.loads(linha)
        x = np.frombuffer(base64.b64decode(pedido["b64"]), dtype="<i2").copy()
        inicio = time.process_time()
        y = candidato.processar(x)
        cpu = time.process_time() - inicio
        falar({"id": pedido["id"], "b64": base64.b64encode(y.astype("<i2").tobytes()).decode("ascii"), "cpu_s": cpu})


if __name__ == "__main__":
    main()
