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

### 3.3 O motor: `packages/voice-engine/src/engines/pipeline.ts`

Implementa `VoiceEngine` com `id: "pipeline"`. O `connect` recebe, além do `VoiceSessionConfig`, a
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
pieceUsage(line: { piece: "transcriber" | "brain" | "synthesizer"; id: string; model?: string; usage: Usage; characters?: number; costMicrocents: number; estimated: boolean }): void;
```

O `meter` do `call-session.ts` grava uma linha de `usage_ledger` por evento: `engine` =
`<peça>:<id>` (o mesmo rótulo `transcriber:<id>` do #245), `model`, `cost_microcents` e
`cost_estimated`. Cada linha conta para o teto como hoje. Motor que não emite `pieceUsage` continua
no caminho de `usage`, sem mudança.

**Teto.** O `reachCeiling` de hoje dispara a despedida. No pipeline, a despedida também custa voz.
Por isso as três falas fixas da ligação (`FAREWELL.costCeiling`, `costCeilingTransfer` e a fala de
falha da seção 3.4) são **sintetizadas na abertura** e guardadas em memória. Na hora do teto, o
áudio já está pronto e não há gasto novo. O custo dessa síntese entra no extrato da ligação que a
fez. Um cache por processo, com a chave `(organização, sintetizador, voz, modelo, texto)`, evita
pagar de novo na ligação seguinte com a mesma voz. **O cache não atravessa organizações:** cada
organização paga e usa só o que a chave dela sintetizou, mesmo quando duas usam o mesmo `voiceId`.
E a abertura confere a chave da organização a cada ligação, mesmo quando todas as falas vêm do
cache: chave recusada é recusa de abertura, com ou sem cache. Antes de cada pedido ao cérebro, o pipeline também confere se o
pior caso do pedido (entrada enviada + `max_tokens` × preço) passa do que sobra do teto. Se passar,
o pedido não sai, e a despedida do teto toca. Isso resolve, no pipeline, a pendência da R12 "reserva
em voo que passa do pior caso".

### 3.4 A falha (antipadrão 15)

| Peça que falha | Quem ligou ouve | O painel recebe |
|---|---|---|
| Voz, ao abrir | O tom de falha (o caminho de hoje: `call_refused`/`engine_refused`) | `call_refused`, com `detail` dizendo que foi a voz |
| Voz, no meio | A fala de falha **pré-sintetizada** e depois o tom. A fala não depende da voz estar viva | `engine_failed` com `piece: "synthesizer"` e o motivo no vocabulário fechado |
| Ouvido, no meio | A fala de falha, pela voz viva | `engine_failed` com `piece: "transcriber"` |
| Cérebro, um pedido (prazo, 5xx, 429) | "Desculpe, não consegui responder agora. Pode repetir, por favor?" e a conversa segue | `pipeline_turn_failed` com `piece: "brain"` e o motivo |
| Cérebro, duas vezes seguidas | A fala de falha | `engine_failed` com `piece: "brain"` |

A fala de falha (texto fixo, no padrão de `FAREWELL`) é: "Estou com um problema técnico e não vou
conseguir continuar. Se puder, ligue de novo em alguns minutos. Obrigado." Quando há
`transfer_to_e164`, vale a fala de transferência que já existe. Os eventos usam o vocabulário de
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
`pipeline_turn_latency`. Prova de ponta a ponta com transcritor simulado, cérebro em servidor falso e
voz simulada: uma ferramenta no meio da conversa, três linhas no extrato e o teto que dispara a
despedida pré-sintetizada. Quem já instalou não precisa fazer nada: sem `agents.pipeline`, nada muda.
A fala aberta e parada morre no `inactivity_timeout` da ElevenLabs (20 s) com `error`. Esta fatia
decide e testa: ou abre a fala só quando o cérebro começa a responder, ou trata esse `error` como
fim sem falha.
A 3.3 confere a chave da organização em toda abertura, mesmo com o cache cheio (nota da revisora no
#390). Isso pode ser um pedido a mais antes do primeiro áudio. Esta fatia diz quanto ele pesa na 3.5,
ou mostra que a própria abertura da fala já serve de prova da chave e dispensa o pedido.

### Fatia 4: interrupção

Fala de quem ligou durante o áudio do agente (`callerActivity` com `words: true`, ou trecho parcial
com texto) → `speech.cancel()`, `chat.cancel()` e o evento `interrupted`. A fala do agente gravada no
histórico e na transcrição é cortada no que já saiu (`spoken`). Com ruído (`listeningEnvironment:
"noisy"`), só texto interrompe; o início de fala sozinho não interrompe (lição da R11). Os testes
provam o corte, o custo do que já foi enviado e que o próximo pedido ao cérebro leva a fala cortada.

### Fatia 5: a tela do agente

Na tela do agente, "Pipeline" aparece como motor. Ao escolhê-lo, surgem três escolhas: a transcrição,
o cérebro e o modelo (da lista da R4, só cérebros com `chat`) e a voz (da lista da 1b, com amostra).
O custo por peça aparece no detalhe da chamada e em Custos. A latência medida (p50 das últimas
ligações, pelo `pipeline_turn_latency`) aparece ao lado da escolha, com o aviso quando passa do
orçamento. Chamada pelo navegador (decisão 0008) com o pipeline. Ela entra na prova de primeira
impressão do CI pelo caminho simulado.
Ao lado de cada escolha que não roda neste servidor (transcrição e voz), a tela repete o aviso da
seção 9.1 e diz se já foi confirmado, por quem e quando. O servidor recusa salvar um agente com uma
peça cujo `processingLocation` não é `this-server` e que não tem confirmação gravada (422, com o motivo
na tela). O teste prova a recusa pela API, sem a tela.

### Fatia 6: o ouvido real e a medida de ponta a ponta (ESPERA a R12)

O transcritor real escolhido pela R12 (fatia 3 da R12) entra no pipeline sem mudança de código no
motor: é uma peça da pasta. A medida da seção 3.5 na chamada real (30 turnos, uma ferramenta) fica
registrada no PR e nesta seção. É o aceite da frente.

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
- O país do processamento da ElevenLabs: a política diz só onde guarda (EUA). Os Termos de Serviço,
  o DPA e a página de segurança não foram lidos; algum deles pode dar prazo ou país.
- Se as gerações do WebSocket `stream-input` aparecem no histórico da conta (seria a base da opção
  de apagar depois da ligação).
