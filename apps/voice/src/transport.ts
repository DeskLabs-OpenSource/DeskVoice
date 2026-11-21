/** Agenda `fn` para daqui a `delayMs` e devolve como cancelar. Injetável: teste não espera tempo real. */
export type Schedule = (fn: () => void, delayMs: number) => () => void;

export const realSchedule: Schedule = (fn, delayMs) => {
  const timer = setTimeout(fn, delayMs);
  return () => clearTimeout(timer);
};

/** Todo áudio entre a telefonia e a conversa é PCM16 mono 8 kHz, em quadros de 20 ms. */
export const SAMPLE_RATE = 8000;
export const FRAME_MS = 20;
export const FRAME_BYTES = 320;

/**
 * O lado de telefonia de uma chamada, visto pela conversa (`call-session.ts`). A mesma conversa
 * roda sobre o Asterisk (`asterisk-transport.ts`) e sem telefonia (`simulated-transport.ts`).
 */
export interface CallTransport {
  /** `false`: este canal não tem para onde transferir (a ligação pelo WhatsApp). Ausente vale `true`. */
  readonly canTransfer?: boolean;
  /** Áudio de quem ligou. O que chegar antes do primeiro handler fica guardado e é entregue a ele. */
  onAudio(handler: (pcm16_8k: Buffer) => void): void;
  /** Fala do agente, em pedaços de qualquer tamanho. Sai na cadência real de 20 ms por quadro. */
  sendAudio(pcm16_8k: Buffer): void;
  /** Descarta o que ainda não saiu (quem ligou falou por cima). */
  clearAudio(): void;
  /**
   * Quanto da fala do agente já saiu para quem ligou nesta chamada, em ms, acumulado: os quadros
   * enviados, nunca o que está na fila. Opcional: o canal que não sabe (sem telefonia, o WhatsApp,
   * o navegador) não declara, e o motor não corta a fala interrompida no histórico.
   */
  playedMs?(): number;
  /** Quem ligou desligou, ou a telefonia caiu. Não dispara quando o encerramento partiu daqui. */
  onHangup(handler: () => void): void;
  /** Espera a fala pendente terminar de sair e desliga. */
  hangup(): Promise<void>;
  /**
   * Espera a fala pendente terminar de sair e passa a ligação para `toE164`. Sem `returnIfUnanswered`,
   * resolve assim que a ligação saiu daqui, como sempre foi. Com ele, e só no canal que declara
   * `canReturnFromTransfer`, resolve quando a transferência terminou: atendida (no atendimento), abandonada
   * por quem ligou, ou de volta, com o áudio desta ligação já no transporte de novo (`returned`).
   */
  transfer(toE164: string, options?: TransferOptions): Promise<TransferOutcome | void>;
  /**
   * `true`: a transferência que ninguém atende pode voltar para a conversa (`transfer` com
   * `returnIfUnanswered`). Só o Asterisk declara (Vapi · fatia 5a). Ausente vale `false`.
   */
  readonly canReturnFromTransfer?: boolean;
  /**
   * Aperta teclas no menu do outro lado e resolve quando o último tom saiu. Opcional: o canal que
   * não tem como mandar tom (a ligação pelo WhatsApp) não declara, e a ferramenta se recusa.
   */
  sendDtmf?(digits: string): Promise<void>;
  /**
   * Tecla apertada por quem ligou. Opcional pelo mesmo motivo de `sendDtmf`, ao contrário: o canal
   * que não tem teclado (a ligação pelo WhatsApp) não declara.
   *
   * O Asterisk já entrega isto no AudioSocket há tempo (`audiosocket.ts`), mas o contrato da
   * conversa não expunha — a tecla chegava ao processo e morria ali. É a peça que falta para um
   * menu por teclas (URA) existir sem mexer no resto do motor de voz.
   */
  onDtmf?(handler: (digit: string) => void): void;
  /** Solta a telefonia na hora, sem esperar fala pendente. */
  close(): Promise<void>;
}

export interface TransferOptions {
  /** Ninguém atendeu: a ligação volta para a conversa em vez de desligar. */
  returnIfUnanswered?: boolean;
  /** A conversa acabou enquanto a transferência tocava: se ninguém atender, desliga como antes. */
  signal?: AbortSignal;
}

