/**
 * O ruído do "Áudio de teste" do desenho da DESA-24 (docs/specs/2026-11-14-ambiente-barulhento.md):
 * obra e música geradas aqui, a 16 kHz, e conversa de fundo com três ou mais vozes sintéticas
 * (montada em `voz.ts`, que tem o TTS). Tudo com semente fixa: o mesmo comando gera o mesmo ruído.
 * A relação voz/ruído é aplicada em `audio.ts` (`misturar`), sobre o RMS.
 */

export const TIPOS_DE_RUIDO = ["obra", "musica", "conversa"] as const;
export type TipoDeRuido = (typeof TIPOS_DE_RUIDO)[number];
export const NIVEIS_DB = [15, 5, 0] as const;

/** Gerador pseudoaleatório com semente (mulberry32). */
export function sorteio(semente: number): () => number {
  let a = semente >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Obra: rajadas de impacto (estalo de ruído com baque grave) e uma furadeira que liga e desliga. */
export function obra(amostrasTotais: number, taxaHz: number, semente = 1): Float64Array {
  const rand = sorteio(semente);
  const out = new Float64Array(amostrasTotais);
  // Impactos a cada 0,4 a 1,2 s.
  for (let t = Math.floor(rand() * taxaHz * 0.5); t < amostrasTotais; t += Math.floor(taxaHz * (0.4 + rand() * 0.8))) {
    const amplitude = 6000 + rand() * 6000;
    const duracao = Math.floor(taxaHz * 0.15);
    for (let i = 0; i < duracao && t + i < amostrasTotais; i++) {
      const decai = Math.exp(-i / (taxaHz * 0.03));
      const baque = Math.sin((2 * Math.PI * 60 * i) / taxaHz);
      out[t + i] = (out[t + i] ?? 0) + amplitude * decai * ((rand() * 2 - 1) * 0.7 + baque * 0.5);
    }
  }
  // Furadeira: dente de serra em torno de 150 Hz, com vibrato, em trechos de 1 a 2,5 s.
  let t = 0;
  let fase = 0;
  while (t < amostrasTotais) {
    const ligada = Math.floor(taxaHz * (1 + rand() * 1.5));
    for (let i = 0; i < ligada && t + i < amostrasTotais; i++) {
      const segundos = (t + i) / taxaHz;
      fase += (150 + 20 * Math.sin(2 * Math.PI * 6 * segundos)) / taxaHz;
      const serra = 2 * (fase - Math.floor(fase + 0.5));
      const envelope = Math.min(1, i / (taxaHz * 0.05), (ligada - i) / (taxaHz * 0.05));
      out[t + i] = (out[t + i] ?? 0) + 3000 * serra * envelope;
    }
    t += ligada + Math.floor(taxaHz * (0.5 + rand()));
  }
  return out;
}

/** Música: acordes sintetizados (dó, lá menor, fá, sol) a 100 batidas por minuto, com baixo e chimbal. */
export function musica(amostrasTotais: number, taxaHz: number, semente = 2): Float64Array {
  const rand = sorteio(semente);
  const out = new Float64Array(amostrasTotais);
  const acordes = [
    [261.63, 329.63, 392.0],
    [220.0, 261.63, 329.63],
    [174.61, 220.0, 261.63],
    [196.0, 246.94, 293.66],
  ];
  const batida = Math.floor((taxaHz * 60) / 100);
  for (let i = 0; i < amostrasTotais; i++) {
    const nBatida = Math.floor(i / batida);
    const acorde = acordes[Math.floor(nBatida / 4) % acordes.length] ?? acordes[0] ?? [];
    const dentro = (i % batida) / taxaHz;
    const envelope = Math.exp(-dentro * 3);
    const s = i / taxaHz;
    let v = 0;
    for (const f of acorde) v += Math.sin(2 * Math.PI * f * s) + 0.5 * Math.sin(4 * Math.PI * f * s) + 0.25 * Math.sin(6 * Math.PI * f * s);
    const raiz = acorde[0] ?? 0;
    v += 1.5 * Math.sin(Math.PI * raiz * s); // baixo, uma oitava abaixo
    out[i] = 1500 * v * envelope;
  }
  // Chimbal no contratempo: estalo curto de ruído.
  for (let b = 0; b * batida < amostrasTotais; b++) {
    const t = b * batida + Math.floor(batida / 2);
    for (let i = 0; i < taxaHz * 0.04 && t + i < amostrasTotais; i++) out[t + i] = (out[t + i] ?? 0) + 2500 * (rand() * 2 - 1) * Math.exp(-i / (taxaHz * 0.008));
  }
  return out;
}
