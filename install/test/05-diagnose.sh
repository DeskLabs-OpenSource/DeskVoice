#!/usr/bin/env bash
# diagnose.sh: o arquivo para pedir ajuda não pode carregar segredo nenhum.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
fake_install
source "$KIT/_common.sh"; set +e; trap - ERR
D="$DESKVOICE_DEPLOY_DIR"

pg="$(env_get "$D/.env" POSTGRES_PASSWORD)"; app="$(env_get "$D/migrate.env" APP_DB_PASSWORD)"; sys="$(env_get "$D/migrate.env" SYSTEM_DB_PASSWORD)"
key="$(env_get "$D/app.env" DESKVOICE_SECRET_KEY)"; token="$(env_get "$D/app.env" INTERNAL_TOKEN)"; ari="$(env_get "$D/app.env" ARI_PASSWORD)"
# Logs com todo tipo de vazamento que um contêiner pode cuspir.
cat > "$FAKE_DIR/logs" <<LOG
panel-1 | conectando em postgres://deskvoice_app:${app}@postgres:5432/deskvoice
panel-1 | sistema postgres://deskvoice_system:${sys}@postgres:5432/deskvoice
migrate-1 | dono postgres://deskvoice:${pg}@postgres:5432/deskvoice
voice-1 | ARI auth deskvoice:${ari} falhou; token interno ${token}
voice-1 | chave ${key} carregada
voice-1 | {"apiKey":"AIzaSyFAKE-chave-do-provedor-000","password":"senha-do-tronco-xyz"}
voice-1 | Authorization: Bearer abc.def.ghi-token-de-sessao
panel-1 | login de ana.exemplo@empresa.com.br; chamada de +5531999998888 para 3133334444
asterisk-1 | linha inofensiva que precisa continuar legível 2026-11-10 22:00:01
LOG
bash "$KIT/diagnose.sh" --out "$SANDBOX/diag.txt" >/dev/null 2>&1
equal "diagnóstico sai com zero" 0 "$?"
report="$(cat "$SANDBOX/diag.txt")"
for pair in "senha do dono do banco|$pg" "senha do papel da aplicação|$app" "senha do papel de sistema|$sys" "chave de segredos|$key" "token interno|$token" "senha da ARI|$ari" \
            "chave de IA em JSON|AIzaSyFAKE-chave-do-provedor-000" "senha de tronco em JSON|senha-do-tronco-xyz" "token de sessão|abc.def.ghi-token-de-sessao" \
            "e-mail completo|ana.exemplo@empresa.com.br" "telefone completo|+5531999998888" "telefone sem mais|3133334444"; do
  lacks "não vaza: ${pair%%|*}" "$report" "${pair#*|}"
done
contains "mantém o que não é segredo" "$report" "linha inofensiva que precisa continuar legível 2026-11-10 22:00:01"
contains "mantém o domínio do e-mail para dar contexto" "$report" "***@empresa.com.br"
equal "mascara e-mail de verdade" "de ***@empresa.com" "$(printf 'de ana@empresa.com\n' | mask_secrets)"
equal "mascara e-mail com subdomínio" "de ***@mail.empresa.com.br" "$(printf 'de ana.lima@mail.empresa.com.br\n' | mask_secrets)"
equal "mascara a@b.com.br" "***@b.com.br" "$(printf 'a@b.com.br\n' | mask_secrets)"
equal "deixa intacto pacote@1.2.3" "> pacote@1.2.3 migrate" "$(printf '> pacote@1.2.3 migrate\n' | mask_secrets)"
equal "deixa intacto o nome do pacote na saída do pnpm" "> @deskvoice/routines@0.0.0 migrate" "$(printf '> @deskvoice/routines@0.0.0 migrate\n' | mask_secrets)"
contains "lista os três arquivos de ambiente" "$report" "--- migrate.env"
contains "mostra valor que não é segredo" "$report" "PANEL_DOMAIN=voz.exemplo.com.br"
contains "mostra o nome da variável secreta sem o valor" "$report" "POSTGRES_PASSWORD=***"
contains "inclui a saúde, peça por peça" "$report" "Linha telefônica"
contains "inclui o teste de portas" "$report" "UDP em escuta"
equal "arquivo do diagnóstico só o dono lê" 600 "$(mode_of "$SANDBOX/diag.txt")"

# Instalação pela metade: ainda assim gera o arquivo, dizendo o que faltou.
rm -f "$D/.env" "$D/app.env" "$D/migrate.env"
bash "$KIT/diagnose.sh" --out "$SANDBOX/diag2.txt" >/dev/null 2>&1
equal "sem instalação ainda gera diagnóstico" 0 "$?"
contains "diz que a instalação não subiu" "$(cat "$SANDBOX/diag2.txt")" "a instalação não chegou a subir"
finish