/**
 * Como terminou uma transferência pedida com `returnIfUnanswered`. `status` é o `DIALSTATUS` do
 * Asterisk, ou `CALLER_HANGUP` quando quem ligou desistiu enquanto tocava.
 */
export type TransferOutcome = { returned: true; status: string } | { returned: false; status: string };

/** Os estados do `Dial` em que ninguém atendeu e a ligação pode voltar para a conversa. */
export const RETURNABLE_DIAL_STATUSES: ReadonlySet<string> = new Set(["NOANSWER", "BUSY", "CONGESTION", "CHANUNAVAIL"]);

/**
 * O transporte com teclado: quem precisa da tecla de quem liga (a URA, `ivr-session.ts`) exige
 * `onDtmf` no tipo, e o canal que não tem (a ligação pelo WhatsApp) não serve a ela sem o compilador
 * reclamar.
 */
export type KeypadTransport = CallTransport & Required<Pick<CallTransport, "onDtmf">>;

/**
 * Três bipes curtos. É o que quem está na linha ouve quando não há motor de voz para falar
 * (chave ausente, motor que caiu): o processo não tem como sintetizar fala sozinho, e sinal
 * sonoro seguido de transferência ou desligamento é melhor que silêncio.
 */
export function failureTone(): Buffer {
  const beepMs = 160;
  const gapMs = 110;
  const samples = ((beepMs + gapMs) * 3 * SAMPLE_RATE) / 1000;
  const pcm = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    const withinCycle = ((i * 1000) / SAMPLE_RATE) % (beepMs + gapMs);
    if (withinCycle < beepMs) pcm.writeInt16LE(Math.round(5000 * Math.sin((2 * Math.PI * 480 * i) / SAMPLE_RATE)), i * 2);
  }
  return pcm;
}

// Frequências do teclado (ITU-T Q.23): cada tecla soma a da linha com a da coluna.
const DTMF_ROWS = [697, 770, 852, 941];
const DTMF_COLUMNS = [1209, 1336, 1477, 1633];
const DTMF_KEYPAD = ["123A", "456B", "789C", "*0#D"];
// 100 ms de tom e 100 ms de pausa por tecla: acima do mínimo do Q.24 (40 ms) com folga para
// detector de operadora, e cinco quadros inteiros cada, para a cadência do AudioSocket.
const DTMF_TONE_MS = 100;
const DTMF_GAP_MS = 100;

/**
 * As teclas como áudio (DTMF em banda), no mesmo PCM da fala do agente. Com o canal no
 * `AudioSocket()` a ARI recusa `POST /channels/{id}/dtmf` (409, o canal não está na Stasis) e o
 * AudioSocket não aceita quadro de tecla vindo de nós; tom em banda é o caminho que sobra sem
 * mexer no dialplan. Vale porque o tronco só fala `ulaw`/`alaw` (`trunks.ts`), que levam o tom sem
 * deformar. Tecla fora do teclado lança: quem chama já validou a entrada.
 */
export function dtmfTones(digits: string): Buffer {
  const perKey = ((DTMF_TONE_MS + DTMF_GAP_MS) * SAMPLE_RATE) / 1000;
  const toneSamples = (DTMF_TONE_MS * SAMPLE_RATE) / 1000;
  const pcm = Buffer.alloc(perKey * digits.length * 2);
  [...digits].forEach((key, index) => {
    const row = DTMF_KEYPAD.findIndex((keys) => keys.includes(key));
    if (row === -1) throw new Error(`"${key}" is not a telephone key`);
    const low = DTMF_ROWS[row] as number;
    const high = DTMF_COLUMNS[(DTMF_KEYPAD[row] as string).indexOf(key)] as number;
    for (let i = 0; i < toneSamples; i++) {
      const t = i / SAMPLE_RATE;
      pcm.writeInt16LE(Math.round(8000 * Math.sin(2 * Math.PI * low * t) + 8000 * Math.sin(2 * Math.PI * high * t)), (index * perKey + i) * 2);
    }
  });
  return pcm;
}
