import { isIP } from "node:net";
import { isPublicAddress } from "@deskvoice/core";
import { z } from "zod";
import type { AnalysisGuess } from "./analysis";
import type { Brain, BrainFailure, BrainPrice } from "./brain";
import type { OutcomeGuess } from "./outcome";

/** Definição de ferramenta no formato que os motores entendem (JSON Schema em `parameters`). */
export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface VoiceSessionConfig {
  instructions: string;
  /** Fala de abertura. O agente fala primeiro quando presente. */
  greeting?: string;
  voiceId?: string;
  /** BCP 47, ex.: "pt-BR". */
  language: string;
  tools: ToolSpec[];
  /**
   * Nomes e termos que podem aparecer na ligação, já conferidos pela regra de `@deskvoice/core`
   * (`checkVocabulary`). É dica de reconhecimento, que o provedor pode ignorar, e não garantia de
   * que o agente vá entender. Vazia ou ausente, o motor envia ao provedor o mesmo de antes. O motor
   * em pipeline (R5) reaproveita este campo no serviço de transcrição dele.
   */
  vocabulary?: readonly string[];
  /**
   * Ambiente de quem liga. `noisy` ajusta a detecção de fala do provedor para ruído de fundo (obra,
   * música, pessoas falando): o fim de turno não espera o ruído acabar, e o ruído interrompe menos.
   * `normal` ou ausente, o motor envia ao provedor o mesmo de antes. Os valores de `noisy` são ponto
   * de partida (docs/specs/2026-11-14-ambiente-barulhento.md); o efeito real não foi medido.
   */
  listeningEnvironment?: ListeningEnvironment;
  /**
   * `text`: sessão de teste do agente (docs/specs/2026-11-21-testes-do-agente.md, 5.3). Quem liga
   * fala por `sendUserText`, o agente responde em `transcript` e avisa o fim da resposta em
   * `turnDone`; não há áudio. Só para motor com `textMode`. Ausente, vale `audio`, a ligação de sempre.
   */
  mode?: "audio" | "text";
}

/** Como o agente ajusta a detecção de fala do provedor. `normal` é o de sempre. */
export type ListeningEnvironment = "normal" | "noisy";

export interface Usage {
  seconds?: number;
  /** Tokens de entrada no preço cheio (áudio, quando o motor separa; todos, quando não separa). */
  inputTokens?: number;
  outputTokens?: number;
  /** Quando o motor separa: entrada de texto (instruções, resultados de ferramenta), entrada em cache e saída de texto. */
  textInputTokens?: number;
  cachedInputTokens?: number;
  textOutputTokens?: number;
}

/** De onde veio o marco de fim da vez de quem ligou (`callerTurnEnded`). */
export type CallerTurnSource = "vad" | "transcript";

export interface VoiceSessionEvents {
  /** Fala do agente. Sempre PCM16 mono 8 kHz, em pedaços de qualquer tamanho. */
  audio(pcm16_8k: Buffer): void;
  transcript(turn: { speaker: "user" | "agent"; text: string }): void;
  toolCall(call: { id: string; name: string; args: unknown }): void;
  /**
   * O provedor desistiu destas chamadas de ferramenta (o Gemini avisa com `toolCallCancellation`,
   * em geral porque quem ligou falou por cima): o resultado delas não deve ir em `sendToolResult`.
   */
  toolCallCancelled(ids: string[]): void;
  /** O usuário falou por cima: quem toca o áudio deve descartar o que ainda não saiu. */
  interrupted(): void;
  /**
   * Há sinal de que quem ligou está falando: início de fala detectado pelo provedor, ou um pedaço
   * novo de transcrição. Vem muitas vezes por turno. Não diz quando a fala acabou: é o que a guarda
   * contra o silêncio precisa saber, e é o que o provedor erra com ruído.
   *
   * `words` é verdadeiro quando o sinal é texto novo da transcrição de quem ligou, e falso quando é
   * só detecção de início de fala.
   */
  callerActivity(signal: { words: boolean }): void;
  /**
   * A vez de quem ligou acabou, pelo que o motor sabe agora. É o marco da latência por turno: quem
   * mede (a sessão, com o relógio dela) conta daqui até o primeiro áudio do agente que sai para a
   * linha. Pode vir mais de uma vez antes da resposta: vale o último. Opcional para o motor: sem
   * ele, não há medida, e nada quebra.
   *
   * `source` diz de onde veio o marco. `vad`: o provedor detectou o fim da fala (OpenAI,
   * `input_audio_buffer.speech_stopped`). `transcript`: o provedor não avisa o fim da fala, e o
   * marco é o pedaço mais recente da transcrição de quem ligou (Gemini); a transcrição chega depois
   * do fim real da fala, então a medida sai menor que a espera de verdade.
   */
  callerTurnEnded(signal: { source: CallerTurnSource }): void;
  /** Incremento desde o último `usage` (não é acumulado): quem mede custo soma os eventos. */
  usage(usage: Usage): void;
  /** Seguido de `closed` quando é fatal; sozinho, a sessão continua. */
  error(error: Error): void;
  /**
   * O motor trocou a conexão com o provedor por uma nova, retomando a mesma conversa, sem fechar a
   * sessão (o provedor avisou que ia fechar a de antes, ou ela caiu). Só informa: nada muda para quem
   * chama, e o consumo da conexão nova continua chegando em `usage`.
   */
  resumed(): void;
  /**
   * Sessão em `mode: "text"`: a resposta do agente acabou, sem ferramenta pendente. É o fim do turno
   * de um teste do agente. Opcional: motor sem `textMode` não emite.
   */
  turnDone(): void;
  /**
   * Só motores com peças separadas (o pipeline, R5). Incremento de consumo de uma peça, já com o
   * custo pelo preço dela. Opcional: motor que não emite continua no caminho de `usage`, sem mudança.
   */
  pieceUsage(line: PieceUsageLine): void;
  closed(reason: string): void;
}

