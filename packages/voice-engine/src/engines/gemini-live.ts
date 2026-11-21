/**
 * Motor Gemini Live (Google), por WebSocket.
 *
 * Documentação oficial consultada em 2026-11-10 (ai.google.dev redireciona para aistudio.google.com):
 *   - https://ai.google.dev/gemini-api/docs/live-api/get-started-websocket  (URL, setup, realtimeInput, toolCall/toolResponse)
 *   - https://ai.google.dev/api/live  (mensagens: setup, setupComplete, serverContent, usageMetadata)
 *   - https://ai.google.dev/api/generate-content  (speechConfig, FunctionDeclaration, FunctionResponse, Blob)
 *   - https://ai.google.dev/gemini-api/docs/live-api/capabilities  (áudio 16 kHz na entrada, 24 kHz na saída, interrupção, transcrição)
 *   - https://ai.google.dev/gemini-api/docs/live-api/tools  (chamada de função bloqueante)
 *   - https://ai.google.dev/gemini-api/docs/speech-generation  (lista de vozes)
 *   - https://ai.google.dev/gemini-api/docs/pricing  (preços)
 *
 * Vocabulário do agente, consultado em 2026-11-13 (ai.google.dev/api/live redireciona para
 * aistudio.google.com/api-reference/live):
 *   - `AudioTranscriptionConfig.customVocabulary[]`: "A list of custom vocabulary phrases to bias the speech
 *     recognition model toward recognizing specific terms". Vale para a transcrição lateral; a página não diz
 *     formato, limite de quantidade nem de tamanho. O modelo de voz não tem campo de vocabulário no `setup`:
 *     os termos vão também na instrução de sistema (`instructionsWithVocabulary`).
 *
 * Teste da chave (`checkKey`), consultado em 2026-11-12 (ai.google.dev redireciona para aistudio.google.com):
 *   - https://ai.google.dev/api/models  (`GET /v1beta/models/{model}`: lê os dados do modelo, não gera nada)
 *   - https://ai.google.dev/gemini-api/docs/api-key  (a chave vai no cabeçalho `x-goog-api-key`)
 *   - https://ai.google.dev/gemini-api/docs/api-errors  (401 chave inválida, 402 crédito pré-pago esgotado,
 *     403 sem permissão ou chave bloqueada, 404 modelo inexistente, 429 limite, 5xx do lado do Google)
 *   A página de modelos não diz se ler um modelo é cobrado; nenhuma página de preço lista essa chamada.
 *
 * Não confirmado contra o servidor real (nenhuma chamada com chave foi feita):
 *   - o código de uma chave inválida na API de modelos: a página de erros diz 401, e a forma antiga
 *     da API respondia 400 com `API_KEY_INVALID`; as duas são tratadas como chave recusada;
 *   - se a leitura do modelo confere crédito (402) ou só a chave: a resposta "aceita" não promete crédito.
 *     Medido em 2026-11-16 numa instalação: com o crédito pré-pago esgotado, a leitura do modelo aceitou
 *     a chave, e a Live API fechou o socket antes do `setupComplete` com código 1011 e o motivo "Your
 *     prepayment credits are depleted…". Esse motivo chega ao `connect` pelo `onClosed`;
 *   - `responseModalities`/`speechConfig` vão dentro de `setup.generationConfig`, como na referência da
 *     API; o exemplo do guia de WebSocket mostra `responseModalities` direto em `setup`;
 *   - `inputAudioTranscription.languageCodes` (está na referência; os guias só mostram `{}`);
 *   - `inputAudioTranscription.customVocabulary` aceito pela Live API (está na referência, nenhum guia mostra),
 *     e o efeito dele no reconhecimento;
 *   - se `usageMetadata` é por turno ou acumulado na sessão. Aqui é tratado como incremento.
 *
 * Sinal de fala e fim de turno forçado (`callerActivity`, `closeCallerTurn`), consultado em 2026-11-14:
 *   - https://aistudio.google.com/api-reference/live  (`serverContent.interimInputTranscription`,
 *     `serverContent.inputTranscription`, `realtimeInput.audioStreamEnd`, que só vale com a detecção
 *     automática de fala ligada, como aqui, e reabre quando chega áudio de novo)
 *   Não confirmado contra o servidor real: se o Gemini manda `interimInputTranscription` sem que se
 *   peça, e com que frequência; se `audioStreamEnd` o faz responder ao que ouviu, ou só esvazia o que
 *   estava guardado. `voiceActivity` não entra: a referência não diz se ele é início de fala.
 *
 * Ambiente barulhento (`listeningEnvironment: "noisy"`), consultado em 2026-11-14 na referência v1beta
 * (https://aistudio.google.com/api-reference/live, `setup.realtimeInputConfig`):
 *   - `automaticActivityDetection.startOfSpeechSensitivity`: `START_SENSITIVITY_HIGH` (padrão) ou `_LOW`;
 *   - `automaticActivityDetection.endOfSpeechSensitivity`: `END_SENSITIVITY_HIGH` (padrão) ou `_LOW`;
 *   - `automaticActivityDetection.prefixPaddingMs` (int32);
 *   - `activityHandling`: `START_OF_ACTIVITY_INTERRUPTS` (padrão) ou `NO_INTERRUPTION`. Fica no padrão:
 *     `NO_INTERRUPTION` mataria a interrupção de verdade.
 *   Não confirmado contra o servidor real: o efeito desses valores numa ligação com ruído (a bancada
 *   da fatia 5 mede).
 *
 * Retomada da sessão (`resumed`), consultado em 2026-11-21:
 *   - https://ai.google.dev/gemini-api/docs/live-api/session-management (redireciona para
 *     aistudio.google.com/docs/live-api/session-management): "The lifetime of a connection is limited
 *     as well, to around 10 minutes"; sem compressão, a sessão só de áudio para em 15 minutos; o
 *     `contextWindowCompression.slidingWindow` tira esse limite; o `goAway` avisa, com `timeLeft`, que a
 *     conexão vai fechar; o handle de `sessionResumptionUpdate.newHandle` vai em
 *     `setup.sessionResumption.handle` na conexão nova, e vale por 2 horas;
 *   - https://aistudio.google.com/api-reference/live: `newHandle` "Empty if `resumable`=false";
 *     `SlidingWindow.targetTokens` tem padrão (metade de `triggerTokens`), e os dois ficam no padrão.
 *   Aqui: no `goAway`, ou na queda com um handle guardado, abre-se uma conexão nova com o último handle
 *   retomável, sem `closed`. A conexão de agora segue tocando a fala do agente até a nova confirmar; o
 *   que sai para o provedor nesse meio (áudio de quem ligou, resultado de ferramenta) espera a nova, e
 *   do áudio fica no máximo 2 s, o mais recente. Uma tentativa por conexão: falhou, `error` + `closed`
 *   como antes. Nenhuma fala extra.
 *   Não confirmado contra o servidor real: a duração real da conexão; se a troca é audível; se o
 *   handle alcança uma chamada de ferramenta em curso (a página não diz quando `resumable` é falso);
 *   se o `usageMetadata` da conexão nova recomeça do zero (aqui, como antes, é incremento e soma).
 *
 * Fim da vez de quem ligou (`callerTurnEnded`, a latência por turno): com a detecção automática de
 * fala, o servidor não manda aviso de fim de fala (lido no código e na referência acima, não na
 * documentação de hoje). O marco é cada pedaço de `inputTranscription` que chega antes do primeiro
 * áudio da resposta, e quem mede fica com o último. `source: "transcript"`: a transcrição vem depois
 * do fim real da fala, e a medida sai menor que a espera de verdade. Pedaço que chega com o agente já
 * falando (transcrição atrasada) não é marco. `closeCallerTurn` devolve sempre `true` (agiu): o
 * `audioStreamEnd` vai sempre, e não há como saber se a resposta veio por causa dele ou se o servidor
 * já ia responder. Por isso, no Gemini, todo turno em que a guarda fecha a vez sai da conta (e é
 * contado em `guardTurns`, sem valor).
 *
 * Cancelamento de ferramenta (`toolCallCancelled`), consultado em 2026-11-21
 * (https://aistudio.google.com/api-reference/live, `BidiGenerateContentToolCallCancellation`): o
 * servidor avisa que as chamadas de ferramenta com estes `ids` "should not have been executed and
 * should be cancelled"; "This message occurs only in cases where the clients interrupt server turns";
 * se houve efeito, "clients may attempt to undo the tool calls". Aqui o motor só repassa os `ids`:
 * quem roda a ferramenta descarta o resultado, e o efeito que já saiu não é desfeito.
 *   Não confirmado contra o servidor real: com que frequência o aviso vem numa ligação, e se o modelo
 *   reclama de um resultado que chegue mesmo assim.
 *
 * Orientação ao agente (`VoiceSession.guide`): este motor **não** a recebe na v1, e não declara o
 * método. Consultado em 2026-11-17 (https://aistudio.google.com/api-reference/live):
 *   - `systemInstruction` só vai no `setup`, no começo da sessão;
 *   - o `clientContent` "will interrupt any current model generation", e misturar `clientContent` com
 *     `realtimeInput` "there are no guarantees".
 *   Entregar a orientação por ali cortaria a fala do agente no meio, e por `realtimeInput.text` ela
 *   viraria um turno a responder. Quem chama vê o método ausente e registra que o motor não recebe
 *   orientação (docs/specs/2026-11-17-analistas-ao-vivo.md, seção 3.3).
 */
