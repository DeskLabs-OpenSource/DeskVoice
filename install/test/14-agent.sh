#!/usr/bin/env bash
# agent.sh: o agente de atualização. Anuncia a versão, lê UM sim ou não, roda o atualizador e
# devolve o resultado. Confere que é o dono da instalação, não se sobrepõe e não morre calado.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
fake_install
source "$KIT/_common.sh"; set +e; trap - ERR
D="$DESKVOICE_DEPLOY_DIR"; E="$D/.env"; A="$D/app.env"; S="$D/agent"
export DESKVOICE_HEALTH_TIMEOUT=0
printf 'agents=3\ncalls=120\nusers=1\n' > "$FAKE_DIR/counts_backup"; cp "$FAKE_DIR/counts_backup" "$FAKE_DIR/counts_restore"
token="$(env_get "$A" UPDATE_AGENT_TOKEN)"
agent() { bash "$KIT/agent.sh" "$@" 2>&1; }
fresh() { rm -f "$FAKE_DIR"/agent_call.* "$FAKE_DIR/agent_replies"; : > "$FAKE_DIR/calls.log"; }
said() { sed -n "${2}p" "$FAKE_DIR/agent_call.$1" 2>/dev/null; }   # said <chamada> <linha>
calls_made() { n=0; while [ -e "$FAKE_DIR/agent_call.$((n + 1))" ]; do n=$((n + 1)); done; echo "$n"; }
updates_run() { grep -c ' pg_dump ' "$FAKE_DIR/calls.log"; }
with_versions() { printf '%s\n' "$@" > "$FAKE_DIR/git_tags"; }

# ── O segredo é do instalador ──
check "o instalador gera o segredo do agente" test "${#token}" = 64
( source "$KIT/_common.sh"; write_env_files "https://voz.exemplo.com.br" 203.0.113.10 voz.exemplo.com.br 10000 10200 )
equal "rodar o instalador de novo não troca o segredo" "$token" "$(env_get "$A" UPDATE_AGENT_TOKEN)"
check "o segredo entra na lista do que nunca aparece em tela" test "$(printf 'x %s y\n' "$token" | mask_secrets)" = "x *** y"

# ── Passada sem pedido: anuncia a versão e não executa nada ──
fresh
out="$(agent)"; equal "sem pedido: sai com zero" 0 "$?"
equal "sem pedido: falou uma vez com o painel" 1 "$(calls_made)"
equal "manda o segredo pela entrada padrão" "$token" "$(said 1 1)"
equal "anuncia a versão instalada" 0.1.0 "$(said 1 2)"
equal "sem versão mais nova: não anuncia alvo" "" "$(said 1 3)"
equal "sem resultado a entregar" "" "$(said 1 4)"
check "guarda quando o painel ouviu pela última vez" test -s "$S/last-ok"
equal "sem pedido: não roda o atualizador" 0 "$(updates_run)"
lacks "o segredo nunca vai na linha de comando" "$(cat "$FAKE_DIR/calls.log")" "$token"
check "fala de dentro do contêiner do painel, não pela entrada pública" grep -q 'exec -T panel node -e .*' "$FAKE_DIR/calls.log"
contains "fala direto na porta do painel" "$(cat "$FAKE_DIR/calls.log")" "http://127.0.0.1:3000/api/v1/system/agent"
refuse "sem pedido e sem falha: nenhuma trava sobra" test -e "$S/lock"

# ── Só um sim executa: qualquer outra resposta é falha, e nada roda ──
for reply in 'update=maybe' 'run=rm -rf /' 'update=true; reboot' ''; do
  fresh; echo "$reply" > "$FAKE_DIR/agent_replies"; [ -n "$reply" ] || echo ' ' > "$FAKE_DIR/agent_replies"
  out="$(agent)"; equal "resposta '$reply': sai com erro" 1 "$?"
  equal "resposta '$reply': não roda o atualizador" 0 "$(updates_run)"
done
contains "resposta estranha: fica no registro" "$(cat "$S/agent.log")" "não é um sim nem um não"

