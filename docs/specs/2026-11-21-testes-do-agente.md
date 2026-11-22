# Testes do agente: conversas escritas pelo operador, conferidas antes de pôr no ar (item 7 da pesquisa Vapi)

- **Estado:** desenho, com a decisão dada em 22/11 (seção 9). A recomendação ficou nas três
  perguntas.
- **Data:** 2026-11-21
- **Quem pediu:** o dono aprovou em 21/11 a terceira leva da pesquisa Vapi (itens 7, 8 e 10), com
  "desenho maior antes". A fonte é o estudo de lacunas do board, de 20/11.
- **Base medida:** `origin/main` em `78663e5`. Arquivos, linhas e nomes citados foram conferidos
  nesse commit, salvo os marcados como **novo**.

## 1. Problema

Hoje, quem muda as instruções de um agente só descobre que quebrou o atendimento quando uma
ligação real dá errado. Por exemplo, o agente deixa de chamar `create_task`, ou chama com a data
errada. Para conferir antes, existem duas coisas:

- **A chamada simulada** (`apps/voice/src/simulate.ts`, rota interna `POST /calls/simulate`, e o
  `pnpm demo` em `apps/voice/src/cli/demo.ts`). O motor simulado
  (`packages/voice-engine/src/engines/simulated.ts`) executa um roteiro e **não lê as
  instruções**: quem decide a ferramenta é o roteiro (`{ toolCall: … }`). Ela prova que a
  tubulação funciona, mas não prova nada sobre o que o modelo faria.
- **A conversa pelo navegador** (`apps/voice/src/web-calls.ts`): o motor é real, mas a conferência
  é a orelha do operador, uma vez, sem registro do que se esperava. Ela também chama as
  ferramentas de verdade: um webhook para o sistema do cliente cria o agendamento de verdade.

Falta um jeito de escrever "quando a pessoa disser X, o agente tem de chamar `create_task` com a
data Y", rodar isso contra o modelo que atende o telefone, sem efeito fora, e ver na tela se passou.

## 2. O que a Vapi e a Retell fazem (lido em 21/11/2026)

| | Vapi Evals | Retell (simulação e lote) |
|---|---|---|
| Modo | Texto. "Evals run at the text and model layer. They don't test speech recognition, audio quality, or turn-taking." Tipo `chat.mockConversation`. | Texto. A simulação "runs as a text conversation". |
| Quem faz o papel de quem liga | A conversa escrita: mensagens `user` fixas. | Um LLM com uma persona escrita pelo operador ("An AI plays the caller"). |
| Como confere | Um `judgePlan` por resposta do agente: `exact` (nome da ferramenta **e** todos os argumentos), `regex` (só o nome, ou o texto) e `ai` (um modelo juiz devolve pass/fail). | Critérios em texto livre, cada um julgado por um LLM, com explicação. A rodada passa só se todos passarem. A doc recomenda olhar a taxa de acerto de várias rodadas, porque o resultado varia. |
| Ferramentas | O resultado vem escrito no teste, numa mensagem `tool`. "The mock response doesn't create an appointment." | Um *mock* intercepta a chamada e devolve um resultado fixo. Encerrar e transferir são sempre simulados. **Ferramenta sem mock vai ao endpoint de produção**, e ferramenta MCP ignora o mock. |
| Disparo | Botão no painel, ou API (`POST /eval/run`, consultando `GET /eval/run/{id}` até acabar). A integração com CI fica por conta de quem usa. | Botão "Run Test" na aba Test Cases (um caso já vira lote), ou API (`create-batch-test`). |
| Custo | A página não diz. O juiz `ai` chama um modelo de terceiro. | A página não diz preço. O modelo de quem liga e o do agente "both bill per message". |

Fontes:

- https://docs.vapi.ai/observability/evals-quickstart
- https://docs.retellai.com/test/llm-simulation-testing
- https://docs.retellai.com/test/batch-test-simulation
- https://docs.retellai.com/api-references/create-batch-test

O que tiramos dali:

1. As duas testam em texto, e dizem isso.
2. Conferir ferramenta pelo nome **e** pelos argumentos é o centro.
3. O resultado da ferramenta vem escrito no teste.
4. A Retell deixa escapar para produção a ferramenta sem mock. Aqui, isso não acontece: no teste,
   nenhuma ferramenta roda, sem exceção.

## 3. Alternativas

**Qual motor responde no teste.**