import { z } from "zod";
import { SessionEmitter } from "../emitter";
import { awaitSessionReady, openProviderSocket, type ProviderSocket } from "../provider-socket";
import { resample } from "../resample";
import { instructionsWithVocabulary } from "../vocabulary";
import { checkKeyOverHttp } from "../key-check";
import { ANALYSIS_SCHEMA_GOOGLE, analysisPrompt } from "../analysis";
import { classifyOptionsFor, classifyOutcomeOverHttp, readClassifyText, transcribeOverHttp } from "../outcome-over-http";
import { OUTCOME_GUESS_SCHEMA_GOOGLE, outcomePrompt } from "../outcome";
import type { ClassifyOptions, EnginePricing, RecordingTranscriber, Usage, VoiceEngine, VoiceSession, VoiceSessionConfig } from "../types";

const DEFAULT_BASE_URL =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";
/**
 * Ambiente barulhento, ponto de partida do desenho (a bancada da fatia 5 pode trocar os valores):
 * início de fala menos sensível (menos início falso, que é a interrupção falsa) com 300 ms de fala
 * antes de confirmar, e fim de fala sensível, que não espera o ruído acabar. `activityHandling` não
 * aparece: fica no padrão, em que a fala de verdade interrompe o agente.
 */
const NOISY_REALTIME_INPUT = {
  automaticActivityDetection: {
    startOfSpeechSensitivity: "START_SENSITIVITY_LOW",
    endOfSpeechSensitivity: "END_SENSITIVITY_HIGH",
    prefixPaddingMs: 300,
  },
} as const;
const DEFAULT_API_URL = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_MODEL = "gemini-3.8-live";
const DEFAULT_VOICE = "Sulafat";
// Modelo de texto que classifica o desfecho e transcreve a gravação: o mais barato da linha estável de texto. A página de
// preços e a de modelos (conferidas em 2026-11-13) não listam `gemini-3.5-flash`, só o
// `gemini-3.5-flash-lite`. Trocar de modelo é trocar o preço abaixo junto, numa versão.
const TEXT_MODEL = "gemini-3.5-flash-lite";
// gemini-3.5-flash-lite, por milhão de tokens: entrada US$ 0,30 e saída US$ 2,50, com o raciocínio
// incluído na saída. A linha de entrada diz "text / image / video / audio" (conferida em 2026-11-13):
// o áudio da gravação custa o mesmo que o texto. O cache implícito custaria menos; cobrar tudo como entrada nova superestima.
const TEXT_PRICING: EnginePricing = {
  centsPerMillionInputTokens: 30,
  centsPerMillionOutputTokens: 250,
  checkedOn: "2026-11-13",
  source: "https://ai.google.dev/gemini-api/docs/pricing",
};
// "Maximum request size is 20 MB total (including prompts and all files)", na página de áudio
// (aistudio.google.com/docs/audio, conferida em 2026-11-13). A página de formas de envio diz 100 MB
// para dados embutidos; vale a menor. O áudio vai em base64 (4/3 do tamanho), com folga para o
// pedido: cerca de 15 minutos de um lado a 8 kHz.
const TRANSCRIBE_MAX_BYTES = Math.floor(((20_000_000 - 100_000) * 3) / 4);
/** Transcrever, não resumir: resumo e desfecho são outras peças, com outro dono. */
const TRANSCRIBE_PROMPT =
  "Transcreva a fala deste áudio literalmente, no idioma em que foi dita, sem resumir, sem comentar, sem traduzir e sem marcar quem fala. Se não houver fala, responda com um texto vazio.";
