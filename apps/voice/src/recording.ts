import { mkdir, open, readdir, rename, rm, statfs } from "node:fs/promises";
import path from "node:path";

/**
 * Abaixo deste espaço livre na pasta das gravações, a chamada não é gravada. As gravações dividem
 * o disco com o Postgres: disco cheio para o banco, e isso é pior que uma chamada sem áudio. 1 GiB
 * é cerca de 9 horas de gravação (1,9 MB por minuto), folga para o banco e para as chamadas em curso.
 */
export const MIN_FREE_BYTES_TO_RECORD = 1024 ** 3;

// O que ficou mais que isto para trás do relógio da chamada não muda mais e vai para o disco.
// Folga para o áudio de quem ligou que chega atrasado pela rede.
const SETTLED_MS = 1000;
// A escrita sai em blocos de pelo menos 1 s, não a cada pedaço de 20 ms.
const FLUSH_MS = 1000;

/**
 * Um lado da chamada (mono PCM16), em posições absolutas da chamada, guardado só enquanto ainda
 * pode mudar. Acrescentar, cortar o fim e tirar do começo custam o tamanho do pedaço, nunca o da
 * gravação: nada aqui copia o que já foi guardado.
 */
function track() {
  const chunks: Buffer[] = [];
  let start = 0; // posição do primeiro byte ainda guardado
  let end = 0; // posição do fim do que foi escrito
  return {
    get end(): number {
      return end;
    },
    /** Põe `pcm` em `at` (nunca antes do fim); o buraco até lá é silêncio. */
    append(at: number, pcm: Buffer): void {
      if (at > end) chunks.push(Buffer.alloc(at - end));
      chunks.push(pcm);
      end = Math.max(at, end) + pcm.length;
    },
    /** Apaga o que está depois de `at`. */
    truncate(at: number): void {
      let cut = end - Math.max(at, start);
      while (cut > 0) {
        const last = chunks.length - 1;
        const chunk = chunks[last] as Buffer;
        if (chunk.length <= cut) {
          chunks.pop();
          cut -= chunk.length;
          end -= chunk.length;
        } else {
          chunks[last] = chunk.subarray(0, chunk.length - cut);
          end -= cut;
          cut = 0;
        }
      }
    },
    /** Tira `bytes` do começo para o canal `side` de `stereo`; o que falta é silêncio. */
    shift(stereo: Buffer, side: 0 | 2, bytes: number): void {
      let written = 0;
      while (written < bytes && chunks.length > 0) {
        const chunk = chunks[0] as Buffer;
        const take = Math.min(chunk.length, bytes - written);
        for (let i = 0; i < take; i += 2) stereo.writeInt16LE(chunk.readInt16LE(i), (written + i) * 2 + side);
        written += take;
        if (take === chunk.length) chunks.shift();
        else chunks[0] = chunk.subarray(take);
      }
      start += bytes;
      end = Math.max(end, start);
    },
  };
}

/**
 * Grava a chamada em WAV estéreo, PCM16 na taxa da chamada (8 kHz na telefonia): canal esquerdo é quem ligou, direito é o agente.
 * Cada lado é posto na posição do relógio da chamada, então silêncios e falas por cima ficam onde
 * aconteceram. A fala do agente chega mais rápido que o tempo real e sai na cadência do transporte;
 * aqui ela é enfileirada a partir do fim da fala anterior, que é quando ela toca do outro lado.
 *
 * O que já não muda (mais de 1 s atrás do relógio) sai intercalado para `sink`, em blocos; em
 * memória fica só esse trecho e a fala do agente que ainda vai tocar. Sem `sink`, os blocos ficam
 * em memória e `wav()` monta o arquivo, para os testes.
 */