/** As peças do pipeline, no rótulo do extrato (`<peça>:<id>`, como o `transcriber:<id>` do #245). */
export type PipelinePieceKind = "transcriber" | "brain" | "synthesizer";

/**
 * Uma linha de custo de uma peça (`VoiceSessionEvents.pieceUsage`, seção 3.3 de
 * `docs/specs/2026-11-17-motor-de-voz-em-pipeline.md`). `costMicrocents` ausente é **custo não
 * medido** (peça sem preço conhecido, ou consumo não declarado), nunca zero: é a regra da R4 e do
 * `SpeechUsage`. `estimated` diz se o consumo foi contado aqui em vez de declarado pelo provedor.
 */
export interface PieceUsageLine {
  piece: PipelinePieceKind;
  id: string;
  model?: string;
  usage: Usage;
  /** Só na voz: caracteres enviados ao provedor. */
  characters?: number;
  costMicrocents?: number;
  estimated: boolean;
}

export interface VoiceSession {
  on<K extends keyof VoiceSessionEvents>(event: K, handler: VoiceSessionEvents[K]): void;
  /** Áudio de quem ligou. Sempre PCM16 mono 8 kHz. */
  sendAudio(pcm16_8k: Buffer): void;
  sendToolResult(id: string, result: unknown): void;
  /** Pede ao motor uma fala com este conteúdo (aviso de gravação, desculpa, espera). */
  say(text: string): void;
  /**
   * Pede ao provedor que dê por encerrada a fala de quem ligou e responda ao que ouviu. A guarda
   * contra o silêncio chama isto quando o provedor não viu o fim do turno.
   *
   * Diz se agiu: `false` quando o motor não mandou nada, porque o provedor já tinha fechado a vez
   * de quem ligou e só está lento (a resposta que vier não foi forçada). `true`, ou sem retorno,
   * quando mandou fechar. A sessão só tira o turno da latência por turno quando o motor agiu.
   */
  closeCallerTurn(): boolean | void;
  /**
   * Contexto para o agente, que não vira fala por si. Entra pelo mecanismo que o provedor documenta,
   * nunca por `say`. Sem o método, o motor não aceita orientação, e quem chama registra isso.
   * Depois de `close`, não manda nada.
   */
  guide?(text: string): void;
  /**
   * Quanto da fala desta sessão já tocou para quem ligou, em ms, acumulado desde o início da sessão.
   * Quem toca o áudio chama na interrupção, antes de descartar o resto, para o motor cortar no
   * histórico o que não chegou a tocar. Sem o método, o motor não corta e nada muda.
   */
  played?(ms: number): void;
  /**
   * Sessão em `mode: "text"`: o que quem liga diz, em texto. Só nos motores com `textMode`; o fim da
   * resposta vem em `turnDone`.
   */
  sendUserText?(text: string): void;
  close(): Promise<void>;
}

export interface EnginePricing {
  /** Centavos de dólar por minuto de conversa, quando o provedor cobra por tempo. */
  centsPerMinute?: number;
  /** Centavos de dólar por milhão de tokens de áudio. */
  centsPerMillionInputTokens?: number;
  centsPerMillionOutputTokens?: number;
  /** Preços menores que o provedor cobra por texto e por entrada em cache. Sem eles, vale o preço cheio. */
  centsPerMillionTextInputTokens?: number;
  centsPerMillionCachedInputTokens?: number;
  centsPerMillionTextOutputTokens?: number;
  /** Data em que o preço foi conferido na página do provedor (AAAA-MM-DD). */
  checkedOn: string;
  source: string;
}

export interface ConnectOptions {
  /** Sobrepõe o modelo padrão do motor. */
  model?: string;
  /** Sobrepõe a URL do WebSocket do provedor (testes apontam para um servidor falso). */
  baseUrl?: string;
  /** Prazo para a conexão abrir e, depois, para o provedor confirmar a sessão. Padrão: 10 s cada. */
  readyTimeoutMs?: number;
  /** Agendador do prazo (`setTimeout` por padrão). Devolve como cancelar. */
  schedule?: (fn: () => void, delayMs: number) => () => void;
}