# ── Não é o dono da instalação: nem anuncia a versão ──
fresh; rm -f "$S/last-failure"; echo /outra/pasta/deploy > "$FAKE_DIR/project_dir"
out="$(agent)"; equal "outra pasta é a dona: sai com erro" 1 "$?"
equal "outra pasta é a dona: não fala com o painel" 0 "$(calls_made)"
contains "outra pasta é a dona: diz por quê" "$out" "foi instalado a partir de /outra/pasta/deploy"
contains "outra pasta é a dona: fica no registro que persiste" "$(cat "$S/agent.log")" "FALHA: o DeskVoice que roda nesta máquina foi instalado a partir de /outra/pasta/deploy"
rm "$FAKE_DIR/project_dir"
fresh; printf '%s\n' postgres asterisk voice routines caddy > "$FAKE_DIR/running"
out="$(agent)"; equal "painel parado: sai com erro" 1 "$?"
equal "painel parado: não fala com ninguém" 0 "$(calls_made)"
contains "painel parado: diz por quê" "$out" "o painel não está rodando"
printf '%s\n' postgres asterisk panel voice routines caddy > "$FAKE_DIR/running"
fresh; mv "$D/migrate.env" "$D/migrate.env.away"
out="$(agent)"; equal "pasta sem instalação: sai com erro" 1 "$?"
equal "pasta sem instalação: não fala com o painel" 0 "$(calls_made)"
mv "$D/migrate.env.away" "$D/migrate.env"

# ── A falha de comunicação vai ao painel na passada seguinte que der certo ──
fresh; echo '!error=o painel respondeu HTTP 401 unauthenticated' > "$FAKE_DIR/agent_replies"
out="$(agent)"; equal "painel recusou: sai com erro" 1 "$?"
contains "painel recusou: o motivo fica no registro" "$(cat "$S/agent.log")" "não consegui falar com o painel (o painel respondeu HTTP 401 unauthenticated)"
fresh
out="$(agent)"; equal "passada seguinte: zero" 0 "$?"
check "passada seguinte: conta quando falhou" test -n "$(said 1 6)"
contains "passada seguinte: conta o que falhou" "$(said 1 7)" "HTTP 401 unauthenticated"
fresh; agent >/dev/null
equal "falha entregue não é reenviada" "" "$(said 1 6)"

# ── Sim: roda o atualizador e devolve o resultado ──
with_versions v0.2.0 v0.1.0
fresh; echo 'update=true' > "$FAKE_DIR/agent_replies"
out="$(agent)"; equal "pedido aceito, atualização boa: zero" 0 "$?"
equal "atualizou para a versão publicada mais recente, que ele mesmo descobriu" 0.2.0 "$(env_get "$E" DESKVOICE_VERSION)"
equal "rodou o atualizador uma vez" 1 "$(updates_run)"
equal "falou duas vezes: o anúncio e o resultado" 2 "$(calls_made)"
equal "o painel não mandou versão: o anúncio só leva a instalada" 0.1.0 "$(said 1 2)"
equal "anuncia para qual versão iria, que ele mesmo descobriu" 0.2.0 "$(said 1 3)"
equal "depois de atualizar, não há mais alvo a anunciar" "" "$(said 2 3)"
equal "resultado: funcionou" succeeded "$(said 2 4)"
equal "resultado: para qual versão foi" 0.2.0 "$(said 2 5)"
contains "resultado: leva a saída do atualizador" "$(sed 1,7d "$FAKE_DIR/agent_call.2")" "Atualizado para 0.2.0"
refuse "resultado entregue não fica pendente" test -e "$S/pending-result"
refuse "a trava sai no fim" test -e "$S/lock"
contains "a atualização fica no registro" "$(cat "$S/agent.log")" "atualização terminou: succeeded (de 0.1.0 para 0.2.0"

fresh; echo 'update=true' > "$FAKE_DIR/agent_replies"
out="$(agent)"; equal "já na mais recente: zero" 0 "$?"
equal "já na mais recente: nada a fazer" nothing_to_do "$(said 2 4)"
equal "já na mais recente: não faz backup" 0 "$(updates_run)"