export function createRecorder(now: () => number, sink?: (stereo: Buffer) => void, sampleRate = 8000) {
  const BYTES_PER_MS = (sampleRate * 2) / 1000; // PCM16 mono
  const startedAt = now();
  const caller = track();
  const agent = track();
  const kept: Buffer[] = [];
  const write = sink ?? ((stereo: Buffer) => void kept.push(stereo));
  let flushed = 0;
  // Depois da pausa o áudio não entra mais, mas o que já estava guardado sai: o pedido de quem
  // ligou tem de estar no arquivo.
  let paused = false;

  const bytesAt = (ms: number): number => Math.max(0, Math.floor((ms * BYTES_PER_MS) / 2) * 2);
  const elapsedBytes = (): number => bytesAt(now() - startedAt);

  function flush(upTo: number): void {
    const bytes = upTo - flushed;
    if (bytes <= 0) return;
    const stereo = Buffer.alloc(bytes * 2);
    caller.shift(stereo, 0, bytes);
    agent.shift(stereo, 2, bytes);
    flushed = upTo;
    write(stereo);
  }

  /** Escreve o resto e devolve quantos bytes de áudio a gravação tem. */
  function end(): number {
    flush(Math.max(caller.end, agent.end));
    return flushed * 2;
  }

  function settle(): void {
    const settled = elapsedBytes() - bytesAt(SETTLED_MS);
    if (settled - flushed >= bytesAt(FLUSH_MS)) flush(settled);
  }

  return {
    caller(pcm: Buffer): void {
      if (paused) return;
      // Áudio de quem ligou chega no tempo real; um buraco (rede, mudo) vira silêncio.
      caller.append(Math.max(caller.end, elapsedBytes() - pcm.length), pcm);
      settle();
    },
    agent(pcm: Buffer): void {
      if (paused) return;
      agent.append(Math.max(agent.end, elapsedBytes()), pcm);
      settle();
    },
    /** Quem ligou falou por cima: o que o agente ainda não tinha falado não foi ouvido, sai da gravação. */
    clear(): void {
      agent.truncate(elapsedBytes());
    },
    end,
    /**
     * Para de aceitar áudio e devolve quantos bytes de áudio a gravação tem até aqui — o trecho
     * inteiro, inclusive o pedido que acabou de ser feito. Chamar de novo não muda nada.
     */
    pause(): number {
      if (paused) return flushed * 2;
      paused = true;
      return end();
    },
    /** O WAV pronto, ou `null` se ninguém falou nada. Só sem `sink`. */
    wav(): Buffer | null {
      const bytes = end();
      return bytes === 0 ? null : Buffer.concat([wavHeader(bytes, sampleRate), ...kept]);
    },
  };
}

export type Recorder = ReturnType<typeof createRecorder>;

export interface Recording {
  caller(pcm: Buffer): void;
  agent(pcm: Buffer): void;
  clear(): void;
  /**
   * Para de gravar, deixando no arquivo tudo o que foi dito até aqui. Espera os blocos chegarem ao
   * disco antes de resolver: quem chamou pode contar que o pedido está salvo.
   */
  pause(): Promise<void>;
  /** Fecha o arquivo. Com áudio, acerta o cabeçalho e troca `.part` por `.wav`; sem, ou com falha, apaga o `.part`. */
  finish(): Promise<boolean>;
}

/** O espaço livre na pasta das gravações, criando-a se ainda não existe. */
export async function freeBytes(dir: string): Promise<number> {
  await mkdir(dir, { recursive: true });
  const info = await statfs(dir);
  return info.bavail * info.bsize;
}

/**
 * Teto da fila de escritas: 10 s de áudio (a 8 kHz estéreo PCM16, 32 kB por segundo, 320 kB).
 * Os blocos saem a cada ~1 s com ~32 kB, e um disco são escreve isso em menos de 1 ms: dez blocos
 * esperando querem dizer que o disco passou 10 s sem dar conta de 32 kB/s, e não vai alcançar a
 * chamada. 10 s, e não 2 ou 3, para que um engasgo de E/S da VPS de alguns segundos não perca a
 * gravação. Em memória, 320 kB por chamada, cinco vezes os 64 kB que o gravador segura (#102):
 * 50 chamadas presas no mesmo disco somam 16 MB, e não a chamada inteira de cada uma.
 */
export const MAX_QUEUED_AUDIO_SECONDS = 10;

/** Por que a gravação parou no meio: o disco encheu, a escrita deu erro, ou o disco não deu conta. */
export type RecordingFailureReason = "disk_full" | "write_failed" | "disk_too_slow";

/**
 * Começa a gravar em `<file>.part`, com o cabeçalho WAV provisório (tamanhos zerados), e escreve
 * em blocos durante a chamada, na ordem. Só no fim o arquivo vira `.wav`: quem lê nunca vê um
 * arquivo pela metade.
 *
 * Se a escrita falha, ou a fila passa do teto, a gravação para ali, `onFailure` é chamado uma vez,
 * na hora, e o resto da chamada não é mais gravado; `finish` apaga o `.part` e lança a falha.
 */
