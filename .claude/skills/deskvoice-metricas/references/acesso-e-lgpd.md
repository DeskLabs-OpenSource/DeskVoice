# Como chegar no dado, e o que pode sair dele

## Primeiro a tela, depois o banco

As rotas do painel (`/api/v1/...`) abrem só com a sessão de quem está logado: não há token de API.
Por isso a fonte de primeira mão é a **tela**, lida pela própria pessoa:

| Tela | Rota que ela lê | O que mostra |
|---|---|---|
| Saúde (`/health`) | `/api/v1/system/health` | o estado de cada peça (painel, banco, voz, telefonia, rotinas, motor) |
| Custos (`/costs`) | `/api/v1/system/costs?from=AAAA-MM-DD&to=AAAA-MM-DD` | custo por dia, por agente e por motor, com "não medido" e "inclui estimativa" |
| Chamadas (`/calls`) | `/api/v1/calls` | as 200 chamadas mais recentes, com situação, desfecho e nota |
| A chamada (`/calls/<id>`) | `/api/v1/calls/<id>` | a linha do tempo e a seção da análise de uma ligação |

A rota de saúde é a única que responde sem sessão (o instalador e o `install/healthcheck.sh` a
chamam), e sem sessão mostra só o estado das peças:
`curl -sS https://<endereço do painel>/api/v1/system/health`.

Nunca peça o cookie de sessão nem a senha do painel para ler uma rota. A resposta de
`/api/v1/calls` traz telefone (`from`, `to`), resumo e a frase que justificou o desfecho: lida pela
pessoa na tela, tudo bem; colada no chat, é dado pessoal indo para o modelo.

## O banco, quando a tela não responde

O Postgres roda no contêiner `postgres` de `deploy/docker-compose.yml`, na própria VPS, com banco e
dono `deskvoice`. Entrar nele pede a pessoa no terminal da VPS, na pasta do projeto:

```bash
docker compose -f deploy/docker-compose.yml exec -T \
  -e PGOPTIONS='-c default_transaction_read_only=on' postgres \
  psql -U deskvoice -d deskvoice -v ON_ERROR_STOP=1 \
  -v org=<id da organização> -v de=2026-10-01 -v ate=2026-10-31 < consulta.sql
```

- `PGOPTIONS` deixa toda transação da sessão só de leitura. O envelope de
  [`consultas.md`](consultas.md) repete isso com `begin read only`.
- `deskvoice` é o dono do schema e **atravessa a trava de organização**. Por isso toda consulta
  roda dentro do envelope (`set local role deskvoice_app` e `app.organization_id`), que devolve a
  trava, e ainda filtra `organization_id`.
- A senha do banco e o `.env` não entram em nada: não são necessários, porque o `psql` roda dentro
  do contêiner.
- Uma instalação pode ter mais de uma organização. Confirme com a pessoa de qual se trata antes de
  rodar (C0 de [`consultas.md`](consultas.md)).

Ler métrica pelo terminal não liga recurso nenhum: é diagnóstico, como o `install/diagnose.sh`. Se a
pessoa não tem acesso à VPS, fique nas telas e diga o que ficou sem medir.

## O que pode ir para o modelo

A linha é a mesma do apagamento a pedido do titular (`packages/core/src/erasures.ts`): o que ele
apaga ou anonimiza **não sai do banco**; o que ele preserva (ids, datas, situações, valores) pode
ser contado e agregado.

| Pode sair, agregado | Nunca sai |
|---|---|
| contagem, mediana, média, taxa | `calls.from_e164`, `calls.to_e164`, `calls.summary`, `calls.outcome_evidence` |
| `calls.status`, `direction`, `channel`, `outcome`, `outcome_confidence`, `analysis_score`, `voicemail` | `calls.analysis`, menos `criteria[].id` e `criteria[].status` (o `evidence`, os pontos fortes e fracos, as objeções e o próximo passo são texto da ligação) |
| `calls.end_reason` quando tem forma de código (`^[a-z]+(_[a-z]+)*$`) | `calls.end_reason` com frase livre (a ferramenta `end_call` grava o que o agente escreveu) |
| `call_events.kind`, `at`, e do `payload` só `reason` de `call_refused`, `outcome_not_classified`, `analysis_not_done` e `transcription_failed`; `engine` de `engine_failed`; `name` e `ok` de `tool_result` | qualquer outro campo do `payload`: `text` das transcrições, `args` de `tool_called`, `message`, `error`, `detail`, `summary`, `question`, `context`, `from`, `to`, `dialed`, `digits` |
| `usage_ledger.*` (motor, modelo, segundos, tokens, custo, `cost_measured`, `cost_estimated`) | `caller_notes.*` (recado e número de quem ligou) |
| `tasks.kind`, `status`, `attempts`, datas | `tasks.payload`, `tasks.last_error` |
| `follow_ups.status`, datas, se tem responsável | `follow_ups.caller_e164`, `title`, `details`, `closing_note` |
| `approvals.status`, `default_on_timeout`, datas | `approvals.question`, `approvals.context` |
| `agents.name` (é o nome do agente, não de pessoa) e os limites dele | `users.*`, `sessions.*`, `invites.*`, `do_not_call.*`, `notifications.target`, `body` e `error` |
| `outbound_policy.*` (teto, janela, fuso, tentativas) | `settings.value` (chaves e segredos), `trunks.*` |

Regras que decorrem da tabela:

- Nunca `select *` e nunca o `payload` inteiro. Só a chave que a tabela libera.
- Ligação apagada a pedido do titular (`calls.erased_at` preenchido) continua contando: contar é
  aceitável, nomear não.
- Se a pergunta só se responde lendo a conversa ("ouve as ligações e me diz o que está errado"),
  não é esta skill: é a tela da chamada, lida pela pessoa, uma ligação por vez.

## Higiene da sessão

- A consulta fica num arquivo `.sql` que a pessoa vê antes de rodar; o resultado agregado vai para o
  relatório; nada de cópia de tabela.
- Nada de `\copy`, `pg_dump` ou saída redirecionada para arquivo com linha de ligação.
- Ao terminar, apague os `.sql` temporários que você criou.
