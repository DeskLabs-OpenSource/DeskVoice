"""
Ajudante da medida do Laya na bancada de voz (scripts/bancada-de-voz/decisores/laya.ts).

Não monta pergunta nenhuma: executa os pedidos (estado e perguntas) que o `laya.ts` manda, e que
são os mesmos que o Jev recebe (`filtro.ts`). Assim os dois respondem ao mesmo conjunto, com as
mesmas perguntas. Lê um JSON na entrada e devolve um JSON na saída:
  entrada {"pedidos": [{"estado": "...", "perguntas": {...}}], "aquecimento": 3, "concorrencias": [1, 3]}
  saída   {"versao", "modelo", "carregamento_s", "memoria_mb",
           "por_concorrencia": {"1": {"nucleos_ocupados", "resultados": [{"i", "ms", "respostas" | "erro"}]}}}

Com N chamadas simultâneas, cada uma das N linhas executa todos os pedidos, como no Jev.

Laya: pacote `laya` (Apache 2.0) e o checkpoint `convaiinnovations/laya` (subpasta multilingual,
Apache 2.0), conferidos em huggingface.co e no PyPI em 14/11/2026.
"""
import json
import resource
import sys
import threading
import time
from importlib.metadata import version

from laya import Router


def cpu_s():
    uso = resource.getrusage(resource.RUSAGE_SELF)
    return uso.ru_utime + uso.ru_stime


def main():
    entrada = json.load(sys.stdin)
    pedidos = entrada["pedidos"]
    inicio = time.perf_counter()
    router = Router()
    router.predict("Agente: Em que posso ajudar?", {"x": {"type": "noul", "instructions": "teste"}}, model="multilingual")
    carregamento = time.perf_counter() - inicio
    # Aquece: os primeiros pedidos não contam.
    for pedido in pedidos[: entrada["aquecimento"]]:
        router.predict(pedido["estado"], pedido["perguntas"], model="multilingual")

    resultado = {}
    for concorrencia in entrada["concorrencias"]:
        resultados = []
        trava = threading.Lock()

        def trabalhar():
            for i, pedido in enumerate(pedidos):
                t = time.perf_counter()
                try:
                    saida = router.predict(pedido["estado"], pedido["perguntas"], model="multilingual")
                    registro = {"i": i, "respostas": saida.get("answers", {})}
                except Exception as erro:  # a falha conta, com o tipo do erro, e a medida segue
                    registro = {"i": i, "erro": type(erro).__name__}
                registro["ms"] = (time.perf_counter() - t) * 1000
                with trava:
                    resultados.append(registro)

        cpu0, parede0 = cpu_s(), time.perf_counter()
        linhas = [threading.Thread(target=trabalhar) for _ in range(concorrencia)]
        for linha in linhas:
            linha.start()
        for linha in linhas:
            linha.join()
        parede = time.perf_counter() - parede0
        resultado[str(concorrencia)] = {"nucleos_ocupados": (cpu_s() - cpu0) / parede, "resultados": resultados}

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