- **A. Só o motor simulado.** Custa zero e roda no CI, mas não testa nada do que importa: o roteiro
  decide a ferramenta, e as instruções nem são lidas. Serve só para provar a tubulação.
- **B. O cérebro de texto (`Brain.chat`, `packages/voice-engine/src/brain.ts`)**, com as instruções
  e as ferramentas do agente. É barato e rápido, mas é **outro modelo**: o telefone é atendido
  pelo OpenAI Realtime ou pelo Gemini Live, e um verde no modelo de texto não diz nada sobre o de
  voz. Daria uma confiança falsa. Vale para o motor em pipeline (R5) quando ele existir, porque lá
  o cérebro **é** o `Brain.chat`.
- **C. O mesmo motor e o mesmo modelo do agente, em modo texto (recomendada).** O teste manda o que
  quem ligou diz como texto, e o motor responde em texto. As instruções e as ferramentas são as
  mesmas da ligação, montadas pela mesma função. O OpenAI Realtime aceita texto de entrada
  (`conversation.item.create` com `input_text`) e saída só em texto (`output_modalities`). O texto
  custa bem menos que o áudio na tabela já cadastrada (`openai-realtime.ts:342-348`: texto
  US$ 4/M de entrada e US$ 24/M de saída, contra US$ 32/M e US$ 64/M do áudio). Como nas duas
  referências, não testa ouvido, voz nem tomada de turno.
- **D. O motor real com a fala de quem ligou sintetizada.** Testa também o ouvido, mas custa áudio
  nas duas pontas, mais uma chave de voz, e roda em tempo real. Fica fora deste item.

**Recomendação: C para o operador e A para o CI.** O motor simulado ganha a entrada em texto, e o
executor do teste é o mesmo nos dois casos. O CI prova o executor e o juiz, e o operador prova o
modelo dele.

**Onde mora o resultado.** Mora numa tabela própria com `organization_id` (seção 5.1), e não na
linha do tempo. Teste não é ligação. A linha do tempo (`call_events`) alimenta a lista de
ligações, as rotinas depois da ligação (`review_call`, resumo, analistas) e a memória de quem
ligou. Uma ligação de teste entraria nisso tudo, e cada leitor teria de aprender a ignorá-la, como
já acontece com `channel = 'simulated'` em `packages/core/src/caller-memory.ts:238` e
`caller-history.ts:111`. A rodada tem a tela dela (seção 5.6), e o custo vai ao mesmo extrato
(`usage_ledger`) de todo custo.

**Quando roda.** Recomendo **só por botão**. Rodar sozinho ao salvar as instruções gastaria a
chave do operador sem ele pedir, e isso surpreende quem já instalou. Em vez disso, a tela marca o
teste como "não rodado com as instruções atuais" quando o retrato da configuração (seção 5.2)
mudou desde a última rodada. Rodar sozinho pode virar uma chave depois, desligada de fábrica, com
pedido próprio.

**Como se reaproveita o que existe.**

- O motor simulado ganha `sendUserText` (seção 5.3), e o roteiro dele continua sendo o lugar onde o
  CI diz o que o "modelo" faz.
- O `pnpm demo` termina rodando um teste do agente Lia contra o motor simulado e imprime o veredito
  (fatia 7a). É a primeira entrada e a primeira saída da peça, antes de existir tela.
- A sessão de voz (`call-session.ts`) **não** é usada: ela pede transporte de áudio, cria a linha
  em `calls` e chama `runTool`. O executor reaproveita só as peças de montar a sessão (seção 5.4).

## 4. As regras de produto (conferidas em `GOVERNANCE.md`)

- **Núcleo ou peça opcional:** núcleo. Testar um agente vale para qualquer negócio, e nada aqui é
  de nicho.
- **Disparo em massa:** não. Nenhum número é discado, e o teste não sai do processo de voz para a
  telefonia. Nenhuma ferramenta roda, e então nenhum webhook, aviso ou transferência sai.
- **SSH para ligar:** não. É uma tela.
- **Recurso pago e telemetria:** nenhum. O custo é o do provedor do próprio operador, com a chave
  dele, e aparece no extrato e no teto do mês.
- **Quem já instalou:** não vê mudança até criar um teste. A tela de Custos ganha a linha "Testes"
  só quando houver custo de teste. É capacidade nova, que gasta dinheiro ao clicar, e por isso vai
  à pasta do dono antes (seção 9).

## 5. O contrato

### 5.1 Dados (migration **nova** `db/migrations/AAAAMMDDTHHMMSS_testes_do_agente.sql`)

