function toSamples(pcm16: Buffer): Int16Array {
  const samples = new Int16Array(pcm16.length >> 1);
  for (let i = 0; i < samples.length; i++) samples[i] = pcm16.readInt16LE(i * 2);
  return samples;
}

function toBuffer(samples: ArrayLike<number>): Buffer {
  const out = Buffer.allocUnsafe(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] ?? 0))), i * 2);
  }
  return out;
}

/** Passa-baixa FIR (sinc com janela de Hann). `cutoff` é fração da taxa de amostragem de entrada. */
function lowPass(input: Int16Array, cutoff: number): Float64Array {
  const half = Math.ceil(4 / cutoff);
  const taps = new Float64Array(half * 2 + 1);
  let sum = 0;
  for (let i = -half; i <= half; i++) {
    const sinc = i === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * i) / (Math.PI * i);
    const tap = sinc * (0.5 + 0.5 * Math.cos((Math.PI * i) / (half + 1)));
    taps[i + half] = tap;
    sum += tap;
  }
  const out = new Float64Array(input.length);
  for (let n = 0; n < input.length; n++) {
    let acc = 0;
    for (let k = -half; k <= half; k++) {
      // Borda: repete a primeira/última amostra em vez de supor silêncio, que geraria um clique.
      const index = Math.max(0, Math.min(input.length - 1, n + k));
      acc += (input[index] ?? 0) * (taps[k + half] ?? 0);
    }
    out[n] = acc / sum;
  }
  return out;
}

/**
 * Reamostra PCM16 LE mono. Subir: interpolação linear. Descer: passa-baixa abaixo da nova
 * frequência de Nyquist antes de decimar, para o que estava acima dela não virar aliasing.
 */
export function resample(pcm16: Buffer, fromHz: number, toHz: number): Buffer {
  if (!(fromHz > 0) || !(toHz > 0)) throw new RangeError(`taxa de amostragem inválida: ${fromHz} -> ${toHz}`);
  const input = toSamples(pcm16);
  if (fromHz === toHz || input.length === 0) return toBuffer(input);
  const source = toHz < fromHz ? lowPass(input, (0.45 * toHz) / fromHz) : input;
  const out = new Float64Array(Math.round((input.length * toHz) / fromHz));
  const step = fromHz / toHz;
  for (let i = 0; i < out.length; i++) {
    const position = i * step;
    const left = Math.min(Math.floor(position), source.length - 1);
    const right = Math.min(left + 1, source.length - 1);
    const a = source[left] ?? 0;
    out[i] = a + ((source[right] ?? 0) - a) * (position - left);
  }
  return toBuffer(out);
}

const ULAW_BIAS = 0x84;
const ULAW_CLIP = 32635;

function encodeUlawSample(sample: number): number {
  const sign = sample < 0 ? 0x80 : 0;
  const magnitude = Math.min(Math.abs(sample), ULAW_CLIP) + ULAW_BIAS;
  let exponent = 7;
  while (exponent > 0 && (magnitude & (0x80 << exponent)) === 0) exponent--;
  const mantissa = (magnitude >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

const ULAW_DECODE = Int16Array.from({ length: 256 }, (_, byte) => {
  const value = ~byte & 0xff;
  const magnitude = ((((value & 0x0f) << 3) + ULAW_BIAS) << ((value >> 4) & 0x07)) - ULAW_BIAS;
  return value & 0x80 ? -magnitude : magnitude;
});

/** PCM16 LE → G.711 μ-law (um byte por amostra). */
export function pcm16ToUlaw(pcm16: Buffer): Buffer {
  const out = Buffer.allocUnsafe(pcm16.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = encodeUlawSample(pcm16.readInt16LE(i * 2));
  return out;
}

/** G.711 μ-law → PCM16 LE. */
export function ulawToPcm16(ulaw: Buffer): Buffer {
  const out = Buffer.allocUnsafe(ulaw.length * 2);
  for (let i = 0; i < ulaw.length; i++) out.writeInt16LE(ULAW_DECODE[ulaw[i] ?? 0] ?? 0, i * 2);
  return out;
}
