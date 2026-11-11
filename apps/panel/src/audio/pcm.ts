// Áudio da chamada pelo navegador: só contas, sem DOM, para poder testar.
// Entre o navegador e o processo de voz o áudio é sempre PCM de 16 bits, mono, 8000 Hz,
// em quadros de 20 ms.
export const VOICE_RATE = 8000;
export const FRAME_BYTES = 320;

/** Amostras de -1 a 1 para inteiros de 16 bits. O que passar da faixa é cortado, nunca dá a volta. */
export function floatToPcm16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let index = 0; index < input.length; index += 1) {
    // Mesma escala nos dois sentidos (32768), para a ida e volta ser exata; +1 cheio cabe em 32767.
    const scaled = Math.round((input[index] ?? 0) * 32768);
    out[index] = Number.isNaN(scaled) ? 0 : Math.max(-32768, Math.min(32767, scaled));
  }
  return out;
}

export function pcm16ToFloat(input: Int16Array): Float32Array<ArrayBuffer> {
  const out = new Float32Array(input.length);
  for (let index = 0; index < input.length; index += 1) out[index] = (input[index] ?? 0) / 32768;
  return out;
}

/** Volume do bloco, de 0 a 1 (raiz da média dos quadrados). */
export function rms(input: Float32Array): number {
  if (input.length === 0) return 0;
  let sum = 0;
  for (const sample of input) sum += sample * sample;
  return Math.sqrt(sum / input.length);
}

// Passa-baixa por sinc janelado (Hamming), com ganho 1 em frequência zero.
function lowPassTaps(cutoffRatio: number, length = 95): Float32Array {
  const taps = new Float32Array(length);
  const middle = (length - 1) / 2;
  let sum = 0;
  for (let n = 0; n < length; n += 1) {
    const x = n - middle;
    const sinc = x === 0 ? 2 * cutoffRatio : Math.sin(2 * Math.PI * cutoffRatio * x) / (Math.PI * x);
    const tap = sinc * (0.54 - 0.46 * Math.cos((2 * Math.PI * n) / (length - 1)));
    taps[n] = tap;
    sum += tap;
  }
  return taps.map((tap) => tap / sum);
}

/**
 * Troca a taxa de amostragem de um fluxo, bloco a bloco: o estado entre os blocos fica guardado,
 * então juntar as saídas dá o mesmo que converter tudo de uma vez (sem estalo na emenda).
 *
 * Para descer a taxa (microfone, em geral 48000 → 8000) o sinal passa antes por um passa-baixa:
 * sem ele, tudo acima de 4000 Hz dobra para dentro da faixa da voz como chiado.
 */
export function createResampler(fromRate: number, toRate: number): (input: Float32Array) => Float32Array<ArrayBuffer> {
  const taps = toRate < fromRate ? lowPassTaps((0.45 * toRate) / fromRate) : null;
  let history = new Float32Array(taps ? taps.length - 1 : 0);
  let last = 0;
  // Posição da próxima amostra de saída, em frações de 1/toRate de amostra de entrada (inteiro:
  // somar 1/6 em ponto flutuante desalinha uma amostra a cada tanto). 0 é `last`, a última do bloco anterior.
  let phase = 0;

  return (input) => {
    let signal = input;
    if (taps) {
      const joined = new Float32Array(history.length + input.length);
      joined.set(history);
      joined.set(input, history.length);
      signal = new Float32Array(input.length);
      for (let n = 0; n < input.length; n += 1) {
        let sum = 0;
        for (let k = 0; k < taps.length; k += 1) sum += (taps[k] ?? 0) * (joined[n + taps.length - 1 - k] ?? 0);
        signal[n] = sum;
      }
      history = joined.slice(joined.length - history.length);
    }

    const out: number[] = [];
    while (Math.floor(phase / toRate) < signal.length) {
      const index = Math.floor(phase / toRate);
      const fraction = (phase % toRate) / toRate;
      const before = index === 0 ? last : (signal[index - 1] ?? 0);
      out.push(before * (1 - fraction) + (signal[index] ?? 0) * fraction);
      phase += fromRate;
    }
    if (signal.length > 0) last = signal[signal.length - 1] ?? 0;
    phase -= signal.length * toRate;
    return Float32Array.from(out);
  };
}

/** Junta amostras até fechar quadros de exatamente `frameBytes` (little-endian); o resto espera o próximo bloco. */
export function createFramer(frameBytes = FRAME_BYTES): (samples: Int16Array) => ArrayBuffer[] {
  const frameSamples = frameBytes / 2;
  let pending: number[] = [];
  return (samples) => {
    pending.push(...samples);
    const frames: ArrayBuffer[] = [];
    while (pending.length >= frameSamples) {
      const frame = new DataView(new ArrayBuffer(frameBytes));
      for (let index = 0; index < frameSamples; index += 1) frame.setInt16(index * 2, pending[index] ?? 0, true);
      frames.push(frame.buffer);
      pending = pending.slice(frameSamples);
    }
    return frames;
  };
}

/** Lê PCM de 16 bits little-endian que chega em pedaços de qualquer tamanho; um byte solto espera o par. */
export function createPcmDecoder(): (chunk: ArrayBuffer) => Int16Array {
  let dangling: number | undefined;
  return (chunk) => {
    let bytes = new Uint8Array(chunk);
    if (dangling !== undefined) {
      const joined = new Uint8Array(bytes.length + 1);
      joined[0] = dangling;
      joined.set(bytes, 1);
      bytes = joined;
      dangling = undefined;
    }
    if (bytes.length % 2 === 1) dangling = bytes[bytes.length - 1];
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length - (bytes.length % 2));
    const out = new Int16Array(view.byteLength / 2);
    for (let index = 0; index < out.length; index += 1) out[index] = view.getInt16(index * 2, true);
    return out;
  };
}