export async function startRecording(
  file: string,
  now: () => number,
  options: { sampleRate?: number; onFailure?: (reason: RecordingFailureReason, error: Error) => void } = {},
): Promise<Recording> {
  const { sampleRate = 8000, onFailure } = options;
  const maxQueuedBytes = MAX_QUEUED_AUDIO_SECONDS * sampleRate * 4;
  await mkdir(path.dirname(file), { recursive: true });
  const partial = `${file}.part`;
  const handle = await open(partial, "w", 0o640);
  let failure: Error | undefined;
  const fail = (reason: RecordingFailureReason, error: Error): void => {
    if (failure !== undefined) return;
    failure = error;
    onFailure?.(reason, error);
  };
  let writing: Promise<void> = Promise.resolve();
  let queuedBytes = 0;
  let closing = false;
  const append = (data: Buffer, at: number): void => {
    if (failure !== undefined) return;
    // Medido antes de cada bloco, durante a chamada: a fila passa do teto por no máximo um bloco.
    // No fim não: depois do resto da fala do agente e do cabeçalho, nada mais entra na fila, e o
    // resto já estava em memória.
    if (!closing && queuedBytes >= maxQueuedBytes) {
      return fail("disk_too_slow", new Error(`the disk did not keep up: more than ${MAX_QUEUED_AUDIO_SECONDS} s of audio waiting to be written`));
    }
    queuedBytes += data.length;
    writing = writing
      .then(async () => {
        if (failure === undefined) await handle.write(data, 0, data.length, at);
      })
      .catch((error: unknown) => {
        const full = error instanceof Error && "code" in error && error.code === "ENOSPC";
        fail(full ? "disk_full" : "write_failed", error instanceof Error ? error : new Error(String(error)));
      })
      .finally(() => {
        queuedBytes -= data.length;
      });
  };
  append(wavHeader(0, sampleRate), 0);
  let position = 44;
  const recorder = createRecorder(
    now,
    (stereo) => {
      append(stereo, position);
      position += stereo.length;
    },
    sampleRate,
  );

  let paused = false;
  return {
    // Depois da falha, nada mais é gravado: nem o trecho que ainda podia mudar fica em memória.
    caller: (pcm) => {
      if (failure === undefined) recorder.caller(pcm);
    },
    agent: (pcm) => {
      if (failure === undefined) recorder.agent(pcm);
    },
    clear: () => recorder.clear(),
    async pause() {
      if (paused) return;
      paused = true;
      const bytes = recorder.pause();
      if (bytes > 0) append(wavHeader(bytes, sampleRate), 0);
      // O pedido de quem ligou pode estar no último bloco, ainda na fila: só resolve depois que ele
      // entrou no arquivo.
      await writing;
    },
    async finish() {
      closing = true;
      const bytes = recorder.end();
      if (bytes > 0) append(wavHeader(bytes, sampleRate), 0);
      await writing;
      await handle.close();
      if (failure !== undefined || bytes === 0) {
        await rm(partial, { force: true });
        if (failure !== undefined) throw failure;
        return false;
      }
      await rename(partial, file);
      return true;
    },
  };
}

/**
 * Apaga os `.part` que um processo anterior deixou ao cair no meio de uma chamada. Roda ao subir o
 * processo de voz, antes de atender: nenhuma gravação está aberta nesse momento.
 */
export async function removePartialRecordings(dir: string): Promise<number> {
  const folders = await readdir(dir, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  let removed = 0;
  for (const folder of folders) {
    if (!folder.isDirectory()) continue;
    for (const name of await readdir(path.join(dir, folder.name))) {
      if (!name.endsWith(".wav.part")) continue;
      await rm(path.join(dir, folder.name, name), { force: true });
      removed += 1;
    }
  }
  return removed;
}

function wavHeader(dataBytes: number, sampleRate: number): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // tamanho do bloco fmt
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(2, 22); // estéreo
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 4, 28); // bytes por segundo
  header.writeUInt16LE(4, 32); // bytes por quadro
  header.writeUInt16LE(16, 34); // bits por amostra
  header.write("data", 36);
  header.writeUInt32LE(dataBytes, 40);
  return header;
}
