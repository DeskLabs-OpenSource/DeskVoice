# Ambiente barulhento: o ruído não cala nem interrompe o agente

> Roteiro de novembro, item R11 (DESA-24). Desenho do Arquiteto, 14/11/2026.
> Toca o mesmo caminho do áudio que o desenho do ouvido (#160, R3) e a transcrição pura (R12).
> Os pontos de contato estão na seção "Onde esta frente toca as outras".

## Problema

Fala do Rafael em 13/11, depois de uma ligação real que falhou: "a pessoa respondeu, só que no
ambiente está tendo uma obra, tem pessoas falando, e aí ela acha que não responde enquanto não
acabar o barulho. […] a pessoa que está conversando com a inteligência artificial tem a sensação
de que ela está calada, ignorando ela".

Isso fere o antipadrão 15 (a chamada fica muda). Há dois defeitos, com a mesma causa:

1. **Silêncio:** a detecção de fala do provedor não vê o fim do turno porque o ruído não para, e
   o agente espera.
2. **Interrupção falsa:** ruído, música ou um "uhum" parecem início de fala, e o agente para no
   meio da frase.

### O que o código faz hoje (lido em `origin/main` `9670784`, 14/11)

- `openai-realtime.ts` abre a sessão com
  `turn_detection: { type: "server_vad", create_response: true, interrupt_response: true }`, sem
  nenhum outro parâmetro e sem redução de ruído. `input_audio_buffer.speech_started` vira
  `interrupted`. `speech_stopped` não é lido.
- `gemini-live.ts` não envia `realtimeInputConfig`, então valem os padrões do provedor. Só lê
  `serverContent.interrupted` e `turnComplete`.
- `VoiceSessionEvents` não tem nenhum sinal de "quem ligou começou ou parou de falar". A transcrição
  de quem ligou chega só quando o turno fecha. Com isso, `call-session.ts` **não tem como saber**
  que alguém falou e ficou sem resposta. Nenhuma guarda é possível sem um contrato novo.
- O áudio de quem ligou vai direto ao motor (`transport.onAudio` → `session.sendAudio`), sem
  nenhum tratamento além da conversão de taxa dentro do motor.

## Mecanismo de cada provedor (fonte e data)

Conferido em 2026-11-14. Nada abaixo foi provado contra o servidor real (ver "Não medido").

### Gemini Live

Fonte: aistudio.google.com/api-reference/live (redireciona de ai.google.dev/api/live).

| Campo | O que a referência diz |
|---|---|
| `setup.realtimeInputConfig.automaticActivityDetection.startOfSpeechSensitivity` | `START_SENSITIVITY_HIGH` (padrão) detecta início de fala com mais frequência; `START_SENSITIVITY_LOW` com menos |
| `…endOfSpeechSensitivity` | `END_SENSITIVITY_HIGH` (padrão) encerra a fala com mais frequência; `END_SENSITIVITY_LOW` com menos |
| `…prefixPaddingMs` | duração de fala detectada exigida antes de confirmar o início. Valor menor é mais sensível e dá mais falso positivo |
| `…silenceDurationMs` | silêncio exigido antes de confirmar o fim. Valor maior tolera pausas e aumenta o atraso |
| `…disabled` | desliga a detecção automática. O cliente passa a mandar `activityStart` e `activityEnd` |
| `setup.realtimeInputConfig.activityHandling` | `START_OF_ACTIVITY_INTERRUPTS` (padrão, interrompe a resposta) ou `NO_INTERRUPTION` |
| `realtimeInput.audioStreamEnd` | o fluxo de áudio acabou (por exemplo, o microfone foi desligado). "Should only be sent when automatic activity detection is enabled". Reabre quando chega áudio de novo |
| `serverContent.interimInputTranscription` | "Low latency transcription updated while the user is speaking" |
| `voiceActivity.type = ACTIVITY_START` | descrito só como "Start of sentence signal". A página não diz se equivale a início de fala |

A referência não publica redução de ruído do lado do provedor, nem detecção semântica de fim de turno.

### OpenAI Realtime

Fontes: developers.openai.com/api/docs/api-reference/realtime e
developers.openai.com/api/docs/guides/realtime-vad.

| Campo | O que a documentação diz |
|---|---|
| `audio.input.noise_reduction` | `{ type: "near_field" \| "far_field", strength: 0..1 }` (`strength` padrão 1). `null` desliga. `near_field` é para microfone perto da boca |
| `turn_detection.type = "server_vad"` | `threshold`: "A higher threshold will require louder audio to activate the model, and thus might perform better in noisy environments". Também `prefix_padding_ms`, `silence_duration_ms` e `idle_timeout_ms` (o buffer sem fala detectada por esse tempo dispara `input_audio_buffer.timeout_triggered` e uma resposta) |
| `turn_detection.type = "semantic_vad"` | um modelo de fim de turno estima se a pessoa terminou de falar. `eagerness`: `low`, `medium`, `high` e `auto` (padrão, igual a `medium`). "Less likely to interrupt the user" |
| `input_audio_buffer.speech_started` / `speech_stopped` | início e fim de fala detectados (`audio_start_ms`, `audio_end_ms`) |
| `conversation.item.input_audio_transcription.delta` | transcrição incremental da fala de quem ligou |
| `input_audio_buffer.commit` | fecha o buffer num item de quem ligou, sem criar resposta. Com `server_vad`, o servidor faz isso sozinho |

A página do guia não traz o valor padrão de `threshold`, `prefix_padding_ms` e `silence_duration_ms`.
Os exemplos usam 0,5, 300 e 500, sem dizer que são o padrão.

## Contrato

### 1. Sinal de fala de quem ligou (motor)

Em `packages/voice-engine/src/types.ts`, um evento novo em `VoiceSessionEvents`:

```ts
/**
 * Há sinal de que quem ligou está falando: início de fala detectado pelo provedor, ou um pedaço
 * novo de transcrição. Vem muitas vezes por turno. Não diz quando a fala acabou: é o que a guarda
 * contra o silêncio precisa saber, e é o que o provedor erra com ruído.
 */
callerActivity(signal: { words: boolean }): void;
```

- `words: true` quando o sinal é texto novo da transcrição de quem ligou, e `false` quando é só
  detecção de início de fala.
- **OpenAI:** `input_audio_buffer.speech_started` emite `{ words: false }` (além do `interrupted`
  de hoje). `conversation.item.input_audio_transcription.delta` com texto não vazio emite
  `{ words: true }`.
- **Gemini:** `serverContent.interimInputTranscription` e `serverContent.inputTranscription` com
  texto não vazio emitem `{ words: true }`. `voiceActivity` **não** entra até a medida dizer o que
  ele significa.
- **Simulado:** emite `{ words: true }` quando o roteiro faz quem ligou falar, para a chamada
  simulada exercitar a guarda.

E um método novo em `VoiceSession`:

```ts
/**
 * Pede ao provedor que dê por encerrada a fala de quem ligou e responda ao que ouviu. A guarda
 * contra o silêncio chama isto quando o provedor não viu o fim do turno.
 */
closeCallerTurn(): void;
```

- **OpenAI:** `input_audio_buffer.commit` seguido de `response.create`.
- **Gemini:** `realtimeInput.audioStreamEnd`. O áudio seguinte reabre o fluxo.
- **Simulado:** registra a chamada, para o teste conferir.

### 2. Guarda contra o silêncio (`apps/voice`)

Um módulo novo, `apps/voice/src/silence-guard.ts`, puro: recebe `Clock` e `Schedule`, sem banco e
sem motor. `call-session.ts` o liga aos eventos da sessão.

**Quando arma:** a cada `callerActivity`, desde que o agente não esteja falando.

**O que desarma:** áudio do agente (`audio`), chamada de ferramenta (`toolCall`), espera de
aprovação, despedida ou encerramento.

**O que reinicia o prazo:** cada `callerActivity` com `words: true`. Enquanto chega texto novo, a
pessoa está falando, e a guarda não age. É isso que impede a guarda de falar por cima de quem fala.

**Os prazos** (constantes num lugar só, no próprio módulo; são o ponto de partida, e a fatia 5
mede e ajusta):

| Prazo | Valor inicial | O que vence |
|---|---|---|
| `AFTER_WORDS_MS` | 2500 | sem texto novo de quem ligou e sem resposta do agente, depois do último texto |
| `WITHOUT_WORDS_MS` | 8000 | houve início de fala, mas nenhum texto e nenhuma resposta (é o caso do OpenAI, cuja transcrição só chega depois do fim do turno) |
| `AFTER_CLOSE_MS` | 4000 | o turno foi fechado à força e o agente continua calado |

**O que faz, em ordem, uma vez por turno de quem ligou:**

1. Vence `AFTER_WORDS_MS` ou `WITHOUT_WORDS_MS`: chama `closeCallerTurn()`. O agente responde ao que
   ouviu, que é o melhor desfecho, porque a pessoa já falou.
2. Vence `AFTER_CLOSE_MS`: chama `say()` com um pedido curto para repetir, no idioma do agente:
   "Desculpe, a linha está com bastante barulho. Pode repetir, por favor?".
3. Depois disso, não insiste. O próximo `callerActivity` arma a guarda de novo. Ela nunca entra em
   laço, e nunca fala duas vezes seguidas sem quem ligou ter dito algo entre uma fala e outra.

**Evento novo no vocabulário** (`CALL_EVENT_KINDS` em `packages/core/src/types.ts`):
`caller_unanswered`, com o payload
`{ action: "turn_closed" | "asked_to_repeat", waitedMs: number, words: boolean }`.
O evento aparece na linha do tempo com rótulo nos três dicionários (`apps/panel/src/i18n/*/timeline.ts`).

### 3. Ajuste de ambiente (dado, motor e tela)

- **Dado:** `agents.listening_environment text not null default 'normal'`, com
  `check (listening_environment in ('normal', 'noisy'))`, numa migration nova.
- **Motor:** `VoiceSessionConfig.listeningEnvironment?: "normal" | "noisy"`. `call-session.ts` lê a
  coluna junto com o agente e passa adiante.
- **"normal" é igual a hoje.** Com `normal` ou ausente, a mensagem de abertura de cada provedor é
  byte a byte a de hoje. Quem já instalou não vê mudança no provedor até escolher "barulhento".
- **"noisy", ponto de partida** (a fatia 5 mede e pode trocar os valores sem mudar o contrato):
  - **OpenAI:** `noise_reduction: { type: "near_field" }` e
    `turn_detection: { type: "semantic_vad", eagerness: "auto", create_response: true, interrupt_response: true }`.
    O fim de turno pelo sentido não espera o ruído acabar, e a documentação diz que interrompe menos.
  - **Gemini:** `realtimeInputConfig.automaticActivityDetection` com
    `startOfSpeechSensitivity: "START_SENSITIVITY_LOW"` (menos início falso, que é a interrupção
    falsa), `endOfSpeechSensitivity: "END_SENSITIVITY_HIGH"` (encerra a fala com mais frequência, e
    não espera o ruído) e `prefixPaddingMs: 300`.
    `activityHandling` fica no padrão: `NO_INTERRUPTION` mataria a interrupção de verdade.
  - **Simulado:** ignora.
- **Tela:** na página do agente, um campo "Ambiente de quem liga" com duas opções, "Normal" e
  "Barulhento (obra, música, pessoas falando)", e uma frase curta que diz o custo da escolha:
  o agente demora um pouco mais para perceber que alguém começou a falar. Nos três idiomas.
  Nada de lista de números.

### 4. Interrupção falsa: o que cada motor faz

- **OpenAI:** quem interrompe é o próprio provedor (`interrupt_response: true`). No modo "noisy",
  quem decide é o `semantic_vad` com `noise_reduction`. O DeskVoice não segura o `interrupted` por
  conta própria: a transcrição de quem ligou só chega depois do fim do turno, então não há texto
  para confirmar que era fala, e segurar só atrasaria a interrupção de verdade.
- **Gemini:** no modo "noisy", `START_SENSITIVITY_LOW` com `prefixPaddingMs: 300`. A interrupção de
  verdade continua.
- **"Uhum":** nenhum dos dois documenta como trata a fala curta de concordância. A fatia 5 mede.

### 5. Redução de ruído antes do provedor

**Esta frente não liga redução de ruído local sem medida.** A fatia 4 avalia candidatos abertos que
rodem na VPS, em áudio de 8 kHz:

| Candidato | Por que entra na avaliação | A conferir na fatia |
|---|---|---|
| SpeexDSP (pré-processador, supressão de ruído) | roda em 8 kHz nativo, é leve | licença, binding para Node sem compilar na VPS |
| RNNoise | rede pequena, feita para ruído de fundo | licença; trabalha em 48 kHz, então soma duas conversões de taxa |
| DeepFilterNet | qualidade maior | licença, custo de CPU, 48 kHz |

As licenças acima não foram conferidas neste documento. Nenhum deles foi feito para tirar **outra
voz** de fundo: com conversa de fundo, o ganho esperado é pequeno, e a fatia 4 diz o quanto.

Se algum entrar, ele fica em `apps/voice`, antes de `session.sendAudio`, em 8 kHz, e antes da
conversão de taxa do motor (a da fatia 1 do #160).

## Fatias

Cada uma é um PR de rascunho contra `main`, com fragmento em `.changes/`. A ordem é a da lista. A 3
depende da 2. A 4 e a 5 não travam as outras.

### Fatia 1: sinal de fala e guarda contra o silêncio

`types.ts`, os três motores (`callerActivity`, `closeCallerTurn`), `silence-guard.ts` e o teste
dele, a ligação em `call-session.ts`, `caller_unanswered` no vocabulário, e os rótulos da linha do
tempo nos três idiomas.

Uma pessoa liga de um lugar com obra, fala, e o agente responde, ou pede para repetir, em no máximo
`AFTER_WORDS_MS` + `AFTER_CLOSE_MS` depois da última palavra, mesmo que o barulho não pare.

Aceite:
- teste de `silence-guard` com relógio falso: com atividade contínua sem fim de turno e sem áudio do
  agente, `closeCallerTurn` é chamado no prazo, e `say` em seguida, se o agente continuar calado.
  **Este é o teste que prova a guarda;**
- teste: enquanto chega `{ words: true }` a cada segundo, por 20 s, a guarda não age (não fala por
  cima);
- teste: áudio do agente, chamada de ferramenta ou encerramento desarmam a guarda;
- teste: a guarda age no máximo uma vez por turno e nunca fala duas vezes sem atividade de quem
  ligou entre uma fala e outra;
- teste de cada motor, com o servidor falso que os testes já usam: o evento do provedor vira
  `callerActivity`, e `closeCallerTurn` manda a mensagem documentada;
- teste de `call-session`: a guarda grava `caller_unanswered` com o payload do contrato;
- a chamada simulada de ponta a ponta continua passando.

Fracasso mesmo funcionando: guarda que fala por cima de quem ainda fala, que repete o pedido em laço,
ou que age durante uma ferramenta em espera.

Quem já instalou: a guarda vale para todo agente, sem ajuste. Ela é a correção do antipadrão 15, e o
fragmento diz isso.

### Fatia 2: o ajuste de ambiente de ponta a ponta, sem tela

Migration, API de agentes (`apps/panel/src/app/api/v1/agents/store.ts`, `apps/panel/src/server/shapes.ts`),
`call-session.ts`, `types.ts` e os dois motores.

Aceite:
- teste de cada motor: com `noisy`, os campos do contrato chegam na mensagem de abertura; com
  `normal` ou ausente, a mensagem é idêntica à de hoje;
- teste da API: recusa um valor fora de `normal` e `noisy`, e aceita a ausência (fica `normal`);
- teste de `call-session`: a coluna chega ao `VoiceSessionConfig`.

### Fatia 3: o campo na tela do agente

`apps/panel/src/app/(app)/agents/[id]/page.tsx` e i18n nas três línguas.

Aceite: a pessoa escolhe "Barulhento", salva, recarrega e vê a escolha.

Fracasso mesmo funcionando: campo escondido em "avançado", lista de números, ou texto que promete
que o agente "ignora todo barulho".

### Fatia 4: redução de ruído local, medida antes de decidir

Um script manual em `scripts/`, fora do CI, que passa cada candidato da seção 5 por áudio de 8 kHz
gerado (veja "Áudio de teste") e grava, por candidato:
- atraso somado (ms) e CPU de um núcleo por chamada, na VPS de teste;
- quanto tira do ruído só (dB), por tipo de ruído;
- **quanto tira da fala baixa sozinha** (dB de perda na voz sintética sem ruído, a −20 dB e a
  −30 dB do pico). Perda acima de 1 dB reprova o candidato. É a régua do "ajuste que corta a fala
  baixa";
- licença e onde está a fonte, para `CREDITS.md`.

O resultado vira uma seção "Medida da redução de ruído" neste documento. Ligar um candidato é outra
fatia: ela traz dependência nova (segunda leitura, porque muda dependência e talvez o `Dockerfile`),
e só existe se a medida passar.

### Fatia 5: bancada antes e depois, contra os provedores (depende do pedido de decisão)

Um script manual em `scripts/`, fora do CI, que, para cada motor e para `normal` e `noisy`, com e
sem a guarda:
1. toca para o motor, pelo caminho real do canal (8 kHz da ponte, e μ-law no OpenAI), frases de voz
   sintética misturadas aos ruídos do "Áudio de teste";
2. mede, por frase: o tempo entre o fim da fala sintética e o primeiro áudio do agente, e se a guarda
   agiu;
3. com o agente falando, toca só ruído, música e "uhum" sintético, e conta as interrupções
   (`interrupted`);
4. toca uma frase sintética longa (12 s) sobre ruído contínuo, e confere que a guarda não age antes
   de ela acabar.

O resultado vira a seção "Medida contra o provedor", com data, modelo, número de frases e custo. É
ela que ajusta os prazos da guarda e os valores do modo "noisy". "Melhorou" só com essa tabela.

### Áudio de teste (vale para a 4 e a 5)

- **Voz:** sintética, gerada por TTS. Nunca voz de pessoa real, nem gravação de ligação.
- **Obra:** gerada (rajadas de impacto e um tom de furadeira com variação).
- **Música:** gerada (acordes sintetizados com ritmo).
- **Conversa de fundo:** mistura de três ou mais vozes sintéticas diferentes, abaixo da voz principal.
- **Níveis medidos:** relação voz/ruído de 15, 5 e 0 dB, calculada sobre o RMS de cada trecho, e
  escrita junto do resultado.

## Onde esta frente toca as outras

| Ponto | R3, ouvido (#160, DESA-10) | R12, transcrição pura (DESA-25) | O que fazer |
|---|---|---|---|
| `VoiceSessionConfig` em `types.ts` | ganha `vocabulary` (fatia 2 dele) | pode ganhar campos de transcrição | campos opcionais e independentes. Quem mescla depois rebaseia, sem mudar o do outro |
| Mensagem de abertura dos motores (`session.update`, `setup`) | muda `transcription` e `inputAudioTranscription` | pode trocar o modelo de transcrição | mesmo objeto, conflito de texto. Ordem: a fatia 2 do R3 entra antes da 2 desta. Os dois usam o mesmo teste de "padrão igual a hoje, byte a byte" |
| `agents`, API e página do agente | coluna `vocabulary` e campo na tela | — | migrations separadas. As telas ficam lado a lado na mesma página |
| Áudio de quem ligou antes do provedor | `resample` sobe sem imagem (#161) | — | a redução de ruído (se entrar) fica antes da conversão, em 8 kHz |
| Bancada com voz sintética | fatia 4 dele (acerto de nomes) | conjunto de teste em português | **uma bancada só** em `scripts/`: quem chegar primeiro cria, e os outros acrescentam o seu caso. O áudio de teste desta frente serve à R12 (ambiente barulhento é um dos casos dela) |
| Transcrição de quem ligou | — | a pureza da transcrição é o fim dela | `callerActivity` é independente do motor: um motor em pipeline (R5) ou uma transcrição separada (R12) emite o mesmo sinal, e a guarda continua valendo |
| Pedido de decisão sobre gasto | decisão 1 da DESA-10 (fatia 4 com chave do dono) | — | a fatia 5 pede o mesmo. Se a decisão da DESA-10 sair, vale para as duas bancadas |

## Regras de produto

- **Núcleo ou peça opcional?** Núcleo. Atender bem em ambiente comum não é regra de nicho.
- **Facilita disparo em massa?** Não. Não mexe em saída, teto nem lista de não ligar.
- **Exige ação de quem já instalou?** Não. O modo "normal" é byte a byte o de hoje. A guarda é nova
  para todos, e o fragmento a descreve: é a correção do antipadrão 15.
- **Sem SSH, sem recurso pago, sem telemetria:** o ajuste tem tela. A bancada é script manual, fora
  do produto.

## Fora do escopo

- Separar a voz de quem ligou das vozes de fundo (separação de fonte). Nenhum candidato aberto
  conhecido faz isso em tempo real em 8 kHz com custo de VPS. Se a fatia 4 mostrar que a conversa
  de fundo é o caso que sobra, vira item de roteiro.
- Detecção de fala própria do DeskVoice no lugar da do provedor (`automaticActivityDetection.disabled`,
  `turn_detection: null`). É o caminho do motor em pipeline (R5), e não destes motores.
- Prazos da guarda configuráveis na tela. Ficam como constantes até a medida dizer se precisam
  variar por agente.
- Diagnóstico da ligação de 13/11: depende dos eventos que só o Rafael tem (pedido de decisão).

## Pedido de decisão

Fica no comentário da DESA-24, no formato do `GOVERNANCE.md`. Resumo:
1. **Eventos da ligação de 13/11**, em texto, sem dado pessoal (só os tipos de evento e os horários
   relativos, sem transcrição nem telefone). **Sem resposta:** o diagnóstico não é feito, e as
   fatias seguem.
2. **Fatia 5 com chave do dono**, com teto de gasto. **Sem resposta:** vale o que a decisão 1 da
   DESA-10 disser. Se nada for dito, a bancada não roda, e o PR de cada fatia diz que o "antes e
   depois" contra o provedor não foi medido.

## Não medido (deste documento)

- Nenhum parâmetro de provedor foi provado contra o servidor real. Tudo vem da documentação lida
  em 14/11.
- Se o Gemini manda `interimInputTranscription` sem pedir, e com que frequência.
- Se `audioStreamEnd` faz o Gemini responder ao que ouviu, ou só esvazia o que estava guardado.
- O significado de `voiceActivity.ACTIVITY_START` no Gemini.
- Se o OpenAI emite `input_audio_transcription.delta` antes do fim do turno (a leitura indica que
  não emite, e por isso existe `WITHOUT_WORDS_MS`).
- O valor padrão de `threshold`, `prefix_padding_ms` e `silence_duration_ms` no OpenAI.
- Os prazos iniciais da guarda (2,5 s, 8 s e 4 s). São estimativa, e não medida.
- As licenças, o custo e o atraso dos candidatos de redução de ruído.
- O que aconteceu na ligação de 13/11: não vi os eventos dela.
- Por qual canal a ligação de 13/11 entrou (tronco, WhatsApp ou navegador) nem qual motor ela usou.
