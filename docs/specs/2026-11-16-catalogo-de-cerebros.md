# Catálogo de cérebros: provedores e modelos de texto atuais, escolhidos na tela

- **Estado:** desenho. Nenhum código de produto foi escrito.
- **Data:** 2026-11-16
- **Quem pediu:** o dono, no roteiro de novembro (item R4): "Adicionar modelos de IA pro cérebro de
  resposta do agente (os mesmos que tem no Deskcomm): Gemini, Anthropic, OpenAI, DeepSeek,
  OpenRouter etc. [...] Seria interessante podermos configurar o modelo de IA, com os mais
  atualizados disponíveis."
- **Base medida:** `origin/main` em `3c520ff`. Nomes de função, chave e evento citados abaixo foram
  conferidos nesse commit, salvo os marcados como **novo**.
- **Referência:** DeskcommCRM (`melgarafael/DeskcommCRM`, MIT) em `9dea1ee`, lido em 2026-11-16:
  `app/api/v1/ai/credentials/route.ts`, `app/api/v1/ai/providers/[provider]/models/route.ts`,
  `app/api/v1/cron/sync-model-catalog/route.ts`, `ModelPicker.tsx`, `lib/ai/provider-validators.ts`,
  `lib/ai/catalogo/*`. O que for trazido de lá ganha linha no `CREDITS.md` no mesmo PR.
- **Trilha:** B. Nenhuma fatia toca `apps/voice/**`, `call-session.ts` nem
  `packages/voice-engine/src/engines/**` (trilha A). Cada fatia lista os arquivos que toca (seção 4).

## 1. Problema

Hoje o único texto que o DeskVoice pede a um modelo depois da ligação, o desfecho e a análise
(`classify_call_outcome`, R1), sai do **motor de voz do agente**: `gpt-5-nano` no OpenAI Realtime e
`gemini-3.5-flash-lite` no Gemini Live, fixos no arquivo do motor. Quem quer outro modelo tem o
`engine.<id>.classify_target` (endpoint compatível com OpenAI), que não mede custo: o preço do modelo
é desconhecido e o extrato grava zero.

O dono quer escolher o modelo, entre os atuais de cada provedor, e que a lista não envelheça no
código. Sem isso, a análise da R1 fica presa a modelos baratos e fracos, e o motor em pipeline (R5)
e os analistas ao vivo (R6) não têm de onde tirar um modelo de texto.

## 2. As decisões de forma

1. **Uma peça nova, o cérebro (`Brain`), um arquivo por provedor**, descoberto por pasta em
   `packages/voice-engine/src/brains/` (**novo**), como os motores em `engines/`. Sem lista central
   (convenção 2, antipadrão 1). Diferente da referência, que registra provedores numa lista, num
   `switch` e num registro de execução que um teste mantém iguais.
2. **O cérebro só faz texto.** Voz em tempo real continua sendo do motor. Os dois não se misturam:
   a chave do cérebro é dele, separada da chave do motor (seção 3.3).
3. **A lista de modelos é da organização, lida da API do provedor com a chave dela.** Nada de
   catálogo global sincronizado por cron: o DeskVoice não tem cron, e a lista da chave é a única que
   diz o que aquela chave alcança (a referência mostra modelos que a chave não acessa, defeito 5 da
   leitura). A lista fica guardada e é relida ao salvar a chave, pelo botão "Atualizar" e quando a
   tela abre com a lista mais velha que 24 horas.
4. **Preço é por modelo, com fonte e data, e pode faltar.** Faltando, o modelo aparece marcado
   "custo não medido" e segue o padrão do pedido de decisão 1 (seção 7).
5. **Primeiro consumidor na mesma entrega (antipadrão 14):** o desfecho e a análise de fim de
   ligação passam a poder rodar num cérebro escolhido, com o custo medido. Sem cérebro escolhido,
   tudo é exatamente como hoje (quem já instalou não é surpreendido).

## 3. Contrato

### 3.1 A peça (fatia 1, `packages/voice-engine/src/brain.ts`, **novo**)

