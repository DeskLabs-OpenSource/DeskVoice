"""
As dependências Python do Laya entram na imagem só pelo resumo (desenho R12, fatia 8a+). Rodam sem
rede e sem Docker:
  python3 -I -m unittest discover -s deploy/laya -p 'test_*.py'
(o `scripts/laya-servico.test.ts` roda isto dentro do `pnpm test`).

T1 lê os dois arquivos de requisitos e o Dockerfile. No Dockerfile, todo comando pip (`pip`, `pip3`,
`pip3.12`, `python -m pip`, `python3 -I -m pip`) conta: cada install precisa do resumo, só de roda e de
uma das duas listas; o `pip check` vem depois do último install; no RUN com pip, só `&&` liga
comandos (`||`, `;`, `|` e `&` deixariam o RUN sair com o código do último comando); e o
torch vem só do índice de CPU (`--index-url`, nunca `--extra-index-url`). T2 monta uma roda mínima e confere que o pip,
com as mesmas opções do Dockerfile, aceita o resumo certo e recusa o trocado.
"""
import base64
import hashlib
import os
import re
import shlex
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


PIP_EXE = re.compile(r"pip(?:3(?:\.\d+)?)?")
PIP_WORD = re.compile(r"pip(?![A-Za-z_])")
# O shlex entrega numa palavra só toda sequência dos caracteres `()<>;&|` (`||(`, `)&&(`, `||>`, `;<`,
# `>||`). Tirados os parênteses, a palavra é cortada da esquerda para a direita, sempre na peça mais
# longa: `&&`, `||`, `;`, `|` e `&` são separadores de comandos; `>&`, `<&`, `>|`, `>>`, `<<`, `<<-`,
# `<>`, `<` e `>` são redireção. Assim `||>` é `||` e `>`, e `>||` é `>|` e `|`. O Dockerfile não tem
# `SHELL`, então o RUN roda no `/bin/sh` (dash), que não conhece `&>`: lá `&>` é `&` (segundo plano)
# mais `>`, e `&>>` é `&` mais `>>`.
PUNCTUATION = re.compile(r"[()<>;&|]+")
PIECE = re.compile(r"&&|\|\||[<>]&|>\||>>|<<-?|<>|[<>;&|]")
SEPARATORS = {"&&", "||", ";", "|", "&"}


def separators(token):
    """Os separadores que a palavra carrega, na ordem; lista vazia se ela não é só pontuação ou se
    só tem redireção (e parênteses)."""
    if not PUNCTUATION.fullmatch(token):
        return []
    pieces = PIECE.findall(token.replace("(", "").replace(")", ""))
    return [piece for piece in pieces if piece in SEPARATORS]


REQUIREMENTS = {"requirements-torch.txt", "requirements.txt"}


def dockerfile_runs():
    """Cada RUN do Dockerfile como lista de comandos (cada um, a lista de palavras) e os operadores
    entre eles. As palavras saem do `shlex`, que respeita as aspas e separa `&&`, `||`, `;`, `|` e `&`
    (mesmo colados num parêntese ou numa redireção, como em `||(true)` e `||>/dev/null`)."""
    with open(os.path.join(HERE, "Dockerfile"), encoding="utf-8") as f:
        text = f.read()
    runs = []
    for line in logical_lines(text):
        keyword, _, body = line.partition(" ")
        if keyword.upper() != "RUN":
            continue
        lexer = shlex.shlex(body, posix=True, punctuation_chars=True)
        lexer.whitespace_split = True
        commands, operators, current = [], [], []
        for token in lexer:
            ops = separators(token)
            if ops:
                operators.extend(ops)
                commands.append(current)
                current = []
            else:
                current.append(token)
        commands.append(current)
        runs.append(([c for c in commands if c], operators))
    return text, runs


def pip_commands():
    """Os comandos pip dos RUN, na ordem do arquivo, como (subcomando, palavras, operadores do RUN).

    Reconhece `pip`, `pip3`, `pip3.12` (com ou sem caminho), `python -m pip`, `python3 -m pip`,
    `python -I -m pip` e `-mpip`. O subcomando é a primeira palavra depois do pip que não começa com
    `-`. Toda palavra `pip` do arquivo (fora dos comentários) tem de ser um desses comandos: o que
    não deu para ler (um `sh -c "pip3 install x"`, um heredoc) faz o teste falhar, e não passar."""
    text, runs = dockerfile_runs()
    found = []
    for commands, operators in runs:
        for words in commands:
            for i, word in enumerate(words):
                if PIP_EXE.fullmatch(word.rsplit("/", 1)[-1]) or word == "-mpip":
                    rest = [w for w in words[i + 1:] if not w.startswith("-")]
                    found.append((rest[0] if rest else None, words[i + 1:], operators))
                    break
    seen = len(PIP_WORD.findall("\n".join(logical_lines(text))))
    if seen != len(found):
        raise AssertionError(
            "o Dockerfile cita pip %d vez(es), mas só %d viraram comando lido: %r" % (seen, len(found), found)
        )
    return found


def option_value(words, name):
    """O valor de `--opção valor` ou `--opção=valor`; None se a opção não está lá."""
    for i, word in enumerate(words):
        if word == name and i + 1 < len(words):
            return words[i + 1]
        if word.startswith(name + "="):
            return word[len(name) + 1:]
    return None


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
        commands = pip_commands()
        installs = [words for sub, words, _ in commands if sub == "install"]
        for sub, words, operators in commands:
            self.assertIn(sub, ("install", "check"), "pip com subcomando inesperado: %r" % words)
            # O RUN sai com o código do último comando: `pip check || true`, `pip check; true`,
            # `pip check | cat` e `pip check & true` engolem a falha. Só `&&` para no primeiro erro.
            others = [op for op in operators if op != "&&"]
            self.assertEqual(others, [], "no RUN com pip, só && liga comandos: %r em %r" % (others, words))
        for words in installs:
            self.assertIn("--require-hashes", words, words)
            self.assertIn("--only-binary=:all:", words, words)
            self.assertIn(option_value(words, "-r"), REQUIREMENTS, "install sem -r de uma das duas listas: %r" % words)
        self.assertEqual(len(installs), 2, installs)
        torch, rest = installs
        self.assertEqual(option_value(torch, "-r"), "requirements-torch.txt", torch)
        self.assertIn("--no-deps", torch, torch)
        self.assertEqual(option_value(torch, "--index-url"), "https://download.pytorch.org/whl/cpu", torch)
        self.assertFalse(
            [w for w in torch if w.startswith("--extra-index-url")], "o torch vem só do índice de CPU: %r" % torch
        )
        self.assertEqual(option_value(rest, "-r"), "requirements.txt", rest)

    def test_dockerfile_pip_check_after_last_install(self):
        subs = [sub for sub, _, _ in pip_commands()]
        self.assertIn("install", subs)
        last_install = max(i for i, sub in enumerate(subs) if sub == "install")
        self.assertEqual(subs.count("check"), 1, "um pip check só, e ele tem de vir depois do último install: %r" % subs)
        self.assertGreater(subs.index("check"), last_install, "o pip check vem antes do último install: %r" % subs)


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
