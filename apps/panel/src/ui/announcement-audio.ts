import { ApiFailure } from "./api";

/** A taxa da linha: o anúncio sai do navegador já em PCM16 mono a 8 kHz, como o servidor exige. */
export const ANNOUNCEMENT_SAMPLE_RATE = 8000;

/**
 * O anúncio mais curto que se aceita. Um arquivo que o navegador "abre" com duração zero (ou quase)
 * viraria um WAV de uma amostra: silêncio salvo como anúncio. Abaixo disto, recusa.
 */
export const MIN_ANNOUNCEMENT_MS = 200;

/**
 * Amostras de -1 a 1 viram um WAV PCM16 mono, com o cabeçalho de 44 bytes que o
 * `parseRecordedSpeech` do servidor lê. Sem `Buffer`: roda no navegador.
 */
export function pcm16Wav(samples: Float32Array, sampleRate = ANNOUNCEMENT_SAMPLE_RATE): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const ascii = (at: number, text: string): void => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(at + i, text.charCodeAt(i));
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, i) => {
    const clipped = Math.max(-1, Math.min(1, sample));
    view.setInt16(44 + i * 2, clipped < 0 ? clipped * 0x8000 : clipped * 0x7fff, true);
  });
  return bytes;
}

/**
 * O arquivo que o operador já tem (WAV, MP3, M4A) vira o WAV da linha: o navegador decodifica
 * (`decodeAudioData`), mistura para mono e reamostra a 8 kHz (`OfflineAudioContext`). Devolve o WAV
 * e a duração. O que o navegador não abre, ou abre com menos de `MIN_ANNOUNCEMENT_MS`, é recusado
 * aqui, com `null`.
 */
export async function convertAnnouncement(file: Blob): Promise<{ wav: Blob; ms: number } | null> {
  const AudioContextClass = window.AudioContext;
  const decoder = new AudioContextClass();
  let decoded: AudioBuffer;
  try {
    decoded = await decoder.decodeAudioData(await file.arrayBuffer());
  } catch {
    return null;
  } finally {
    void decoder.close();
  }
  if (!(decoded.duration * 1000 >= MIN_ANNOUNCEMENT_MS)) return null;
  const frames = Math.max(1, Math.ceil(decoded.duration * ANNOUNCEMENT_SAMPLE_RATE));
  const offline = new OfflineAudioContext(1, frames, ANNOUNCEMENT_SAMPLE_RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();
  const wav = pcm16Wav(rendered.getChannelData(0));
  return { wav: new Blob([wav.buffer as ArrayBuffer], { type: "audio/wav" }), ms: Math.round((frames / ANNOUNCEMENT_SAMPLE_RATE) * 1000) };
}

/** Sobe o WAV convertido. A falha vira `ApiFailure`, como as outras chamadas da API do painel. */
export async function uploadAnnouncement(menuId: string, wav: Blob): Promise<{ id: string; promptAudioMs: number }> {
  let response: Response;
  let envelope: { ok: true; data: { id: string; promptAudioMs: number } } | { ok: false; error: { code: string; message: string } };
  try {
    response = await fetch(`/api/v1/ivr-menus/${menuId}/audio`, { method: "PUT", headers: { "content-type": "audio/wav" }, body: wav });
    envelope = (await response.json()) as typeof envelope;
  } catch (error) {
    throw new ApiFailure("network", error instanceof Error ? error.message : String(error), 0);
  }
  if (envelope.ok) return envelope.data;
  throw new ApiFailure(envelope.error.code, envelope.error.message, response.status);
}