/**
 * O provedor não respondeu no prazo ao abrir a sessão. Quem ligou já foi atendido: a chamada
 * precisa sair do silêncio, então quem chama `connect` trata isto como recusa, e não espera.
 */
export class EngineTimeoutError extends Error {}

/**
 * O resultado do teste de uma chave, num vocabulário fechado: a tela e a saúde traduzem o código,
 * e nunca repassam o texto do provedor.
 */
export const KEY_CHECK_RESULTS = [
  /** A chave foi aceita e dá acesso ao modelo que o motor usa. */
  "accepted",
  /** O provedor recusou a chave (inválida, revogada ou sem permissão). */
  "rejected",
  /** A chave foi aceita, mas o modelo que o motor usa não existe para ela. */
  "model_unavailable",
  /** O provedor disse que falta crédito ou que o limite de gasto da conta foi atingido. */
  "no_credit",
  /** O provedor não atende o país, a região ou o território de onde o servidor fala com ele. */
  "region_unavailable",
  /** O provedor pediu para esperar (limite de pedidos). */
  "rate_limited",
  /** Sem resposta: prazo esgotado, DNS, conexão recusada ou derrubada. */
  "unreachable",
  /** O provedor respondeu, com erro do lado dele (5xx). */
  "provider_error",
  /** O provedor respondeu algo que não é o que a documentação descreve. */
  "unexpected_response",
  /** O motor não usa chave. */
  "not_needed",
] as const;
export type KeyCheckResult = (typeof KEY_CHECK_RESULTS)[number];

export interface KeyCheck {
  result: KeyCheckResult;
  /** O modelo conferido (o mesmo que `connect` abre). Ausente no motor sem chave. */
  model?: string;
}

export interface KeyCheckOptions {
  /** Sobrepõe o modelo padrão do motor. */
  model?: string;
  /** Sobrepõe a URL da API HTTP do provedor (testes apontam para um servidor falso). */
  baseUrl?: string;
  fetch?: typeof fetch;
  /** Prazo da resposta. Padrão: 10 s; 30 s no pedido completo (`analyze`). */
  timeoutMs?: number;
  /** Agendador do prazo (`setTimeout` por padrão). Devolve como cancelar. */
  schedule?: (fn: () => void, delayMs: number) => () => void;
}

/** Uma voz do provedor. `style` é o descritor que a documentação dele usa ("Warm", "Bright"). */
export interface EngineVoice {
  id: string;
  style?: string;
  /** O provedor recomenda esta voz. A tela escreve o rótulo no idioma dela. */
  recommended?: boolean;
  /**
   * A amostra que o botão "Ouvir" da tela do agente toca, por idioma falado: o caminho do arquivo
   * relativo a `apps/panel/public/` (`voice-samples/<motor>/<voz>.<idioma>.mp3`). Sem a do idioma do
   * agente, a tela toca a de pt-BR e diz que é em português; sem nenhuma, o botão fica desligado e a
   * tela diz por quê. A cerca `voice-samples-exist` reprova caminho sem arquivo (DESA-397, fatia 1a).
   */
  sample?: { "pt-BR"?: string; en?: string; es?: string };
}

/** De onde veio uma declaração do provedor, como `pricing.checkedOn`: endereço e dia conferido. */
export interface LocationSource {
  url: string;
  /** `AAAA-MM-DD`. */
  checkedOn: string;
}

/**
 * Onde o áudio é processado. País só existe com fonte: o tipo não deixa declarar um sem a outra.
 * `undeclared` é o provedor que não publica o lugar, e isso precisa aparecer na tela, porque
 * silêncio ali se confunde com garantia.
 */
export type ProcessingLocation =
  | { kind: "this-server" }
  | { kind: "undeclared" }
  | { kind: "country"; country: string; source: LocationSource };

/** O que a classificação precisa saber: o que foi dito e o que o agente fez. */
export interface ClassifyInput {
  /** Falas da ligação, uma por linha, com quem falou. */
  transcript: string;
  /** Ferramentas chamadas na ligação, pelo nome. */
  tools: readonly string[];
  /**
   * Pede o formato completo: o desfecho e a análise da ligação na mesma resposta. Só vale para motor
   * com `analyzes`. Sem ele, o pedido é exatamente o só de desfecho.
   */
  analyze?: boolean;
}

export interface ClassifyOptions {
  fetch?: typeof fetch;
  /** Prazo da resposta. Padrão: 10 s; 30 s no pedido completo (`analyze`). */
  timeoutMs?: number;
  /** Agendador do prazo (`setTimeout` por padrão). Devolve como cancelar. */
  schedule?: (fn: () => void, delayMs: number) => () => void;
  /** Sobrepõe a URL da API HTTP do provedor (testes apontam para um servidor falso). */
  baseUrl?: string;
  /**
   * Sobrepõe o modelo do pedido de classificação. Sem ele, o modelo do motor — o mesmo de antes
   * desta opção existir. Só a classificação lê: a voz em tempo real tem o modelo dela.
   */
  model?: string;
}

/** Por que a classificação não leu um desfecho: o vocabulário do teste da chave, menos o que não é falha. */
export type ClassifyFailure = Exclude<KeyCheckResult, "accepted" | "not_needed">;

