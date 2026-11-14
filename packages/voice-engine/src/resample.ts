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

/** Meia largura do núcleo, em amostras de entrada: quatro ciclos da frequência de corte. */
function kernelHalf(cutoff: number): number {
  return Math.ceil(4 / cutoff);
}

/**
 * Núcleo do passa-baixa: sinc com janela de Hann, avaliado a `t` amostras de entrada do centro.
 * `cutoff` é fração da taxa de amostragem de entrada.
 */
function kernel(cutoff: number, half: number, t: number): number {
  const sinc = t === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * t) / (Math.PI * t);
  return sinc * (0.5 + 0.5 * Math.cos((Math.PI * t) / (half + 1)));
}

/** Borda: repete a primeira/última amostra em vez de supor silêncio, que geraria um clique. */
function at(input: Int16Array, index: number): number {
  return input[Math.max(0, Math.min(input.length - 1, index))] ?? 0;
}

/** Passa-baixa FIR (sinc com janela de Hann). `cutoff` é fração da taxa de amostragem de entrada. */
function lowPass(input: Int16Array, cutoff: number): Float64Array {
  const half = kernelHalf(cutoff);
  const taps = new Float64Array(half * 2 + 1);
  let sum = 0;
  for (let i = -half; i <= half; i++) {
    const tap = kernel(cutoff, half, i);
    taps[i + half] = tap;
    sum += tap;
  }
  const out = new Float64Array(input.length);
  for (let n = 0; n < input.length; n++) {
    let acc = 0;
    for (let k = -half; k <= half; k++) acc += at(input, n + k) * (taps[k + half] ?? 0);
    out[n] = acc / sum;
  }
  return out;
}

/**
 * Sobe de taxa com o mesmo passa-baixa da descida, avaliado entre as amostras (interpolação
 * limitada em banda). A interpolação linear deixava cópias espelhadas da voz entre a Nyquist de
 * origem e a de destino (de 8 para 16 kHz, a imagem de 3 kHz em 5 kHz ficava só 7 dB abaixo).
 * Os coeficientes de cada fase entre amostras são calculados uma vez por chamada.
 */
function upsample(input: Int16Array, fromHz: number, toHz: number, length: number): Float64Array {
  const cutoff = 0.45;
  const half = kernelHalf(cutoff);
  const phases = new Map<number, { taps: Float64Array; sum: number }>();
  const out = new Float64Array(length);
  for (let i = 0; i < length; i++) {
    // Posição i·from/to separada em amostra base e fase (resto/to), em inteiros para a fase repetir.
    const numerator = i * fromHz;
    const remainder = numerator % toHz;
    const base = Math.round((numerator - remainder) / toHz);
    const phase = remainder / toHz;
    let entry = phases.get(remainder);
    if (!entry) {
      // Taps para as amostras base-half .. base+half+1, à distância (phase - k) da posição.
      const taps = new Float64Array(half * 2 + 2);
      let sum = 0;
      for (let k = -half; k <= half + 1; k++) {
        const tap = kernel(cutoff, half, phase - k);
        taps[k + half] = tap;
        sum += tap;
      }
      entry = { taps, sum };
      phases.set(remainder, entry);
    }
    let acc = 0;
    for (let k = -half; k <= half + 1; k++) acc += at(input, base + k) * (entry.taps[k + half] ?? 0);
    out[i] = acc / entry.sum;
  }
  return out;
}

/**
 * Reamostra PCM16 LE mono, cada pedaço isolado. Os dois sentidos filtram com passa-baixa a 45% da
 * menor das taxas: ao descer, antes de decimar, para o que estava acima da nova Nyquist não virar
 * aliasing; ao subir, na própria interpolação, para não criar imagem espelhada acima da Nyquist
 * de origem.
 */
export function resample(pcm16: Buffer, fromHz: number, toHz: number): Buffer {
  if (!(fromHz > 0) || !(toHz > 0)) throw new RangeError(`taxa de amostragem inválida: ${fromHz} -> ${toHz}`);
  const input = toSamples(pcm16);
  if (fromHz === toHz || input.length === 0) return toBuffer(input);
  const length = Math.round((input.length * toHz) / fromHz);
  if (toHz > fromHz) return toBuffer(upsample(input, fromHz, toHz, length));
  const source = lowPass(input, (0.45 * toHz) / fromHz);
  const out = new Float64Array(length);
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
