"""
O serviço do Laya no DeskVoice (desenho R12, fatia 8a): um servidor HTTP mínimo, com as três
primitivas (`noul`, `choice`, `score`) e nada mais.

Rotas:
  GET  /health      200 quando o modelo está carregado (503 antes), com a revisão dos pesos, a
                    versão do pacote, o tempo de CPU do processo e a memória máxima. A bancada usa
                    os dois últimos para dizer quantos núcleos e quanta memória a medida ocupou.
  POST /v1/decide   {"state": "...", "questions": {"<id>": {"type", "instructions", "criteria"?}}}
                    → {"model": "...", "answers": {"<id>": {...}}}, no formato de resposta do Jev.

Sem rede para fora: os pesos estão na imagem, conferidos pelo resumo de `weights.sha256` no build e
de novo aqui, antes de o modelo ser lido. `HF_HUB_OFFLINE=1` (no Dockerfile) faz o carregamento
falhar em vez de baixar, se algo faltar.

O texto de quem ligou chega no `state` e não vai para log nenhum: o log tem só a rota, o status e
a duração.

Configuração (variáveis de ambiente):
  LAYA_PORT            porta, padrão 8000
  LAYA_THREADS         linhas de cálculo do torch; o Compose passa o teto de CPU do serviço
  LAYA_MAX_CONCURRENT  pedidos calculando ao mesmo tempo, padrão 4; o que passar espera até 1 s
                       por vaga e então recebe 503 (quem chama tem prazo de 1 s e não espera)
  LAYA_REVISION        a revisão fixa do Hugging Face (no Dockerfile)
"""
import json
import math
import os
import resource
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from importlib.metadata import version

HERE = os.path.dirname(os.path.abspath(__file__))
MODEL = "multilingual"
REPO = "convaiinnovations/laya"
MAX_BODY_BYTES = 64 * 1024
MAX_STATE_CHARS = 16 * 1024
MAX_QUESTIONS = 16
MAX_OPTIONS = 255
KINDS = ("noul", "choice", "score")


class Invalid(ValueError):
    """Pedido fora da forma: 400, com o motivo em palavras fixas (nunca o texto recebido)."""


def read_digests(path):
    """O `weights.sha256` (formato do `sha256sum`) como o mapa que o Laya confere antes de ler."""
    digests = {}
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            digest, name = line.split(None, 1)
            prefix = MODEL + "/"
            if not name.startswith(prefix):
                raise ValueError("weights.sha256: arquivo fora de %s/: %s" % (MODEL, name))
            digests[name[len(prefix):]] = digest
    return digests


def threads_from(value):
    """`cpus` aceita fração (1.5); o torch quer um inteiro. Arredonda para baixo, no mínimo 1."""
    try:
        return max(1, int(math.floor(float(value))))
    except (TypeError, ValueError):
        return None


def validate(body):
    """Confere a forma do pedido e devolve (state, questions). Só as três primitivas passam."""
    if not isinstance(body, dict):
        raise Invalid("body must be an object")
    state = body.get("state")
    questions = body.get("questions")
    if not isinstance(state, str) or not state:
        raise Invalid("state must be a non-empty string")
    if len(state) > MAX_STATE_CHARS:
        raise Invalid("state is too long")
    if not isinstance(questions, dict) or not questions:
        raise Invalid("questions must be a non-empty object")
    if len(questions) > MAX_QUESTIONS:
        raise Invalid("too many questions")
    clean = {}
    for qid, q in questions.items():
        if not isinstance(q, dict) or q.get("type") not in KINDS:
            raise Invalid("each question needs a type: noul, choice or score")
        if not isinstance(q.get("instructions"), str) or not q["instructions"]:
            raise Invalid("each question needs instructions")
        out = {"type": q["type"], "instructions": q["instructions"]}
        criteria = q.get("criteria")
        if q["type"] == "choice":
            if not isinstance(criteria, dict) or not criteria or len(criteria) > MAX_OPTIONS:
                raise Invalid("choice needs criteria with 1 to 255 options")
            out["criteria"] = criteria
        elif q["type"] == "score":
            if not isinstance(criteria, list) or not 2 <= len(criteria) <= 10:
                raise Invalid("score needs criteria with 2 to 10 levels")
            out["criteria"] = criteria
        elif criteria is not None:
            if not isinstance(criteria, dict) or set(criteria) != {"true", "false"}:
                raise Invalid("noul criteria must have true and false")
            out["criteria"] = criteria
        clean[qid] = out
    return state, clean


def number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def project(answer, kind):
    """A resposta no formato do Jev, sem os campos a mais do Laya. Fora da forma: None."""
    if not isinstance(answer, dict) or answer.get("type") != kind:
        return None
    if kind == "noul":
        return {"type": "noul", "noul": answer["noul"]} if number(answer.get("noul")) else None
    out = {"type": kind}
    if kind == "choice":
        if not isinstance(answer.get("choice"), str):
            return None
        out["choice"] = answer["choice"]
    else:
        if not number(answer.get("score")):
            return None
        out["score"] = answer["score"]
    if number(answer.get("confidence")):
        out["confidence"] = answer["confidence"]
    probabilities = answer.get("probabilities")
    if isinstance(probabilities, dict):
        out["probabilities"] = {str(k): v for k, v in probabilities.items() if number(v)}
    return out