# ── Vai para a versão que anunciou, mesmo que outra seja publicada no meio do caminho ──
# O agente anuncia a 0.3.0 e a consulta fica valendo por 10 minutos. Antes de o pedido chegar,
# sai a 0.4.0 (o atualizador a enxergaria ao consultar). Quem pediu confirmou a 0.3.0.
with_versions v0.3.0 v0.2.0 v0.1.0
fresh; agent >/dev/null
equal "anuncia a 0.3.0" 0.3.0 "$(said 1 3)"
printf '%s\n' v0.4.0 v0.3.0 v0.2.0 v0.1.0 > "$FAKE_DIR/git_tags_after_fetch"
fresh; echo 'update=true' > "$FAKE_DIR/agent_replies"
out="$(agent)"; equal "versão nova publicada no meio: a passada termina" 0 "$?"
equal "no pedido, anuncia a mesma versão que a tela mostrou" 0.3.0 "$(said 1 3)"
equal "atualiza para a versão anunciada, não para a que acabou de sair" 0.3.0 "$(env_get "$E" DESKVOICE_VERSION)"
equal "o resultado diz para qual foi" 0.3.0 "$(said 2 5)"
rm -f "$S/last-fetch"; fresh; agent >/dev/null
equal "na consulta seguinte, passa a anunciar a mais nova" 0.4.0 "$(said 1 3)"
env_set "$E" DESKVOICE_VERSION 0.2.0; with_versions v0.3.0 v0.2.0 v0.1.0; rm -f "$S/last-fetch"
touch "$FAKE_DIR/git_fetch_fail"; fresh; agent >/dev/null
equal "sem rede para consultar: anuncia o que o clone já conhece" 0.3.0 "$(said 1 3)"
contains "sem rede para consultar: fica no registro" "$(cat "$S/agent.log")" "não consegui consultar as versões publicadas"
rm "$FAKE_DIR/git_fetch_fail"

# ── O painel que não responde não segura a passada ──
touch "$FAKE_DIR/agent_hang"; fresh; started=$SECONDS
out="$(DESKVOICE_AGENT_DEADLINE=2 bash "$KIT/agent.sh" 2>&1)"; equal "painel travado: sai com erro" 1 "$?"
check "painel travado: desiste no prazo, sem esperar o painel" test "$((SECONDS - started))" -lt 30
contains "painel travado: conta como falha de comunicação no registro" "$(cat "$S/agent.log")" "o painel não respondeu em 2s"
contains "painel travado: a falha vai ao painel depois" "$(sed -n 2p "$S/last-failure")" "não respondeu em 2s"
refuse "painel travado: a trava é liberada" test -e "$S/lock"
equal "painel travado: nada é executado" 0 "$(updates_run)"
rm "$FAKE_DIR/agent_hang"; fresh; agent >/dev/null

# ── Voltou: diz que voltou e por quê, sem segredo ──
with_versions v0.3.0 v0.2.0 v0.1.0
echo "denied: token=$token e a senha $(env_get "$E" POSTGRES_PASSWORD)" > "$FAKE_DIR/pull_fail"
fresh; echo 'update=true' > "$FAKE_DIR/agent_replies"
out="$(agent)"; equal "imagem não baixa: a passada termina" 0 "$?"
equal "imagem não baixa: a versão não muda" 0.2.0 "$(env_get "$E" DESKVOICE_VERSION)"
equal "imagem não baixa: não aplicada, sistema de pé" rolled_back "$(said 2 4)"
detail="$(sed 1,7d "$FAKE_DIR/agent_call.2")"
contains "imagem não baixa: diz por quê" "$detail" "Não consegui baixar as imagens da versão 0.3.0"
lacks "o resultado não leva o segredo do agente" "$detail" "$token"
lacks "o resultado não leva a senha do banco" "$detail" "$(env_get "$E" POSTGRES_PASSWORD)"
rm "$FAKE_DIR/pull_fail"

echo 1 > "$FAKE_DIR/migrate_exit"
fresh; echo 'update=true' > "$FAKE_DIR/agent_replies"
out="$(agent)"
equal "migration falhou e a volta respondeu: voltou" rolled_back "$(said 2 4)"
contains "migration falhou: diz que foi desfeita" "$(sed 1,7d "$FAKE_DIR/agent_call.2")" "foi desfeita"
echo 0 > "$FAKE_DIR/migrate_exit"

# A volta também não respondeu: é falha, e a tela não pode dizer "voltou".
echo 1 > "$FAKE_DIR/pg_isready_exit"
fresh; echo 'update=true' > "$FAKE_DIR/agent_replies"
out="$(agent)"
equal "a volta não respondeu: falhou" failed "$(said 2 4)"
contains "a volta não respondeu: diz onde estão os dados" "$(sed 1,7d "$FAKE_DIR/agent_call.2")" "Seus dados estão no backup"
echo 0 > "$FAKE_DIR/pg_isready_exit"

