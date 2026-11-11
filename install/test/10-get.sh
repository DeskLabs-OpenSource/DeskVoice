#!/usr/bin/env bash
# get.sh: o comando de uma linha. Baixa, reaproveita o que já existe e não deixa a entrada do
# `curl | bash` virar resposta das perguntas do instalador.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
set +e
# Este arquivo usa o git de verdade (clona um repositório local de mentira), sem rede.
REAL_PATH="${PATH#"$TEST_DIR/fake:"}"
real_git="$(PATH="$REAL_PATH" command -v git || true)"
if [ -z "$real_git" ]; then echo "  10-get.sh: PULADO (não há git nesta máquina)"; finish; fi

origin="$SANDBOX/origin"; mkdir -p "$origin/install"
cat > "$origin/install/install.sh" <<'STUB'
#!/usr/bin/env bash
echo "INSTALADOR args=[$*]"
if [ -t 0 ]; then echo "entrada=terminal"; else echo "entrada=$(cat | wc -c | tr -d ' ') bytes"; fi
STUB
( cd "$origin" && "$real_git" init -q -b main && "$real_git" add . && "$real_git" -c user.email=t@example.com -c user.name=t commit -qm stub ) >/dev/null 2>&1
# Por cano, como `curl | bash`, e com sobra depois do script: o bash lê o cano em blocos, então só
# um download maior que um bloco deixa bytes na entrada para vazar ao instalador. A sobra são
# linhas de comentário, que é o que o bash veria se chegasse a lê-las.
stream() { cat "$KIT/get.sh"; awk 'BEGIN { for (i = 0; i < 6000; i++) print "# sobra do download que nao pode virar resposta do instalador" }'; }
# Quem escreve a sobra é interrompido quando ninguém mais lê: isso não é falha do get.sh.
get() { { stream 2>/dev/null || true; } | PATH="$REAL_PATH" DESKVOICE_REPO="$origin" DESKVOICE_REF=main DESKVOICE_DIR="$1" bash -s -- "${@:2}" 2>&1; }

# Como no README: o script chega pela entrada padrão. Sem perguntas (--yes), instala direto.
target="$SANDBOX/alvo"
out="$(get "$target" --yes --dry-run)"; equal "baixa e chama o instalador: sai com zero" 0 "$?"
check "clonou na pasta pedida" test -f "$target/install/install.sh"
contains "repassa os argumentos ao instalador" "$out" "INSTALADOR args=[--yes --dry-run]"
contains "o download não vaza para a entrada do instalador" "$out" "entrada=0 bytes"

# Rodar de novo aproveita o que já existe.
out="$(get "$target" --yes)"; equal "segunda vez: sai com zero" 0 "$?"
contains "segunda vez: diz que aproveitou" "$out" "vou aproveitar o que está lá"
contains "segunda vez: chama o instalador" "$out" "INSTALADOR args=[--yes]"

# Pasta que existe e não é um DeskVoice: não mexe nela.
mkdir -p "$SANDBOX/ocupada"; echo importante > "$SANDBOX/ocupada/arquivo.txt"
out="$(get "$SANDBOX/ocupada" --yes)"; equal "pasta alheia: sai com erro" 1 "$?"
contains "pasta alheia: diz o que fazer" "$out" "DESKVOICE_DIR="
equal "pasta alheia: conteúdo intacto" importante "$(cat "$SANDBOX/ocupada/arquivo.txt")"
lacks "pasta alheia: não chama o instalador" "$out" "INSTALADOR"

# Repositório que não existe: erro claro, sem deixar pasta pela metade.
out="$(cat "$KIT/get.sh" | PATH="$REAL_PATH" DESKVOICE_REPO="$SANDBOX/nao-existe" DESKVOICE_DIR="$SANDBOX/falhou" bash -s -- --yes 2>&1)"; equal "download falhou: sai com erro" 1 "$?"
contains "download falhou: diz o que fazer" "$out" "Confira a conexão"
refuse "download falhou: não deixa instalador pela metade" test -f "$SANDBOX/falhou/install/install.sh"

finish