```sql
create table agent_tests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id),
  agent_id uuid not null,
  name text not null check (length(name) between 1 and 120),
  turns jsonb not null,               -- validado por zod em packages/core (5.2); o banco não interpreta
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, agent_id) references agents (organization_id, id) on delete cascade
);

create table agent_test_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id),
  test_id uuid not null,
  status text not null check (status in ('running', 'passed', 'failed', 'error')),
  error_code text,                    -- vocabulário fechado (5.5), só com status = 'error'
  engine text not null,
  model text,
  config_hash text not null,          -- o retrato da configuração (5.2)
  turns jsonb not null default '[]',  -- o que aconteceu, turno a turno, com o veredito de cada um
  requested_by uuid,                  -- quem clicou
  started_at timestamptz not null,
  finished_at timestamptz,
  unique (organization_id, id),
  foreign key (organization_id, test_id) references agent_tests (organization_id, id) on delete cascade
);
create index agent_test_runs_test_idx on agent_test_runs (organization_id, test_id, started_at desc);

-- O custo vai ao mesmo extrato de toda chamada, com a fonte dele.
alter table usage_ledger alter column call_id drop not null;
alter table usage_ledger add column test_run_id uuid;
alter table usage_ledger add foreign key (organization_id, test_run_id)
  references agent_test_runs (organization_id, id) on delete set null;
-- source passa a aceitar 'test'; a linha tem ligação ou rodada, nunca as duas
-- (o nome do check atual é conferido na fatia).
```

- Os dois `enable row level security`, as duas políticas por `organization_id` e a entrada das duas
  tabelas na lista do isolamento seguem a forma das tabelas mais novas (`ivr_menus`,
  `organization_limits`). A cerca de isolamento tem de achar as duas.
- **Retenção:** são guardadas as 20 rodadas mais novas por teste, e a gravação de uma rodada
  nova apaga as mais velhas. Teste apagado leva as rodadas. A linha do extrato fica, porque o
  dinheiro foi gasto.
- **`on delete set null` no extrato:** o custo do mês não pode encolher porque alguém apagou um
  teste. A linha fica com `call_id` e `test_run_id` nulos, `source = 'test'`.

### 5.2 O teste e o juiz (**novo** `packages/core/src/agent-tests.ts`, funções puras)

```ts
type ArgMatcher = { equals: string | number | boolean | null } | { contains: string } | { present: true };

interface ToolExpectation {
  tool: string;                          // nome da ferramenta, como em `agents.tools`
  args?: Record<string, ArgMatcher>;     // só os campos citados são conferidos; os outros ficam livres
  result: unknown;                       // o que o teste devolve ao modelo no lugar da ferramenta
}

interface TurnExpectation {
  tools?: ToolExpectation[];             // todas têm de acontecer neste turno, em qualquer ordem
  onlyThese?: boolean;                   // padrão true: chamar outra ferramenta reprova
  forbid?: string[];                     // ferramentas que não podem ser chamadas
  says?: string[];                       // trechos que a fala do agente precisa ter
  saysNot?: string[];                    // trechos que ela não pode ter
}

interface AgentTestTurn { user: string; expect?: TurnExpectation }  // `user`: 1 a 1 000 caracteres
type AgentTestTurns = AgentTestTurn[];                              // 1 a 12 turnos

export const agentTestTurns: z.ZodType<AgentTestTurns>;
export function judgeTurn(expect: TurnExpectation | undefined, happened: HappenedTurn): TurnVerdict;
export function configHash(input: { instructions: string; tools: ToolSpec[]; engine: string; model: string | null; language: string }): string; // sha256
```

- **Comparação:** `equals` compara o valor do JSON que o modelo mandou, depois de `trim` em texto,
  sem mudar maiúsculas. `contains` e `says`/`saysNot` ignoram maiúsculas e acentos (`NFD`, sem
  marcas). Argumento que não é JSON válido reprova com `args_invalid_json`. Não existe juiz por
  modelo nesta leva (seção 8).
- **Os motivos da reprovação** são um vocabulário fechado: `tool_missing`, `tool_unexpected`,
  `tool_forbidden`, `args_mismatch`, `args_invalid_json`, `text_missing`, `text_forbidden`.
  Cada motivo leva `detail` com o esperado e o que veio, para a tela mostrar lado a lado.