const generateText = z.object({ candidates: z.array(z.object({ content: z.object({ parts: z.array(z.object({ text: z.string().optional() })) }) })).min(1) });
const generateUsage = z.object({
  usageMetadata: z.object({ promptTokenCount: z.number(), candidatesTokenCount: z.number().optional(), thoughtsTokenCount: z.number().optional() }),
});
/** O consumo de `:generateContent`. O raciocínio vem à parte e é cobrado como saída. */
const generateUsageOf = (body: unknown): Usage => {
  const usage = generateUsage.safeParse(body).data?.usageMetadata;
  if (!usage) return {};
  return { inputTokens: usage.promptTokenCount, outputTokens: (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0) };
};
// As 30 vozes prontas, com o descritor oficial. Conferido em 2026-11-12 na página de síntese de voz
// (aistudio.google.com/docs/speech-generation); a página da Live API não lista as vozes dela.
const VOICES = [
  { id: "Zephyr", style: "Bright" },
  { id: "Puck", style: "Upbeat" },
  { id: "Charon", style: "Informative" },
  { id: "Kore", style: "Firm" },
  { id: "Fenrir", style: "Excitable" },
  { id: "Leda", style: "Youthful" },
  { id: "Orus", style: "Firm" },
  { id: "Aoede", style: "Breezy" },
  { id: "Callirrhoe", style: "Easy-going" },
  { id: "Autonoe", style: "Bright" },
  { id: "Enceladus", style: "Breathy" },
  { id: "Iapetus", style: "Clear" },
  { id: "Umbriel", style: "Easy-going" },
  { id: "Algieba", style: "Smooth" },
  { id: "Despina", style: "Smooth" },
  { id: "Erinome", style: "Clear" },
  { id: "Algenib", style: "Gravelly" },
  { id: "Rasalgethi", style: "Informative" },
  { id: "Laomedeia", style: "Upbeat" },
  { id: "Achernar", style: "Soft" },
  { id: "Alnilam", style: "Firm" },
  { id: "Schedar", style: "Even" },
  { id: "Gacrux", style: "Mature" },
  { id: "Pulcherrima", style: "Forward" },
  { id: "Achird", style: "Friendly" },
  { id: "Zubenelgenubi", style: "Casual" },
  { id: "Vindemiatrix", style: "Gentle" },
  { id: "Sadachbia", style: "Lively" },
  { id: "Sadaltager", style: "Knowledgeable" },
  { id: "Sulafat", style: "Warm" },
] as const;
const BRIDGE_HZ = 8000;
const INPUT_HZ = 16000;
const DEFAULT_OUTPUT_HZ = 24000;
/**
 * Áudio de quem ligou guardado durante a troca de conexão, no máximo 2 s (PCM16 8 kHz, 16 bytes por
 * ms), e o mais recente: a troca que demorar mais perde o começo, não o fim, do que a pessoa disse.
 */
