#!/usr/bin/env bash
# Exporta o que a instalação guarda sobre um telefone: chamadas, eventos e a lista de não ligar.
#
#   bash install/exportar-dados.sh --telefone +5531999998888
#   bash install/exportar-dados.sh --telefone +5531999998888 --saida /root/ficha.ndjson
#   bash install/exportar-dados.sh --telefone +5531999998888 --organizacao <uuid>
#
# O arquivo sai com permissão 600 e tem dado pessoal: entregue e apague. Nada é alterado no banco.
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"
require_install

tel=""
org=""
saida=""
while [ $# -gt 0 ]; do
  case "$1" in
    --telefone) tel="${2:-}"; shift 2 ;;
    --saida) saida="${2:-}"; shift 2 ;;
    --organizacao) org="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,8p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "Não conheço a opção $1." "Use --telefone <+E.164>, --saida <arquivo>, --organizacao <uuid>, ou nenhuma opção." ;;
  esac
done

[ -n "$tel" ] || die "Faltou o telefone." "Use --telefone +5531999998888, em E.164 (com o + e o DDI)."
printf '%s' "$tel" | grep -qE '^\+[1-9][0-9]{7,14}$' \
  || die "O telefone precisa estar em E.164." "É o formato que o painel mostra: + e DDI, só dígitos. Exemplo: +5531999998888"
if [ -n "$org" ]; then
  printf '%s' "$org" | grep -qE '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' \
    || die "A organização precisa ser um uuid." "Copie o id da tela de organizações."
fi

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
query="$repo/db/queries/exportar-ficha.sql"
[ -f "$query" ] || die "Não achei $query." "Rode de dentro do repositório do DeskVoice."

if [ -z "$saida" ]; then
  saida="$(pwd)/ficha-$(printf '%s' "$tel" | tr -d '+')-$(date +%Y-%m-%d).ndjson"
fi
case "$saida" in /*) ;; *) saida="$(pwd)/$saida" ;; esac
[ -e "$saida" ] && die "O arquivo $saida já existe." "Escolha outro com --saida, ou apague o antigo: não sobrescrevo ficha de outra pessoa por engano."

tmp="$saida.parcial"
if ! dc exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -tA -v ON_ERROR_STOP=1 \
      -v tel="$tel" -v org="$org" -f - < "$query" > "$tmp"; then
  rm -f "$tmp"
  die "A consulta falhou." "Veja a mensagem acima. Nada foi exportado."
fi

total="$(wc -l < "$tmp" | tr -d ' ')"
if [ "$total" = "0" ]; then
  rm -f "$tmp"
  info "Não há registro de $tel nesta instalação$([ -n "$org" ] && printf ' (organização %s)' "$org")."
  info "Nada foi exportado."
  exit 0
fi

chmod 600 "$tmp"
mv "$tmp" "$saida"
conta_tipo() { grep -o "\"tipo\": \"$1\"" "$saida" | wc -l | tr -d ' '; }

ok "Ficha de $tel em $saida (permissão 600)."
info "  chamadas: $(conta_tipo chamada) · eventos: $(conta_tipo evento) · lista de não ligar: $(conta_tipo nao_ligar)"
warn "O arquivo tem dado pessoal. Entregue pelo canal combinado e apague depois: rm $saida"
