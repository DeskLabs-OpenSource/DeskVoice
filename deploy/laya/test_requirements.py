"""
As dependências Python do Laya entram na imagem só pelo resumo (desenho R12, fatia 8a+). Rodam sem
rede e sem Docker:
  python3 -I -m unittest discover -s deploy/laya -p 'test_*.py'
(o `scripts/laya-servico.test.ts` roda isto dentro do `pnpm test`).

T1 lê os dois arquivos de requisitos e o Dockerfile. T2 monta uma roda mínima e confere que o pip,
com as mesmas opções do Dockerfile, aceita o resumo certo e recusa o trocado.
"""
import base64
import hashlib
import os
import re
import subprocess
import sys
import tempfile
import unittest
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
HASH = re.compile(r"--hash=sha256:[0-9a-f]{64}")
SPEC = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]*==[A-Za-z0-9.+!_-]+")


def logical_lines(text):
    """As linhas como o pip as lê: sem comentário e com a continuação (`\\` no fim) juntada."""
    joined = re.sub(r"\\\n", " ", text)
    lines = []
    for line in joined.splitlines():
        line = re.sub(r"(^|\s)#.*$", "", line).strip()
        if line:
            lines.append(line)
    return lines


def requirements(name):
    """Cada requisito como (nome, versão, [resumos]); falha em qualquer pedaço que não seja isso."""
    with open(os.path.join(HERE, name), encoding="utf-8") as f:
        text = f.read()
    out = []
    for line in logical_lines(text):
        spec, *rest = line.split()
        if not SPEC.fullmatch(spec):
            raise AssertionError("%s: requisito sem versão exata (==): %r" % (name, line))
        bad = [token for token in rest if not HASH.fullmatch(token)]
        if bad:
            raise AssertionError("%s: %s tem algo que não é --hash=sha256:<64 hex>: %r" % (name, spec, bad))
        if not rest:
            raise AssertionError("%s: %s está sem --hash" % (name, spec))
        package, version = spec.split("==")
        out.append((package.lower().replace("_", "-"), version, rest))
    return out


def pip_installs():
    """Os comandos `pip install` dos RUN do Dockerfile, um por item."""
    with open(os.path.join(HERE, "Dockerfile"), encoding="utf-8") as f:
        text = f.read()
    commands = re.split(r"&&|;|\n", "\n".join(logical_lines(text)))
    return [c.strip() for c in commands if re.search(r"\bpip\s+install\b", c)], [c.strip() for c in commands if re.search(r"\bpip\s+check\b", c)]


class T1Static(unittest.TestCase):
    def test_requirements_have_exact_version_and_hash(self):
        reqs = requirements("requirements.txt")
        self.assertGreater(len(reqs), 1)
        self.assertNotIn("torch", [package for package, _, _ in reqs])

    def test_torch_file_has_only_torch_with_two_hashes(self):
        reqs = requirements("requirements-torch.txt")
        self.assertEqual([package for package, _, _ in reqs], ["torch"])
        _, version, hashes = reqs[0]
        self.assertTrue(version.endswith("+cpu"), version)
        self.assertGreaterEqual(len(set(hashes)), 2, "x86_64 e aarch64: pelo menos dois resumos")

    def test_dockerfile_installs_only_by_hash(self):
        installs, checks = pip_installs()
        self.assertEqual(len(installs), 2, installs)
        for command in installs:
            self.assertIn("--require-hashes", command.split(), command)
            self.assertIn("--only-binary=:all:", command.split(), command)
        torch, rest = installs
        self.assertIn("requirements-torch.txt", torch)
        self.assertIn("--no-deps", torch.split(), torch)
        self.assertIn("https://download.pytorch.org/whl/cpu", torch)
        self.assertIn("requirements.txt", rest.split())
        self.assertEqual(len(checks), 1, "falta o pip check depois dos dois pip install")


def make_wheel(folder):
    """Uma roda mínima, à mão (METADATA, WHEEL, RECORD), e o resumo dela."""
    name, version = "deskvoice_hashprobe", "1.0"
    dist = "%s-%s.dist-info" % (name, version)
    files = {
        "%s.py" % name: b"VALUE = 1\n",
        dist + "/METADATA": b"Metadata-Version: 2.1\nName: deskvoice-hashprobe\nVersion: 1.0\n",
        dist + "/WHEEL": b"Wheel-Version: 1.0\nGenerator: deskvoice-test\nRoot-Is-Purelib: true\nTag: py3-none-any\n",
    }
    record = ""
    for path, data in files.items():
        digest = base64.urlsafe_b64encode(hashlib.sha256(data).digest()).rstrip(b"=").decode()
        record += "%s,sha256=%s,%d\n" % (path, digest, len(data))
    record += dist + "/RECORD,,\n"
    files[dist + "/RECORD"] = record.encode()
    path = os.path.join(folder, "%s-%s-py3-none-any.whl" % (name, version))
    with zipfile.ZipFile(path, "w") as z:
        for member, data in files.items():
            z.writestr(member, data)
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


class T2WrongHashFails(unittest.TestCase):
    def setUp(self):
        probe = subprocess.run([sys.executable, "-I", "-m", "pip", "--version"], capture_output=True, text=True)
        if probe.returncode != 0:
            self.fail("sem pip em %s, o T2 não tem como medir: %s" % (sys.executable, probe.stderr.strip()))

    def install(self, folder, digest):
        req = os.path.join(folder, "req.txt")
        with open(req, "w") as f:
            f.write("deskvoice-hashprobe==1.0 --hash=sha256:%s\n" % digest)
        target = tempfile.mkdtemp(dir=folder)
        env = dict(os.environ, PIP_NO_CACHE_DIR="1", PIP_DISABLE_PIP_VERSION_CHECK="1", PIP_CONFIG_FILE=os.devnull)
        return subprocess.run(
            [sys.executable, "-I", "-m", "pip", "install", "--require-hashes", "--only-binary=:all:", "--no-deps",
             "--no-index", "--find-links", folder, "--target", target, "-r", req],
            capture_output=True, text=True, env=env, timeout=120,
        )

    def test_right_hash_installs_and_wrong_hash_stops(self):
        with tempfile.TemporaryDirectory() as folder:
            digest = make_wheel(folder)
            ok = self.install(folder, digest)
            self.assertEqual(ok.returncode, 0, ok.stdout + ok.stderr)
            wrong = digest[:-1] + ("0" if digest[-1] != "0" else "1")
            bad = self.install(folder, wrong)
            self.assertNotEqual(bad.returncode, 0, bad.stdout + bad.stderr)
            self.assertIn("DO NOT MATCH THE HASHES", bad.stderr)
            self.assertIn(wrong, bad.stderr)
            self.assertIn(digest, bad.stderr)


if __name__ == "__main__":
    unittest.main()