const HELD_AUDIO_MAX_BYTES = 2000 * 16;

const transcription = z.object({ text: z.string().optional() });
const serverMessage = z.object({
  setupComplete: z.object({}).optional(),
  serverContent: z
    .object({
      modelTurn: z
        .object({
          parts: z.array(
            z.object({ inlineData: z.object({ data: z.string(), mimeType: z.string().optional() }).optional() }),
          ),
        })
        .optional(),
      turnComplete: z.boolean().optional(),
      interrupted: z.boolean().optional(),
      inputTranscription: transcription.optional(),
      interimInputTranscription: transcription.optional(),
      outputTranscription: transcription.optional(),
    })
    .optional(),
  toolCall: z
    .object({ functionCalls: z.array(z.object({ id: z.string().optional(), name: z.string(), args: z.unknown() })) })
    .optional(),
  toolCallCancellation: z.object({ ids: z.array(z.string()) }).optional(),
  usageMetadata: z
    .object({ promptTokenCount: z.number().optional(), responseTokenCount: z.number().optional() })
    .optional(),
  sessionResumptionUpdate: z.object({ newHandle: z.string().optional(), resumable: z.boolean().optional() }).optional(),
  // `timeLeft` não é lido: a troca começa já, com a conexão de agora ainda de pé.
  goAway: z.object({ timeLeft: z.string().optional() }).optional(),
});
type ServerMessage = z.infer<typeof serverMessage>;

