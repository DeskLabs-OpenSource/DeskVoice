# Motor de voz em pipeline: transcrição, cérebro e voz escolhíveis, com ElevenLabs (R5)

> Desenho do Arquiteto, 17/11/2026. Roteiro de novembro, item R5 (DESA-13). Depende da R4 (catálogo de
> cérebros, concluída) e da R12 (transcrição pura, em andamento). A R3 (vocabulário) já está na `main`
> no campo `VoiceSessionConfig.vocabulary`.
>
> **Estado (17/11, documento vivo):** fatia 1a (a voz atrás de uma interface, #393) e fatia 1b (a
> chave e as vozes na tela, #412) na `main`. Fatia 2 (`Brain.chat` em streaming, #419) na `main`,
> com um ajuste ao contrato da seção 3.2 (o consumo nunca fica sem número). A latência do cérebro na
> 3.5 segue **não medida**: a bancada existe, e faltaram as chaves. Fatia 2b (`Brain.chat` na
> Anthropic, com o transporte do streaming separado do formato de cada API, #423) na `main`; fatia 2c
> (`Brain.chat` no Gemini, com o campo `providerState` para a assinatura de raciocínio) no #425.
> Fatias 3 a 6 não começaram.

## 1. O problema

Os motores diretos (Gemini Live, OpenAI Realtime) amarram ouvido, cérebro e voz a um provedor só.
O Rafael pediu três coisas que essa amarração impede: "Adicionar ElevenLabs como modelo de voz", um
cérebro que responda melhor e um ouvido melhor. O pipeline separa as três peças. Cada uma é escolhida
na tela do agente, tem o próprio preço e falha sozinha.

O risco número um é a **latência**. Num motor direto, o modelo ouve e fala no mesmo processo. No
pipeline, cada fala passa por três provedores em série. Se ninguém medir esse tempo, a conversa
fica lenta sem ninguém perceber.

## 2. O que já existe e o que falta

| Peça | Onde está | O que falta para o pipeline |
|---|---|---|
| Ouvido em streaming | Contrato `StreamingTranscriber` + transcritor simulado do **#245** (R12, fatia 2), entra na `main` antes desta frente, sozinho e desligado, pelo #566, que o retoma (exceção à regra 4 aberta pelo Rafael em 25/11, no documento "2026-11-24 — motor em pipeline entra desligado antes da tela" (opção A); a DESA-398 decidiu que as fatias 3 a 5 não esperam o vencedor da R12). A fatia 4 da R12 fica só com a peça do vencedor | Um transcritor real, escolhido pela medida da R12 |
| Vocabulário | `VoiceSessionConfig.vocabulary` (R3, na `main`); `StreamingTranscriber.maxVocabulary` (#245) | Nada: o pipeline repassa o campo à peça de transcrição |
| Cérebro | `Brain` em `packages/voice-engine/src/brains/` (R4, na `main`): `listModels` e `completeJson` | **Conversa em streaming com ferramentas.** Hoje o cérebro só faz um pedido JSON fechado, sem ferramentas e sem streaming |
| Voz | Não existe. A fala é do motor direto | **Contrato de voz** + a ElevenLabs |
| Custo e teto | `meter` em `apps/voice/src/call-session.ts` aplica um preço por trecho (`engine.pricing`), grava o extrato em `usage_ledger` (com `model`, `cost_measured` e `cost_estimated`) e confere `reachCeiling` | Três linhas por trecho (ouvido, cérebro e voz), cada uma com o próprio preço |
| Fala de falha | Motor que cai: `engine_failed` + **tom** de falha (`failureTone`). A voz morreu junto e não sobra quem fale | No pipeline, a voz continua viva quando cai o ouvido ou o cérebro. Ela precisa falar |

## 3. O contrato

### 3.1 A voz: `SpeechSynthesizer`, uma peça por arquivo em `packages/voice-engine/src/synthesizers/`

Descoberta pela pasta (`loadSynthesizers`), no mesmo molde de `loadTranscribers` do #245. A cerca
`fences/one-file-per-piece.test.ts` passa a cobrir a pasta, e a régua de
`docs/doctrine/um-arquivo-por-peca.md` ganha a linha "Voz do pipeline".

```ts
export interface SynthesizerVoice {
  id: string;
  name: string;
  /** Idiomas que o provedor declara verificados para a voz (`pt-BR`, ...). Vazio quando não declara. */
  languages: readonly string[];
  /** Amostra que o provedor hospeda: tocar não gasta crédito. */
  previewUrl?: string;
}

export type SynthesizerVoicesResult =
  | { ok: true; voices: SynthesizerVoice[] }
  | { ok: false; failure: BrainFailure; status: number | null };

/** O preço por caractere, que é como a ElevenLabs cobra. */
export interface SynthesizerPricing {
  centsPerThousandCharacters: number;
  source: string;
  checkedOn: string; // AAAA-MM-DD
}

export interface SpeechEvents {
  /** PCM16 mono 8 kHz, como `VoiceSessionEvents.audio`. */
  audio(pcm16_8k: Buffer): void;
  /** O que já virou áudio, em caracteres, para cortar a fala do agente na interrupção (fatia 4). */
  spoken(chars: number): void;
  /** Incremento do que foi ENVIADO ao provedor, com o custo. É por aqui que o `cancel` cobra. */
  usage(usage: SpeechUsage): void; // { characters; costMicrocents?; estimated: true }
  /** Esta fala terminou de gerar. Não vem depois de `cancel`. */
  done(): void;
  error(error: Error): void;
}

export interface Speech {
  on<K extends keyof SpeechEvents>(event: K, handler: SpeechEvents[K]): void;
  /** Texto em pedaços, como o cérebro entrega. `flush` força a geração do que já chegou. */
  push(text: string, options?: { flush?: boolean }): void;
  end(): void;
  /** Interrupção: para de gerar e descarta o que não saiu. O que já foi enviado ao provedor é cobrado. */
  cancel(): void;
}

export interface SpeechSynthesizer {
  id: string;
  label: string;
  provider: string;
  processingLocation: ProcessingLocation;
  /** O modelo usado quando a escolha não diz outro. */
  defaultModel: string;
  /** O preço do modelo padrão. */
  pricing: SynthesizerPricing;
  /** O preço de um modelo; `undefined` é "sem preço conhecido", nunca zero. */
  pricingOf(model: string): SynthesizerPricing | undefined;
  keyless?: boolean;
  /** Onde a pessoa pega a chave (o link da tela). */
  keyUrl?: string;
  listVoices(apiKey: string, options?: KeyCheckOptions): Promise<SynthesizerVoicesResult>;
  checkKey(apiKey: string, options?: KeyCheckOptions): Promise<KeyCheck>;
  /** Abre uma fala. Lança `SynthesizerOpenError` com o motivo no vocabulário fechado. */
  speak(config: { voiceId: string; language: string; model?: string }, apiKey: string, options?: ConnectOptions): Promise<Speech>;
}
```

O custo da voz é **caracteres enviados × preço**. A API de streaming da ElevenLabs não devolve o
consumo na resposta (fonte na seção 7). Por isso a linha do extrato sai com `cost_estimated = true`,
até uma rodada com a conta real comparar a contagem com o consumo da conta (fatia 1, item 7). Se a
contagem bater, a marca vira `false` num PR à parte, com a medida.

### 3.2 O cérebro conversa: `Brain.chat`, opcional

```ts
/** `providerState`: opaco; devolva como veio. Hoje só o Gemini usa (assinatura de raciocínio). Fatia 2c. */
export interface BrainToolCall { id: string; name: string; args: string; providerState?: string }

export interface BrainChatMessage { role: "system" | "user" | "assistant" | "tool"; content: string; toolCallId?: string; toolCalls?: BrainToolCall[] }

export interface BrainChatEvents {
  /** Texto da resposta, em pedaços, assim que chega. */
  text(delta: string): void;
  /** O modelo pediu uma ferramenta. `args` é texto: quem executa valida com zod (convenção 16). */
  toolCall(call: BrainToolCall): void;
  /** Consumo do pedido: exatamente um por pedido que saiu. `estimated` diz se o provedor declarou. */
  usage(usage: Usage, estimated: boolean): void;
  done(): void;
  error(failure: BrainFailure, status: number | null): void;
}

export interface BrainChat {
  on<K extends keyof BrainChatEvents>(event: K, handler: BrainChatEvents[K]): void;
  /** Interrupção: aborta o pedido em voo. */
  cancel(): void;
}

// Em Brain:
chat?(apiKey: string, request: { model: string; messages: BrainChatMessage[]; tools: ToolSpec[]; timeoutMs: number }, options: { fetch?: typeof fetch }): BrainChat;
```

**O consumo nunca fica sem número (ajuste da fatia 2, DESA-113).** Todo pedido que saiu emite
**exatamente um** `usage` antes do fim (`done`, `error`, ou depois do `cancel`). Quando o provedor
declarou o consumo no último pedaço, vai `estimated: false`. Quando não declarou (corte, prazo,
`cancel`, provedor que não manda), vai `estimated: true`, pela regra do Jev (`deciders/jev.ts`): a
entrada é um token por byte UTF-8 de `messages` + `tools` enviados, e a saída, um por byte do texto, do
raciocínio e dos `args` já recebidos. A resposta de erro HTTP (fora de 2xx) é recusa e vem com
`usage({}, false)`, como no Jev. Esse `{}` com `false` só vale custo zero quando o fim é `error` com
status fora de 2xx; em qualquer outro fim (`done`, `cancel`, ou `error` com status 200 ou `null`), é
**custo não medido**, nunca zero (no #423: a escrita em cache que a Anthropic declarar). Quem soma o
custo lê o `usage` junto com o fim, como o `brainCost` da R4 lê o status. O pedido que nem saiu (a rede recusou a conexão, ou `cancel` no
mesmo giro de `chat`) não tem `usage`. `stream_options.include_usage` vai à OpenAI e à DeepSeek, que o
documentam, e não ao OpenRouter, que o marca como obsoleto e sem efeito (o consumo vem sempre).

Opcional como `classifyOutcome`: cérebro sem `chat` não aparece na lista do pipeline. Primeiro entram
os três que falam `/chat/completions` com `stream: true` e `tools` (OpenAI, OpenRouter e DeepSeek),
por um caminho comum em `brain-http.ts`. Anthropic entrou na 2b, e o Gemini na 2c. Na 2b o
caminho comum foi dividido em transporte (`chatTransport`: o pedido, o prazo, o SSE, o `usage` único e
a estimativa) e formato (`ChatFormat`: o corpo e a leitura de cada `data:`), e a Anthropic usa o
transporte com o formato da API de mensagens. O `toolCall` sai quando a ferramenta fecha, antes do fim:
pode vir `toolCall` e depois `error`, e isso é válido no contrato.

**O Gemini e o campo `providerState` (fatia 2c).** O Gemini usa o mesmo transporte, com o formato de
`POST /v1beta/models/{model}:streamGenerateContent?alt=sse` e a chave só em `x-goog-api-key`. A fonte
(https://aistudio.google.com/docs/thought-signatures.md?generate-content=true, lida em 17/11/2026) diz
que a assinatura de raciocínio é obrigatória: "If you omit a `thought_signature` for the first
`functionCall` part in any step of the current turn, the request will fail with a 400 error". Ela vem
**na parte** da `functionCall` (nas paralelas, só na primeira) e volta "exactly as received". Por isso o
`toolCall` e o `toolCalls[]` ganharam `providerState?: string`: texto opaco do provedor, que quem chama
devolve na mensagem `assistant` seguinte, junto da chamada, sem ler nem alterar. OpenAI, OpenRouter,
DeepSeek e Anthropic não emitem e ignoram o campo. A tradução:
- `system` vai para `systemInstruction`, uma parte por mensagem, na ordem;
- `assistant` vira `role: "model"`, com uma parte `functionCall` por chamada e a `thoughtSignature` na
  mesma parte. A primeira `functionCall` de cada passo do turno atual que chega sem `providerState`
  (histórico de outro cérebro, troca de cérebro no meio da ligação) leva a assinatura fictícia
  `skip_thought_signature_validator`, que a FAQ da mesma página permite e diz "strongly discouraged".
  A fictícia nunca vai numa chamada com assinatura de verdade;
- os `tool` seguidos viram uma só mensagem `user` com uma `functionResponse` cada, na ordem das
  chamadas e depois de todas elas (intercalar dá 400). O `name` sai da chamada; o `response` é o
  `content` se for objeto JSON, senão `{ result: content }`;
- as ferramentas vão em `functionDeclarations[].parametersJsonSchema`, o JSON Schema do `ToolSpec`
  como está (https://aistudio.google.com/api-reference/generate-content, lida em 17/11/2026);
- na leitura, `functionCall.args` (objeto) vira texto com `JSON.stringify`, a única exceção a "args como
  veio". Sem `functionCall.id`, o id é gerado aqui e não volta ao Gemini. A parte `thought: true` conta
  só na saída estimada. O `usageMetadata` vale o último pedaço, e a saída soma `candidatesTokenCount` e
  `thoughtsTokenCount`. `STOP` e `MAX_TOKENS` terminam em `done`; os outros `finishReason` (bloqueio,
  chamada mal formada, assinatura ausente) e o `promptFeedback.blockReason` terminam em
  `error("unexpected_response", 200)`.

### 3.3 O motor: `packages/voice-engine/src/engines/pipeline.ts` (desde a fatia 5b-1; antes, `src/pipeline-engine.ts`)

Implementa `VoiceEngine` com `id: "pipeline"`. **Mora fora de `engines/` até a fatia 5** (decisão B da
DESA-418): `loadEngines()` e o painel oferecem como motor tudo o que está naquela pasta, e o pipeline
não pode aparecer antes da tela que o escolhe. Quem o abre é `call-session.ts`, por
`createPipelineEngine()`, só para o agente com `agents.pipeline` preenchida. O `connect` recebe, além do `VoiceSessionConfig`, a
escolha do agente: `{ transcriber, brain, model, synthesizer, voiceId }` e uma chave por peça. As
chaves são as que já existem: `brain.<id>.api_key` (R4), a do transcritor (R12, fatia 4) e
`synthesizer.<id>.api_key` (fatia 1b), todas cifradas (convenção 12). A forma exata de passar as
três chaves sem alargar o `connect` de todos os motores é decisão da fatia 3: a sugestão é um
`PipelineConnectOptions` que só o pipeline lê.

O laço de um turno:

1. O áudio de quem ligou vai à peça de transcrição. Trecho com texto novo vira `callerActivity({ words: true })`.
2. O fim do turno é o trecho `final` da peça. Na falta dele, vale a guarda contra o silêncio (R11) pelo
   `closeCallerTurn`, que o pipeline atende pedindo à peça o fechamento ou usando o último parcial.
3. A fala final vai ao cérebro (`chat`), com o histórico, as instruções e as ferramentas.
4. Cada pedaço de texto do cérebro vai direto à voz (`push`), com `flush` no fim de frase. A voz não
   espera a resposta inteira.
5. Pedido de ferramenta: o pipeline emite `toolCall`. A resposta volta por `sendToolResult` e reabre o
   cérebro. Enquanto a ferramenta roda, não há fala de espera na v1 (fica de fora).
6. `say(text)` vai direto à voz, sem passar pelo cérebro.
7. `guide(text)` (R6) entra como mensagem `system` no próximo pedido ao cérebro.

**Custo por peça.** Um evento novo e opcional em `VoiceSessionEvents`:

```ts
/** Só motores com peças separadas. Incremento de uma peça, já com o custo calculado pelo preço dela. */
pieceUsage(line: { piece: "transcriber" | "brain" | "synthesizer"; id: string; model?: string; usage: Usage; characters?: number; costMicrocents?: number; estimated: boolean }): void;
```

**`costMicrocents` é opcional:** ausente é custo **não medido** (a peça sem preço conhecido), nunca
zero. O cérebro que termina sem declarar consumo (o `{}` fora da recusa HTTP, como a escrita em cache
da Anthropic) sai, com o preço conhecido, **estimado** pelo que foi e voltou, um token por byte (a
regra do Jev), com `estimated: true`. O `{}` da recusa HTTP é zero medido.

O `call-session.ts` grava uma linha de `usage_ledger` por evento (`chargePiece`): `engine` =
`<peça>:<id>` (o mesmo rótulo `transcriber:<id>` do #245), `model`, `cost_microcents`,
`cost_estimated` e `cost_measured` (falso quando `costMicrocents` veio ausente). Cada linha conta para
o teto, como o filtro e o analista. A linha que chega depois do `closed` (o cérebro cancelado no fim)
também entra. Motor que não emite `pieceUsage` continua no caminho de `usage`, sem mudança.

**A escolha das peças** fica em `agents.pipeline` (fatia 3). A sessão as monta pela pasta
(`loadTranscribers`, `loadBrains`, `loadSynthesizers`, lidas na primeira ligação que pede o pipeline),
com a chave de cada uma na organização (`transcriber.`, `brain.` e `synthesizer.<id>.api_key`) e o
preço do modelo do cérebro na lista `brain.<id>.models`. Peça não instalada, cérebro sem `chat` ou
chave que falta é recusa de abertura (`call_refused` com `piece`). A recusa de uma peça ao abrir
(`PipelineOpenError`) traz o que a abertura já gastou, as falas fixas sintetizadas antes de a outra
peça recusar, e esse custo entra no extrato da tentativa.

**Teto.** O `reachCeiling` de hoje dispara a despedida. No pipeline, a despedida também custa voz.
Por isso as falas fixas da ligação (`FAREWELL.costCeiling`, a fala de falha da seção 3.4 e, só
quando o trecho transfere, `costCeilingTransfer`) são **sintetizadas na abertura** e guardadas em
memória. A despedida que promete transferência segue a mesma regra de `transferOnFailure` (o agente
com `transfer_to_e164`, o canal que transfere, a ligação que não voltou de uma transferência): sem
ela, o teto toca a que não promete, e as falas prontas não crescem (fatia 4, ponta da 3c-2). Na hora
do teto, o áudio já está pronto e não há gasto novo. O custo dessa síntese entra no extrato da
ligação que a fez, **mesmo quando a sessão nunca entra na linha**: a abertura que termina durante ou
logo depois do fim da ligação (o trecho de volta da transferência, a passagem) fecha emitindo esse
custo, e a sessão o grava, depois do `call_ended` se for o caso. O custo que saiu do provedor
aparece; a linha de zero medido (o ouvido que fechou sem ouvir nada) não entra. Um cache por processo, com a chave `(organização, sintetizador, voz, modelo, texto)`, evita
pagar de novo na ligação seguinte com a mesma voz. **O cache não atravessa organizações:** cada
organização paga e usa só o que a chave dela sintetizou, mesmo quando duas usam o mesmo `voiceId`.
E a abertura confere a chave da organização a cada ligação, mesmo quando todas as falas vêm do
cache: chave recusada é recusa de abertura, com ou sem cache. As duas despedidas chegam ao motor por
`PipelineConnectOptions.fixedSpeech`, e o `reachCeiling` de hoje as toca por `say` com o mesmo texto:
o motor acha o áudio pronto e não abre fala nova.

**A nota da chave: quanto pesa a abertura (3c-1).** Uma vez por ligação de pipeline, o `call_answered`
leva `opening`: `{ transcriberMs, fixedSpeechMs, keyCheckMs, fixedSpeech, fromCache, totalMs }`, em ms,
pelo `Clock` da sessão (`PipelineConnectOptions.clock`). As duas etapas correm juntas: a transcrição
abrindo (é o que prova a chave dela) e as falas prontas. Sem cache, a própria síntese prova a chave da
voz, e não há conferência à parte (`keyCheckMs: null`). Com alguma fala no cache, o `checkKey` da voz
roda junto, e `keyCheckMs` é o tempo dele: é esse o pedido a mais que a nota da revisora no #390
apontou. A chave do cérebro não é conferida na abertura: ela se prova no primeiro pedido. O trecho de
volta da transferência e a passagem para outro agente abrem de novo, mas não gravam outra nota. Sem
`clock`, o motor não mede, e a nota não sai. **Não medido:** o valor real de cada etapa contra um
provedor, sem chave (seção 6.1). Os testes só provam a conta com o relógio falso.

**O pior caso antes de cada pedido ao cérebro (3b-2).** Todo pedido de `chat` leva
`BrainChatRequest.maxTokens`, que o motor preenche com `PIPELINE_BRAIN_MAX_TOKENS` = 4 096, e cada
cérebro o manda no campo do provedor: `max_completion_tokens` na OpenAI, `max_tokens` no DeepSeek, no
OpenRouter e na Anthropic (no lugar dos 16 000 fixos, só no `chat`), e `generationConfig.maxOutputTokens`
no Gemini. O `completeJson` (a análise e o desfecho) não muda de corpo. Antes de cada pedido, inclusive
o que reabre o cérebro depois de uma ferramenta, o motor soma a entrada estimada (um token por byte do
que vai em `messages` e `tools`, a regra do Jev) e `maxTokens`, pelo preço do modelo, e confere contra
o que sobra do teto, que a sessão entrega por `PipelineConnectOptions.ceiling` (o teto menos o custo
somado da ligação, em micro-centavos, sem arredondar). Se passar, o pedido não sai, e a sessão toca a
despedida do teto pronta, como o `reachCeiling` de hoje (`cost_ceiling_reached` com
`brainWorstCase: true` e o `brainWorstCaseMicrocents`). Isso resolve, no pipeline, a pendência da R12
"reserva em voo que passa do pior caso". Sem teto, nada é conferido. **Não medido:** os nomes dos
campos num provedor real, e se 4 096 tokens cortam alguma resposta de ligação.

**A peça sem preço (3b-2).** A sessão recusa abrir o pipeline quando uma peça não tem preço conhecido,
com ou sem teto: o modelo do cérebro fora da lista `brain.<id>.models` com preço, ou a voz sem
`pricingOf` para o modelo dela (a escolha não traz modelo da voz: vale o `defaultModel`). Sem teto, a
linha do extrato sairia sem custo; com teto, a promessa dele não se cumpriria. A transcrição tem
`pricing` obrigatório no contrato. A recusa é `call_refused` com `piece`, `pieceId`, `model` e o motivo
`pipeline_piece_unpriced` (o fim da chamada também), com frase na linha do tempo nos três idiomas e
uma linha no `diagnostico.md` das duas cópias da skill. O motivo **fica fora** de `KEY_CHECK_RESULTS`,
como o `brain_unmeasured_without_ceiling` da rotina: uma chave não fica "sem preço". Para quem já
instalou, nada muda (a coluna está nula). Na fatia 5, a tela só oferece modelo e voz com preço, e a
recusa fica como rede de proteção. O motor, por sua vez, não faz pedido com teto e sem preço do
cérebro: o pior caso não tem conta.

### 3.4 A falha (antipadrão 15)

| Peça que falha | Quem ligou ouve | O painel recebe |
|---|---|---|
| Voz, ao abrir | O tom de falha (o caminho de hoje: `call_refused`/`engine_refused`) | `call_refused`, com `detail` dizendo que foi a voz |
| Voz, no meio | A fala de falha **pré-sintetizada** e depois o tom. A fala não depende da voz estar viva | `engine_failed` com `piece: "synthesizer"` e o motivo no vocabulário fechado |
| Ouvido, ao abrir | O tom de falha | `call_refused` com `piece: "transcriber"` e o motivo |
| Ouvido, no meio (`closed`) | A fala de falha **pré-sintetizada**, como na voz: não depende de nenhuma fala aberta | `engine_failed` com `piece: "transcriber"` e o motivo do último `error`, se ele veio tipado |
| Ouvido, `error` sem `closed` | Nada: a conversa segue | `pipeline_turn_failed` com `piece: "transcriber"` e o motivo |
| Cérebro, um pedido (prazo, 5xx, 429) | "Desculpe, não consegui responder agora. Pode repetir, por favor?" e a conversa segue | `pipeline_turn_failed` com `piece: "brain"` e o motivo |
| Cérebro, duas vezes seguidas | A fala de falha | `engine_failed` com `piece: "brain"` |

A fala de falha (texto fixo, no padrão de `FAREWELL`) é: "Estou com um problema técnico e não vou
conseguir continuar. Se puder, ligue de novo em alguns minutos. Obrigado." Quando há
`transfer_to_e164` (e o canal transfere, e a ligação não voltou de uma transferência), quem ligou ouve
no lugar dela a **fala de transferência**, também pré-sintetizada: "Estou com um problema técnico e não
vou conseguir continuar. Vou transferir você para uma pessoa da equipe. Um instante, por favor." Depois,
a ligação é transferida. A sessão pede essa fala no `connect` (`transferOnFailure`), e ela fica pronta
**no lugar** da fala de falha, com o mesmo cache por organização. O custo dela entra no extrato e no
teto como o das outras falas prontas. Sem `transfer_to_e164` (ou no canal que não transfere, ou no
trecho de volta), ela não é sintetizada, nem a despedida do teto que promete transferência (fatia 4,
ponta da 3c-2).
O `error` da transcrição sozinho não é fatal (o contrato de `StreamingTranscriptionEvents`): só o
`closed` derruba a sessão. Os eventos levam `piece`, `pieceId` e `detail` (o código). Os eventos usam o vocabulário de
`KEY_CHECK_RESULTS` e nunca repassam o texto do provedor (o texto vai só ao log). Há frase na linha
do tempo nos três idiomas: o CI reprova motivo sem frase.

### 3.5 A latência: orçamento e como medir

**O que se mede:** o tempo entre o **fim da fala de quem ligou** e a **primeira amostra de áudio do
agente entregue ao transporte**. O fim da fala é o `endMs` do trecho final da peça de transcrição,
convertido para o relógio do pipeline. Quando a peça não informa `endMs`, vale a hora em que o trecho
final chegou, e o evento leva a marca `endFromArrival: true`.

**Evento por turno:** `pipeline_turn_latency`, com `{ endpointMs, brainFirstTextMs, voiceFirstAudioMs, totalMs, endFromArrival }`.
`endpointMs` vai do fim da fala ao trecho final. `brainFirstTextMs` vai do pedido ao primeiro texto.
`voiceFirstAudioMs` vai do primeiro `push` ao primeiro áudio. O relógio é o `Clock` da sessão
(convenção 10).

**Como o evento sai (3c-1).** Quem mede é o motor, com o `Clock` que a sessão passa em
`PipelineConnectOptions.clock`. O motor emite `pipelineTurnLatency`, e a sessão grava o
`pipeline_turn_latency` em `call_events`, só com os números, mais `tool` e, depois de uma passagem,
`agentId`. O zero do fluxo da transcrição é a hora do primeiro áudio mandado a ela. O `endMs` que
cairia depois da chegada (o relógio do serviço adiantado) vale como a chegada, com `endFromArrival`, e
nunca dá número negativo. No turno fechado à força (`closeCallerTurn`), vale o `endMs` do último
parcial, e a chegada é a hora do fechamento.
- **Um por turno respondido**, no primeiro áudio da resposta entregue ao transporte. O resto do áudio
  da mesma resposta não emite de novo.
- **Turno com ferramenta:** sai uma vez. A marca sai da **origem do texto que deu o primeiro áudio**
  (fatia 3c-2), e não da ordem entre o áudio e o fim da rodada. `tool: true` quando esse texto foi
  pedido ao cérebro **depois** de uma ferramenta (o pedido que reabriu o cérebro): o `totalMs` inclui a
  ferramenta, e o `brainFirstTextMs` é o desse pedido. Se o cérebro falou antes de pedir a ferramenta,
  o primeiro áudio é dessa fala: `tool: false`, e o `totalMs` vai até ela. O orçamento abaixo é "sem
  ferramenta": a fatia 5 separa por `tool`.
- **Turno sem áudio não emite:** o cérebro que falhou (o "pode repetir?" não é resposta), o teto que
  barrou o pedido, a resposta vazia e a ligação que acabou antes do primeiro áudio. Nenhum número é
  inventado.
- O `turn_latency` de hoje (um por ligação, `turn-latency.ts`) continua como está, também no pipeline.
- A linha do tempo mostra cada turno, com frase nos três idiomas, e o atendimento mostra a nota da
  abertura (3.3).

**Orçamento (p95 por turno, sem ferramenta):**

| Etapa | Orçamento | De onde vem |
|---|---|---|
| Fim da fala → trecho final | 700 ms | A régua da R12 (spec #198) |
| Pedido → primeiro texto do cérebro | 800 ms | **Não medido.** Meta. A bancada da fatia 2 (`scripts/bancada-de-voz/cerebro-primeiro-texto.ts`) existe, com a linha da Anthropic desde a 2b; em 17/11 rodou sem nenhuma das chaves (`BANCADA_OPENAI_API_KEY`, `BANCADA_OPENROUTER_API_KEY`, `BANCADA_DEEPSEEK_API_KEY`, `BANCADA_ANTHROPIC_API_KEY`) |
| Primeiro texto → primeiro áudio da voz | 400 ms | **Não medido.** Meta. A fatia 1 mede na bancada |
| Transporte e ajuste | 100 ms | Pedaço de 20 ms + fila de saída |
| **Total p95** | **2 000 ms** | Soma. **Meta p50: 1 200 ms** |

Esses números são uma régua a confirmar, e não uma medida. As fatias 1 e 2 medem cada etapa, e a
fatia 6 mede o total na chamada real. O resultado vai ao PR e a esta seção. **Acima de 2 000 ms no
p95, a combinação não é proibida, mas a tela do agente mostra o tempo medido** ("Esta combinação
respondeu em 2,4 s na média das últimas ligações"). Latência que inviabiliza a conversa sem estar dita
é o fracasso desta frente. Um tempo alto que está à vista é uma escolha do operador.

## 4. As fatias

Cada fatia cabe numa revisão de uma sentada. A trilha de cada fatia é a primeira que liberar. As
fatias 1a, 1b e 2 **não dependem da R12** e podem começar já.

### Fatia 1a: a voz atrás de uma interface, ElevenLabs e simulada (não espera a R12)

Arquivos: `packages/voice-engine/src/types.ts` (contrato da 3.1), `synthesizers/simulated.ts`,
`synthesizers/elevenlabs.ts`, `load.ts` (`loadSynthesizers`), `fences/one-file-per-piece.test.ts`,
`docs/doctrine/um-arquivo-por-peca.md` (uma linha), `synthesis.ts` (`prepareFixedSpeech`),
`testing/fake-provider.ts` (registro dos cabeçalhos e `rejectUpgrade`),
`scripts/bancada-de-voz/sintetizador.ts` (o nome `voz.ts` já é do Piper, #201) e fragmento.
Sem migration, sem tela e sem `call-session.ts`. (Ajustado em 17/11 pelo que o #393 encontrou.)

Aceite:
1. `elevenlabs.ts` abre `wss://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream-input` com
   `xi-api-key` no cabeçalho, `model_id` e `output_format=pcm_8000`. O PCM sai como PCM16 mono 8 kHz,
   sem reamostrar. Testes contra um servidor falso (`testing/fake-provider.ts`) cobrem: abertura,
   pedaços de texto, `flush`, `isFinal`, `cancel` no meio, recusa 401/402/429 mapeada para o
   vocabulário fechado, e o prazo de abertura.
2. `listVoices` lê `GET /v2/voices` paginado (`page_size` ≤ 100, `next_page_token`, `has_more`) e
   valida cada voz com zod (convenção 16). Voz fora da forma é pulada, sem derrubar a lista.
   `languages` sai de `verified_languages[].locale` ou `.language`.
3. `checkKey` usa a chamada mais barata que prova a chave sem sintetizar. Quem escolhe a chamada é o
   Desenvolvedor, com fonte e data no cabeçalho do arquivo.
4. O preço fica no arquivo com `source` e `checkedOn`, por modelo. Modelo padrão: `eleven_flash_v2_5`.
   Modelo sem preço na tabela = "sem preço conhecido", nunca zero (regra da R4).
5. O custo sai como `characters × centsPerThousandCharacters / 1000`, em micro-centavos, sempre com
   `estimated: true`. Um teste prova que o `cancel` cobra o que já foi enviado, e não zero.
6. A fala de falha e as despedidas do teto são sintetizadas por uma função
   `prepareFixedSpeech(synth, voice, texts)`, com cache em memória pela chave da 3.3, que inclui a
   organização. Os testes provam: a segunda ligação da mesma organização com a mesma voz não pede de
   novo; voz diferente pede; **duas organizações com o mesmo `voiceId` sintetizam duas vezes, e cada
   uma paga a sua**; a chave recusada é recusa de abertura mesmo com o cache cheio; e a falha ao
   preparar é uma recusa de abertura, nunca uma ligação sem fala de falha. (Ajustado em 17/11 pela
   revisão do #393.)
7. Bancada (`scripts/bancada-de-voz/sintetizador.ts`, fora do CI, no padrão de `orcamento.ts`): mede o tempo
   do primeiro `push` ao primeiro áudio (p50 e p95 de 30 falas curtas em pt-BR) e compara os
   caracteres contados com o consumo da conta antes e depois (`character_count` da assinatura, se a
   API expuser; o Desenvolvedor confere e diz). Ela só roda com a chave do pedido de decisão da
   seção 6.1 e com teto próprio. **Sem a chave, o PR diz "não medido"**, e a fatia entra mesmo assim,
   com os testes contra o servidor falso.
8. O simulado (`keyless`) gera um tom curto por caractere, sem rede, para os testes das fatias 3 a 5.

Fracasso mesmo funcionando: cobrar zero quando a fala é interrompida; preço sem fonte e data.

### Fatia 1b: credencial e vozes na tela (não espera a R12)

Rota `api/v1/synthesizers/[id]/key` (gravar cifrada, testar, apagar com confirmação nomeando o
provedor) e `api/v1/synthesizers/[id]/voices` (lista lida da API, sem guardar áudio). A seção
"Voz" fica em Configurações → Inteligência artificial, ao lado de "Cérebros", com o resultado do
teste, a lista de vozes com o idioma e a amostra (`previewUrl`, que não gasta crédito). Textos nos
três idiomas. Settings `synthesizer.<id>.api_key`, sem migration (tabela `settings`).
Aceite: o operador cola a chave, vê "aceita" ou o motivo, vê as vozes com pt-BR primeiro e ouve a
amostra. A chave nunca volta para a tela.
O dado que vai para a ElevenLabs (seção 9.1) entra nesta fatia:
- gravar a chave pede a **confirmação nomeando o fornecedor**, com o texto da seção 9.1. Quem
  confirmou e quando ficam em `synthesizer.elevenlabs.consent` (`{ userId, confirmedAt }`, tabela
  `settings`, por organização). Sem a confirmação, a rota recusa a chave (422), e o teste prova isso;
- o aviso diz o que as páginas da ElevenLabs dizem, sem inventar nem esconder (resposta A da
  DESA-103, 17/11, ver 9.1): o texto fica no histórico dela até alguém apagar a geração ou a conta;
  depois de apagado, fica até 30 dias em cópia de segurança; os registros de depuração e moderação
  não têm prazo; o dado fica **guardado nos EUA**. Onde ela **processa** continua não declarado
  (`processingLocation: undeclared`), e a tela diz isso. Teste: o único nome de país no texto da
  tela é o do armazenamento, e ele aparece junto do endereço e da data da fonte; o aviso não some
  com a chave gravada;
- o guia `docs/guides/voz.md` (três idiomas) registra a leitura, **antes da entrega** desta fatia:
  endereço, data e trecho de cada página (seção 7, "Retenção da ElevenLabs"), e diz que o modo sem
  retenção da ElevenLabs é só do plano Enterprise. Se, na entrega, a página tiver mudado e disser
  outra coisa, o guia e o aviso seguem a página nova e a mudança é contada no PR;
- cada confirmação nova grava também o **recibo** `synthesizer_provider_confirmed` em
  `organization_events`, na mesma transação, no molde do `analyst_provider_confirmed` (#386):
  `actor_user_id` de quem confirmou e payload `{ synthesizerId, provider, confirmedByName }`, com o
  nome gravado no momento. O tipo entra em `ORG_EVENT_KINDS` (`packages/core`), sem migration, e a
  linha aparece no histórico de Privacidade, nos três idiomas. O recibo é só de acréscimo: a
  `settings` diz se a chave de hoje está confirmada, e o recibo guarda quem confirmou e quando,
  mesmo depois de a pessoa sair da equipe ou de a chave ser apagada. (Ajustado em 17/11 pela
  revisão do #390.) Teste: confirmar grava um recibo, com o nome e sem e-mail; testar de novo a
  mesma chave não grava outro; apagar a chave apaga a confirmação da `settings` e deixa o recibo; a
  gravação recusada por falta de confirmação (422) não grava recibo;
- apagar a chave apaga a confirmação. Uma chave nova pede confirmação nova, com recibo novo.
A sobra da 1a (o teste do fechamento 1000 depois do `end()`) saiu desta fatia e foi feita à parte
(DESA-104, #407).
O corpo do PR cita a resposta do Rafael na DESA-103 ("pode seguir com sua recomendação", 17/11,
17:11Z), e o Verificador confere a citação. Os arquivos que a fatia toca ficam em `apps/panel`
(rotas `api/v1/synthesizers/[id]/key` e `voices`, a seção "Voz" em `settings`, o histórico de
Privacidade e os textos em `i18n`), em `packages/core/src/types.ts` (`ORG_EVENT_KINDS`), no máximo
em `packages/voice-engine/src/synthesizers/` (ler a lista de vozes) e em `docs/guides/voz.md`. Não
toca `apps/voice` nem `call-session.ts`, nem migration.

### Fatia 2: o cérebro conversa em streaming, com ferramentas (não espera a R12)

`Brain.chat` (3.2) em `brain.ts`, com o caminho comum em `brain-http.ts` (SSE de
`/chat/completions` com `stream: true`, `tools` e `stream_options.include_usage` onde o provedor
documenta) para OpenAI, OpenRouter e DeepSeek. Testes contra servidor falso: texto em pedaços,
`tool_calls` montados a partir dos deltas, consumo no último pedaço, `cancel` que aborta, prazo e
recusa no vocabulário fechado. A bancada mede o tempo do pedido ao primeiro texto (p50/p95, 30
pedidos curtos) com as chaves que a R4 já usa. Sem chave, "não medido".
Fracasso mesmo funcionando: argumento de ferramenta aceito sem zod; custo zero quando o provedor não
declarou consumo (precisa ser estimado pela entrada, `cost_estimated`, como na R12).

### Fatia 3: o motor pipeline, pelo caminho simulado (sobre o #245, que entra antes)

`engines/pipeline.ts` costura transcritor, cérebro e voz (3.3). Na escolha do agente entra uma
migration: `agents.pipeline jsonb` com `{ transcriber, brain, model, synthesizer, voiceId }`, nula
para quem não usa. O carimbo é a hora real (`date -u +%Y%m%dT%H%M%S`), nunca futura. Em
`call-session.ts`, entram o `pieceUsage` no `meter`, a falha por peça (3.4) e o
`pipeline_turn_latency`. O motor mora em `src/pipeline-engine.ts` até a fatia 5 (3.3).

A fatia foi cortada em quatro: a **3a** (o motor com as peças injetadas, sem banco, #567), a **3b-1**
(a coluna, as peças montadas na sessão, uma linha por peça, as despedidas prontas, a falha por peça
até o painel e o `error` não fatal da transcrição), a **3b-2** (DESA-425: o pior caso antes de cada
pedido ao cérebro, com o `maxTokens`, e a recusa da peça sem preço, na 3.3) e a **3c** (`pipeline_turn_latency`,
a nota da chave e a corrida da transferência com volta). A 3c foi cortada em duas: a **3c-1**
(DESA-427: o `pipeline_turn_latency`, a nota da chave, a L1 da DESA-421 e as duas ressalvas da
DESA-426) entrou; a **3c-2** (DESA-430: a corrida do fim de chamada na volta, a fala de transferência
pronta quando a peça cai com `transfer_to_e164`, 3.4, a regra da marca `tool`, 3.5, e as ressalvas da
DESA-428) entrou. **A fatia 3 terminou.** A corrida do fim de chamada na volta: se a ligação acaba
durante a transferência, enquanto as peças do trecho de volta abrem ou logo depois, as peças abertas
fecham, nenhuma fica viva depois do `call_ended`, nada é gravado depois do fim e nenhuma síntese nova é
pedida (testado com o banco, nas quatro ordens). Prova de ponta a ponta com transcritor simulado, cérebro em servidor falso e
voz simulada: uma ferramenta no meio da conversa, três linhas no extrato e o teto que dispara a
despedida pré-sintetizada. Quem já instalou não precisa fazer nada: sem `agents.pipeline`, nada muda.
A fala aberta e parada morre no `inactivity_timeout` da ElevenLabs (20 s) com `error`. Esta fatia
decide e testa: ou abre a fala só quando o cérebro começa a responder, ou trata esse `error` como
fim sem falha.
A 3.3 confere a chave da organização em toda abertura, mesmo com o cache cheio (nota da revisora no
#390). Isso pode ser um pedido a mais antes do primeiro áudio. Esta fatia diz quanto ele pesa na 3.5,
ou mostra que a própria abertura da fala já serve de prova da chave e dispensa o pedido. (3c-1: a nota
da chave está na 3.3. Sem cache, a síntese prova a chave e o pedido não sai; com cache, ele sai, e o
tempo dele vai no `call_answered`. O valor real é **não medido** sem chave.)

### Fatia 4: interrupção

Fala de quem ligou durante o áudio do agente (`callerActivity` com `words: true`, ou trecho parcial
com texto) → `speech.cancel()`, `chat.cancel()` e o evento `interrupted`. A fala do agente gravada no
histórico e na transcrição é cortada no que já saiu (`spoken`). Com ruído (`listeningEnvironment:
"noisy"`), só texto interrompe; o início de fala sozinho não interrompe (lição da R11). Os testes
provam o corte, o custo do que já foi enviado e que o próximo pedido ao cérebro leva a fala cortada.

**Como ficou (DESA-432).**

- **Só a resposta do cérebro se interrompe, e só quando é ela que está saindo** (a primeira da fila de
  saída, ainda gerando ou entregando áudio). O `say` (a saudação, a guarda, o "pode repetir?", as
  despedidas) e as falas prontas saem inteiras: a despedida do teto ou da falha nunca é cortada, e a
  fala pronta atrás da resposta cortada toca do mesmo jeito. Com a fala pronta tocando sozinha, quem
  ligou não interrompe nada.
- **O gatilho é texto novo da transcrição**, o mesmo `callerActivity({ words: true })`, parcial ou final.
  A transcrição não tem sinal de início de fala, então a regra do modo Barulhento ("só texto
  interrompe") vale nos dois ambientes: o trecho sem palavra nunca corta o agente.
- **O corte é o `spoken` do áudio já entregue** a quem abriu (o `spoken` do áudio que ainda espera na
  fila não conta), em pontos de código, sem o espaço do fim. A mensagem da resposta no histórico passa a
  ser a fala cortada (com as ferramentas, se pediu; sem nada ouvido e sem ferramenta, ela sai do
  histórico). O pedido aberto é cancelado, e o que ele já tinha dito entra cortado do mesmo jeito.
- **A fala do agente vai à transcrição quando acaba de sair**, inteira, ou cortada na interrupção e no
  fim da sessão (antes do `closed`). Antes desta fatia, ela ia no fim do pedido ao cérebro, com o áudio
  ainda saindo. Por isso, no painel, a fala de antes de uma ferramenta pode aparecer depois do
  `tool_called`, e a fala que o cérebro disse antes de falhar, depois do "pode repetir?".
- **O custo:** a voz cobra no envio (`push`), então o que foi enviado antes do `cancel` está no extrato e
  no teto; o texto que esperava a voz abrir não foi enviado, e não é cobrado. O pedido cancelado emite o
  consumo dele (estimado, a regra da 3.2), que entra no extrato e no teto.
- **Durante a ferramenta:** a fala de antes dela é cortada, a ferramenta segue, e o resultado entra no
  histórico. Ele não reabre o cérebro sozinho: o próximo pedido é o da fala nova de quem ligou (o trecho
  final, ou a guarda que fecha o turno pelo parcial), com o resultado e a fala cortada antes dela.
- **Não medido:** a janela da interrupção é a da geração e entrega do áudio pelo motor, e não a da
  reprodução na linha. Com a voz real mais rápida que o tempo real, a resposta já entregue inteira ao
  transporte, que ainda toca, não se interrompe, e o corte conta como ouvido o que o transporte ainda
  não tocou. O `played(ms)` do transporte (o Asterisk já mede) é o caminho para a fatia 6, com a medida.
  Também não medido: o eco da própria voz do agente transcrito como fala de quem ligou, e a conta do
  `spoken` da ElevenLabs (o `alignment`) contra o texto enviado.

### Fatia 5: a tela do agente

Na tela do agente, "Pipeline" aparece como motor. Ao escolhê-lo, surgem três escolhas: a transcrição,
o cérebro e o modelo (da lista da R4, só cérebros com `chat`) e a voz (da lista da 1b, com amostra).
O custo por peça aparece no detalhe da chamada e em Custos. A latência medida (p50 das últimas
ligações, pelo `pipeline_turn_latency`) aparece ao lado da escolha, com o aviso quando passa do
orçamento. Chamada pelo navegador (decisão 0008) com o pipeline. O motor sai de
`src/pipeline-engine.ts` para `engines/pipeline.ts`, com `default`, só aqui, junto com a escrita em
`agents.pipeline`. Ela entra na prova de primeira
impressão do CI pelo caminho simulado.
Ao lado de cada escolha que não roda neste servidor (transcrição e voz), a tela repete o aviso da
seção 9.1 e diz se já foi confirmado, por quem e quando. O servidor recusa salvar um agente com uma
peça cujo `processingLocation` não é `this-server` e que não tem confirmação gravada (422, com o motivo
na tela). O teste prova a recusa pela API, sem a tela.

**5a (o servidor, sem tela; DESA-434).** A rota do agente (`POST` e `PATCH /api/v1/agents`) aceita
`pipeline`, na mesma forma que a sessão lê (`pipelineChoice`, em
`packages/voice-engine/src/pipeline-choice.ts`, uma só para as duas), ou `null`. A conferência fica em
`apps/panel/src/server/pipeline.ts` (`requirePipeline`), e cada recusa é 422 com a peça no `detail`:
`pipeline_piece_unknown` (a peça fora da pasta), `pipeline_piece_test_only` (a peça simulada, que só os
testes aceitam, por `ServerDeps.simulatedPieces`), `pipeline_brain_cannot_chat`, `pipeline_piece_unpriced`
(a mesma regra da abertura, `pricePipeline`) e `pipeline_piece_unconfirmed` (seção 9.1: a voz sem
`synthesizer.<id>.consent`; a transcrição de fora sempre, até a R12 trazer a confirmação dela). Salvar
outro campo não regrava a escolha. Gravar `pipeline` não troca o `engine`: com a coluna preenchida, a
sessão abre o pipeline e o `engine` fica sem uso (a chamada simulada segue no motor do roteiro); com a
coluna nula, vale o `engine`, como sempre. A coluna gravada à mão fora da forma recusa a ligação com o
motivo, e não cai no motor direto. Ficam para a 5b e a 5c o motor em `engines/pipeline.ts`, a lista, a
tela, a prévia, o custo por peça no detalhe e em Custos, e a latência ao lado da escolha.

**5b-1 (a tela do agente, com o Pipeline desligado; DESA-436).** O motor mora em `engines/pipeline.ts`,
com `default` e a marca `assembled`, e o contrato (`PipelineEngine`, `isPipelineEngine`) fica em
`types.ts`: a sessão o acha em `loadEngines()`, como os outros motores, sem importar o arquivo, e o índice
do pacote não o reexporta (a cerca `one-file-per-piece` reprova o índice que importa duas peças pelo nome).
`/api/v1/engines` o devolve com `assembled: true` e `unavailable: { reason: "no_live_transcriber" }`
enquanto a pasta não tiver transcrição fora a simulada; os outros motores saem sem campo novo. Ninguém
grava o pipeline como `engine`: a rota do agente e `engine.default` recusam, e a sessão recusa o `engine =
'pipeline'` gravado à mão sem abrir nada. A abertura confere, além da chave, a confirmação da 9.1 da voz
de fora do servidor (`synthesizer.<id>.consent`), a cada ligação: sem ela, `call_refused` com
`pipeline_piece_unconfirmed` e a peça, antes de qualquer peça abrir (o motivo fica fora de
`KEY_CHECK_RESULTS`, como o da peça sem preço). Na tela do agente, o campo Motor mostra "Pipeline"
desligado, com a linha do motivo, e o agente novo nunca nasce nele. O bloco "Pipeline" mostra as três
escolhas só para ver e ouvir, e nada dele entra no salvar: a transcrição que falta; o cérebro com `chat` e
a chave aceita, e o modelo com preço (`pricedBrainModels`, a mesma regra de `pricePipeline`); e as vozes da
conta da ElevenLabs, pela rota da 1b, com o rótulo do fornecedor e o Ouvir da 1a tocando o `previewUrl`
(`preload="none"`; o `play()` recusado diz o erro). Ao lado da voz e da transcrição, o aviso da 9.1, com
quem confirmou e quando. A linha da ElevenLabs no campo Voz aponta para o bloco. Ficam para a 5b-2 a
chamada pelo navegador com o pipeline e a prova de primeira impressão pelo caminho simulado; para a 5c, o
custo por peça e a latência ao lado da escolha.

**5b-2 (a chamada pelo navegador e a prova de primeira impressão, pelo caminho simulado; DESA-442).** A
chamada pelo navegador (decisão 0008) não confere nada do pipeline: com `agents.pipeline` preenchida, o
pedido do convite (`POST /calls/web`, em `apps/voice/src/web-calls.ts`) pula a conferência do `engine` (o
simulado, o motor instalado e a chave dele), grava a linha com `engine = 'pipeline'` e deixa a abertura para
`startCallSession`, a mesma do telefone: a mesma recusa (`call_refused` com a peça e o código, sem chave, sem
preço ou sem a confirmação da 9.1, antes de qualquer peça abrir), o mesmo teto e o mesmo extrato por peça. Um
caminho próprio do navegador seria uma segunda regra, que pode pular a da sessão. Com a coluna nula, vale o
`engine`, como sempre: o agente no motor simulado continua recusado antes de abrir o microfone. A condição é a
mesma da sessão (`usesPipeline`). A tela de falar com o agente não muda: ela decide pelo `engine` do agente, e
o Pipeline continua desligado. Os testes (`web-calls-pipeline.db.test.ts`) abrem a ligação por um WebSocket de
verdade, com a transcrição e a voz simuladas da pasta e o cérebro da OpenAI num servidor falso (o motor
pipeline entra no mapa de motores do servidor, como o da pasta, com o `fetch` do teste), e comparam a recusa
com a da mesma agente pelo telefone. A prova de primeira impressão do CI é o job `simulated-call`
(`apps/voice/src/simulated-call.db.test.ts`): uma ligação pelo tronco com o agente de peças simuladas, com a
saudação, um turno pelo cérebro, o fim pela ferramenta `end_call` e as linhas das três peças no extrato; o
`engine` gravado é o simulado de roteiro, então a ligação que caísse no motor direto teria a linha dele. O
workflow não mudou: o job já roda esse arquivo. `ServerDeps.simulatedPieces` só é ligado pelos testes:
o painel montado pelo ambiente sai sem ele, e nenhum código fora dos testes o escreve
(`apps/panel/src/server/simulated-pieces.test.ts`). No processo de voz, a transcrição e a voz simuladas vêm da
pasta também num servidor instalado, e até a 5c só o painel recusava gravá-las: a 5c fecha isso na sessão (abaixo).
O e2e do bloco Pipeline
(`pipeline-block.spec.ts`) cobre as ressalvas da DESA-437: o Ouvir que falha (a amostra 404 e o `play()`
recusado pelo navegador) e o PATCH sem `pipeline`.

**5c, commit 1 (as notas da 5b-2, parecer da DESA-443; DESA-444).** A abertura do pipeline em `call-session.ts`
recusa a transcrição ou a voz simulada (`simulated`) com o mesmo motivo do 422 do painel, `pipeline_piece_test_only`,
e a peça, antes de qualquer chave ser lida ou peça abrir, a menos que o processo de voz tenha sido montado com
`simulatedPieces` (`VoiceServerDeps` e `CallSessionDeps`), que só os testes ligam: a coluna escrita à mão no banco
não abre a ligação com peças simuladas. O motivo fica fora de `KEY_CHECK_RESULTS`, com frase na linha do tempo nos
três idiomas e linha no `diagnostico.md` das duas cópias da skill. Depois do fim pedido por ferramenta (o
`end_call` e a transferência), o resultado da ferramenta não volta ao motor pipeline, porque reabriria o cérebro
com um pedido que o fim cancelaria e cobraria como estimado: a despedida do `end_call` vai direto à voz, pela
sessão (`wrapUp`), e o extrato tem só o pedido que respondeu. O motor direto não muda: ele ainda recebe o
resultado e fala a despedida. A chamada pelo navegador ganhou a prova do corte pelo pior caso **antes** do pedido
(3b-2): com o teto de 1 centavo, o pedido nem sai.

**5c, o custo por peça e a latência ao lado da escolha (DESA-444).** O detalhe da chamada (`GET /calls/{id}`)
leva `costByPiece`: a transcrição, o cérebro e a voz, nessa ordem, cada uma com o id, o nome da pasta, o modelo
quando ela usou um só, e o valor e as contagens de não medido e estimado do extrato, como o resto da tela. Sai só
na ligação que passou pelo pipeline (`calls.engine = 'pipeline'`, ou uma passagem com `engine: 'pipeline'`); na
do motor direto, a lista vem vazia, e o detalhe não muda. A peça sem nenhuma linha vem com `lines: 0`, e a tela a
mostra como "não medido": sem linha, o custo não é conhecido, e nunca aparece como zero. A linha da peça é a que a
sessão grava com o agente do trecho (`agent_id`): a classificação do desfecho pelo cérebro (R4) grava `brain:<id>`
também, mas depois da ligação e sem agente, em qualquer chamada, e fica de fora das peças, com a aparência de
antes. Custos (`GET /system/costs`) marca cada linha de peça (`piece`), com o nome dela e, no lugar dos minutos,
a nota de que ela cobra pelo próprio consumo; a data e a fonte do preço não saem na linha da peça (o preço do
cérebro vem da lista de modelos da organização, e o da voz depende do modelo). A transcrição da R12 num motor
direto (o mesmo rótulo `transcriber:<id>`, só nos testes por enquanto) ganha o mesmo nome em Custos.

A latência sai de `GET /agents/{id}/pipeline-latency`: a mediana (`percentile_cont(0.5)`) do `totalMs` do
`pipeline_turn_latency` nas últimas 20 ligações do agente com turno medido, com o turno do agente que respondeu
(o `agentId` do evento depois de uma passagem, senão o agente da ligação). **O turno com ferramenta fica à
parte**, com a mediana dele e uma linha própria que diz que o tempo da ferramenta entra no número; a meta vale
para a mediana sem ferramenta (1 200 ms, a "Meta p50" da 3.5), e acima dela o bloco mostra o aviso. Sem turno
medido, o bloco diz "sem medida ainda". O Pipeline continua desligado no campo Motor. **Não medido:** a mediana
é do agente, e não da combinação de peças: com a escolha trocada, as ligações das duas entram juntas (a escolha
ainda não é gravável pela tela). O p95 do orçamento não é mostrado.

### Fatia 6: o ouvido real e a medida de ponta a ponta (ESPERA a R12)

O transcritor real escolhido pela R12 (fatia 3 da R12) entra no pipeline sem mudança de código no
motor: é uma peça da pasta. A medida da seção 3.5 na chamada real (30 turnos, uma ferramenta) fica
registrada no PR e nesta seção. É o aceite da frente.

**Pendência antes da ligação real: a concordância não pode cortar o agente** (nota da revisora no
#573, comentário 7171910478, 25/11; registrada pelo board na DESA-397). Hoje, pela fatia 4, qualquer
texto novo de quem ligou corta a resposta do cérebro, inclusive "aham", "sim" e "tá", ditos só para
mostrar que está ouvindo. O modo Barulhento não ajuda: lá só texto interrompe (lição da R11), e a
concordância chega como texto. **A fatia 6 não fica pronta sem uma regra para isso, medida na
bancada.**

- **As regras candidatas** (não decididas; a medida escolhe):
  - **R-lista:** enquanto a resposta do cérebro sai, um trecho (parcial ou final) cujo texto,
    em minúsculas e sem pontuação, só tem palavras de concordância do idioma do agente não
    interrompe. Lista inicial:
    - pt-BR: "aham", "uhum", "hum", "hã", "sim", "é", "tá", "certo", "ok", "isso", "entendi", "sei";
    - en: "uh-huh", "mhm", "hmm", "yeah", "yes", "ok", "okay", "right", "sure", "got it", "i see";
    - es: "ajá", "mhm", "sí", "vale", "claro", "ok", "entiendo", "ya".
    "Não", "no", "espera" e "wait" nunca entram na lista. Quando a parcial cresce ("sim, mas…"), o
    corte acontece na primeira palavra fora da lista.
  - **R-lista + mínimo:** a R-lista e, além dela, o corte só acontece com pelo menos 2 palavras fora
    da lista, ou com 1 palavra fora da lista e 600 ms de fala desde o início do trecho.
  - A concordância que não corta entra na transcrição e vai ao cérebro no próximo pedido, mas não
    abre pedido sozinha.
- **A medida que decide**, na bancada da R12, pela linha estreita (8 kHz) e pelo transcritor da
  fatia 6:
  - **Corpus, por idioma (pt-BR, en, es):** 40 turnos com concordância falada no meio de uma resposta
    do agente de pelo menos 4 s (as palavras da lista, sozinhas e repetidas), e 40 turnos com
    interrupção de verdade ("não, espera", "mas eu queria outra coisa", uma pergunta nova, um
    número). A mesma gravação roda sem regra (o de hoje) e com cada regra.
  - **Números, por idioma e por regra:**
    - falsos cortes: concordâncias que cortaram, sobre 40;
    - cortes perdidos: interrupções de verdade que não cortaram, sobre 40;
    - atraso acrescentado: p50 e p95 de (tempo até o `interrupted` com a regra) menos (tempo sem
      regra), no mesmo áudio.
  - **Régua proposta:** falsos cortes ≤ 2 em 40, nenhum corte perdido, e atraso acrescentado no p95
    ≤ 300 ms, nos três idiomas. Vence a regra mais simples que passa. Se nenhuma passa, a fatia 6
    para e volta ao Arquiteto com a tabela.
  - **Os testes da regra escolhida**, sem bancada: a lista nos três idiomas; "não" corta; "sim, mas"
    corta na palavra "mas"; a concordância vai à transcrição e não abre pedido; a fala pronta e o
    `say` continuam sem corte.
  - A tabela vai ao PR da fatia 6 e a esta seção, com o comando e a data.

**6a, parte 1: a transcrição da OpenAI como peça provisória (DESA-469, opção B da DESA-398, decisão 2).**
O pedido do Rafael de 26/11 (a ligação real com a ElevenLabs) não espera o vencedor da R12. A peça é
`transcribers/openai.ts`, no contrato `StreamingTranscriber`. É o `gpt-4o-mini-transcribe`, o mesmo do
OpenAI Realtime, numa sessão só de transcrição (`?intent=transcription`), em μ-law a 8 kHz, com a
detecção de fala do servidor (`server_vad`). Os itens saem na ordem em que o servidor os fecha. O
`endMs` é o `audio_end_ms` menos o silêncio que o servidor esperou. O custo vem de cada `completed`:
em tokens, em segundos, ou, sem `usage`, pela duração do item, ao preço por minuto.
- **A chave é a do motor OpenAI Realtime** (`engine.openai-realtime.api_key`), sem chave nova. O
  contrato ganhou o campo opcional `keySetting`. A sessão (`call-session.ts`) e o painel leem a chave
  por `transcriberKeySettingOf`. Sem o campo, a chave segue em `transcriber.<id>.api_key`.
- **A confirmação da 9.1** fica em `transcriber.<id>.consent`, com o recibo
  `transcriber_provider_confirmed`, na forma da 1b. O texto é "O áudio da pessoa na ligação vai para a
  OpenAI". Como não há chave para gravar, a confirmação tem rota própria:
  `PUT|DELETE /api/v1/transcribers/{id}/consent`, com o botão no bloco Pipeline. `GET /api/v1/transcribers`
  diz se a chave existe e quem confirmou. A gravação do agente (`requirePipeline`) e a abertura da ligação
  conferem a confirmação, com o mesmo `pipeline_piece_unconfirmed`, agora também para a transcrição.
- **O pipeline deixa de aparecer desligado** na organização que tem uma transcrição de verdade na
  pasta e a chave dela. `unavailable` passa a ser por organização: `no_live_transcriber` (a pasta sem
  transcrição de verdade) ou `no_transcriber_key` (sem a chave). Com as duas, `null`, e o campo Motor
  diz "Pipeline", com a linha de que ele está pronto.
- **Fica de fora desta parte:** a escolha das peças pela tela (o bloco ainda não grava
  `agents.pipeline`; a API do agente grava), pergunta ao Arquiteto na DESA-469. Também fica de fora a
  regra da concordância, num PR depois deste (ordem do board de 26/11, fatias de até ~400 linhas).
- **Não medido:** a peça contra a OpenAI de verdade (nenhuma chamada com chave). Não foi medido se a
  sessão de transcrição aceita `audio/pcmu` (o guia só mostra `audio/pcm` a 24 kHz; a referência aceita
  os três), se manda `delta` antes do `completed` neste modelo, nem quanto o final chega depois do fim da
  fala (a régua de 700 ms do p95 da R12). Também não foi medido o custo por minuto real no extrato. A
  confirmação não sai com a chave do motor, como a da voz sai com a dela: apagar a chave do motor desliga
  o pipeline (`no_transcriber_key`), mas a confirmação continua gravada.

**6b: a escolha do Pipeline e da voz pela tela (DESA-474, depois do #597).** O campo Motor libera o
Pipeline quando ele está montado (`pipelineMissing`, em `agents/[id]/pipeline-pieces.ts`): o servidor sem
motivo em `unavailable`, uma transcrição com a chave e a confirmação da 9.1, um cérebro que conversa com a
chave aceita, e uma voz com a chave e a confirmação. A régua parte da de `requirePipeline`, lida antes, e é
mais dura na chave de cada peça; o preço da voz fica com o 422 do servidor. Sem isso,
o Pipeline fica desligado, com a linha da peça que falta (`transcriber_unconfirmed`, `no_brain`,
`no_voice`, além dos dois motivos do servidor). As peças do bloco ficam no rascunho do agente: a
transcrição, o cérebro e o modelo com preço, e a voz, marcada em cada voz da conta confirmada ("Usar … no
Pipeline", ao lado do Ouvir). Com o Pipeline no campo Motor, o salvar leva `pipeline` pela mesma rota e
pela mesma validação da 5a, sem caminho novo de escrita. O `engine` de antes fica guardado, porque a API
recusa o pipeline como `engine`. Voltar a outro motor leva `pipeline: null`. A escolha só vai no PATCH
quando muda: salvar outro campo não regrava a escolha, nem esbarra numa confirmação apagada. Sem voz
marcada, o salvar diz o que falta e não manda nada. As recusas do servidor (`pipeline_*`) ganharam frase
nos três idiomas, com a peça do `detail`. A transcrição de hoje é a peça provisória (opção B da
DESA-398): a tela diz "Transcrição provisória: a definitiva vem com a medida da transcrição." junto da
escolha da transcrição e no campo Motor, com o Pipeline escolhido. A tela em abas (DESA-470) ainda vai
mover o bloco: a 6b fica na tela de hoje.

## 5. O que espera a R12

- **O contrato `StreamingTranscriber` na `main`: não espera.** A DESA-398 decidiu que as fatias 3 a 5
  não esperam o vencedor da R12. O #245 entra sozinho, desligado, pelo #566, que o retoma (DESA-409),
  na exceção à regra 4 aberta pelo Rafael em 25/11, no documento
  "2026-11-24 — motor em pipeline entra desligado antes da tela" (opção A): nenhum motor o usa, e nada muda na
  tela nem no banco. A fatia 3 deste
  desenho parte da `main`. A fatia 4 da R12 fica só com a peça do vencedor.
- **O transcritor real.** A fatia 6 espera o vencedor medido da R12 (régua de 700 ms no p95 do trecho
  final). Hoje a R12 espera a DESA-75 e o crédito do Gemini. Sem vencedor, o pipeline existe e é
  testado pelo simulado, mas não atende chamada real.
- **O pedido previsto na DESA-13** ("qual transcrição entra primeiro") **não é feito aqui.** Ele é a
  própria medida da R12, com o padrão já dito na tarefa: a que o Arquiteto medir melhor em português
  com vocabulário.

## 6. Pedidos de decisão (vão ao lote do Líder)

O dono dos dois pedidos é o Arquiteto.

### 6.1 A conta e a chave da ElevenLabs para a bancada

O texto está no comentário da DESA-13, no formato do `GOVERNANCE.md`: conta e chave da ElevenLabs
para a bancada da fatia 1a, com teto de gasto. Padrão sem resposta: a fatia 1a entra sem a medida
real ("não medido") e a fatia 6 fica presa a essa medida.

### 6.2 O texto e o áudio da ligação que saem para a voz e para a transcrição

```markdown
## Decisão: as condições de 16/11 do Jev valem para a voz e a transcrição do pipeline?

**Quem decide:** dono do projeto
**O que está parado esperando:** a fatia 1b (a confirmação ao gravar a chave) e a fatia 5 (a
recusa de salvar o agente sem confirmação). As fatias 1a, 2, 3 e 4 não esperam.

### Opções
- **A.** As mesmas condições do Jev (desenho da R12, #198, "Custo e consentimento"), para cada
  peça do pipeline que não roda neste servidor e é escolhida à parte: a voz (ElevenLabs) e a
  transcrição. Confirmação nomeando o fornecedor, com quem e quando; país só com fonte; retenção
  lida antes. O cérebro segue a R4, sem confirmação, como hoje. Custo: um passo a mais ao gravar a
  chave, um guia com a retenção de cada fornecedor e um teste por peça.
- **B.** As condições valem também para o cérebro no pipeline. Custo: a tela do agente passa a
  pedir uma confirmação que os cérebros da R4 e os motores diretos (Gemini Live, OpenAI Realtime,
  que recebem o áudio inteiro) não pedem. Quem já usa um cérebro da R4 não é tocado, porque o pedido
  vale só no pipeline.
- **C.** Só o aviso, sem confirmação gravada, como nos cérebros da R4. Custo: a ElevenLabs recebe o
  texto que repete nome, endereço e telefone de quem ligou sem registro de quem aceitou isso, ao
  contrário do Jev, que recebe menos.

### Recomendação
A, porque a voz e a transcrição são peças escolhidas à parte, como o Jev, e a pessoa que liga tem o
mesmo dado em jogo. Igualar o cérebro (B) é uma revisão da R4 e dos motores diretos, e merece pedido
próprio, não uma carona neste.

### Se ninguém responder em 5 dias, vale: A

### Não medido
- A política de retenção da ElevenLabs não foi lida. Também não conferi se a conta comum tem um
  modo sem retenção, nem o preço dele.
- Não conferi se a página da ElevenLabs declara o país do processamento.
- Não conferi se o desenho da R12 (#198) já pede confirmação para a peça de transcrição. Ele diz
  que "nada sai do servidor sem o operador ligar e confirmar", mas o texto da confirmação só existe
  para o Jev.
```

Resposta: A, dada pelo Rafael em 17/11, junto com a DESA-103 (seção 9.1).

## 7. Fontes (conferidas em 17/11/2026)

- WebSocket de streaming: https://elevenlabs.io/docs/api-reference/text-to-speech/v-1-text-to-speech-voice-id-stream-input
  (`wss://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream-input`, cabeçalho `xi-api-key`,
  primeira mensagem com `text: " "`, `flush`, fechamento com `text: ""`, resposta com `audio`
  base64 e `isFinal`, alinhamento por caractere opcional, `inactivity_timeout` padrão 20, máximo
  180). **A página não mostra consumo de caracteres na resposta.**
- Formatos de saída: https://elevenlabs.io/docs/api-reference/text-to-speech/stream (lista com
  `pcm_8000`, `ulaw_8000` e `alaw_8000`). A página do WebSocket não lista os valores aceitos.
  **Não conferido:** se o WebSocket aceita `pcm_8000` e se esse PCM é little-endian assinado de 16
  bits. A fatia 1a confere contra a conta real ou diz "não conferido".
- Vozes: https://elevenlabs.io/docs/api-reference/voices/search (`GET /v2/voices`, `page_size` até
  100, `next_page_token`, `has_more`, `voice_id`, `name`, `category`, `verified_languages[]` com
  `language`, `model_id`, `locale` e `preview_url`).
- Preço: https://elevenlabs.io/pricing/api: Flash/Turbo a US$ 0,04 por mil caracteres; v3 e
  Multilingual v2 a US$ 0,08 por mil, igual em todos os planos. O plano gratuito inclui 20 mil
  caracteres de Flash/Turbo por mês. Conferido no HTML da página pelo #393 e pela revisora do
  #390, em 17/11/2026.
- **Retenção da ElevenLabs** (lida pelo Desenvolvedor em 17/11/2026, 15:50 UTC, na DESA-101):
  - https://elevenlabs.io/docs/eleven-api/resources/zero-retention-mode: o texto e o áudio de TTS
    ficam no histórico por padrão; a API apaga gerações, mas "debugging and moderation logs may
    still retain data"; depois de apagar, "retained in backups for up to 30 days"; o modo sem
    retenção é só para Enterprise.
  - https://elevenlabs.io/privacy-policy (atualizada em 9/10/2026): guarda "for as long as you have
    an account with us"; "your personal information will be transferred to the United States for
    storage".
- **Não conferido:** onde a ElevenLabs processa; os Termos de Serviço e o DPA; se o plano gratuito permite uso comercial ou exige
  atribuição; a latência própria do Flash v2.5 em pt-BR; os limites de conexões simultâneas por plano.

## 8. O que fica de fora

- Fala de espera enquanto uma ferramenta roda.
- Clonagem de voz e vozes geradas pela tela (só a lista do que a conta já tem).
- Outras vozes (OpenAI TTS, Google, Piper local): cada uma é um arquivo novo em `synthesizers/`,
  depois.
- Escolher a região da ElevenLabs (`api.eu.residency...`). O `processingLocation` diz "não declara"
  até haver fonte.
- Guardar o áudio sintetizado em disco ou no banco. O cache é só em memória, por processo.

## 9. Regras de produto

- **Núcleo ou peça opcional?** O motor é núcleo (está no `ROADMAP.md`). A ElevenLabs é uma peça
  opcional: sem chave, ela não aparece como escolha.
- **Disparo em massa?** Não. O pipeline atende a mesma chamada que os outros motores, com o mesmo
  teto e as mesmas regras de saída.
- **Exige ação de quem já instalou?** Não. Sem `agents.pipeline`, nada muda. A chave da ElevenLabs é
  do operador, pela tela (sem SSH e sem variável de ambiente).
- **Recurso pago ou telemetria?** Não há recurso pago nosso. O gasto é do operador com o provedor que
  ele escolher, medido e com teto, como nos motores diretos.

### 9.1 O dado de quem ligou que sai do servidor

A voz recebe o texto que o agente fala. Ao confirmar, o agente repete o que quem ligou disse: nome,
endereço, telefone e horário. A transcrição recebe o áudio de quem ligou. As duas peças são
escolhidas à parte do cérebro, como o Jev do filtro.

O desenho segue as condições que o Rafael deu em 16/11 ao Jev (desenho da R12, #198, "Custo e
consentimento"), as mesmas que o desenho dos analistas
([`2026-11-17-analistas-ao-vivo.md`](2026-11-17-analistas-ao-vivo.md), seção 2.1) já usa. Isso é a
opção A do pedido 6.2, respondida pelo Rafael em 17/11 (DESA-103):

- **A confirmação nomeia o fornecedor e diz o que vai:** "O texto que o agente fala na ligação vai
  para a ElevenLabs. Ele pode repetir o que a pessoa disse, como nome, endereço e telefone." Quem
  confirmou e quando ficam gravados, com recibo em `organization_events` (fatia 1b). A transcrição
  usa a mesma forma: "O áudio da pessoa na ligação vai para <fornecedor>."
- **O país só aparece com fonte**, com endereço e data da página do fornecedor. A ElevenLabs entra
  com `processingLocation: undeclared`, e a tela diz que ela não declara onde processa. O
  armazenamento nos EUA tem fonte (política de privacidade, atualizada em 9/10/2026) e aparece como
  armazenamento, não como lugar de processamento.
- **A retenção é lida antes:** no guia `docs/guides/voz.md`, antes da entrega da fatia 1b. A página
  não dá prazo para o texto, e o pedido foi ao Rafael (DESA-103). Ele respondeu A em 17/11: a tela
  oferece a ElevenLabs, e o aviso diz o que a página diz (histórico até apagar, 30 dias de cópia,
  registros sem prazo, armazenamento nos EUA). A opção de o DeskVoice apagar a fala do histórico
  depois de cada ligação ficou para depois de uma medida, fora da 1b.
- **A chave é o portão.** Sem chave, nada sai. Com a chave, o agente não salva com a peça sem a
  confirmação (fatia 5).
- **O cérebro segue a R4**, sem confirmação, como nos motores diretos. Mudar isso é a opção B do
  pedido 6.2.
- **A confirmação da transcrição é da R12.** Se o #198 não a trouxer até a fatia 6, a fatia 6 a
  traz, na mesma forma da 1b.

A bancada (fatia 1a) usa só texto sintético, sem dado de ninguém.

## 10. Não medido

- Toda a latência da seção 3.5 por etapa. Os números são meta, e as fatias 1a, 2 e 6 medem.
- Se a contagem de caracteres bate com o consumo da conta ElevenLabs.
- Se o WebSocket aceita `pcm_8000` (seção 7).
- Se o `/chat/completions` com `stream: true` + `tools` do OpenRouter e do DeepSeek se comporta como o
  da OpenAI. A documentação da R4 foi lida para o `completeJson`, não para streaming.
- O custo por minuto de conversa no pipeline. A fatia 6 calcula a partir do extrato real.
- Quantas concordâncias cortam o agente hoje e quanto atraso a regra da fatia 6 acrescenta: a
  régua de 2 em 40 e de 300 ms é proposta minha, sem medida. A bancada fala com áudio sintético; se
  a concordância sintética se transcreve como a falada, não foi medido.
- O país do processamento da ElevenLabs: a política diz só onde guarda (EUA). Os Termos de Serviço,
  o DPA e a página de segurança não foram lidos; algum deles pode dar prazo ou país.
- Se as gerações do WebSocket `stream-input` aparecem no histórico da conta (seria a base da opção
  de apagar depois da ligação).