/**
 * O que a classificação devolve: o palpite, ou o motivo de não haver. Nos dois casos, o consumo
 * que o provedor declarou e o custo dele pelo preço do modelo de texto, para entrar no custo da
 * chamada (um 200 fora da forma também foi cobrado).
 *
 * O custo vem em duas vistas do mesmo número: `costMicrocents`, a exata, e `costCents`, ela
 * arredondada para cima. Quem lê uma ligação custa cerca de 0,03 centavo, então quem grava o
 * extrato usa o micro-centavo e arredonda uma vez só, no total da chamada.
 */
export type ClassifyResult = { model: string; usage: Usage; costCents: number; costMicrocents: number } & (
  // `analysis` só no pedido completo, já na forma e antes da checagem contra a transcrição.
  | { ok: true; guess: OutcomeGuess; analysis?: AnalysisGuess }
  // `status` é o HTTP da resposta; `null` quando ela não veio (prazo, rede).
  | { ok: false; failure: ClassifyFailure; status: number | null }
);

/** A transcrição de um lado da gravação: o texto, ou o motivo de não haver um, e sempre o custo. */
export type TranscribeResult = { model: string; usage: Usage; costCents: number } & (
  // `text` vazio é "o provedor ouviu e não achou fala", não falha.
  | { ok: true; text: string }
  | { ok: false; failure: ClassifyFailure; status: number | null }
);

export interface TranscribeInput {
  /** Um lado da chamada, WAV PCM16 mono. */
  audio: Uint8Array;
  /** Duração do áudio, para o preço por minuto quando o provedor não declara o consumo. */
  seconds: number;
  /** O idioma do agente (`pt-BR`). */
  language: string;
}

/** Transcreve áudio já gravado, depois da chamada. */
export interface RecordingTranscriber {
  /** O modelo que transcreve: o preço abaixo é o dele. */
  model: string;
  pricing: EnginePricing;
  /** O maior WAV mono que o provedor aceita num pedido, em bytes. Acima disto o pedido nem sai. */
  maxAudioBytes: number;
  /** Nunca lança: falha volta como `ok: false`, com o consumo que o provedor cobrou. */
  transcribe(apiKey: string, input: TranscribeInput, options?: ClassifyOptions): Promise<TranscribeResult>;
}

/**
 * Uma pergunta fixa ao modelo de decisão (R12, Parte 3). O texto de quem ligou nunca entra aqui:
 * ele vai no `state`, que é dado. `noul` é sim ou não (a resposta é a probabilidade do sim),
 * `choice` é uma entre as opções, `score` é um nível de uma escala.
 */
export type DecisionQuestion =
  | { kind: "noul"; instruction: string; criteria?: { true: string; false: string } }
  | { kind: "choice"; instruction: string; options: Record<string, string> }
  | { kind: "score"; instruction: string; levels: readonly [string, string, ...string[]] };

export type DecisionAnswer =
  | { kind: "noul"; value: number }
  | { kind: "choice"; choice: string; probabilities: Record<string, number>; confidence: number }
  | { kind: "score"; score: number; probabilities: Record<string, number>; confidence: number };

export interface DecideInput {
  state: string;
  questions: Record<string, DecisionQuestion>;
}

/**
 * O que o modelo de decisão devolve: as respostas, ou o motivo de não haver, e sempre o consumo e
 * o custo. `late` é o pedido que passou do prazo e foi cancelado. O custo vem nas duas vistas da
 * classificação (`ClassifyResult`): um pedido custa milésimos de centavo, e o extrato guarda o
 * micro-centavo.
 */
/**
 * `costEstimated`: o custo é uma estimativa (o pedido saiu e o consumo não foi lido). Ausente ou
 * `false`, o custo é o medido pelo consumo que o provedor declarou.
 */
export type DecideResult = { model: string; usage: Usage; costCents: number; costMicrocents: number; costEstimated?: boolean; latencyMs: number } & (
  | { ok: true; answers: Record<string, DecisionAnswer> }
  | { ok: false; failure: ClassifyFailure | "late"; status: number | null }
);

/**
 * Um modelo que decide sobre texto (o filtro da fala de quem ligou; depois, os analistas ao vivo).
 * Um arquivo por modelo em `deciders/`, descoberto por `loadDecisionModels`.
 */
export interface DecisionModel {
  id: string;
  label: string;
  provider: string;
  processingLocation: ProcessingLocation;
  pricing: EnginePricing;
  keyless?: boolean;
  /** Nunca lança. Todas as perguntas numa passada só. Passado `timeoutMs`, cancela e devolve `late`. */
  decide(apiKey: string, input: DecideInput, options?: ClassifyOptions): Promise<DecideResult>;
  checkKey?(apiKey: string, options?: KeyCheckOptions): Promise<KeyCheck>;
}