- **`configHash`** retrata o que o modelo recebe: as instruções já compostas
  (`composeInstructions`), as ferramentas oferecidas (`toSpec`), o motor, o modelo e o idioma.
  Se o hash da última rodada é diferente do de agora, a tela diz "não rodado com a configuração
  atual".

### 5.3 O motor em modo texto (`packages/voice-engine/src/types.ts`)

```ts
interface VoiceEngine { /* … */ textMode?: true }        // o motor aceita sessão de teste em texto
interface VoiceSessionConfig { /* … */ mode?: "audio" | "text" }  // padrão "audio"
interface VoiceSession { /* … */ sendUserText?(text: string): void }
interface VoiceSessionEvents { /* … */ turnDone?(): void } // a resposta acabou, sem ferramenta pendente
```

- **Simulado:** `textMode: true`. `sendUserText` encerra a espera de um `expectUserAudio`, como se
  a fala tivesse acabado, e grava a transcrição do usuário com o texto recebido. `turnDone` sai
  quando o roteiro para numa espera nova ou termina.
- **OpenAI Realtime (fatia 7b):** com `mode: "text"`, `session.update` com
  `output_modalities: ["text"]` e sem `audio`. `sendUserText` manda `conversation.item.create`
  (`role: "user"`, `input_text`) e `response.create`. `turnDone` sai em `response.done` quando a
  resposta não tem `function_call`. A fala do agente chega pelos eventos de texto e vira o
  `transcript` do agente que já existe.
- **Gemini Live (fatia 7d):** antes, a medida M7 (seção 7): o modelo de `gemini-live.ts:132` aceita
  `responseModalities: ["TEXT"]`? Se aceita, o caminho é o mesmo. Se não aceita, a resposta vem em
  áudio com transcrição de saída e custa áudio. Isso vai ao PR com o número, e a tela diz que esse
  motor testa mais caro.
- Motor sem `textMode` (o pipeline, enquanto não existir): o botão aparece desligado, com o motivo
  "Este motor ainda não roda testes".

### 5.4 O executor (**novo** `apps/voice/src/agent-test.ts`) e a rota interna

- **Rota interna nova** em `internal-api.ts`, ao lado de `POST /calls/simulate`:
  `POST /agent-tests/run` com `{ organizationId, testId, requestedBy }`. Ela devolve `{ runId }`
  na hora, e a rodada segue em segundo plano. As recusas são as da seção 5.5.
- **A montagem é a mesma da ligação.** A fatia 7b tira de `call-session.ts` o `sessionConfig`
  (`call-session.ts:961`) e a escolha das ferramentas habilitadas para um arquivo **novo**,
  `apps/voice/src/session-config.ts`. As duas pontas passam a usar o mesmo arquivo. Uma cerca
  confere que, para o mesmo agente, a configuração da ligação e a do teste só diferem em `mode`.
  A memória de quem ligou não entra, porque o teste não tem número.
- **Nenhuma ferramenta roda.** O executor **não importa** `runTool` nem `@deskvoice/tools/run-tool`,
  e uma cerca confere isso pelo import. No `toolCall`, ele grava a chamada no turno e devolve ao
  modelo o `result` da expectativa que casou pelo nome. Sem expectativa que case, devolve
  `{ ok: false, message: "Em teste: esta ferramenta não tem resposta escrita no teste." }` e
  reprova com `tool_unexpected`. Isso vale também para `end_call`, `transfer_to_human`,
  `request_approval`, `notify_human` e a passagem a outro agente: o teste registra o pedido, e
  nada sai.
- **A fala do agente** soma os `transcript` do agente entre o texto do usuário e o `turnDone`.
- **Limites:** 30 s por turno (estourou: `error`, `turn_timeout`), 8 chamadas de ferramenta por
  turno (passou: `error`, `tool_loop`), 12 turnos por teste e 20 testes por agente.
- **"Rodar todos"** roda os testes do agente em série, nunca em paralelo. Antes de cada teste,
  confere de novo o teto do mês.

### 5.5 Custo e teto

- **Antes de começar** (na transação da organização, como a ligação pelo navegador faz em
  `web-calls.ts`), a rota recusa em três casos:
  - `spendCapReached` deu sim: `spend_cap_reached`;
  - já existe uma rodada `running` na organização: `test_run_busy`, uma de cada vez;
  - o motor não tem `textMode` (`engine_no_text_mode`), não tem chave (`engine_not_configured`) ou
    o agente não existe (`agent_not_found`).