Exportada também por `@deskvoice/voice-engine/brain` (entrada nova em `package.json` `exports`), para
o painel importar sem puxar a descoberta por pasta (o mesmo motivo de `./types` hoje).

```ts
export interface BrainPrice {
  centsPerMillionInputTokens: number;
  centsPerMillionOutputTokens: number;
  centsPerMillionCachedInputTokens?: number;
  /** De onde o número veio: a URL da página de preços, ou da resposta da API que o trouxe. */
  source: string;
  /** Quando foi conferido (AAAA-MM-DD). Na lista lida da API, é o dia da leitura. */
  checkedOn: string;
}

export interface BrainModel {
  /** O id que vai no pedido, exatamente como o provedor publica. */
  id: string;
  /** O nome que a tela mostra; sem nome publicado, o id. */
  label: string;
  contextTokens?: number;
  /** Ausente é "preço não conhecido": nunca zero inventado. Zero só se o provedor publica zero. */
  price?: BrainPrice;
}

/** O vocabulário fechado de `KEY_CHECK_RESULTS`, menos `not_needed` e `model_unavailable`. */
export type BrainFailure = "rejected" | "no_credit" | "region_unavailable" | "rate_limited" | "unreachable" | "unexpected_response";

export type BrainModelsResult = { ok: true; models: BrainModel[] } | { ok: false; failure: BrainFailure; status: number | null };

export interface BrainJsonRequest {
  model: string;
  prompt: string;
  /** O formato pedido, nas duas formas que existem hoje em analysis.ts e outcome.ts. */
  schema: { name: string; strict: object; google: object };
  timeoutMs: number;
}

export type BrainJsonResult = { model: string; usage: Usage } & (
  | { ok: true; text: string }
  | { ok: false; failure: BrainFailure; status: number | null }
);

export interface Brain {
  id: string;            // "anthropic" | "openai" | "gemini" | "deepseek" | "openrouter" | ...
  label: string;
  /** Onde a pessoa pega a chave: o link da tela de credenciais. */
  keyUrl: string;
  /** Lista os modelos de texto que a chave alcança. Prova a chave: é o teste da tela. */
  listModels(apiKey: string, options: { fetch?: typeof fetch; timeoutMs?: number; today: string }): Promise<BrainModelsResult>;
  /** Um pedido com saída em JSON. Nunca lança; nunca registra a chave nem o corpo do provedor. */
  completeJson(apiKey: string, request: BrainJsonRequest, options: { fetch?: typeof fetch }): Promise<BrainJsonResult>;
}
```

Regras que valem para todo arquivo de cérebro:

- **Toda resposta do provedor passa por zod** (convenção 16): a lista de modelos e o corpo do pedido.
  Um item fora da forma é descartado da lista, não derruba a lista inteira (a referência derruba a
  sincronização inteira por um item, defeito 4).
- **Só modelos de texto.** Cada arquivo filtra pelo que o provedor declara (método `generateContent`
  no Gemini; saída de texto no OpenRouter; no OpenAI, que não declara modalidade, por exclusão de
  famílias que não conversam: `embedding`, `whisper`, `tts`, `dall-e`, `moderation`,
  `-realtime`, `-transcribe`, `-audio`, `image`). O filtro de cada arquivo tem teste com uma
  resposta gravada.
- **A chave vai em cabeçalho, nunca na URL** (no Gemini, `x-goog-api-key`, como o motor já faz; a
  referência põe na query string, que cai em log de proxy).
- **O motivo da falha é código fechado, nunca o texto do provedor.** O texto de erro de alguns
  provedores repete parte da chave. A tela traduz o código (seção 3.6). Status HTTP vai junto.
- **Prazo:** 10 s para listar; o pedido usa o de quem chama (30 s na análise, como hoje).
- **Paginação:** quem pagina (Anthropic, Gemini e, pela documentação de 16/11, OpenRouter com
  `limit`/`offset`) segue até o fim, com teto de 20 páginas; para também na página que não traz id
  novo.
