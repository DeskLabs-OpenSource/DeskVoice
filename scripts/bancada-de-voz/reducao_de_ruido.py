"""
Ajudante da medida de redução de ruído da bancada de voz (scripts/bancada-de-voz/reducao-de-ruido.ts).

Roda **um** candidato por processo, em CPU, num venv à parte, fora do repositório e do produto.
Conversa por linhas JSON:
  argumento  o candidato: speexdsp | rnnoise | deepfilternet | deepfilternet-fluxo
  saída 1    {"tipo":"pronto","taxa":8000|48000,"quadro":<amostras>,"lookahead":<amostras>,"versao":"...","fluxo":true|false}
             ou {"tipo":"nao_instalou","motivo":"..."} (e sai)
  entrada    {"id":"...","b64":"<PCM16 mono na taxa do candidato>","pedaco":<amostras, opcional>}
  saída      {"id":"...","b64":"<PCM16 mono, mesma taxa>","cpu_s":<segundos de CPU do processo>,
              "pedacos":[[<relógio s>,<CPU s>], ...] (só com "pedaco")}

Cada áudio começa com o estado zerado, como uma ligação nova (no `deepfilternet-fluxo`, veja a
classe). A CPU é a do processo inteiro (`time.process_time`, todas as linhas de execução), só no
processamento: carregar o modelo fica de fora. Uma linha só de cálculo (`torch.set_num_threads(1)`),
para a CPU ser a de um núcleo.

**Em fluxo** (fatia 4b): com `pedaco`, o candidato recebe o áudio em pedaços desse tamanho (20 ms,
como a ponte manda), um de cada vez, com o estado guardado entre eles, e cada pedaço é cronometrado
sozinho. Só quem tem `"fluxo": true` aceita `pedaco`; o `deepfilternet` em torch processa o áudio
inteiro de uma vez e não tem medida em fluxo.

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


def em_pedacos(x, pedaco, abrir, passo, fechar):
    """
    Passa `x` em pedaços de `pedaco` amostras, um de cada vez, pelo estado que `abrir()` cria.
    `passo(estado, pedaco)` devolve a saída do pedaço (do mesmo tamanho). Cada pedaço é
    cronometrado sozinho, em relógio e em CPU do processo.
    """
    n = len(x)
    x = np.concatenate([x, np.zeros((-n) % pedaco, dtype=np.int16)])
    estado = abrir()
    saidas, tempos = [], []
    try:
        for i in range(0, len(x), pedaco):
            r0, c0 = time.perf_counter(), time.process_time()
            saidas.append(passo(estado, x[i : i + pedaco]))
            tempos.append([time.perf_counter() - r0, time.process_time() - c0])
    finally:
        fechar(estado)
    return np.concatenate(saidas)[:n], tempos


class Rnnoise:
    """RNNoise (biblioteca em C, pelo `pyrnnoise`), chamado quadro a quadro em 48 kHz."""

    taxa = 48000
    lookahead = 0
    fluxo = True

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

    def processar_em_fluxo(self, x, pedaco):
        """Pedaços de `pedaco` amostras; o RNNoise anda de 10 ms em 10 ms, e o que sobra espera o próximo pedaço."""
        ctypes = self.ctypes
        q = self.quadro
        buf = np.empty(q, dtype=np.float32)
        ptr = buf.ctypes.data_as(ctypes.POINTER(ctypes.c_float))

        def abrir():
            # entrada que espera completar um quadro; saída pronta que ainda não saiu (começa com
            # um quadro de silêncio quando o pedaço não é múltiplo do quadro)
            return {"st": self.lib.rnnoise_create(None), "ent": np.zeros(0, np.float32), "sai": np.zeros(0 if pedaco % q == 0 else q, np.float32)}

        def passo(e, p):
            e["ent"] = np.concatenate([e["ent"], p.astype(np.float32)])
            prontos = []
            while len(e["ent"]) >= q:
                buf[:] = e["ent"][:q]
                e["ent"] = e["ent"][q:]
                self.lib.rnnoise_process_frame(e["st"], ptr, ptr)
                prontos.append(buf.copy())
            e["sai"] = np.concatenate([e["sai"], *prontos])
            out, e["sai"] = e["sai"][: len(p)], e["sai"][len(p) :]
            return np.clip(np.round(out), -32768, 32767).astype(np.int16)

        return em_pedacos(x, pedaco, abrir, passo, lambda e: self.lib.rnnoise_destroy(e["st"]))


class Deepfilternet:
    """DeepFilterNet3, pesos padrão do pacote, em 48 kHz, o áudio inteiro de uma vez (sem fluxo)."""

    taxa = 48000
    fluxo = False

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


class DeepfilternetFluxo:
    """
    DeepFilterNet em tempo real, pelo plugin LADSPA que o próprio projeto publica em cada versão
    (`libdeep_filter_ladspa-<versão>-x86_64-unknown-linux-gnu.so`, em BANCADA_DF_LADSPA). É o
    caminho em fluxo do projeto: o `deep_filter` em Rust (tract), um quadro de 10 ms por vez, numa
    linha de execução própria. O plugin publicado traz o modelo **DeepFilterNet3 de baixa latência**
    (`default-model-ll` no Cargo.toml do plugin), e não o DeepFilterNet3 do pacote em torch.

    Os controles ficam no padrão da biblioteca (`RuntimeParams::default_with_ch`: limite de
    atenuação 100 dB, que é sem limite; −10, 30 e 20 dB nos limiares; sem pós-filtro). O
    "Min Processing Buffer" fica em 1 quadro: com 0, o plugin tira um quadro do atraso depois de
    1000 chamadas, e o atraso mudaria no meio da medida.

    Uma instância só para a medida inteira: o plugin não para a linha de execução dele ao ser
    descartado, e uma por áudio deixaria dezenas delas acordando a cada 2 ms e somando CPU. Para cada
    áudio ser uma ligação nova, a bancada empurra 1 s de silêncio antes dele (fora da conta) e
    descarta a saída correspondente. O atraso do plugin aparece na correlação, como nos outros.
    """

    taxa = 48000
    lookahead = 0
    fluxo = True
    SILENCIO_ENTRE_AUDIOS_S = 1.0

    def __init__(self):
        import ctypes
        import hashlib
        import re

        caminho = os.environ.get("BANCADA_DF_LADSPA", "")
        if not caminho or not os.path.isfile(caminho):
            raise RuntimeError("BANCADA_DF_LADSPA não aponta para o plugin (veja o README da bancada)")
        self.ctypes = ctypes
        c = ctypes

        class Dica(c.Structure):
            _fields_ = [("HintDescriptor", c.c_int), ("LowerBound", c.c_float), ("UpperBound", c.c_float)]

        class Descritor(c.Structure):
            pass

        Descritor._fields_ = [
            ("UniqueID", c.c_ulong), ("Label", c.c_char_p), ("Properties", c.c_int),
            ("Name", c.c_char_p), ("Maker", c.c_char_p), ("Copyright", c.c_char_p),
            ("PortCount", c.c_ulong), ("PortDescriptors", c.POINTER(c.c_int)),
            ("PortNames", c.POINTER(c.c_char_p)), ("PortRangeHints", c.POINTER(Dica)),
            ("ImplementationData", c.c_void_p),
            ("instantiate", c.CFUNCTYPE(c.c_void_p, c.POINTER(Descritor), c.c_ulong)),
            ("connect_port", c.CFUNCTYPE(None, c.c_void_p, c.c_ulong, c.POINTER(c.c_float))),
            ("activate", c.CFUNCTYPE(None, c.c_void_p)),
            ("run", c.CFUNCTYPE(None, c.c_void_p, c.c_ulong)),
            ("run_adding", c.c_void_p), ("set_run_adding_gain", c.c_void_p),
            ("deactivate", c.CFUNCTYPE(None, c.c_void_p)),
            ("cleanup", c.CFUNCTYPE(None, c.c_void_p)),
        ]
        lib = c.CDLL(caminho)
        lib.ladspa_descriptor.restype = c.POINTER(Descritor)
        lib.ladspa_descriptor.argtypes = [c.c_ulong]
        d = lib.ladspa_descriptor(0).contents
        if d.Label != b"deep_filter_mono":
            raise RuntimeError(f"plugin inesperado: {d.Label!r}")
        self.lib, self.d = lib, d
        self.h = d.instantiate(c.byref(d), self.taxa)
        if not self.h:
            raise RuntimeError("o plugin não abriu em 48 kHz")
        controles = {
            b"Attenuation Limit (dB)": 100.0,
            b"Min processing threshold (dB)": -10.0,
            b"Max ERB processing threshold (dB)": 30.0,
            b"Max DF processing threshold (dB)": 20.0,
            b"Min Processing Buffer (frames)": 1.0,
            b"Post Filter Beta": 0.0,
        }
        self._valores = []
        self._ent = np.zeros(0, np.float32)
        self._sai = np.zeros(0, np.float32)
        for k in range(d.PortCount):
            nome = d.PortNames[k]
            if nome in controles:
                v = c.c_float(controles.pop(nome))
                self._valores.append(v)
                d.connect_port(self.h, k, c.pointer(v))
        if controles:
            raise RuntimeError(f"controles que o plugin não tem: {list(controles)}")
        d.activate(self.h)
        self.quadro = 480
        with open(caminho, "rb") as f:
            sha = hashlib.sha256(f.read()).hexdigest()[:12]
        m = re.search(r"ladspa-(\d+\.\d+\.\d+)", os.path.basename(caminho))
        self.versao = f"plugin LADSPA {m.group(1) if m else '?'} (sha256 {sha}), DeepFilterNet3 de baixa latência"

    def _rodar(self, bloco):
        """Um `run` do plugin: entra `bloco` (float32), sai o mesmo tamanho."""
        c = self.ctypes
        n = len(bloco)
        if len(self._ent) != n:
            self._ent = np.zeros(n, np.float32)
            self._sai = np.zeros(n, np.float32)
            self.d.connect_port(self.h, 0, self._ent.ctypes.data_as(c.POINTER(c.c_float)))
            self.d.connect_port(self.h, 1, self._sai.ctypes.data_as(c.POINTER(c.c_float)))
        self._ent[:] = bloco
        self.d.run(self.h, n)
        return self._sai.copy()

    def processar_em_fluxo(self, x, pedaco):
        def abrir():
            silencio = np.zeros(pedaco, np.float32)
            for _ in range(int(round(self.SILENCIO_ENTRE_AUDIOS_S * self.taxa / pedaco))):
                self._rodar(silencio)
            return None

        def passo(_, p):
            y = self._rodar(p.astype(np.float32) / 32768.0)
            return np.clip(np.round(y * 32768.0), -32768, 32767).astype(np.int16)

        return em_pedacos(x, pedaco, abrir, passo, lambda _: None)

    def processar(self, x):
        y, _ = self.processar_em_fluxo(x, 960)
        return y


CANDIDATOS = {"speexdsp": Speexdsp, "rnnoise": Rnnoise, "deepfilternet": Deepfilternet, "deepfilternet-fluxo": DeepfilternetFluxo}


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
    fluxo = bool(getattr(candidato, "fluxo", False))
    falar({"tipo": "pronto", "taxa": candidato.taxa, "quadro": candidato.quadro, "lookahead": candidato.lookahead, "versao": candidato.versao, "fluxo": fluxo})
    for linha in sys.stdin:
        if not linha.strip():
            continue
        pedido = json.loads(linha)
        x = np.frombuffer(base64.b64decode(pedido["b64"]), dtype="<i2").copy()
        pedaco = pedido.get("pedaco")
        if pedaco is not None and not fluxo:
            falar({"id": pedido["id"], "erro": f"{nome} não roda em fluxo"})
            continue
        inicio = time.process_time()
        tempos = None
        if pedaco is None:
            y = candidato.processar(x)
        else:
            y, tempos = candidato.processar_em_fluxo(x, int(pedaco))
        cpu = time.process_time() - inicio
        resposta = {"id": pedido["id"], "b64": base64.b64encode(y.astype("<i2").tobytes()).decode("ascii"), "cpu_s": cpu}
        if tempos is not None:
            resposta["pedacos"] = tempos
        falar(resposta)


if __name__ == "__main__":
    main()