class Laya:
    """O modelo carregado, uma vez, e a vaga de cálculo."""

    def __init__(self, predict, revision, package, max_concurrent):
        self.predict = predict
        self.revision = revision
        self.package = package
        self.slots = threading.BoundedSemaphore(max_concurrent)

    def decide(self, state, questions):
        if not self.slots.acquire(timeout=1.0):
            return None
        try:
            raw = self.predict(state, questions)
        finally:
            self.slots.release()
        answers = {}
        given = raw.get("answers", {}) if isinstance(raw, dict) else {}
        for qid, q in questions.items():
            answer = project(given.get(qid), q["type"])
            if answer is None:
                raise RuntimeError("answer out of shape")
            answers[qid] = answer
        return {"model": "%s/%s@%s" % (REPO, MODEL, self.revision), "answers": answers}


def cpu_seconds():
    usage = resource.getrusage(resource.RUSAGE_SELF)
    return usage.ru_utime + usage.ru_stime


def make_handler(holder):
    class Handler(BaseHTTPRequestHandler):
        server_version = "deskvoice-laya"
        sys_version = ""

        def log_message(self, fmt, *args):  # o padrão escreveria a linha do pedido; aqui só o resumo
            return

        def reply(self, status, payload):
            data = json.dumps(payload).encode()
            self.send_response(status)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            if self.path != "/health":
                return self.reply(404, {"error": "not_found"})
            laya = holder.get("laya")
            if laya is None:
                return self.reply(503, {"ok": False, "error": holder.get("error", "loading")})
            return self.reply(200, {
                "ok": True,
                "model": "%s/%s" % (REPO, MODEL),
                "revision": laya.revision,
                "package": laya.package,
                "cpu_s": cpu_seconds(),
                "max_rss_mb": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024,
            })

        def do_POST(self):
            started = time.perf_counter()
            status = self.handle_decide()
            sys.stderr.write("POST /v1/decide %d %.0fms\n" % (status, (time.perf_counter() - started) * 1000))

        def handle_decide(self):
            if self.path != "/v1/decide":
                self.reply(404, {"error": "not_found"})
                return 404
            laya = holder.get("laya")
            if laya is None:
                self.reply(503, {"error": "loading"})
                return 503
            try:
                length = int(self.headers.get("content-length") or "0")
            except ValueError:
                length = -1
            if length <= 0 or length > MAX_BODY_BYTES:
                self.reply(413 if length > MAX_BODY_BYTES else 400, {"error": "bad_length"})
                return 413 if length > MAX_BODY_BYTES else 400
            try:
                state, questions = validate(json.loads(self.rfile.read(length)))
            except (Invalid, ValueError) as error:
                message = str(error) if isinstance(error, Invalid) else "body is not JSON"
                self.reply(400, {"error": "invalid_request", "message": message})
                return 400
            try:
                result = laya.decide(state, questions)
            except Exception as error:  # a falha diz o tipo, nunca o texto (que pode citar o state)
                self.reply(500, {"error": "inference_failed", "type": type(error).__name__})
                return 500
            if result is None:
                self.reply(503, {"error": "busy"})
                return 503
            self.reply(200, result)
            return 200

    return Handler


def load(holder):
    """Carrega o modelo fora da linha do servidor: o /health responde 503 até terminar."""
    try:
        import torch
        from laya import Router

        threads = threads_from(os.environ.get("LAYA_THREADS"))
        if threads:
            torch.set_num_threads(threads)
        revision = os.environ.get("LAYA_REVISION", "").strip()
        if not revision:
            raise RuntimeError("LAYA_REVISION is not set")
        digests = read_digests(os.path.join(HERE, "weights.sha256"))
        router = Router(revision=revision, sha256_digests={MODEL: digests}, max_loaded=1, default=MODEL, vega=False)
        predict = lambda state, questions: router.predict(state, questions, model=MODEL)  # noqa: E731
        predict("Agente: Em que posso ajudar?", {"x": {"type": "noul", "instructions": "warm up"}})
        max_concurrent = int(os.environ.get("LAYA_MAX_CONCURRENT", "4"))
        holder["laya"] = Laya(predict, revision, version("laya"), max(1, max_concurrent))
        sys.stderr.write("laya: pronto (%s/%s@%s)\n" % (REPO, MODEL, revision))
    except Exception as error:
        holder["error"] = type(error).__name__
        sys.stderr.write("laya: o modelo não carregou: %s: %s\n" % (type(error).__name__, error))
        os._exit(1)


def main():
    holder = {}
    port = int(os.environ.get("LAYA_PORT", "8000"))
    server = ThreadingHTTPServer(("0.0.0.0", port), make_handler(holder))
    server.daemon_threads = True
    threading.Thread(target=load, args=(holder,), daemon=True).start()
    sys.stderr.write("laya: escutando em :%d\n" % port)
    server.serve_forever()


if __name__ == "__main__":
    main()
