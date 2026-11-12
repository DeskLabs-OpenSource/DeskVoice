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

# Sem DESKVOICE_REF: o código fica na última versão publicada, e não na ponta da main.
( cd "$origin" && "$real_git" tag v0.1.0 && "$real_git" tag v0.2.0-rc.1 && echo novo > depois-da-versao && "$real_git" add . && "$real_git" -c user.email=t@example.com -c user.name=t commit -qm depois ) >/dev/null 2>&1
tagged="$SANDBOX/alvo-versao"
out="$({ stream 2>/dev/null || true; } | PATH="$REAL_PATH" DESKVOICE_REPO="$origin" DESKVOICE_DIR="$tagged" bash -s -- --yes 2>&1)"; equal "sem ramo pedido: sai com zero" 0 "$?"
contains "sem ramo pedido: diz a versão baixada" "$out" "Versão baixada: 0.1.0"
check "sem ramo pedido: o código é o da versão, não o da ponta da main" test ! -e "$tagged/depois-da-versao"
onmain="$SANDBOX/alvo-main"
out="$(get "$onmain" --yes)"; check "com ramo pedido: fica na ponta do ramo" test -e "$onmain/depois-da-versao"

# Sem git, num sistema com dnf e sem apt-get (AlmaLinux, Rocky): instala o git pelo dnf.
# Um PATH só com o que o get.sh usa; o dnf de mentira "instala" um git que chama o de verdade.
nogit="$SANDBOX/sem-git"; mkdir -p "$nogit"
for tool in bash env id cat wc tr grep head; do ln -s "$(PATH="$REAL_PATH" command -v "$tool")" "$nogit/$tool"; done
cp "$TEST_DIR/fake/sudo" "$nogit/sudo"
cat > "$nogit/dnf" <<DNF
#!$(PATH="$REAL_PATH" command -v bash)
echo "dnf \$*" >> "$FAKE_DIR/calls.log"
printf '#!/bin/sh\nPATH="%s" exec "%s" "\$@"\n' "$REAL_PATH" "$real_git" > "$nogit/git"; $(PATH="$REAL_PATH" command -v chmod) +x "$nogit/git"
DNF
chmod +x "$nogit/dnf"
: > "$FAKE_DIR/calls.log"
out="$({ stream 2>/dev/null || true; } | PATH="$nogit" DESKVOICE_REPO="$origin" DESKVOICE_REF=main DESKVOICE_DIR="$SANDBOX/alvo-dnf" "$nogit/bash" -s -- --yes 2>&1)"
equal "sem git, com dnf: sai com zero" 0 "$?"
contains "sem git, com dnf: avisa que vai instalar o git" "$out" "O git não está instalado"
equal "sem git, com dnf: instala pelo dnf" 1 "$(grep -c '^dnf install -y -q git$' "$FAKE_DIR/calls.log")"
if [ "$(id -u)" != 0 ]; then equal "sem git, com dnf, sem ser root: pelo sudo" 1 "$(grep -c '^sudo dnf install -y -q git$' "$FAKE_DIR/calls.log")"; fi
check "sem git, com dnf: clona e chama o instalador" test -f "$SANDBOX/alvo-dnf/install/install.sh"
contains "sem git, com dnf: chama o instalador" "$out" "INSTALADOR args=[--yes]"
finish