- **Status:** 401 é `rejected`. O 403 e o 404 no **pedido** são `unexpected_response` (no
  OpenRouter o 403 é moderação, não chave). Na prova da chave do OpenRouter (`/key`), 403 continua
  `rejected`.
- **Preço fora da forma** (negativo, texto que não é número) deixa o modelo **sem preço**, nunca 0.
  O 0 só vale quando o provedor publica 0 (os `:free` do OpenRouter).
- **Tarifa além do token** (OpenRouter): o preço só lê `prompt`, `completion` e
  `input_cache_read`. Qualquer outro componente de `pricing` diferente de zero (`request`,
  `web_search`, `image`, `input_cache_write` ou um que apareça depois) deixa o modelo **sem preço**,
  porque o custo medido sairia menor que o cobrado. Pedido da revisão do #336.
- `today` vem do `Clock` de quem chama (convenção 10): é a data do preço lido da API.

O cálculo de custo reusa `estimateCostMicrocents` de `pricing.ts`: `BrainPrice` cabe em
`EnginePricing` (os campos de token e `checkedOn`/`source`).

Descoberta: `loadBrains(dir?)` em `packages/voice-engine/src/brain-load.ts` (**novo**), cópia de
`loadEngines`: arquivo cujo `default` não é um `Brain` falha alto; id repetido falha alto.

### 3.2 Os provedores (fatias 1 e 2)

| Arquivo | Listar modelos | Pedido em JSON | De onde vem o preço |
|---|---|---|---|
| `brains/openai.ts` | `GET https://api.openai.com/v1/models`, `Authorization: Bearer` | `POST /v1/chat/completions` com `response_format: json_schema` estrito (o que o motor faz hoje) | tabela no arquivo, com fonte e data (pedido 2) |
| `brains/openrouter.ts` | `GET https://openrouter.ai/api/v1/models` com a chave; a chave é provada por `GET /api/v1/key` antes, porque `/models` é público | `POST /api/v1/chat/completions`, `response_format: json_schema` | **da própria lista**: `pricing.prompt` e `pricing.completion`, em dólar por token, convertidos para centavo por milhão; fonte = a URL da lista, data = o dia da leitura |
| `brains/anthropic.ts` | `GET https://api.anthropic.com/v1/models`, `x-api-key` e `anthropic-version`, paginado | `POST /v1/messages`; a saída em JSON pelo recurso de saída estruturada ou por uma ferramenta única com `input_schema` (o Desenvolvedor confere qual está documentado na data e escreve a fonte) | tabela no arquivo (pedido 2) |
| `brains/gemini.ts` | `GET https://generativelanguage.googleapis.com/v1beta/models`, `x-goog-api-key`, paginado | `POST /v1beta/models/{id}:generateContent` com `responseMimeType` e `responseSchema` (a forma `google`) | tabela no arquivo (pedido 2) |
| `brains/deepseek.ts` | `GET https://api.deepseek.com/models`, `Authorization: Bearer` | `POST /chat/completions` com `response_format: {type: "json_object"}` (o formato vai no texto do pedido; a leitura com zod de `readClassifyText` é a garantia) | tabela no arquivo (pedido 2) |

Os endereços e cabeçalhos acima são os que a referência usa em `9dea1ee`. **Não conferi a
documentação de cada provedor nesta data.** Cada arquivo abre com o bloco de fontes, como os motores
(`openai-realtime.ts` linhas 1–30), com a URL e a data em que o Desenvolvedor conferiu. Endereço que
mudou ganha a forma documentada, e a mudança é dita no PR.

**A tabela de preço no arquivo** (enquanto o pedido 2 não mudar isso) segue a regra que o motor já
segue (`OUTCOME_PRICING_BY_MODEL`): só entra modelo com preço conferido na página do provedor, com
`source` e `checkedOn`. Modelo que a API lista e a tabela não tem aparece **sem preço**. A tabela é
dado de preço, não a lista de modelos: ela nunca faz um modelo aparecer nem sumir.

