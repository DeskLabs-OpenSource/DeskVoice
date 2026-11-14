/**
 * Utilidades de áudio da bancada: WAV, onde a fala começa e acaba, RMS e mistura com ruído.
 * Todo áudio aqui é PCM16 mono em `Buffer` (little-endian), como no resto do DeskVoice.
 */

/** Lê um WAV PCM16 mono. Devolve as amostras e a taxa. */
export function lerWav(arquivo: Buffer): { pcm16: Buffer; taxaHz: number } {
  if (arquivo.toString("ascii", 0, 4) !== "RIFF" || arquivo.toString("ascii", 8, 12) !== "WAVE") throw new Error("não é WAV");
  let taxaHz = 0;
  let offset = 12;
  while (offset + 8 <= arquivo.length) {
    const id = arquivo.toString("ascii", offset, offset + 4);
    const tamanho = arquivo.readUInt32LE(offset + 4);
    if (id === "fmt ") {
      const formato = arquivo.readUInt16LE(offset + 8);
      const canais = arquivo.readUInt16LE(offset + 10);
      const bits = arquivo.readUInt16LE(offset + 22);
      if (formato !== 1 || canais !== 1 || bits !== 16) throw new Error(`WAV precisa ser PCM16 mono (veio formato ${formato}, ${canais} canais, ${bits} bits)`);
      taxaHz = arquivo.readUInt32LE(offset + 12);
    }
    if (id === "data") return { pcm16: Buffer.from(arquivo.subarray(offset + 8, Math.min(arquivo.length, offset + 8 + tamanho))), taxaHz };
    offset += 8 + tamanho + (tamanho % 2);
  }
  throw new Error("WAV sem bloco de dados");
}

export function amostras(pcm16: Buffer): Float64Array {
  const out = new Float64Array(pcm16.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = pcm16.readInt16LE(i * 2);
  return out;
}

export function paraPcm16(valores: ArrayLike<number>): Buffer {
  const out = Buffer.alloc(valores.length * 2);
  for (let i = 0; i < valores.length; i++) out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(valores[i] ?? 0))), i * 2);
  return out;
}

export function rms(valores: ArrayLike<number>, inicio = 0, fim = valores.length): number {
  let soma = 0;
  for (let i = inicio; i < fim; i++) soma += (valores[i] ?? 0) ** 2;
  return fim > inicio ? Math.sqrt(soma / (fim - inicio)) : 0;
}

/**
 * Onde a fala está, em amostras: do primeiro ao último quadro de 10 ms com RMS acima de 40 dB
 * abaixo do pico. Serve à voz sintética limpa, antes de misturar ruído (com ruído, não adianta).
 */
export function regiaoDaFala(valores: ArrayLike<number>, taxaHz: number): { inicio: number; fim: number } {
  const quadro = Math.round(taxaHz / 100);
  let pico = 0;
  for (let i = 0; i < valores.length; i++) pico = Math.max(pico, Math.abs(valores[i] ?? 0));
  const limiar = pico * 10 ** (-40 / 20);
  let inicio = -1;
  let fim = -1;
  for (let q = 0; q * quadro < valores.length; q++) {
    const a = q * quadro;
    const b = Math.min(valores.length, a + quadro);
    if (rms(valores, a, b) > limiar) {
      if (inicio < 0) inicio = a;
      fim = b;
    }
  }
  return inicio < 0 ? { inicio: 0, fim: 0 } : { inicio, fim };
}

/**
 * Mistura voz e ruído com a relação pedida (dB), calculada sobre o RMS de cada um **no trecho da
 * fala**. Se a soma estourar, as duas descem juntas (a relação não muda). Devolve a relação medida
 * depois do arredondamento, para ser escrita junto do resultado.
 */
export function misturar(voz: Float64Array, ruido: Float64Array, snrDb: number, fala: { inicio: number; fim: number }): { mistura: Float64Array; snrMedidoDb: number } {
  if (ruido.length < voz.length) throw new Error("o ruído precisa cobrir a voz inteira");
  const rmsVoz = rms(voz, fala.inicio, fala.fim);
  const rmsRuido = rms(ruido, fala.inicio, fala.fim);
  if (rmsVoz === 0 || rmsRuido === 0) throw new Error("voz ou ruído sem energia no trecho da fala");
  const ganho = rmsVoz / (rmsRuido * 10 ** (snrDb / 20));
  const mistura = new Float64Array(voz.length);
  let pico = 0;
  for (let i = 0; i < voz.length; i++) {
    mistura[i] = (voz[i] ?? 0) + ganho * (ruido[i] ?? 0);
    pico = Math.max(pico, Math.abs(mistura[i] ?? 0));
  }
  const escala = pico > 30000 ? 30000 / pico : 1;
  const vozFinal = new Float64Array(voz.length);
  const ruidoFinal = new Float64Array(voz.length);
  for (let i = 0; i < voz.length; i++) {
    mistura[i] = (mistura[i] ?? 0) * escala;
    vozFinal[i] = (voz[i] ?? 0) * escala;
    ruidoFinal[i] = ganho * (ruido[i] ?? 0) * escala;
  }
  const snrMedidoDb = 20 * Math.log10(rms(vozFinal, fala.inicio, fala.fim) / rms(ruidoFinal, fala.inicio, fala.fim));
  return { mistura, snrMedidoDb };
}
