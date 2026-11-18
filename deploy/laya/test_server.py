"""
Testes do servidor do Laya sem o modelo: o `predict` é trocado por um falso, e o servidor HTTP é o
de verdade, numa porta livre. Rodam sem torch, sem Docker e sem rede:
  python3 -I -m unittest discover -s deploy/laya -p 'test_*.py'
(o `scripts/laya-servico.test.ts` roda isto dentro do `pnpm test`).
"""
import json
import os
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import server  # noqa: E402

QUESTIONS = {
    "background": {"type": "noul", "instructions": "A fala é de quem está na ligação?"},
    "finished": {"type": "noul", "instructions": "Terminou?", "criteria": {"true": "terminou", "false": "pausou"}},
    "reading": {"type": "choice", "instructions": "Qual a leitura?", "criteria": {"Melgaço": "o nome", "none": "nenhum"}},
    "mood": {"type": "score", "instructions": "Quão irritada?", "criteria": ["calma", "neutra", "irritada"]},
}


def laya_like(state, questions):
    """Responde como o Laya responde, com os campos a mais que o servidor tira."""
    answers = {}
    for qid, q in questions.items():
        if q["type"] == "noul":
            answers[qid] = {"type": "noul", "noul": 0.9, "confidence": 0.8, "action": "answer"}
        elif q["type"] == "choice":
            answers[qid] = {"type": "choice", "choice": "Melgaço", "confidence": 0.4, "answer_confidence": 0.4, "probabilities": {"Melgaço": 0.7, "none": 0.3}}
        else:
            answers[qid] = {"type": "score", "score": 1.2, "confidence": 0.1, "probabilities": {"0": 0.2, "1": 0.4, "2": 0.4}}
    return {"answers": answers, "routing": {"model": "multilingual"}, "usage": {"input_tokens": 10}}


class Running:
    def __init__(self, holder):
        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.make_handler(holder))
        self.url = "http://127.0.0.1:%d" % self.httpd.server_address[1]
        threading.Thread(target=self.httpd.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True).start()

    def close(self):
        self.httpd.shutdown()
        self.httpd.server_close()

    def call(self, method, path, body=None, raw=None):
        data = raw if raw is not None else (None if body is None else json.dumps(body).encode())
        request = urllib.request.Request(self.url + path, data=data, method=method, headers={"content-type": "application/json"})
        try:
            with urllib.request.urlopen(request, timeout=5) as response:
                return response.status, json.loads(response.read())
        except urllib.error.HTTPError as error:
            return error.code, json.loads(error.read())