/** Um trecho de texto da fala de quem ligou, enquanto ela acontece. */
export interface TranscriptPiece {
  /** O texto do trecho. No parcial, pode mudar no próximo evento. */
  text: string;
  /** Verdadeiro quando o serviço não vai mais mudar este trecho. */
  final: boolean;
  /**
   * Outras leituras do mesmo trecho, quando o serviço as devolve, da mais para a menos provável.
   * É o que o filtro de leitura (R12, Parte 3) escolhe. Vazio quando o serviço não devolve.
   */
  alternatives: readonly string[];
  /** Milissegundos desde o início do fluxo, segundo o serviço. Ausente se ele não diz. */
  startMs?: number;
  endMs?: number;
}

export interface StreamingTranscriptionEvents {
  piece(piece: TranscriptPiece): void;
  /** Incremento de consumo, como em `VoiceSessionEvents.usage`. */
  usage(usage: Usage): void;
  /** Seguido de `closed` quando é fatal. */
  error(error: Error): void;
  closed(reason: string): void;
}

export interface StreamingTranscription {
  on<K extends keyof StreamingTranscriptionEvents>(event: K, handler: StreamingTranscriptionEvents[K]): void;
  /** Áudio de quem ligou, PCM16 mono 8 kHz, o mesmo que o motor recebe. */
  sendAudio(pcm16_8k: Buffer): void;
  close(): Promise<void>;
}

/**
 * Transcrição da fala de quem ligou em streaming, ao lado do motor (docs/specs/2026-11-14-transcricao-pura.md).
 * Uma peça por arquivo em `transcribers/`, descoberta pela pasta (`loadTranscribers`). Nasce
 * desligada: sem um agente que peça a peça, a chamada é a de sempre.
 */
export interface StreamingTranscriber {
  id: string;
  label: string;
  provider: string;
  processingLocation: ProcessingLocation;
  pricing: EnginePricing;
  /** Verdadeiro quando não usa chave (o simulado, ou um local). */
  keyless?: boolean;
  /** Quantos termos de vocabulário o serviço aceita. Acima disso, os primeiros N. */
  maxVocabulary: number;
  connect(config: { language: string; vocabulary: readonly string[] }, apiKey: string, options?: ConnectOptions): Promise<StreamingTranscription>;
  checkKey?(apiKey: string, options?: KeyCheckOptions): Promise<KeyCheck>;
}

/**
 * A peça de transcrição recusou abrir, com o motivo no vocabulário fechado do teste da chave. Quem
 * chama `connect` grava o motivo na linha do tempo; o texto do provedor fica só no log.
 */
export class TranscriberOpenError extends Error {
  constructor(
    readonly result: Exclude<KeyCheckResult, "accepted" | "not_needed">,
    message: string,
  ) {
    super(message);
  }
}

export interface VoiceEngine {
  id: string;
  label: string;
  /** Quem processa o áudio: `google`, `openai`, ou `none` (o motor simulado roda aqui mesmo). */
  provider: string;
  processingLocation: ProcessingLocation;
  /** As vozes que a tela oferece. */
  voices?: readonly EngineVoice[];
  /** A voz usada quando o agente não escolheu nenhuma. */
  defaultVoice?: string;
  /** Verdadeiro para motores que não precisam de chave (o simulado). */
  keyless?: boolean;
  pricing: EnginePricing;
  /**
   * O marco de fim da vez de quem ligou que este motor emite (`callerTurnEnded`): sempre o mesmo por
   * motor. A sessão usa isto quando a guarda contra o silêncio fecha uma vez que não teve marco (o
   * provedor não viu o fim da fala): o turno conta em `guardTurns` com este motor e este `source`.
   * Motor sem a declaração: a vez que a guarda fecha sem marco não conta em lugar nenhum.
   */
  callerTurnSource?: CallerTurnSource;
  /**
   * O motor aceita sessão de teste em texto (`mode: "text"`, `sendUserText`, `turnDone`). Motor sem
   * a declaração não roda teste do agente.
   */
  textMode?: true;
  connect(config: VoiceSessionConfig, apiKey: string, options?: ConnectOptions): Promise<VoiceSession>;
  /**
   * Lê a conversa e diz o desfecho comercial dela, com a confiança e a fala que o sustenta.
   *
   * Opcional de propósito: motor que não classifica apenas não declara o método, e a rotina não
   * grava nada. Nunca lança: provedor fora do ar, resposta estranha ou chave sem crédito voltam como
   * `ok: false` com o motivo, que a rotina registra na linha do tempo da chamada.
   */
  classifyOutcome?(apiKey: string, input: ClassifyInput, options?: ClassifyOptions): Promise<ClassifyResult>;
  /**
   * Verdadeiro para motor cujo `classifyOutcome` aceita destino próprio na classificação: `baseUrl`
   * e `model` de `ClassifyOptions`. Só esses motores ganham, no painel, os campos de endpoint e
   * modelo; motor sem a declaração classifica no endereço oficial dele.
   */
  classifyTarget?: boolean;
  /**
   * O preço, por milhão de tokens, que este motor cobra por um modelo de classificação — quando o
   * projeto o conhece. É o que autoriza gravar um modelo **sem** endpoint: sem endpoint o pedido vai
   * ao próprio provedor do motor, que cobra, e o custo só é medido se o preço do modelo estiver
   * aqui. O painel recusa ao salvar o modelo fora daqui, e o motor, na hora do pedido, troca o
   * modelo gravado por fora pelo modelo de tabela (o medido). Modelo com endpoint não precisa disto:
   * quem cobra é o provedor do endpoint.
   */
  classifyPricing?(model: string): EnginePricing | undefined;
  /**
   * Verdadeiro para motor cujo `classifyOutcome` atende `analyze` e devolve a análise da ligação.
   * Motor sem a declaração não analisa, e a rotina registra o motivo na linha do tempo.
   */
  analyzes?: boolean;

