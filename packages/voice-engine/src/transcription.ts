/**
 * Transcrição de áudio já gravado: a segunda passada que o motor em tempo real não fez.
 *
 * O gravador (`apps/voice/src/recording.ts`) escreve WAV PCM16 estéreo: canal esquerdo é quem
 * ligou, direito é o agente. Cada lado vai ao provedor separado, e o texto de cada um entra na linha
 * do tempo com o seu dono. Quem transcreve é o motor do agente (`VoiceEngine.transcription`).
 *
 * Nada aqui lê rede nem disco, e nada registra áudio ou texto: é dado de titular de terceiro.
 */

/** Os dois lados da gravação, cada um como WAV mono. Lado só de silêncio digital vem `null`. */
export interface RecordingSides {
  caller: Uint8Array | null;
  agent: Uint8Array | null;
  /** Duração da gravação. */
  seconds: number;
  /** Tamanho de cada lado em WAV mono (os dois têm o mesmo). */
  sideBytes: number;
}

const HEADER_BYTES = 44;

function monoWavHeader(dataBytes: number, sampleRate: number): Buffer {
  const header = Buffer.alloc(HEADER_BYTES);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataBytes, 40);
  return header;
}

/**
 * Separa a gravação nos dois lados. `null` quando o arquivo não é o WAV PCM16 estéreo que o
 * gravador escreve: sem os dois canais não dá para dizer quem falou, e o texto nunca é atribuído
 * a um lado por palpite.
 */
export function splitRecording(wav: Uint8Array): RecordingSides | null {
  const file = Buffer.from(wav.buffer, wav.byteOffset, wav.byteLength);
  if (file.length < HEADER_BYTES || file.toString("ascii", 0, 4) !== "RIFF" || file.toString("ascii", 8, 12) !== "WAVE") return null;
  let format: { channels: number; sampleRate: number; bits: number; pcm: boolean } | null = null;
  let data: Buffer | null = null;
  // Percorre os blocos: o gravador escreve só `fmt ` e `data`, mas um WAV válido pode ter outros.
  for (let at = 12; at + 8 <= file.length; ) {
    const id = file.toString("ascii", at, at + 4);
    const size = file.readUInt32LE(at + 4);
    const body = at + 8;
    if (id === "fmt " && size >= 16) {
      format = { pcm: file.readUInt16LE(body) === 1, channels: file.readUInt16LE(body + 2), sampleRate: file.readUInt32LE(body + 4), bits: file.readUInt16LE(body + 14) };
    } else if (id === "data") {
      data = file.subarray(body, Math.min(file.length, body + size));
      break;
    }
    at = body + size + (size % 2);
  }
  if (!format || !data || !format.pcm || format.channels !== 2 || format.bits !== 16 || format.sampleRate <= 0) return null;

  const { sampleRate } = format;
  const frames = Math.floor(data.length / 4);
  const caller = Buffer.alloc(frames * 2);
  const agent = Buffer.alloc(frames * 2);
  let callerSound = false;
  let agentSound = false;
  for (let frame = 0; frame < frames; frame += 1) {
    const left = data.readInt16LE(frame * 4);
    const right = data.readInt16LE(frame * 4 + 2);
    caller.writeInt16LE(left, frame * 2);
    agent.writeInt16LE(right, frame * 2);
    if (left !== 0) callerSound = true;
    if (right !== 0) agentSound = true;
  }
  // ponytail: só o silêncio digital (o buraco que o gravador preenche com zero) poupa o pedido;
  // ruído de linha sem fala ainda vai ao provedor, que responde texto vazio.
  const side = (pcm: Buffer, sound: boolean): Uint8Array | null => (sound ? new Uint8Array(Buffer.concat([monoWavHeader(pcm.length, sampleRate), pcm])) : null);
  return { caller: side(caller, callerSound), agent: side(agent, agentSound), seconds: frames / sampleRate, sideBytes: HEADER_BYTES + frames * 2 };
}
