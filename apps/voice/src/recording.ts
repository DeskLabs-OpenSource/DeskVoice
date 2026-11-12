import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";


/**
 * Grava a chamada em WAV estéreo, PCM16 na taxa da chamada (8 kHz na telefonia): canal esquerdo é quem ligou, direito é o agente.
 * Cada lado é posto na posição do relógio da chamada, então silêncios e falas por cima ficam onde
 * aconteceram. A fala do agente chega mais rápido que o tempo real e sai na cadência do transporte;
 * aqui ela é enfileirada a partir do fim da fala anterior, que é quando ela toca do outro lado.
 */
export function createRecorder(now: () => number, sampleRate = 8000) {
  const BYTES_PER_MS = (sampleRate * 2) / 1000; // PCM16 mono
  const startedAt = now();
  const caller: Buffer[] = [];
  let callerBytes = 0;
  let agent = Buffer.alloc(0);
  let agentCursor = 0;

  const elapsedBytes = (): number => Math.floor(((now() - startedAt) * BYTES_PER_MS) / 2) * 2;

  return {
    caller(pcm: Buffer): void {
      // Áudio de quem ligou chega no tempo real; um buraco (rede, mudo) vira silêncio.
      const gap = elapsedBytes() - pcm.length - callerBytes;
      if (gap > 0) {
        caller.push(Buffer.alloc(gap));
        callerBytes += gap;
      }
      caller.push(pcm);
      callerBytes += pcm.length;
    },
    agent(pcm: Buffer): void {
      agentCursor = Math.max(agentCursor, elapsedBytes());
      const end = agentCursor + pcm.length;
      if (agent.length < end) agent = Buffer.concat([agent, Buffer.alloc(end - agent.length)]);
      pcm.copy(agent, agentCursor);
      agentCursor = end;
    },
    /** Quem ligou falou por cima: o que o agente ainda não tinha falado não foi ouvido, sai da gravação. */
    clear(): void {
      const at = elapsedBytes();
      if (agent.length > at) agent = agent.subarray(0, at);
      agentCursor = Math.min(agentCursor, at);
    },
    /** O WAV pronto, ou `null` se ninguém falou nada. */
    wav(): Buffer | null {
      const left = Buffer.concat(caller);
      const frames = Math.max(left.length, agent.length) / 2;
      if (frames === 0) return null;
      const data = Buffer.alloc(frames * 4);
      for (let i = 0; i < frames; i++) {
        data.writeInt16LE(i * 2 < left.length ? left.readInt16LE(i * 2) : 0, i * 4);
        data.writeInt16LE(i * 2 < agent.length ? agent.readInt16LE(i * 2) : 0, i * 4 + 2);
      }
      return Buffer.concat([wavHeader(data.length, sampleRate), data]);
    },
  };
}

export type Recorder = ReturnType<typeof createRecorder>;

/** Grava no disco sem deixar arquivo pela metade: escreve ao lado e troca de nome. */
export async function saveRecording(file: string, wav: Buffer): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const partial = `${file}.part`;
  await writeFile(partial, wav, { mode: 0o640 });
  await rename(partial, file);
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