# ── O resultado que não foi entregue espera a passada seguinte ──
echo 1 > "$FAKE_DIR/migrate_exit"
fresh; printf '%s\n' 'update=true' '!error=o painel respondeu HTTP 502 ' > "$FAKE_DIR/agent_replies"
out="$(agent)"; equal "painel fora na hora do resultado: sai com erro" 1 "$?"
check "painel fora: o resultado fica guardado" test -f "$S/pending-result"
equal "painel fora: guardado com o desfecho" rolled_back "$(sed -n 1p "$S/pending-result")"
fresh
out="$(agent)"; equal "passada seguinte: entrega" 0 "$?"
equal "passada seguinte: leva o desfecho guardado" rolled_back "$(said 1 4)"
refuse "entregue: não fica pendente" test -e "$S/pending-result"
echo 0 > "$FAKE_DIR/migrate_exit"

# ── Não morre calado: interrompido no meio, ainda reporta ──
# Um kit igual a este, com um atualizador que derruba o agente no meio.
K="$SANDBOX/kit"; mkdir -p "$K"; cp "$KIT"/*.sh "$KIT"/*.env "$KIT"/deskvoice-agent.* "$K/"
# shellcheck disable=SC2016  # o $(cat ...) é do script gerado, não deste
killer() { printf '#!/usr/bin/env bash\necho "começando a atualizar"\nkill -%s "$(cat "%s/lock/pid")"\nsleep 1\n' "$1" "$S" > "$K/update.sh"; }
killer TERM
fresh; echo 'update=true' > "$FAKE_DIR/agent_replies"
out="$(bash "$K/agent.sh" 2>&1)"; equal "interrompido (TERM): sai com o código do sinal" 143 "$?"
equal "interrompido (TERM): mesmo assim fala de novo com o painel" 2 "$(calls_made)"
equal "interrompido (TERM): reporta falha" failed "$(said 2 4)"
contains "interrompido (TERM): diz que parou no meio" "$(sed 1,7d "$FAKE_DIR/agent_call.2")" "parou antes de terminar"
refuse "interrompido (TERM): a trava sai" test -e "$S/lock"

# Morto sem chance de reagir (ou a máquina reiniciou): quem reporta é a passada seguinte.
killer KILL
fresh; echo 'update=true' > "$FAKE_DIR/agent_replies"
bash -c 'bash "$1" >/dev/null 2>&1' _ "$K/agent.sh" 2>/dev/null   # o aviso "Killed" do bash fica fora da saída
equal "morto (KILL): só o anúncio foi feito" 1 "$(calls_made)"
check "morto (KILL): a trava ficou para trás" test -d "$S/lock"
fresh
out="$(agent)"; equal "passada seguinte ao KILL: assume a trava que sobrou e termina" 0 "$?"
equal "passada seguinte ao KILL: reporta falha" failed "$(said 1 4)"
contains "passada seguinte ao KILL: diz que parou no meio" "$(sed 1,7d "$FAKE_DIR/agent_call.1")" "parou antes de terminar"

# ── Duas passadas não se sobrepõem ──
fresh; mkdir -p "$S/lock"; echo $$ > "$S/lock/pid"   # este teste está vivo: a trava vale
out="$(agent)"; equal "outra passada em curso: sai sem fazer nada" 0 "$?"
equal "outra passada em curso: não fala com o painel" 0 "$(calls_made)"
check "outra passada em curso: não apaga a trava alheia" test -d "$S/lock"
rm -rf "$S/lock"

# ── O registro não cresce para sempre ──
head -c 600000 /dev/zero | tr '\0' 'x' > "$S/agent.log"
fresh; echo '!error=fora' > "$FAKE_DIR/agent_replies"; agent >/dev/null
check "registro grande vira agent.log.1" test -f "$S/agent.log.1"
check "registro novo começa pequeno" test "$(wc -c < "$S/agent.log")" -lt 1000
fresh; agent >/dev/null

# ── O agendamento ──
units="$DESKVOICE_SYSTEMD_DIR"
rm -f "$units"/deskvoice-agent.* "$FAKE_DIR/timer_enabled"; : > "$FAKE_DIR/calls.log"
out="$(agent --install --dry-run)"; equal "simulação do agendamento: zero" 0 "$?"
contains "simulação: diz o que faria" "$out" "faria: gravar $units/deskvoice-agent.service"
refuse "simulação: não grava nada" test -e "$units/deskvoice-agent.service"
equal "simulação: não chama o systemd" 0 "$(grep -c '^systemctl ' "$FAKE_DIR/calls.log")"

out="$(agent --install)"; equal "agendar: zero" 0 "$?"
unit="$(cat "$units/deskvoice-agent.service")"
contains "a unidade roda o agente desta pasta" "$unit" "ExecStart=/usr/bin/env bash $REPO/install/agent.sh"
contains "a unidade roda como o dono da pasta" "$unit" "User=$(owner_of "$REPO")"
# shellcheck disable=SC2016  # procura o texto literal
lacks "nenhuma variável do modelo sobra sem trocar" "$unit" '${'
contains "o timer passa a cada minuto" "$(cat "$units/deskvoice-agent.timer")" "OnCalendar=minutely"
contains "o timer tem um atraso aleatório pequeno" "$(cat "$units/deskvoice-agent.timer")" "RandomizedDelaySec=15s"
equal "liga o timer" 1 "$(grep -c '^systemctl enable --now deskvoice-agent.timer' "$FAKE_DIR/calls.log")"
equal "recarrega o systemd uma vez" 1 "$(grep -c '^systemctl daemon-reload' "$FAKE_DIR/calls.log")"
out="$(agent --install)"; equal "agendar de novo: zero" 0 "$?"
equal "agendar de novo: nada mudou, não recarrega" 1 "$(grep -c '^systemctl daemon-reload' "$FAKE_DIR/calls.log")"
equal "agendar de novo: não religa o que já está ligado" 1 "$(grep -c '^systemctl enable' "$FAKE_DIR/calls.log")"

# Sem permissão e sem sudo que não pergunte: avisa com o comando e segue.
rm -f "$units"/deskvoice-agent.*; chmod 555 "$units"; touch "$FAKE_DIR/sudo_fail"
out="$(agent --install)"; equal "sem permissão: não derruba quem chamou" 0 "$?"
contains "sem permissão: diz o comando" "$out" "sudo bash $KIT/agent.sh --install"
check "sem permissão: tentou o sudo sem pedir senha" grep -q '^sudo -n install ' "$FAKE_DIR/calls.log"
chmod 755 "$units"; rm "$FAKE_DIR/sudo_fail"

# A checagem de saúde diz se o agente está agendado e quando falou pela última vez.
health() { NO_COLOR=1 bash "$KIT/healthcheck.sh" 2>&1 | grep 'Agente de atualização'; }
agent --install >/dev/null; fresh; agent >/dev/null
line="$(health)"
contains "saúde: agendado e falando" "$line" "ok     Agente de atualização"
contains "saúde: diz quando falou pela última vez" "$line" "pela última vez em $(cat "$S/last-ok")"
touch -t 202001010000 "$S/last-ok"
contains "saúde: agendado mas calado é aviso, com desde quando" "$(health)" "aviso  Agente de atualização agendado (timer do systemd), mas não fala com o painel desde"
rm -f "$units"/deskvoice-agent.*
contains "saúde: não agendado é aviso, com o comando" "$(health)" "sudo bash install/agent.sh --install"
NO_COLOR=1 bash "$KIT/healthcheck.sh" >/dev/null 2>&1; equal "saúde: agente fora não vira falha" 0 "$?"
check "saúde: a linha do agente não entra nas peças essenciais" test -z "$(NO_COLOR=1 bash "$KIT/healthcheck.sh" --essential 2>&1 | grep 'Agente')"

# Máquina sem systemd: uma linha no cron. Sem nenhum dos dois: avisa.
rmdir "$DESKVOICE_SYSTEMD_RUN_DIR"; mkdir -p "$DESKVOICE_CRON_DIR"
out="$(agent --install)"; equal "sem systemd: zero" 0 "$?"
cron="$(cat "$DESKVOICE_CRON_DIR/deskvoice-agent")"
contains "sem systemd: a linha do cron roda o agente a cada minuto" "$cron" "* * * * * $(owner_of "$REPO") bash $KIT/agent.sh --jitter"
refuse "sem systemd: não grava unidade" test -e "$units/deskvoice-agent.service"
rm -rf "$DESKVOICE_CRON_DIR"
out="$(agent --install)"; equal "sem systemd nem cron: zero" 0 "$?"
contains "sem systemd nem cron: avisa que a tela vai mostrar agente não instalado" "$out" "agente não instalado"
refuse "opção desconhecida é recusada" bash "$KIT/agent.sh" --run 'rm -rf /'
finish
