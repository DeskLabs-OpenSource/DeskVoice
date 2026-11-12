#!/usr/bin/env bash
# Postgres 17 descartável para os testes de banco.
#   scripts/test-db.sh up    sobe o contêiner em porta livre e imprime a URL do dono
#   scripts/test-db.sh down  remove o contêiner
# DESKVOICE_TEST_DB_CONTAINER troca o nome do contêiner (execuções paralelas não colidem).
set -euo pipefail

name="${DESKVOICE_TEST_DB_CONTAINER:-deskvoice-test-db}"

case "${1:-}" in
  up)
    docker rm -f "$name" >/dev/null 2>&1 || true
    # Porta do host vazia: o Docker escolhe uma livre. tmpfs: nada sobrevive ao contêiner.
    docker run -d --name "$name" \
      -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=deskvoice_test \
      -p 127.0.0.1::5432 --tmpfs /var/lib/postgresql/data \
      postgres:17.11-alpine@sha256:e5d2edd28b1f8d40a0a6c0c9cdc545b19b56a0d5d88f94bc11a97d970d4700d0 >/dev/null
    # Por TCP de propósito: durante a inicialização a imagem sobe um servidor provisório que
    # só escuta no socket local, e ele não conta como pronto.
    for _ in $(seq 1 120); do
      if docker exec "$name" pg_isready -q -h 127.0.0.1 -U postgres -d deskvoice_test 2>/dev/null; then
        port="$(docker port "$name" 5432/tcp | head -n 1 | sed 's/.*://')"
        echo "postgres://postgres:postgres@127.0.0.1:${port}/deskvoice_test"
        exit 0
      fi
      sleep 0.5
    done
    echo "test-db: Postgres did not become ready in 60s" >&2
    docker logs "$name" >&2 || true
    docker rm -f "$name" >/dev/null 2>&1 || true
    exit 1
    ;;
  down)
    docker rm -f "$name" >/dev/null 2>&1 || true
    ;;
  *)
    echo "usage: $0 up|down" >&2
    exit 2
    ;;
esac
