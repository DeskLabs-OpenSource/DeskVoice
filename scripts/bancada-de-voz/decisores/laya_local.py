"""
Ajudante da medida do Laya na bancada de voz (scripts/bancada-de-voz/decisores/laya.ts).

Só CPU e latência, com as três perguntas fixas do desenho da R12 ("Jev e Laya como filtro"). Não
mede acerto: isso é da fatia 6. Lê um JSON na entrada e devolve um JSON na saída:
  entrada {"frases": ["..."], "vocabulario": ["..."], "concorrencias": [1, 3]}
  saída   {"versao", "modelo", "carregamento_s", "memoria_mb", "por_concorrencia": {...}}

Laya: pacote `laya` (Apache 2.0) e o checkpoint `convaiinnovations/laya` (subpasta multilingual,
Apache 2.0), conferidos em huggingface.co e no PyPI em 14/11/2026.
"""
import difflib
import json
import resource
import sys
import threading
import time
from importlib.metadata import version

from laya import Router

AGENTE = "Agente: Em que posso ajudar?"


def perguntas(frase, vocabulario):
    palavras = frase.split()
    # Os termos do vocabulário que mais se parecem com algum trecho da fala (até 4), mais "nenhum".
    nota = {t: max((difflib.SequenceMatcher(None, t.lower(), p.lower()).ratio() for p in palavras), default=0) for t in vocabulario}
    parecidos = sorted(vocabulario, key=lambda t: -nota[t])[:4]
    opcoes = {t: f"a pessoa disse {t}" for t in parecidos}
    opcoes["nenhum"] = "nenhum destes termos foi dito"
    return {
        "fundo": {"type": "noul", "instructions": "A fala é de quem está na ligação, conversando com o agente (e não fala de fundo)?"},
        "terminou": {"type": "noul", "instructions": "A pessoa terminou o pensamento, ou só fez uma pausa no meio?"},
        "leitura": {"type": "choice", "instructions": "Qual destes termos a pessoa disse?", "criteria": opcoes},
    }


def percentil(valores, p):
    if not valores:
        return None
    ordenados = sorted(valores)
    indice = min(len(ordenados) - 1, max(0, -(-p * len(ordenados) // 100) - 1))
    return ordenados[int(indice)]


def cpu_s():
    uso = resource.getrusage(resource.RUSAGE_SELF)
    return uso.ru_utime + uso.ru_stime


def main():
    entrada = json.load(sys.stdin)
    frases, vocabulario = entrada["frases"], entrada["vocabulario"]
    inicio = time.perf_counter()
    router = Router()
    router.predict(AGENTE, {"x": {"type": "noul", "instructions": "teste"}}, model="multilingual")
    carregamento = time.perf_counter() - inicio
    # Aquece: as três primeiras chamadas não contam.
    for frase in frases[:3]:
        router.predict(f"{AGENTE}\nPessoa: {frase}", perguntas(frase, vocabulario), model="multilingual")

    resultado = {}
    for concorrencia in entrada["concorrencias"]:
        passadas, por_pergunta = [], []
        trava = threading.Lock()

        def trabalhar():
            for frase in frases:
                estado = f"{AGENTE}\nPessoa: {frase}"
                q = perguntas(frase, vocabulario)
                t = time.perf_counter()
                router.predict(estado, q, model="multilingual")
                passada = (time.perf_counter() - t) * 1000
                uma = []
                for nome, pergunta in q.items():
                    t = time.perf_counter()
                    router.predict(estado, {nome: pergunta}, model="multilingual")
                    uma.append((time.perf_counter() - t) * 1000)
                with trava:
                    passadas.append(passada)
                    por_pergunta.extend(uma)

        cpu0, parede0 = cpu_s(), time.perf_counter()
        linhas = [threading.Thread(target=trabalhar) for _ in range(concorrencia)]
        for linha in linhas:
            linha.start()
        for linha in linhas:
            linha.join()
        parede = time.perf_counter() - parede0
        resultado[str(concorrencia)] = {
            "chamadas": len(passadas),
            "passada_p50_ms": percentil(passadas, 50),
            "passada_p95_ms": percentil(passadas, 95),
            "pergunta_p50_ms": percentil(por_pergunta, 50),
            "pergunta_p95_ms": percentil(por_pergunta, 95),
            "nucleos_ocupados": (cpu_s() - cpu0) / parede,
        }

    json.dump(
        {
            "versao": version("laya"),
            "modelo": "convaiinnovations/laya (multilingual)",
            "carregamento_s": carregamento,
            "memoria_mb": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024,
            "por_concorrencia": resultado,
        },
        sys.stdout,
    )


if __name__ == "__main__":
    main()