  /**
   * Transcreve a gravação de uma chamada que ficou sem texto, um lado por vez. Opcional como
   * `classifyOutcome`: motor que não declara não transcreve, e o painel diz isso.
   */
  transcription?: RecordingTranscriber;

  /**
   * Confere a chave sem abrir sessão de voz e sem gastar: a chamada mais barata do provedor que
   * prova que a chave vale e alcança o modelo de `connect`. Nunca lança, nunca registra a chave.
   */
  checkKey(apiKey: string, options?: KeyCheckOptions): Promise<KeyCheck>;
}

/**
 * Uma voz que o sintetizador oferece, lida da conta do operador (R5, voz do pipeline).
 */
export interface SynthesizerVoice {
  id: string;
  name: string;
  /** Idiomas que o provedor declara verificados para a voz (`pt-BR`, ...). Vazio quando não declara. */
  languages: readonly string[];
  /** Amostra que o provedor hospeda: tocar não gasta crédito. */
  previewUrl?: string;
}

export type SynthesizerVoicesResult = { ok: true; voices: SynthesizerVoice[] } | { ok: false; failure: BrainFailure; status: number | null };

/** O preço por caractere, que é como a ElevenLabs cobra. De um modelo, com a fonte e o dia conferido. */
export interface SynthesizerPricing {
  centsPerThousandCharacters: number;
  source: string;
  /** `AAAA-MM-DD`. */
  checkedOn: string;
}

/**
 * O consumo de uma fala, em incrementos (como `VoiceSessionEvents.usage`): quem mede soma os eventos.
 * Sai quando o texto **é enviado** ao provedor, e não quando vira áudio: é o que o provedor cobra,
 * inclusive do que a interrupção descartou. `costMicrocents` ausente é "sem preço conhecido" (o
 * modelo não está na tabela), nunca zero. `estimated` é sempre verdadeiro enquanto ninguém comparar a
 * contagem com o consumo da conta.
 */
export interface SpeechUsage {
  characters: number;
  costMicrocents?: number;
  estimated: true;
}

export interface SpeechEvents {
  /** PCM16 mono 8 kHz, como `VoiceSessionEvents.audio`. */
  audio(pcm16_8k: Buffer): void;
  /** O que já virou áudio, em caracteres, acumulado, para cortar a fala do agente na interrupção (fatia 4). */
  spoken(chars: number): void;
  /** Incremento do que foi enviado ao provedor, com o custo. */
  usage(usage: SpeechUsage): void;
  /** Esta fala terminou de gerar. Não vem depois de `cancel`. */
  done(): void;
  error(error: Error): void;
}

export interface Speech {
  on<K extends keyof SpeechEvents>(event: K, handler: SpeechEvents[K]): void;
  /** Texto em pedaços, como o cérebro entrega. `flush` força a geração do que já chegou. */
  push(text: string, options?: { flush?: boolean }): void;
  /** Não vem mais texto: o provedor gera o resto e a fala termina com `done`. */
  end(): void;
  /** Interrupção: para de gerar e descarta o que não saiu. O que já foi enviado ao provedor é cobrado. */
  cancel(): void;
}

/** Por que a fala não abriu, no vocabulário fechado do teste da chave. */
export type SynthesizerOpenFailure = Exclude<KeyCheckResult, "accepted" | "not_needed">;

/** A fala não abriu. Quem abre trata como recusa de abertura; o texto do provedor fica só em `message`, para o log. */
export class SynthesizerOpenError extends Error {
  readonly reason: SynthesizerOpenFailure;
  constructor(reason: SynthesizerOpenFailure, message: string) {
    super(message);
    this.reason = reason;
  }
}

export interface SpeakConfig {
  voiceId: string;
  /** BCP 47, ex.: "pt-BR". */
  language: string;
  /** Sobrepõe o modelo padrão do sintetizador. */
  model?: string;
}

/**
 * Uma voz do pipeline (R5): recebe texto em pedaços e devolve PCM16 mono 8 kHz. Um arquivo por
 * provedor em `synthesizers/`, descoberto por `loadSynthesizers`.
 */
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
  /** Nunca lança. */
  listVoices(apiKey: string, options?: KeyCheckOptions): Promise<SynthesizerVoicesResult>;
  /** Nunca lança, nunca sintetiza, nunca registra a chave. */
  checkKey(apiKey: string, options?: KeyCheckOptions): Promise<KeyCheck>;
  /** Abre uma fala. Lança `SynthesizerOpenError` com o motivo no vocabulário fechado. */
  speak(config: SpeakConfig, apiKey: string, options?: ConnectOptions): Promise<Speech>;
}