Modelo cujo preço não cabe no `EnginePricing` também fica **sem preço**: escrita em cache cobrada à
parte (o consumo não a separa) ou preço que muda por faixa de tamanho do pedido. Na fatia 1
(conferido em 16/11) isso deixou sem preço os modelos mais novos da OpenAI: as famílias `gpt-6*` e
`gpt-5.6*`, e `gpt-5.5` e `gpt-5.4`.

Também fica **sem preço** o modelo cuja troca de preço já está marcada na página do provedor: um
preço com data para acabar viraria custo errado sem ninguém notar (decidido no #346, fatia 2). Na
fatia 2 (conferido em 16/11) ficaram com preço 17 modelos da Anthropic e 5 do Gemini. A DeepSeek
ficou toda sem preço, porque cobra conforme a hora do pedido. O Haiku 5.5 e os Gemini com faixa
acima de 200 mil tokens ficaram sem preço pela regra da faixa.

### 3.3 Credenciais (fatia 3)

Em `settings`, por organização, sem migration:

| Chave (**novo**) | Valor | `secret` |
|---|---|---|
| `brain.<id>.api_key` | a chave, cifrada com `encryptSecret` | `true` |
| `brain.<id>.key_check` | `{ result, status, checkedAt }` (sem segredo) | `false` |
| `brain.<id>.models` | `{ fetchedAt, models: BrainModel[] }`, validado com zod na escrita e na leitura | `false` |

- Trocar ou remover a chave apaga `key_check` e `models` na mesma transação: a lista sempre fala da
  chave em vigor (a mesma regra de `engine.<id>.key_check` hoje).
- Remover pede confirmação nomeando o provedor, e a confirmação diz se o cérebro está escolhido para
  a análise (doutrina `destrutivo-pede-confirmacao.md`).
- **A chave do motor não é reaproveitada.** Quem tem a chave OpenAI no motor cola de novo no
  cérebro. Ver "fora do escopo".

Rotas (**novas**), todas com `configure: true` (dono e administrador), corpo validado com zod:

- `GET /api/v1/brains`: os cérebros descobertos, com `configured`, o último `key_check`, o número de
  modelos e `fetchedAt`. Nunca a chave.
- `PUT /api/v1/brains/[brain]/key` `{ apiKey }`: cifra, grava e, fora da transação, lista os modelos
  (que é o teste). Responde o resultado do teste.
- `DELETE /api/v1/brains/[brain]/key`.
- `POST /api/v1/brains/[brain]/models/refresh`: relê a lista. Limite de 5 por cérebro e organização a
  cada 10 minutos, o mesmo `createRateLimiter` do teste de chave do motor.
- `GET /api/v1/brains/[brain]/models`: a lista guardada. Lista com `fetchedAt` acima de 24 horas é
  relida antes de responder (contando no mesmo limite); falhou a releitura, responde a guardada com
  `stale: true`.

Só grava `key_check` e `models` se a chave testada ainda é a salva (o mesmo `where exists` de
`testEngineKey`).

### 3.4 A escolha para a análise (fatia 4)

Uma chave de organização (**nova**) `calls.analysis_brain`, `{ brain, model }`, validada com zod.
Ausente é o comportamento de hoje (o motor do agente).

- Ao salvar, o `model` precisa estar na lista guardada daquele cérebro. Modelo sem preço só é aceito
  com `acceptUnmeasured: true` no corpo, que a tela só manda depois do aviso (seção 3.6).
- Com `calls.analysis_brain` gravado, a escolha vale **para o desfecho e para a análise**, que são a
  mesma chamada paga (desenho da R1, seção 2), e **passa na frente** de `engine.<id>.classify_target`.
  O destino antigo continua gravado e volta a valer se a escolha for removida.
- Sem fallback para o motor: cérebro escolhido sem chave, com chave recusada ou fora do ar não lê a
  ligação, e a linha do tempo diz por quê. Cair no motor pagaria um provedor que o dono deixou de
  escolher.

### 3.5 A rotina, o custo e a linha do tempo (fatia 4)

Em `apps/routines/src/routines/classify_call_outcome.ts`, dentro da primeira transação, depois do
teto e antes do caminho do motor:

1. Lê `calls.analysis_brain`. Ausente: segue o caminho de hoje, sem mudança de linha.
2. Cérebro não descoberto, ou modelo que sumiu da lista guardada: `outcome_not_classified` e
   `analysis_not_done` com o motivo **novo** `brain_unavailable`.
3. Sem `brain.<id>.api_key`: motivo **novo** `brain_no_key`, com `brain` no payload. O `no_key` de
   hoje tem frase sobre o motor de voz ("o motor de voz do agente não tem chave cadastrada") e
   mentiria aqui.
4. Modelo sem preço e agente sem teto (`cost_ceiling_cents = 0`): motivo **novo**
   `brain_unmeasured_without_ceiling`, nada é pedido (padrão do pedido 1).
5. Fora da transação: `brain.completeJson` com `outcomePrompt`/`analysisPrompt` e os esquemas que já
   existem (`OUTCOME_GUESS_SCHEMA`, `ANALYSIS_SCHEMA` e as formas `_GOOGLE`); a leitura é a mesma
   `readClassifyText`, e o resto da rotina (checagem das citações, `callAnalysisSchema`, `scoreOf`,
   `erased_at`) não muda.
6. Custo: `estimateCostMicrocents(price, usage)` com o preço da lista guardada **no momento da
   leitura**. Uma linha no `usage_ledger` com `engine = 'brain:<id>'` e as colunas novas abaixo.
   Um resultado **sem `usage`** (prazo vencido depois do processamento, ou 200 fora da forma) é
   **custo desconhecido**, nunca zero: conta como modelo sem preço para o teto e para a linha do
   tempo. Condição da revisão do #336. Vale também para um `usage` **sem `inputTokens`**: custo
   desconhecido, nunca zero no teto. Hoje isso cobre a DeepSeek sem preço, o Haiku 5.5 com preço por
   faixa e a escrita em cache da Anthropic, que devolvem `usage {}` (regra do board ao fechar o #346).
   Um teste para cada um desses três casos.

Migration **nova** `db/migrations/<carimbo>_custo_por_modelo.sql`, só para frente:

```sql
alter table usage_ledger
  add column model text,
  add column cost_measured boolean not null default true;
```

- `model` é o modelo cobrado; nulo nas linhas antigas e nas da voz (não se reescreve linha antiga).
- `cost_measured = false` na linha cujo preço não era conhecido: tokens gravados, custo zero, e o
  zero não é confundido com grátis. A tela de custo (`/costs`) e o detalhe da chamada mostram "custo
  não medido" quando alguma linha da chamada tem `false`.
- `call_analyzed` e as falhas ganham `brain` e `costMeasured` no payload. Os três motivos novos
  (`brain_unavailable`, `brain_no_key`, `brain_unmeasured_without_ceiling`) entram no vocabulário fechado com frase na linha do tempo, em pt-BR, inglês e espanhol (o CI
  reprova motivo sem frase).

### 3.6 Tela (fatias 3 e 4)

- **`/settings/brains`** (**nova**, fatia 3), "Cérebros": um cartão por cérebro descoberto, com o
  link para pegar a chave, o campo de chave (nunca preenchido de volta; mostra só "chave salva"),
  "Salvar e testar", "Atualizar lista", "Remover", o resultado do último teste em frase e a lista de
  modelos com busca (sem acento e sem caixa, como o `ModelPicker` da referência), cada linha com o
  preço de entrada e de saída por milhão de tokens, **a fonte e a data**, e a marca "sem preço
  conhecido" **visível na linha**, não só num balão (na referência só aparece no balão).
- Frases do resultado do teste: uma por código de `BrainFailure`, dizendo o que fazer
  ("O provedor recusou a chave. Confira se copiou inteira e se ela não foi revogada.";
  "A conta está sem crédito."; etc.). O status HTTP aparece entre parênteses.
- **Na seção da análise** (fatia 4b; hoje ela fica em `apps/panel/src/app/(app)/settings/page.tsx`,
  painel `analysisTitle`, e não em `/settings/calls`): "Quem lê a ligação": "O motor do agente
  (padrão)" ou um cérebro e um modelo, escolhidos de uma lista pesquisável só com cérebros que têm
  chave aceita. Ao escolher modelo sem preço, aviso fixo antes de salvar: "O preço deste modelo não é
  conhecido. O custo da análise não vai ser medido, e ela só roda nas ligações de agentes com teto de
  custo." O aviso continua visível depois de salvo.
- Toda frase em `apps/panel/src/i18n/` nas três línguas (convenção 9).

## 4. Fatias

Cada fatia é um PR de rascunho do **Desenvolvedor 2** contra `main`, com fragmento em `.changes/`,
verificado pelo **Verificador 2**. Uma de cada vez, nesta ordem.

| Fatia | O que entra | Arquivos que toca |
|---|---|---|
| **1. A peça, OpenAI e OpenRouter** | `brain.ts`, `brain-load.ts`, `brains/openai.ts`, `brains/openrouter.ts`, testes com respostas gravadas (lista, filtro, preço do OpenRouter, preço desconhecido, cada falha, JSON fora da forma), entrada `./brain` no `package.json` do pacote, `CREDITS.md` se trouxer código | `packages/voice-engine/src/brain*.ts`, `packages/voice-engine/src/brains/**`, `packages/voice-engine/package.json`, `packages/voice-engine/src/index.ts` (só a exportação), `CREDITS.md`, `.changes/` |
| **2. Anthropic, Gemini e DeepSeek** | os três arquivos e os testes, com o bloco de fontes e datas | `packages/voice-engine/src/brains/**`, `CREDITS.md`, `.changes/` |
| **3. Credenciais e catálogo na tela** | settings da 3.3, as rotas, `/settings/brains`, dicionários, testes de banco (isolamento entre organizações, troca de chave apaga lista, chave nunca na resposta, limite) | `apps/panel/src/app/api/v1/brains/**`, `apps/panel/src/server/brains.ts` (**novo**), `apps/panel/src/app/(app)/settings/brains/**`, `apps/panel/src/i18n/*/brains.ts` (**novo**), o item do menu de configurações, `.changes/` |
| **4a. A análise no cérebro escolhido (rotina)** | migration da 3.5, `calls.analysis_brain` com zod e a validação ao salvar (modelo na lista guardada; sem preço só com `acceptUnmeasured`), o caminho na rotina, os três motivos novos com frase na linha do tempo, `model`/`cost_measured` no extrato, testes de banco (os casos 2 a 6 da 3.5, os três de `usage` sem `inputTokens`, sem fallback para o motor, remover a escolha volta ao de antes) | `db/migrations/<novo>`, `apps/routines/src/routines/classify_call_outcome.ts` e testes, `apps/panel/src/server/settings.ts` (só a chave nova), `apps/panel/src/i18n/*/timeline.ts`, `.changes/` |
| **4b. A escolha e o custo na tela** | "Quem lê a ligação" no painel da análise, com o aviso da 3.6 antes e depois de salvar; "custo não medido" em `/costs` e no detalhe da chamada; a confirmação de remover a chave quando o cérebro é o escolhido; as lacunas 1, 2, 4 e 5 do parecer do #350 (limite por cérebro com teste; refresh falho devolve a lista guardada com `stale`; filtro zod item a item na escrita; usar ou remover `modelsTitle`) | `apps/panel/src/app/(app)/settings/page.tsx` (só o painel da análise), `apps/panel/src/server/costs.ts`, `apps/panel/src/app/(app)/costs/**`, `apps/panel/src/app/(app)/calls/[id]/**` (só a marca de custo), `apps/panel/src/server/brains.ts`, `apps/panel/src/app/(app)/settings/brains/**`, i18n, `.changes/` |

**Fatia 4b, ajuste de 16/11 (Arquiteto, ao abrir a fatia):**

- **Parte do ramo do #354** (`feat/cerebro-analise-rotina`, `7fcea3a`), porque a tela lê
  `calls.analysis_brain` e `usage_ledger.cost_measured`, que só existem nele. O PR aponta para
  `main` e fica em rascunho até o #354 ser mesclado; depois disso, o ramo recebe a `main`. Se o #354
  mudar de head antes do merge, a 4b recebe o ramo novo.
- **Entram também as lacunas 1 e 2 do parecer do Verificador 2 no #354:** um teste em que
  `calls.analysis_brain` fora da forma (gravado à mão) dá `brain_unavailable` e nunca cai no motor;
  e o teste "remover a escolha volta ao `classify_target`" passa a gravar a escolha, ler, remover e
  ler de novo (ou troca de nome para o que mede). Arquivo a mais:
  `apps/routines/src/routines/classify_call_outcome.db.test.ts` (só testes).
- **Não toca** `settings/layout.tsx` nem `apps/voice`: a fatia 7 da R12 (trilha A) abre
  `/settings/speech-filter` ao mesmo tempo. Choque possível em `server/settings.ts` e em
  `calls/[id]/**`; são acréscimos, e quem chegar depois faz o merge da `main`.
- **Não medido pelo Arquiteto:** não li o diff do #354 inteiro.

Choque possível com a trilha A: `apps/panel/src/i18n/*/timeline.ts` (frases de motivo) e
`packages/voice-engine/src/index.ts`. O vocabulário do motivo da análise mora na própria rotina
(`AnalysisNotDoneReason`), e não em `packages/core/src/types.ts`; a fatia 4a não precisa tocar ali. As duas são acréscimos de linha; quem chegar depois faz o
merge da `main`.

O motor em pipeline (R5) e os analistas ao vivo (R6) usam `loadBrains` e `completeJson` (ou um
`complete` de texto livre que eles acrescentam) depois. Nada deles entra aqui.

## 5. Critério de aceite

O que uma pessoa consegue fazer quando terminar:

1. O operador abre "Cérebros", cola as chaves de Anthropic, OpenAI, Gemini, DeepSeek e OpenRouter, e
   em cada uma vê o resultado do teste e a lista de modelos atual daquela chave, com preço, fonte e
   data, ou a marca "sem preço conhecido".
2. Uma chave errada mostra o motivo em frase, sem nenhum pedaço da chave nem texto do provedor.
3. Na seção da análise, ele escolhe um cérebro e um modelo. A próxima ligação terminada é lida por
   esse modelo; a linha do tempo diz qual; o extrato tem a linha com `model` e o custo medido.
4. Escolhe um modelo sem preço: vê o aviso antes e depois de salvar; ligação de agente sem teto não
   é lida e a linha do tempo diz por quê; com teto, é lida e o custo aparece como "não medido".
5. Remove a escolha: a próxima ligação volta a ser lida como antes (motor ou `classify_target`).
6. Quem atualiza e não mexe em nada não vê diferença nenhuma, nem no custo.
7. `pnpm verify` e `pnpm test:db` verdes em cada fatia.

Fracasso mesmo funcionando:

- Lista de modelos escrita no código (um modelo novo do provedor só aparece depois de uma versão).
- Modelo sem preço com custo zero no extrato e nada dizendo que não foi medido.
- Chave em texto puro em qualquer lugar: banco, log, evento, resposta de rota, mensagem de erro,
  fixture de teste com chave que parece real.
- Teste de chave que passa com chave recusada porque a lista é pública (OpenRouter).
- Cérebro escolhido que falha e cai em silêncio no motor, pagando outro provedor.
- Um provedor exigir editar um arquivo índice para aparecer.

E a lista "O que o CI não vê" do `AGENTS.md`, inteira, em toda fatia.

## 6. Fora do escopo

- Reaproveitar a chave do motor de voz no cérebro do mesmo provedor. Evita colar duas vezes, mas
  mistura dois testes de chave diferentes; vira pedido se o dono reclamar.
- Escolha de cérebro por agente (a análise é configuração da organização hoje).
- Provedor com endereço próprio ("custom") no catálogo: o `classify_target` continua cobrindo isso.
  Retirar o `classify_target` é decisão à parte, depois de o catálogo estar em uso.
- Login por assinatura (o "openai-assinatura" da referência).
- Sincronização periódica em segundo plano e catálogo global entre organizações.
- O motor em pipeline (R5) e os analistas ao vivo (R6).

## 7. Pedidos de decisão

Vão ao lote do Líder, no formato do `GOVERNANCE.md`.

**Pedido 1.** Dono: Arquiteto.

## Decisão: modelo sem preço conhecido pode ser escolhido para ler a ligação?

**Quem decide:** dono do projeto
**O que está parado esperando:** fatia 4 da R4 (nada antes dela)

### Opções
- **A.** Pode ser escolhido só com aviso na tela, e só lê ligação de agente com teto de custo ligado.
  Custo: o gasto com esse modelo não entra no teto; o teto só limita a voz da mesma ligação.
- **B.** Pode ser escolhido livremente, com aviso. Custo: gasto sem medida e sem limite nenhum.
- **C.** Não pode ser escolhido. Custo: modelo novo fica indisponível até alguém conferir o preço e
  publicar uma versão (com o pedido 2 em B, isso é sempre).

### Recomendação
A, porque deixa usar o modelo novo que o dono pediu e nunca esconde que o custo não foi medido.

### Se ninguém responder em 3 dias, vale: A (o padrão que a tarefa já trazia)

### Não medido
Quantos modelos de cada provedor ficam sem preço com o pedido 2 em B. Medido só na OpenAI (fatia 1,
16/11): a tabela tem 15 modelos com preço, e os mais novos (`gpt-6*`, `gpt-5.6*`, `gpt-5.5`,
`gpt-5.4`) ficam sem preço. Com C, nenhum desses mais novos poderia ler a ligação. Na fatia 2
(16/11): 17 com preço na Anthropic, 5 no Gemini e nenhum na DeepSeek.

**Pedido 2.** Dono: Arquiteto.

## Decisão: de onde vem o preço dos modelos de OpenAI, Anthropic, Gemini e DeepSeek?

**Quem decide:** dono do projeto
**O que está parado esperando:** nada parado; muda a fatia 2 ou uma fatia 5

### Opções
- **A.** Ler `https://models.dev/api.json` (projeto aberto que publica preço por modelo e provedor,
  usado pela referência para OpenAI e Anthropic), com fonte e data da leitura. Custo: a instalação
  passa a falar com um terceiro, e um preço errado lá vira custo errado aqui.
- **B.** Tabela no arquivo de cada provedor, com a página de preços e a data. Custo: modelo novo
  fica "sem preço" até uma versão; manter a tabela é trabalho a cada lançamento.
- **C.** Não ter preço para esses provedores. Custo: só o OpenRouter teria custo medido.

### Recomendação
B agora, porque não acrescenta dependência externa e é reversível; A fica para depois de medir a
diferença entre os dois em alguns modelos.

### Se ninguém responder em 7 dias, vale: B

### Não medido
A licença e a frequência de atualização do models.dev; quantos preços dele batem com a página do
provedor.

## 8. Não medido

- Os endereços, cabeçalhos e formas de resposta da seção 3.2 vêm da referência em `9dea1ee`, não da
  documentação de cada provedor nesta data. O Desenvolvedor confere e escreve a fonte e a data.
- Se a Anthropic oferece hoje saída estruturada por esquema em `/v1/messages`, ou só por ferramenta.
- Se `GET /models` do OpenAI e do DeepSeek devolve algo que permita filtrar por modalidade sem a
  exclusão por nome.
- O tamanho da lista do OpenRouter (centenas de modelos) dentro de um `jsonb` em `settings`; a
  referência guarda numa tabela. Se passar de algumas centenas de KB, a fatia 3 troca por tabela.
- Nenhum preço citado foi conferido hoje. Nenhum código foi rodado.