- **Durante a rodada**, cada `usage` do motor (o OpenAI manda um por `response.done`,
  `openai-realtime.ts:452`) vira uma linha em `usage_ledger` com `source = 'test'`,
  `test_run_id`, `agent_id` e o custo estimado por `estimateCostMicrocents` com o preço do motor.
  Ela entra na mesma soma do mês (`monthCost`, `packages/core/src/costs.ts:40`, que já soma o
  extrato sem olhar a ligação).
- **Teto da rodada:** é o `cost_ceiling_cents` do agente, o mesmo de uma ligação. Passou, a rodada
  para com `error`, `cost_ceiling`.
- **Os leitores do extrato que juntam com `calls`** (`apps/panel/src/app/api/v1/system/costs/route.ts:35`,
  `join calls c on c.id = l.call_id`, e os outros listados na fatia 7b) passam a usar `left join` e
  a mostrar "Testes" como fonte. Sem isso, o total do mês e a soma das linhas da tela de Custos
  deixariam de bater. Um teste de banco grava uma linha de teste e confere que **total = soma das
  linhas** na tela de Custos e na visão da instalação.
- **Estimativa, não medida:** 5 turnos, instruções de cerca de 3 000 tokens, 100 tokens de resposta
  por turno, no preço cadastrado do OpenAI Realtime em texto. Fica entre US$ 0,02 (com cache) e
  US$ 0,08 (sem cache) por teste. A fatia 7b mede uma rodada com a chave real e põe o número no PR
  e aqui.

### 5.6 A tela (fatia 7c)

- **Nova** página `apps/panel/src/app/(app)/agents/[id]/tests/page.tsx`, com um link na página do
  agente. A página do agente já tem 612 linhas e não recebe o editor.
- **Lista dos testes:** nome, resultado da última rodada (passou, reprovou, erro), quando rodou e,
  se for o caso, o aviso "não rodado com a configuração atual".
- **Editor do teste:** um formulário. Cada turno tem a fala de quem ligou e o que se espera: as
  ferramentas, com os campos e o resultado devolvido, e os trechos de fala. Não é JSON cru na tela.
- **Botões** "Rodar" e "Rodar todos". Antes do primeiro clique, a tela diz a frase de custo: "Cada
  rodada usa o motor deste agente com a sua chave e entra no custo do mês. Nenhuma ferramenta roda
  de verdade."
- **Rodada:** a conversa turno a turno, as ferramentas pedidas com os argumentos, e cada reprovação
  com o esperado e o que veio, lado a lado. A tela consulta a rodada até ela acabar, como a
  ligação pelo navegador faz com a dela.
- **Papel:** quem pode editar o agente (`handle({ configure: true })` em
  `api/v1/agents/[id]/route.ts:12`) cria, edita e roda testes. Quem só vê o agente vê os
  resultados.
- **Textos:** um arquivo por idioma, **novo** `apps/panel/src/i18n/{pt-BR,en,es}/agent-tests.ts`.
  A linha "Testes" na tela de Custos vai no arquivo de custos que já existe.

## 6. As fatias

Cada uma cabe numa revisão de uma sentada, tem fragmento em `.changes/` e vai num PR contra `main`.

| Fatia | O que entrega | Entrada e saída (duas conexões) | Começa quando |
|---|---|---|---|
| **7a** | 5.1 (só as duas tabelas, sem mexer no extrato), 5.2 inteira, `sendUserText` e `turnDone` no simulado, e o executor (5.4) só com o motor simulado. O `pnpm demo` termina rodando um teste da Lia e imprimindo o veredito. | Entrada: o `pnpm demo` e os testes de banco. Saída: o veredito impresso e a linha em `agent_test_runs`. | Já: não toca `call-session.ts` nem o motor real. |
| **7b** | OpenAI Realtime em `mode: "text"`, `session-config.ts` tirado de `call-session.ts`, a rota interna, o extrato (`test_run_id`, `source = 'test'`, `left join` nos leitores) e as recusas de 5.5. Também a medida de custo de uma rodada real, no PR. | Entrada: a rota interna. Saída: a rodada gravada e o custo no extrato e no teto do mês. | Decisão do dono (seção 9), e #537 e #543 mesclados (os dois mexem em `call-session.ts`). |
| **7c** | A tela (5.6), a rota do painel que chama a interna, os textos nos três idiomas e a linha "Testes" em Custos. | Entrada: o botão. Saída: o resultado e o aviso de configuração mudada na tela. | 7b mesclada. |
| **7d** | Gemini Live em modo texto, depois da medida M7. | A mesma tela, para agentes no Gemini. | 7c mesclada e M7 medida. |