/**
 * O que só o motor pipeline lê no `connect` (seção 3.3 de `docs/specs/2026-11-17-motor-de-voz-em-pipeline.md`):
 * as três peças já escolhidas e as chaves delas, cada uma decifrada por quem abre a ligação. O
 * `connect` dos outros motores não muda: este tipo estende `ConnectOptions` só no pipeline.
 */
export interface PipelinePieces {
  transcriber: { piece: StreamingTranscriber; apiKey: string };
  /** Só cérebro com `chat`. `price` ausente é "preço não conhecido": a linha sai sem custo, nunca zero. */
  brain: { piece: Brain; apiKey: string; model: string; price?: BrainPrice };
  synthesizer: { piece: SpeechSynthesizer; apiKey: string; voiceId: string; model?: string };
}

export interface PipelineConnectOptions extends ConnectOptions {
  pieces: PipelinePieces;
  /** A organização da ligação: o cache das falas fixas nunca atravessa organizações. */
  organizationId: string;
  /**
   * Falas fixas que quem abre a ligação precisa ter prontas sem gasto novo na hora (as despedidas do
   * teto). São sintetizadas no `connect`, junto com a fala de falha do motor, e tocam por `say(text)`
   * com o mesmo texto.
   */
  fixedSpeech?: readonly string[];
}

/**
 * Uma peça do pipeline caiu (seção 3.4). O `reason` está no vocabulário fechado do teste da chave;
 * o texto do provedor fica só em `message`, para o log. `fatal` diz se a sessão fecha em seguida
 * (com `closed`): o cérebro que falha uma vez não é fatal, a conversa segue.
 */
export class PipelinePieceError extends Error {
  constructor(
    readonly piece: PipelinePieceKind,
    readonly pieceId: string,
    readonly reason: Exclude<KeyCheckResult, "accepted" | "not_needed">,
    readonly fatal: boolean,
    message: string,
  ) {
    super(message);
  }
}

// Mora aqui, e não em outcome.ts, porque o painel importa valor só por `@deskvoice/voice-engine/types`:
// o índice puxa load.ts, cujo `new URL("./engines", import.meta.url)` o Turbopack não resolve.
/**
 * Classificação do desfecho ligada, por organização (chave `calls.outcome_enabled` em `settings`).
 * Ausente é desligada, de fábrica: cada ligação classificada é uma chamada paga ao provedor, com a
 * transcrição em texto, e quem atualiza não passa a gastar nem a enviar sem decidir. Só `true` liga.
 */
export const OUTCOME_SETTING = "calls.outcome_enabled";
export const outcomeEnabledOf = (stored: unknown): boolean => stored === true;

/**
 * Análise da ligação no fim ligada, por organização (chave `calls.analysis_enabled` em `settings`).
 * Ausente é desligada, de fábrica, pelo mesmo motivo do desfecho. Com ela ligada, o pedido ao
 * provedor é o completo, e o desfecho é gravado junto. Só `true` liga.
 */
export const ANALYSIS_SETTING = "calls.analysis_enabled";
export const analysisEnabledOf = (stored: unknown): boolean => stored === true;

/**
 * Transcrever a gravação de uma chamada sem texto, por organização (chave `calls.transcription_enabled`).
 * Ausente é desligada, de fábrica: o áudio gravado vai ao provedor do motor e cada transcrição é paga.
 * Só `true` liga.
 */
export const TRANSCRIPTION_SETTING = "calls.transcription_enabled";
export const transcriptionEnabledOf = (stored: unknown): boolean => stored === true;

/**
 * Transcrever sozinho, ao fim da chamada, a gravação que terminou sem fala nenhuma (chave
 * `calls.auto_transcription_enabled`). Ausente é desligada, de fábrica: cada chamada sem texto vira
 * um pedido pago ao provedor, sem ninguém pedir. Só vale com `calls.transcription_enabled` também
 * ligada, que é a licença para o áudio sair para o provedor. Só `true` liga.
 */
export const AUTO_TRANSCRIPTION_SETTING = "calls.auto_transcription_enabled";
export const autoTranscriptionEnabledOf = (stored: unknown): boolean => stored === true;

/**
 * O modelo de decisão que lê a fala de quem ligou durante a chamada, por organização (chave
 * `calls.decision_model` em `settings`, com o id do modelo). Ausente é desligado, de fábrica: cada
 * fala vira um pedido pago, com o texto de quem ligou, ao fornecedor do modelo. Só um id de texto liga;
 * quem confere se o modelo existe nesta instalação é quem o usa.
 */
export const DECISION_MODEL_SETTING = "calls.decision_model";
export const decisionModelOf = (stored: unknown): string | undefined => (typeof stored === "string" && stored.trim() !== "" ? stored.trim() : undefined);
/** A chave do modelo de decisão, cifrada como a dos motores. É do operador, e nunca a do motor de voz. */
export const decisionModelKeySetting = (modelId: string): string => `decision_model.${modelId}.api_key`;

