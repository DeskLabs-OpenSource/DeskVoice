---
name: deskvoice-doutrina
description: 'Resumo operacional das regras de forma do DeskVoice: um caminho de schema, um arquivo por peça, isolamento por organização, fila por notificação, configuração tem tela, tudo tem log, relógio injetado. Use ANTES de escrever ou revisar código neste repositório, quando a pessoa perguntar "posso fazer assim?", "isso é permitido?", "por que essa regra existe?", "por que a cerca reprovou?", ao criar tabela, migration, variável de ambiente, consulta ao banco, tarefa em segundo plano ou teste. Aponta para a lei completa em docs/doctrine/.'
---

# Doutrina do DeskVoice, em forma de checklist

A autoridade é o [`AGENTS.md`](../../../AGENTS.md); as leis completas estão em `docs/doctrine/`.
Esta skill é o resumo para consultar com o código aberto. Cada regra traz o que fazer, o que a
cobra e onde ler o porquê. Se este resumo discordar da lei, vale a lei.

## 1. Um caminho de schema

- Mudança de banco é **um arquivo novo** em `db/migrations/`, com nome
  `AAAAMMDDTHHMMSS_slug.sql`: `date -u +%Y%m%dT%H%M%S` gera o carimbo.
- Só para frente. Migration publicada **nunca** é editada, renomeada ou apagada (o executor guarda
  o hash e recusa). Errou? Migration nova.
- Não existe baseline nem "schema.sql" paralelo. Instalar é aplicar todas em ordem.
- Precisa funcionar sobre banco com dados: corrija os dados antes de criar a restrição.
- Cobra: cerca `migrations-are-timestamped-and-unique`; job `db` do CI (instalação nova e
  atualização a partir da última versão).
- Lei: [`um-caminho-de-schema.md`](../../../docs/doctrine/um-caminho-de-schema.md).

## 2. Um arquivo por peça

- Ferramenta (`packages/tools/src/tools/`), motor de voz (`packages/voice-engine/src/engines/`),
  rotina (`apps/routines/src/routines/`) e dicionário de tela (`apps/panel/src/i18n/`) moram cada
  um no próprio arquivo e são **descobertos por pasta**.
- Se o seu PR edita uma lista para registrar a peça, a lista não deveria existir. Não crie
  `index.ts` nessas pastas.
- Cobra: cerca `one-file-per-piece`.
- Lei: [`um-arquivo-por-peca.md`](../../../docs/doctrine/um-arquivo-por-peca.md).

## 3. Isolamento por organização

- Toda tabela tem `organization_id uuid not null`, menos `organizations` e `schema_migrations`.
- Todo acesso a dado de produto passa por `withOrg(db, organizationId, async (q) => ...)` de
  `@deskvoice/core`; dentro dele use `q.many`, `q.one`, `q.exec`. Numa ferramenta, o `ctx.q` já
  vem preso à organização da chamada.
- Fora de `packages/core` ninguém importa `pg` nem chama `.query(`. Operação que atravessa
  organizações (login, fila, roteamento da chamada) nasce dentro do core, com `withSystem`.
- Não filtre `organization_id` à mão achando que basta: a camada é a garantia.
- Cobra: cercas `every-table-has-organization-id` e `no-raw-sql-outside-core`; teste de isolamento
  gerado para toda tabela.
- Lei: [`isolamento.md`](../../../docs/doctrine/isolamento.md).

## 4. Fila por notificação

- Trabalho que continua depois da chamada é tarefa: `enqueueTask(q, { kind, payload, callId, runAt })`.
- Quem consome acorda por `listenTasks` e reivindica com `claimTask` (`for update skip locked`:
  dois processos nunca pegam a mesma). Sem `setInterval` curto consultando tabela.
- Tarefa falha? `failTask` reagenda até `MAX_TASK_ATTEMPTS`. Rotina precisa ser idempotente.

## 5. Configuração de operador tem tela

- O `.env` só guarda o que o instalador gera. Nenhuma variável nova sem padrão em `loadConfig`.
- O que o operador escolhe (chave de IA, tronco, política de saída) mora no banco (`settings` e
  tabelas próprias) e tem tela. Se precisa de SSH para ligar, não está pronto.
- Segredo de operador é cifrado em repouso com `encryptSecret`; nunca aparece em log nem evento.
- Cobra: cerca `env-vars-have-defaults` (lista em `fences/env-allowlist.ts`).

## 6. Tudo tem log

- O que acontece numa chamada vira `call_events`, por `recordEvent(q, callId, kind, payload, at)`.
  É a linha do tempo e a fonte da tela.
- `kind` vem do vocabulário fechado `CALL_EVENT_KINDS` (`packages/core/src/types.ts`). Tipo novo
  entra lá, não como texto solto.
- Falha nunca termina em silêncio: uma fala para quem está na linha e um evento para o painel.
- `console.log` em código de produto é reprovado pelo lint.
- Lei: [`sistema-vivo.md`](../../../docs/doctrine/sistema-vivo.md).

## 7. Relógio injetado

- Código de produto não chama `new Date()` nem `Date.now()`: recebe um `Clock`
  (`{ now(): Date }`; em produção, `systemClock`).
- Teste passa um relógio fixo, abre porta `0` e não depende do fuso da máquina.
- Por quê: teste com hora real fica vermelho sozinho, e PR bom paga por causa alheia.

## Outras leis, quando o assunto aparecer

| Assunto | Lei |
|---|---|
| Ligação feita pelo robô, lista de não ligar, teto diário | [`ligacoes-de-saida.md`](../../../docs/doctrine/ligacoes-de-saida.md) |
| Ação que apaga ou sobrescreve | [`destrutivo-pede-confirmacao.md`](../../../docs/doctrine/destrutivo-pede-confirmacao.md) |
| Criar, renovar ou remover uma cerca | [`cercas.md`](../../../docs/doctrine/cercas.md) |
| Número da versão e fragmentos | [`versionamento.md`](../../../docs/doctrine/versionamento.md) |
| Agente de código trabalhando no repositório | [`operacao-de-agentes.md`](../../../docs/doctrine/operacao-de-agentes.md) |

## Conferir

```bash
pnpm fences     # as regras de forma, em segundos; a mensagem de cada cerca diz o conserto
pnpm verify     # lint, tipos, cercas e testes
```

Regra ausente não se inventa: escreva um pedido de decisão no formato do
[`GOVERNANCE.md`](../../../GOVERNANCE.md), com o padrão que vale sem resposta.