// O modelo lido: o recurso devolve o próprio nome. A forma antiga da API recusava a chave com 400 e
// o motivo `API_KEY_INVALID` nos detalhes.
const modelResource = z.object({ name: z.string().startsWith("models/") });
const errorDetails = z.object({ error: z.object({ details: z.array(z.unknown()) }) });
const invalidKeyDetail = z.object({ reason: z.literal("API_KEY_INVALID") });
const saysInvalidKey = (body: unknown): boolean =>
  errorDetails.safeParse(body).data?.error.details.some((detail) => invalidKeyDetail.safeParse(detail).success) ?? false;

function literalSpeech(text: string, language: string): string {
  return `Say exactly the following to the caller, in ${language}, without adding anything: "${text}"`;
}

const recordingTranscriber: RecordingTranscriber = {
  model: TEXT_MODEL,
  pricing: TEXT_PRICING,
  maxAudioBytes: TRANSCRIBE_MAX_BYTES,
  transcribe(apiKey, input, options = {}) {
    return transcribeOverHttp(
      {
        url: `${options.baseUrl ?? DEFAULT_API_URL}/models/${encodeURIComponent(TEXT_MODEL)}:generateContent`,
        // No cabeçalho, e não na URL: endereço de pedido costuma ir para log de proxy.
        headers: { "x-goog-api-key": apiKey },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ inlineData: { mimeType: "audio/wav", data: Buffer.from(input.audio).toString("base64") } }, { text: TRANSCRIBE_PROMPT }] }],
          generationConfig: { temperature: 0 },
        }),
        model: TEXT_MODEL,
        pricing: TEXT_PRICING,
        read: (body) => {
          const parsed = generateText.safeParse(body);
          return parsed.success ? (parsed.data.candidates[0]?.content.parts ?? []).map((part) => part.text ?? "").join("").trim() : null;
        },
        usage: generateUsageOf,
        classify: (status, body) => (status === 400 && saysInvalidKey(body) ? "rejected" : undefined),
      },
      options,
    );
  },
};

/** Uma conexão com o provedor. A sessão de voz pode passar por várias (a retomada). */
interface Connection {
  events: SessionEmitter;
  socket: ProviderSocket | undefined;
  /** Saiu da sessão: dela só conta o consumo. */
  retired: boolean;
  /** Já houve uma tentativa de retomada a partir desta conexão. */
  resumeTried: boolean;
  /** O socket desta conexão já fechou. */
  closed: boolean;
  /** O último `error` da conexão, que explica o fechamento que vem em seguida. */
  error?: Error;
}

/**
 * A abertura da sessão. `sessionResumption` sempre vai (vazio na primeira conexão, com o handle na
 * retomada), e a compressão da janela de contexto também: sem ela, a sessão de áudio para em 15 min.
 */
function setupMessage(config: VoiceSessionConfig, model: string | undefined, resumeHandle: string | undefined): object {
  return {
    setup: {
      model: `models/${model ?? DEFAULT_MODEL}`,
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: config.voiceId ?? DEFAULT_VOICE } } },
      },
      // Os modelos de áudio nativo não aceitam código de idioma para a fala; a documentação manda
      // restringir o idioma pela instrução de sistema.
      systemInstruction: { parts: [{ text: `${instructionsWithVocabulary(config.instructions, config.vocabulary)}\n\nSpeak only in ${config.language}.` }] },
      ...(config.tools.length > 0 && {
        tools: [
          {
            functionDeclarations: config.tools.map((tool) => ({
              name: tool.name,
              description: tool.description,
              parametersJsonSchema: tool.parameters,
            })),
          },
        ],
      }),
      // Sem termos, o campo nem aparece: o setup fica igual ao de antes.
      inputAudioTranscription: {
        languageCodes: [config.language],
        ...(config.vocabulary && config.vocabulary.length > 0 && { customVocabulary: [...config.vocabulary] }),
      },
      outputAudioTranscription: {},
      // Ambiente `normal` ou ausente: o campo nem aparece, e o setup fica igual ao de antes.
      ...(config.listeningEnvironment === "noisy" && { realtimeInputConfig: NOISY_REALTIME_INPUT }),
      sessionResumption: resumeHandle ? { handle: resumeHandle } : {},
      contextWindowCompression: { slidingWindow: {} },
    },
  };
}