A 7a sozinha tem entrada e saída reais (o `pnpm demo`), mas não tem tela. Ela é a base, e a 7c
fecha a volta para quem usa o painel.

## 7. O que o CI não vê

- **Se o modelo em modo texto escolhe a ferramenta como em voz.** As duas referências testam em
  texto e não afirmam que o resultado vale para a voz. Um verde no teste não garante a ligação. A
  tela diz isso numa frase: "O teste confere o que o agente decide, e não como ele ouve e fala."
- **Se o resultado varia de uma rodada para outra.** O modelo real não é determinístico, e a Retell
  recomenda olhar a taxa de acerto. Esta leva roda uma vez por clique.
- **O custo real de uma rodada.** O CI usa o simulado (custo zero) e servidor falso. O número da
  seção 5.5 é conta, não medida. Só a 7b com a chave real mede.
- **Se o OpenAI Realtime aceita `output_modalities: ["text"]` no modelo cadastrado.** O servidor
  falso aceita qualquer coisa. A 7b confere com a chave real antes de abrir o PR.
- **M7:** se o modelo do Gemini Live cadastrado aceita resposta em texto.
- **Se a configuração do teste é a mesma da ligação** quando alguém acrescentar um campo novo ao
  `sessionConfig`. A cerca de 5.4 compara os dois caminhos, mas só pelo que já passa por
  `session-config.ts`.
- **O total do mês e a soma das linhas de Custos** batem só nos leitores que o teste de banco cobre.
  A lista dos leitores do extrato é conferida à mão na 7b.

## 8. Fora deste item

- Juiz por modelo (o `ai` da Vapi), persona simulada por modelo (a Retell) e várias rodadas por
  clique com taxa de acerto.
- Teste por voz, com a fala sintetizada (alternativa D).
- Rodar sozinho ao salvar as instruções (pedido próprio, desligado de fábrica).
- A passagem a outro agente dentro do teste. O pedido de passagem é registrado e conferido como
  ferramenta, mas o teste não troca de agente.
- Rodar testes por API pública ou pelo CI do operador.
- Testes do menu por teclas (`ivr_menus`).

## 9. Decisão do dono antes da 7b

Esta é capacidade nova que gasta a chave do operador ao clicar. O pedido vai à pasta do dono, com
o padrão que vale sem resposta:

- motor do teste: C (o motor real do agente em texto) **ou** B (o cérebro de texto);
- disparo: só por botão;
- o custo do teste entra no teto do mês e no extrato.

A 7a não depende da resposta.

**Resposta (22/11, pelo orquestrador do roteiro, com a autonomia dada pelo dono em 21/11):** ficou
a recomendação nas três.

- **Motor:** C, o motor do próprio agente em modo texto. Um verde precisa dizer algo do modelo que
  atende o telefone. A tela avisa, como a Vapi e a Retell, que o teste não cobre ouvido nem voz.
- **Disparo:** só por botão. Gastar a chave do operador sem ele pedir surpreende quem já instalou.
  O aviso "não rodado com a configuração atual" cobre o esquecimento.
- **Custo:** entra no extrato (`source = 'test'`) e no teto do mês.

## 10. Não medido

- Nenhuma rodada contra o OpenAI Realtime ou o Gemini Live foi feita. O modo texto dos dois, o
  custo e a forma do `response.done` sem áudio vêm da doc e do código, e não de uma medida.
- As páginas da Vapi e da Retell foram lidas em 21/11/2026. Não abri conta em nenhuma das duas, e
  não conferi se o comportamento real bate com a doc. Num fórum da Retell, há relato de ferramenta
  chamada de verdade na simulação.
- O papel que pode rodar testes (5.6) foi tirado do `configure: true` da rota do agente, sem ler o
  `handle` inteiro.
- Não listei todos os leitores de `usage_ledger` que juntam com `calls`. Conferi só
  `system/costs/route.ts:35`. A fatia 7b lista os outros
  (`apps/panel/src/server/costs.ts`, `calls/route.ts`, `calls/[id]/route.ts`,
  `calls/[id]/transcription/route.ts`, as rotinas `transcribe_call` e `classify_call_outcome`).
- O nome do `check` atual de `usage_ledger.source` (`20261117T081026_analistas.sql:49`) não foi
  conferido.
- Os limites (30 s, 8 ferramentas, 12 turnos, 20 testes, 20 rodadas guardadas) são escolha, e não
  medida.
