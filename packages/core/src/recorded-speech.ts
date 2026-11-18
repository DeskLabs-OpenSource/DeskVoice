/** A taxa em que a linha toca: PCM16 mono a 8 kHz, a mesma do `SAMPLE_RATE` do processo de voz. */
export const RECORDED_SPEECH_SAMPLE_RATE = 8000;

/**
 * Lê um WAV de fala gravada e devolve o PCM16 mono a 8 kHz de dentro dele, a forma em que a linha
 * toca. É o parser único: as falas do sistema (`readRecordedSpeech` no processo de voz) e o anúncio
 * do menu por teclas que o operador sobe pelo painel passam por aqui. Um arquivo em outro formato é
 * recusado com o motivo, e não tocado como ruído. `label` entra na mensagem de erro.
 */
export function parseRecordedSpeech(wav: Buffer, label: string): Buffer {
  if (wav.length < 12 || wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") throw new Error(`${label} is not a WAV file`);
  let format: { pcm: boolean; channels: number; rate: number; bits: number } | null = null;
  for (let at = 12; at + 8 <= wav.length; ) {
    const id = wav.toString("ascii", at, at + 4);
    const size = wav.readUInt32LE(at + 4);
    const body = at + 8;
    if (id === "fmt ") {
      if (body + 16 > wav.length) break;
      format = { pcm: wav.readUInt16LE(body) === 1, channels: wav.readUInt16LE(body + 2), rate: wav.readUInt32LE(body + 4), bits: wav.readUInt16LE(body + 14) };
    }
    if (id === "data") {
      if (!format || !format.pcm || format.channels !== 1 || format.rate !== RECORDED_SPEECH_SAMPLE_RATE || format.bits !== 16) {
        throw new Error(`${label} is not PCM16 mono at ${RECORDED_SPEECH_SAMPLE_RATE} Hz`);
      }
      return wav.subarray(body, Math.min(wav.length, body + size));
    }
    at = body + size + (size % 2);
  }
  throw new Error(`${label} has no audio`);
}

