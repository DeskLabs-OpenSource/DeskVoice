#!/usr/bin/env bash
# Expurgo de transcrição: tira o texto das conversas mais antigas que N dias e mantém a chamada, o
# horário e o registro de que houve transcrição.
#
#   bash install/expurgar-transcricoes.sh                       conta o que passaria de 90 dias (não apaga)
#   bash install/expurgar-transcricoes.sh --dias 30              mesma conta, com outro prazo
#   bash install/expurgar-transcricoes.sh --dias 30 --confirmar  expurga de verdade
#   bash install/expurgar-transcricoes.sh --organizacao <uuid>   só uma organização
#
# Não existe expurgo automático: rodar isto é decisão de quem responde pelos dados da instalação.
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"
require_install

dias=90
org=""
confirmar="nao"
while [ $# -gt 0 ]; do
  case "$1" in
    --dias) dias="${2:-}"; shift 2 ;;
    --organizacao) org="${2:-}"; shift 2 ;;
    --confirmar) confirmar="sim"; shift ;;
    -h|--help) sed -n '2,10p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "Não conheço a opção $1." "Use --dias <n>, --organizacao <uuid>, --confirmar, ou nenhuma opção." ;;
  esac
done

case "$dias" in
  ""|*[!0-9]*) die "O prazo precisa ser um número inteiro de dias." "Exemplo: --dias 90" ;;
esac
[ "$dias" -ge 1 ] || die "O prazo precisa ser de pelo menos 1 dia." "Zero dias expurgaria a conversa de agora, e não é isso que se quer."
if [ -n "$org" ]; then
  printf '%s' "$org" | grep -qE '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' \
    || die "A organização precisa ser um uuid." "Copie o id da tela de organizações."
fi

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
query="$repo/db/queries/expurgar-transcricoes.sql"
[ -f "$query" ] || die "Não achei $query." "Rode de dentro do repositório do DeskVoice."

conta() {  # $1 = sim|nao → imprime "alvo|expurgadas"
  dc exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -tA -F '|' -v ON_ERROR_STOP=1 \
    -v dias="$dias" -v org="$org" -v confirmar="$1" -f - < "$query"
}

if [ "$confirmar" = "nao" ]; then
  saida="$(conta nao)" || die "A consulta falhou." "Veja a mensagem acima. Nada foi apagado."
  alvo="${saida%%|*}"
  info "Prazo: ${dias} dia(s)$([ -n "$org" ] && printf ' · organização %s' "$org")."
  info "Transcrições de $alvo conversa(s) passariam do prazo."
  info "Nada foi apagado."
  dim "Para expurgar de verdade: bash install/expurgar-transcricoes.sh --dias $dias --confirmar"
  exit 0
fi

saida="$(conta sim)" || die "O expurgo falhou." "Veja a mensagem acima. O banco voltou atrás: nada foi apagado."
expurgadas="${saida##*|}"
restam="$(conta nao)" || die "O expurgo rodou, mas não consegui conferir." "Rode de novo sem --confirmar para ver o que restou."
restam="${restam%%|}"
if [ "$restam" = "0" ]; then
  ok "Expurgadas $expurgadas transcrição(ões) de conversas com mais de $dias dia(s)."
  ok "Conferido: não restou transcrição antiga."
else
  warn "Expurgadas $expurgadas. Ainda restam $restam: rode de novo, ou confira se outra sessão está gravando."
fi