class ServerTest(unittest.TestCase):
    def setUp(self):
        self.seen = []

        def predict(state, questions):
            self.seen.append((state, questions))
            return laya_like(state, questions)

        self.holder = {"laya": server.Laya(predict, "e333cb7", "0.4.31", 2)}
        self.running = Running(self.holder)

    def tearDown(self):
        self.running.close()

    def test_answers_the_three_primitives_in_the_jev_shape_without_extras(self):
        status, body = self.running.call("POST", "/v1/decide", {"state": "Cliente: meu gasto", "questions": QUESTIONS})
        self.assertEqual(status, 200)
        self.assertEqual(body["model"], "convaiinnovations/laya/multilingual@e333cb7")
        self.assertEqual(body["answers"], {
            "background": {"type": "noul", "noul": 0.9},
            "finished": {"type": "noul", "noul": 0.9},
            "reading": {"type": "choice", "choice": "Melgaço", "confidence": 0.4, "probabilities": {"Melgaço": 0.7, "none": 0.3}},
            "mood": {"type": "score", "score": 1.2, "confidence": 0.1, "probabilities": {"0": 0.2, "1": 0.4, "2": 0.4}},
        })
        # O modelo recebe o estado como veio, e as perguntas só com os campos conhecidos.
        self.assertEqual(self.seen, [("Cliente: meu gasto", QUESTIONS)])

    def test_refuses_what_is_not_one_of_the_three_primitives(self):
        cases = [
            {"state": "x", "questions": {"a": {"type": "generate", "instructions": "y"}}},
            {"state": "", "questions": QUESTIONS},
            {"state": "x", "questions": {}},
            {"state": "x", "questions": {"a": {"type": "choice", "instructions": "y"}}},
            {"state": "x", "questions": {"a": {"type": "score", "instructions": "y", "criteria": ["só um"]}}},
            {"state": "x", "questions": {"a": {"type": "noul", "instructions": "y", "criteria": {"sim": "a"}}}},
            {"state": "x", "questions": {"a": {"type": "noul"}}},
            {"state": "x" * (server.MAX_STATE_CHARS + 1), "questions": QUESTIONS},
            ["not", "an", "object"],
        ]
        for body in cases:
            status, reply = self.running.call("POST", "/v1/decide", body)
            self.assertEqual((status, reply["error"]), (400, "invalid_request"), body if not isinstance(body, dict) else list(body))
        self.assertEqual(self.seen, [])

    def test_not_json_too_big_and_other_routes(self):
        self.assertEqual(self.running.call("POST", "/v1/decide", raw=b"not json")[0], 400)
        self.assertEqual(self.running.call("POST", "/v1/decide", raw=b"x" * (server.MAX_BODY_BYTES + 1))[0], 413)
        self.assertEqual(self.running.call("POST", "/v1/systemone", {"state": "x", "questions": QUESTIONS})[0], 404)
        self.assertEqual(self.running.call("GET", "/docs")[0], 404)
        self.assertEqual(self.seen, [])

    def test_the_error_never_carries_the_callers_text(self):
        def boom(state, questions):
            raise RuntimeError("falhou lendo: " + state)

        self.holder["laya"] = server.Laya(boom, "e333cb7", "0.4.31", 1)
        status, reply = self.running.call("POST", "/v1/decide", {"state": "segredo de quem ligou", "questions": QUESTIONS})
        self.assertEqual((status, reply), (500, {"error": "inference_failed", "type": "RuntimeError"}))

    def test_an_answer_out_of_shape_is_a_failure_not_a_guess(self):
        self.holder["laya"] = server.Laya(lambda s, q: {"answers": {"background": {"type": "choice", "choice": "x"}}}, "e333cb7", "0.4.31", 1)
        status, reply = self.running.call("POST", "/v1/decide", {"state": "x", "questions": {"background": QUESTIONS["background"]}})
        self.assertEqual((status, reply["error"]), (500, "inference_failed"))

    def test_health_is_503_until_the_model_loads_and_then_reports_revision_and_usage(self):
        holder = {}
        running = Running(holder)
        try:
            self.assertEqual(running.call("GET", "/health"), (503, {"ok": False, "error": "loading"}))
            self.assertEqual(running.call("POST", "/v1/decide", {"state": "x", "questions": QUESTIONS})[0], 503)
            holder["laya"] = server.Laya(laya_like, "e333cb7", "0.4.31", 1)
            status, body = running.call("GET", "/health")
            self.assertEqual(status, 200)
            self.assertEqual((body["ok"], body["revision"], body["package"]), (True, "e333cb7", "0.4.31"))
            self.assertGreaterEqual(body["cpu_s"], 0)
            self.assertGreater(body["max_rss_mb"], 0)
        finally:
            running.close()

    def test_busy_after_one_second_without_a_free_slot(self):
        release = threading.Event()
        entered = threading.Event()

        def slow(state, questions):
            entered.set()
            release.wait(5)
            return laya_like(state, questions)

        self.holder["laya"] = server.Laya(slow, "e333cb7", "0.4.31", 1)
        first = threading.Thread(target=lambda: self.running.call("POST", "/v1/decide", {"state": "x", "questions": QUESTIONS}))
        first.start()
        self.assertTrue(entered.wait(5))
        try:
            status, reply = self.running.call("POST", "/v1/decide", {"state": "y", "questions": QUESTIONS})
            self.assertEqual((status, reply), (503, {"error": "busy"}))
        finally:
            release.set()
            first.join()


class HelpersTest(unittest.TestCase):
    def test_threads_follow_the_cpu_ceiling_rounded_down(self):
        self.assertEqual([server.threads_from(v) for v in ("2", "1.5", "0.5", "3", "", None, "x")], [2, 1, 1, 3, None, None, None])

    def test_digests_are_read_from_the_sha256sum_file_relative_to_the_subfolder(self):
        here = os.path.dirname(os.path.abspath(__file__))
        digests = server.read_digests(os.path.join(here, "weights.sha256"))
        self.assertEqual(sorted(digests), ["encoder/config.json", "model.safetensors", "rl_agent_config.json", "tokenizer/tokenizer.json", "tokenizer/tokenizer_config.json"])
        self.assertTrue(all(len(d) == 64 for d in digests.values()))
        with tempfile.NamedTemporaryFile("w", suffix=".sha256", delete=False) as f:
            f.write("%s  english/model.safetensors\n" % ("0" * 64))
        try:
            with self.assertRaises(ValueError):
                server.read_digests(f.name)
        finally:
            os.unlink(f.name)


if __name__ == "__main__":
    unittest.main()
