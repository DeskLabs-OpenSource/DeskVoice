# A imagem do Laya (desenho R12, fatia 8a): o modelo de decisão de pesos abertos, servido só na rede
# interna do Compose, no perfil `laya`. Construa de dentro de deploy/:
#   docker compose --profile laya build laya
# ou, à parte: docker build --target laya -t deskvoice-laya:local deploy/laya
#
# Tudo o que entra está fixado: a base por resumo (índice multiarquitetura, amd64 e arm64), as
# dependências Python pela versão exata e pelo resumo de cada roda (requirements-torch.txt e
# requirements.txt) e os pesos por revisão do Hugging Face e pelo resumo de cada arquivo
# (weights.sha256). O build é o único momento com rede: o contêiner
# não baixa nada ao subir.

# python:3.12.16-slim-bookworm, resumo do índice lido no Docker Hub em 18/11/2026.
FROM python:3.12.16-slim-bookworm@sha256:935c3c5b12357a7e10caa9c1e6ca5692344d97cf229832ef584be2cec9fc03df AS laya

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    HF_HOME=/opt/laya/hf

WORKDIR /opt/laya

# O torch de CPU (sem as bibliotecas de GPU, que dobrariam a imagem) vem do índice do PyTorch, num
# passo só dele e sem as dependências (elas estão no requirements.txt); o resto vem do PyPI, e o
# torch já instalado satisfaz o que o pede. Os dois só aceitam roda com o resumo da lista
# (`--require-hashes`) e nunca constroem do código-fonte (`--only-binary=:all:`): o build isolado
# baixaria setuptools e wheel sem resumo. O `pip check` para o build se faltar alguma dependência.
COPY requirements-torch.txt requirements.txt ./
RUN pip install --require-hashes --only-binary=:all: --no-deps --index-url https://download.pytorch.org/whl/cpu -r requirements-torch.txt \
 && pip install --require-hashes --only-binary=:all: -r requirements.txt \
 && pip check

# Os pesos: o checkpoint multilíngue de convaiinnovations/laya, na revisão em que a bancada mediu a
# rodada 3 (15/11/2026). As três revisões que o repositório teve entre 14 e 15/11 trazem os mesmos
# arquivos dessa subpasta (resumos conferidos em 18/11/2026). Arquivo que não bate com o resumo
# para o build. O cache fica com o usuário do processo (uid 10001, criado abaixo), na mesma camada,
# para o Hugging Face não avisar Permission denied ao subir, sem duplicar os pesos na imagem.
ENV LAYA_REVISION=e333cb7c823cd1787276228260f56d02fbf5180b
COPY weights.sha256 ./
RUN python -I -c "from huggingface_hub import snapshot_download; print(snapshot_download('convaiinnovations/laya', revision='${LAYA_REVISION}', allow_patterns=['multilingual/rl_agent_config.json', 'multilingual/model.safetensors', 'multilingual/tokenizer/*', 'multilingual/encoder/*']))" > /tmp/weights-dir \
 && cd "$(cat /tmp/weights-dir)" && sha256sum -c /opt/laya/weights.sha256 \
 && rm /tmp/weights-dir \
 && chown -R 10001 /opt/laya/hf

# Daqui em diante, nada sai: sem os pesos certos na imagem, o carregamento falha em vez de baixar.
ENV HF_HUB_OFFLINE=1 \
    TRANSFORMERS_OFFLINE=1 \
    HF_HUB_DISABLE_TELEMETRY=1

COPY server.py ./
RUN useradd --system --uid 10001 --home-dir /opt/laya --shell /usr/sbin/nologin laya \
 && python -I -m py_compile server.py
USER laya

EXPOSE 8000
CMD ["python", "-I", "-u", "/opt/laya/server.py"]