const engine: VoiceEngine = {
  id: "gemini-live",
  label: "Gemini Live (Google)",
  provider: "google",
  // A Gemini Developer API não publica a lista de países onde o áudio é processado: há pedido
  // oficial em aberto no fórum do Google (discuss.ai.google.dev/t/…/195090, 02/11/2026), e a
  // resposta para quem precisa de região é usar Vertex AI com `europe-west1` e semelhantes.
  // Enquanto não houver declaração, o honesto é dizer que não se sabe.
  processingLocation: { kind: "undeclared" },
  voices: VOICES,
  defaultVoice: DEFAULT_VOICE,
  pricing: {
    // US$ 3,00 e US$ 12,00 por milhão de tokens de áudio (entrada e saída) do gemini-3.8-live.
    // O prompt de texto custa menos (US$ 0,75); cobrar tudo como áudio superestima um pouco, nunca subestima.
    centsPerMillionInputTokens: 300,
    centsPerMillionOutputTokens: 1200,
    checkedOn: "2026-11-10",
    source: "https://ai.google.dev/gemini-api/docs/pricing",
  },

  async connect(config, apiKey, options = {}) {
    const emitter = new SessionEmitter();
    const toolNames = new Map<string, string>();
    let anonymousCalls = 0;
    let userText = "";
    let agentText = "";
    // O agente já mandou áudio nesta resposta: a transcrição de quem ligou que chega agora é atrasada,
    // e não marca o fim da vez dele. Volta a falso no fim da resposta ou na interrupção.
    let agentSpeaking = false;

    // A retomada (comentário de topo): o último handle que o provedor disse ser retomável, a conexão
    // atual e a que está abrindo no lugar dela. Só a atual e a que abre dão handle; a que saiu não.
    let handle: string | undefined;
    let current: Connection | undefined;
    let opening: Connection | undefined;
    let swapping = false;
    let closing = false;
    let ended = false;
    // O que sai durante a troca espera a conexão nova. Do áudio de quem ligou, fica o mais recente.
    let held: { message: object; audioBytes: number }[] = [];

    const flush = (speaker: "user" | "agent"): void => {
      const text = (speaker === "user" ? userText : agentText).trim();
      if (speaker === "user") userText = "";
      else agentText = "";
      if (text) emitter.emit("transcript", { speaker, text });
    };

    const fail = (error: Error): void => {
      if (ended) return;
      ended = true;
      emitter.emit("error", error);
      emitter.emit("closed", "socket_closed");
    };

    const onMessage = (conn: Connection, message: ServerMessage): void => {
      const { serverContent, toolCall, toolCallCancellation, usageMetadata, sessionResumptionUpdate, goAway } = message;
      // O consumo de qualquer conexão conta, inclusive o da que já saiu: o provedor cobrou.
      if (usageMetadata) {
        emitter.emit("usage", {
          inputTokens: usageMetadata.promptTokenCount ?? 0,
          outputTokens: usageMetadata.responseTokenCount ?? 0,
        });
      }
      if (conn.retired) return;

      if (sessionResumptionUpdate && (swapping ? conn === opening : conn === current || conn === opening)) {
        // `newHandle` vem vazio quando `resumable` é falso: fica o último que valia.
        if (sessionResumptionUpdate.resumable === true && sessionResumptionUpdate.newHandle) handle = sessionResumptionUpdate.newHandle;
      }

      if (serverContent) {
        // A transcrição chega em fragmentos; o contrato entrega a fala inteira de cada turno.
        if (serverContent.inputTranscription?.text) userText += serverContent.inputTranscription.text;
        // O marco da latência por turno: o pedaço mais recente antes do áudio da resposta (comentário de topo).
        if (serverContent.inputTranscription?.text?.trim() && !agentSpeaking) emitter.emit("callerTurnEnded", { source: "transcript" });
        // A interina não entra no texto da fala (a definitiva chega em `inputTranscription`): só avisa
        // que quem ligou está falando.
        if (serverContent.interimInputTranscription?.text?.trim() || serverContent.inputTranscription?.text?.trim()) {
          emitter.emit("callerActivity", { words: true });
        }
        if (serverContent.modelTurn || serverContent.outputTranscription) flush("user");
        if (serverContent.outputTranscription?.text) agentText += serverContent.outputTranscription.text;
        for (const part of serverContent.modelTurn?.parts ?? []) {
          if (!part.inlineData) continue;
          const rate = Number(/rate=(\d+)/.exec(part.inlineData.mimeType ?? "")?.[1] ?? DEFAULT_OUTPUT_HZ);
          // ponytail: reamostra cada pedaço isolado; a emenda entre pedaços perde uma fração de amostra.
          // Se aparecer estalo na fala, trocar por um reamostrador com estado entre pedaços.
          agentSpeaking = true;
          emitter.emit("audio", resample(Buffer.from(part.inlineData.data, "base64"), rate, BRIDGE_HZ));
        }
        if (serverContent.interrupted) emitter.emit("interrupted");
        if (serverContent.turnComplete || serverContent.interrupted) {
          agentSpeaking = false;
          flush("user");
          flush("agent");
        }
      }

      if (toolCall) {
        flush("user");
        for (const call of toolCall.functionCalls) {
          const id = call.id ?? `gemini-call-${++anonymousCalls}`;
          toolNames.set(id, call.name);
          emitter.emit("toolCall", { id, name: call.name, args: call.args ?? {} });
        }
      }

      // O modelo desistiu destas chamadas: quem roda a ferramenta descarta o resultado.
      if (toolCallCancellation && toolCallCancellation.ids.length > 0) emitter.emit("toolCallCancelled", toolCallCancellation.ids);

      // O provedor avisa que vai fechar esta conexão: a troca começa já, e esta segue até a nova abrir.
      // Sem handle não há o que retomar, e a conexão cai como antes quando o prazo acabar.
      if (goAway && conn === current && !swapping && handle && !conn.resumeTried) void resume(conn);
    };

    /** Fechamento de uma conexão. Só o da atual decide alguma coisa; o das outras já foi tratado. */
    const onConnectionClosed = (conn: Connection, reason: string): void => {
      conn.closed = true;
      if (conn !== current || ended) return;
      if (reason === "client") {
        if (closing) {
          ended = true;
          emitter.emit("closed", "client");
        }
        return;
      }
      // Caiu no meio da troca: quem decide é a troca.
      if (swapping) return;
      if (!closing && handle && !conn.resumeTried) {
        void resume(conn);
        return;
      }
      fail(conn.error ?? new Error(`Gemini Live: a conexão caiu (${reason})`));
    };

    const open = async (resumeHandle: string | undefined): Promise<Connection> => {
      const events = new SessionEmitter();
      const conn: Connection = { events, socket: undefined, retired: false, resumeTried: false, closed: false };
      opening = conn;
      let setupDone: () => void = () => undefined;
      let setupFailed: (error: Error) => void = () => undefined;
      const ready = new Promise<void>((resolve, reject) => {
        setupDone = resolve;
        setupFailed = reject;
      });
      events.on("error", (error) => {
        conn.error = error;
      });
      events.on("closed", (reason) => onConnectionClosed(conn, reason));
      const socket = await openProviderSocket({
        url: `${options.baseUrl ?? DEFAULT_BASE_URL}?key=${encodeURIComponent(apiKey)}`,
        label: "Gemini Live",
        emitter: events,
        onMessage: (raw) => {
          const parsed = serverMessage.safeParse(raw);
          if (!parsed.success) return;
          if (parsed.data.setupComplete) setupDone();
          onMessage(conn, parsed.data);
        },
        onClosed: (detail) => setupFailed(new Error(`Gemini Live: a conexão fechou antes de confirmar a sessão (${detail})`)),
        timeout: options,
      });
      conn.socket = socket;
      // A sessão fechou enquanto esta conexão abria: ela não chega a pedir nada.
      if (closing) {
        conn.retired = true;
        await socket.close();
        throw new Error("Gemini Live: a sessão fechou durante a retomada");
      }
      socket.send(setupMessage(config, options.model, resumeHandle));
      await awaitSessionReady(ready, socket, { label: "Gemini Live", emitter: events, timeout: options });
      return conn;
    };

    /**
     * Troca a conexão por uma nova com o handle, sem `closed`: uma tentativa por conexão. Falhou com a
     * conexão de antes ainda aberta (o `goAway` dá um prazo), a ligação segue por ela até o provedor
     * fechá-la, e o que estava guardado vai para ela; quando ela fechar, a sessão cai como antes. Falhou
     * com ela já fechada (a queda), a sessão cai já (`error` + `closed`), e o guardado é descartado.
     */
    const resume = async (old: Connection): Promise<void> => {
      old.resumeTried = true;
      swapping = true;
      let next: Connection;
      try {
        next = await open(handle);
      } catch (cause) {
        swapping = false;
        opening = undefined;
        if (closing) {
          held = [];
          return;
        }
        if (!old.closed && !ended) {
          for (const { message } of held) old.socket?.send(message);
          held = [];
          return;
        }
        held = [];
        fail(new Error(`Gemini Live: a conexão ia fechar e a retomada da sessão falhou (${cause instanceof Error ? cause.message : String(cause)})`));
        old.retired = true;
        void old.socket?.close();
        return;
      }
      opening = undefined;
      if (closing || ended) {
        next.retired = true;
        await next.socket?.close();
        return;
      }
      old.retired = true;
      current = next;
      swapping = false;
      void old.socket?.close();
      for (const { message } of held) next.socket?.send(message);
      held = [];
      emitter.emit("resumed");
    };

    const send = (message: object, audioBytes = 0): void => {
      if (!swapping) {
        current?.socket?.send(message);
        return;
      }
      held.push({ message, audioBytes });
      let total = held.reduce((sum, item) => sum + item.audioBytes, 0);
      while (total > HELD_AUDIO_MAX_BYTES) {
        const oldest = held.findIndex((item) => item.audioBytes > 0);
        total -= held[oldest]?.audioBytes ?? 0;
        held.splice(oldest, 1);
      }
    };

    current = await open(undefined);
    opening = undefined;

    const session: VoiceSession = {
      on: (event, handler) => emitter.on(event, handler),
      sendAudio(pcm16_8k) {
        send(
          { realtimeInput: { audio: { data: resample(pcm16_8k, BRIDGE_HZ, INPUT_HZ).toString("base64"), mimeType: `audio/pcm;rate=${INPUT_HZ}` } } },
          pcm16_8k.length,
        );
      },
      sendToolResult(id, result) {
        const name = toolNames.get(id);
        if (!name) {
          emitter.emit("error", new Error(`Gemini Live: resultado para uma chamada de ferramenta desconhecida: ${id}`));
          return;
        }
        toolNames.delete(id);
        // A chamada é bloqueante: o modelo retoma a fala sozinho ao receber a resposta.
        send({ toolResponse: { functionResponses: [{ id, name, response: { result } }] } });
      },
      say(text) {
        send({ realtimeInput: { text: literalSpeech(text, config.language) } });
      },
      closeCallerTurn() {
        // O áudio seguinte de quem ligou reabre o fluxo, sem mensagem a mais.
        send({ realtimeInput: { audioStreamEnd: true } });
        // Sempre agiu: não há como saber se o servidor já ia responder (comentário de topo).
        return true;
      },
      async close() {
        closing = true;
        held = [];
        const pending = opening;
        await Promise.all([current?.socket?.close(), pending?.socket?.close()]);
      },
    };

    if (config.greeting) session.say(config.greeting);
    return session;
  },

  analyzes: true,

  async classifyOutcome(apiKey, input, options: ClassifyOptions = {}) {
    const analyze = input.analyze === true;
    return classifyOutcomeOverHttp(
      {
        url: `${options.baseUrl ?? DEFAULT_API_URL}/models/${encodeURIComponent(TEXT_MODEL)}:generateContent`,
        model: TEXT_MODEL,
        pricing: TEXT_PRICING,
        // No cabeçalho, e não na URL: endereço de pedido costuma ir para log de proxy.
        headers: { "x-goog-api-key": apiKey },
        // Sem `analyze`, o pedido é exatamente o só de desfecho: quem usa só o desfecho não paga a análise.
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: analyze ? analysisPrompt(input) : outcomePrompt(input) }] }],
          generationConfig: { temperature: 0, responseMimeType: "application/json", responseSchema: analyze ? ANALYSIS_SCHEMA_GOOGLE : OUTCOME_GUESS_SCHEMA_GOOGLE },
        }),
        read: (body) => readClassifyText((body as { candidates?: { content?: { parts?: { text?: unknown }[] } }[] }).candidates?.[0]?.content?.parts?.[0]?.text, analyze),
        usage: generateUsageOf,
        classify: (status, body) => (status === 400 && saysInvalidKey(body) ? "rejected" : undefined),
      },
      classifyOptionsFor(options, analyze),
    );
  },

  transcription: recordingTranscriber,

  checkKey(apiKey, options = {}) {
    const model = options.model ?? DEFAULT_MODEL;
    return checkKeyOverHttp(
      {
        url: `${options.baseUrl ?? DEFAULT_API_URL}/models/${encodeURIComponent(model)}`,
        // No cabeçalho, e não na URL como no WebSocket: endereço de pedido costuma ir para log de proxy.
        headers: { "x-goog-api-key": apiKey },
        model,
        accepted: modelResource,
        classify: (status, body) => (status === 400 && saysInvalidKey(body) ? "rejected" : undefined),
      },
      options,
    );
  },
};

export default engine;