/**
 * Endpoint, modelo e chave da **classificação**, por motor, juntos numa configuração só
 * (`engine.<id>.classify_target` em `settings`).
 *
 * Existem porque a classificação é a tarefa em que o provedor compatível com OpenAI (DeepSeek,
 * Qwen, OpenRouter, Groq) resolve: uma chamada curta, saída em JSON, uma vez por ligação. Sem
 * eles, quem não tem chave OpenAI ou Google não classifica nada. A voz em tempo real continua nos
 * endpoints oficiais: provedor compatível não oferece áudio bidirecional.
 *
 * Ausentes valem o padrão do motor, que é o de hoje: OpenAI em `https://api.openai.com/v1`, com
 * `gpt-5-nano` e a chave do motor. Com endpoint, a chave é a dele (`apiKey`, cifrada), dada a esse
 * endereço: a chave do motor nunca vai a um endpoint configurado, e trocar o endpoint pede a chave
 * de novo. Só o modelo, sem endpoint, continua na OpenAI com a chave do motor — e só se o motor
 * souber o preço dele (`classifyPricing`): o painel recusa gravar outro, e o motor usa o modelo de
 * tabela quando um já gravado cai fora dela, para não cobrar sem medir.
 */
export const engineClassifyTargetSetting = (engineId: string): string => `engine.${engineId}.classify_target`;

/** O destino da classificação, quando o dono configurou um; vazio é o padrão do motor. */
export interface ClassifyTarget {
  baseUrl?: string;
  model?: string;
}

/** Como a configuração fica gravada: só os campos de texto, sem validar o conteúdo. `apiKey` vem cifrada. */
export interface StoredClassifyTarget {
  baseUrl?: string;
  model?: string;
  apiKey?: string;
}

// Campo que não é texto, ou vazio, é como se não estivesse gravado.
const storedText = z.string().min(1).optional().catch(undefined);
const storedClassifyTarget = z.object({ baseUrl: storedText, model: storedText, apiKey: storedText }).catch({});

export const storedClassifyTargetOf = (stored: unknown): StoredClassifyTarget => storedClassifyTarget.parse(stored);

const MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;

/**
 * O endereço serve como destino da classificação? Só `https`, porque a chave do provedor vai no
 * cabeçalho e um `http` a entregaria em claro; sem usuário e senha na URL; e, quando o host é um
 * IP, só IP público, pela mesma lista da guarda de rede dos conectores. Nome de host é conferido
 * de novo na hora do pedido, com o DNS resolvido, pela própria guarda.
 */
export const isClassifyBaseUrl = (value: string): boolean => {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (url.protocol !== "https:" || host === "" || url.username !== "" || url.password !== "") return false;
  if (host === "localhost" || host.endsWith(".localhost")) return false;
  return isIP(host) === 0 || isPublicAddress(host);
};

/** O endereço gravado, sem a barra final (o caminho é colado depois), ou `undefined` se não serve. */
export const classifyBaseUrlOf = (stored: unknown): string | undefined => {
  if (typeof stored !== "string") return undefined;
  const value = stored.trim().replace(/\/+$/, "");
  return isClassifyBaseUrl(value) ? value : undefined;
};

/** O nome do modelo: o que o provedor publica (`deepseek-chat`, `qwen/qwen3-32b`), ou `undefined`. */
export const classifyModelOf = (stored: unknown): string | undefined => {
  if (typeof stored !== "string") return undefined;
  const value = stored.trim();
  return MODEL_NAME.test(value) ? value : undefined;
};

/** Por que a classificação não sai para o endpoint configurado. */
export type ClassifyDestinationRefusal =
  /** O endpoint gravado não é `https` público (foi gravado por fora do painel), ou a guarda de rede o recusou na hora. */
  | "endpoint_refused"
  /** Há endpoint, mas não a chave dele: a do motor não serve, porque foi dada a outro endereço. */
  | "endpoint_key_missing";

/**
 * Para onde a rotina manda a classificação, lido do que está gravado. Sem endpoint, o padrão do
 * motor (e o modelo, se válido), com a chave do motor. Com endpoint, só se ele for válido e tiver
 * a chave dele, que volta em `endpointKey`, ainda cifrada; senão, o motivo de não sair nada.
 * Modelo inválido cai no padrão do motor.
 */
export const classifyDestinationOf = (
  stored: unknown,
): { ok: true; target: ClassifyTarget; endpointKey?: string } | { ok: false; reason: ClassifyDestinationRefusal } => {
  const { baseUrl: storedBaseUrl, model: storedModel, apiKey } = storedClassifyTargetOf(stored);
  const model = classifyModelOf(storedModel);
  const withModel = model !== undefined ? { model } : {};
  if (storedBaseUrl === undefined) return { ok: true, target: withModel };
  const baseUrl = classifyBaseUrlOf(storedBaseUrl);
  if (baseUrl === undefined) return { ok: false, reason: "endpoint_refused" };
  if (apiKey === undefined) return { ok: false, reason: "endpoint_key_missing" };
  return { ok: true, target: { baseUrl, ...withModel }, endpointKey: apiKey };
};
