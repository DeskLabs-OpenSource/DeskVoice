/**
 * O áudio da medida contra o provedor (`barulho-no-provedor.ts`), do "Áudio de teste" do desenho da
 * DESA-24: voz sintética do Piper (`voz.ts`), obra e música geradas e conversa de fundo (`ruido.ts`,
 * `voz.ts`), misturadas pelo RMS do trecho da fala (`audio.ts`) e passadas pela linha de 8 kHz da
 * ponte (`linhas.ts`; o μ-law do OpenAI fica com o motor). Semente fixa: o mesmo comando gera o
 * mesmo áudio. Precisa de `BANCADA_PIPER` e `BANCADA_VOZES` (README).
 */
import { misturar, paraPcm16, regiaoDaFala } from "./audio";
import { ANTES_S, CAUDA_S, FRASE_LONGA_S, JANELA_S, type AudioDaFrase, type AudioPorBaixo, type OpcoesDoPlano, type Plano } from "./barulho-no-provedor";
import { carregarConjunto } from "./conjunto";
import { TAXA_DA_PONTE, passarPelaLinha } from "./linhas";
import { TIPOS_DE_RUIDO, musica, obra, sorteio, type TipoDeRuido } from "./ruido";
import { TAXA_LARGA, VOZ_PADRAO, conversaDeFundo, pastaTemporaria, sintetizar, vozPorId } from "./voz";

/** A frase longa vai sobre cada ruído neste nível (o do meio). */
const NIVEL_DA_FRASE_LONGA_DB = 5;
/** Pausa entre as frases do conjunto que, juntas, fazem a frase longa: é a pausa que engana o provedor. */
const PAUSA_DA_FRASE_LONGA_S = 0.4;
/** Os "uhum" da janela, em segundos desde o começo dela. */
const UHUNS_S = [1, 4.5, 8];

const para8k = (x16k: Float64Array): Buffer => passarPelaLinha(paraPcm16(x16k), "estreita", { taxaHz: TAXA_DA_PONTE, mulaw: false });
const msDe16k = (amostras: number): number => (amostras * 1000) / TAXA_LARGA;

function comFolga(fala: Float64Array, antesS: number, depoisS: number): Float64Array {
  const out = new Float64Array(Math.round(antesS * TAXA_LARGA) + fala.length + Math.round(depoisS * TAXA_LARGA));
  out.set(fala, Math.round(antesS * TAXA_LARGA));
  return out;
}

export async function montarPlano(opcoes: OpcoesDoPlano): Promise<Plano> {
  const pasta = await pastaTemporaria();
  const voz = vozPorId(VOZ_PADRAO);
  const conjunto = carregarConjunto().frases;
  let conversa: Float64Array | null = null;
  const ruidoDe = async (tipo: TipoDeRuido, amostrasTotais: number, semente: number): Promise<Float64Array> => {
    if (tipo === "obra") return obra(amostrasTotais, TAXA_LARGA, 100 + semente);
    if (tipo === "musica") return musica(amostrasTotais, TAXA_LARGA, 200 + semente);
    conversa ??= await conversaDeFundo(TAXA_LARGA * 30, pasta);
    const c = conversa;
    const inicio = Math.floor(sorteio(300 + semente)() * c.length);
    return Float64Array.from({ length: amostrasTotais }, (_, i) => c[(inicio + i) % c.length] ?? 0);
  };
  const mistura = async (id: string, limpa: Float64Array, tipo: TipoDeRuido, snrDb: number, semente: number): Promise<AudioDaFrase> => {
    const fala = regiaoDaFala(limpa, TAXA_LARGA);
    const r = misturar(limpa, await ruidoDe(tipo, limpa.length, semente), snrDb, fala);
    return { id, pcm8k: para8k(r.mistura), falaInicioMs: msDe16k(fala.inicio), falaFimMs: msDe16k(fala.fim), ruido: { tipo, snrDb, snrMedidoDb: r.snrMedidoDb } };
  };

  const frases: AudioDaFrase[] = [];
  let referencia: Float64Array | null = null;
  if (opcoes.partes.includes("resposta") || opcoes.partes.includes("interrupcao")) {
    for (const [n, f] of conjunto.slice(0, opcoes.nFrases).entries()) {
      const limpa = comFolga(await sintetizar(f.texto, voz, pasta), ANTES_S, CAUDA_S);
      referencia ??= limpa;
      if (!opcoes.partes.includes("resposta")) continue;
      for (const tipo of TIPOS_DE_RUIDO) for (const snrDb of opcoes.niveis) frases.push(await mistura(f.id, limpa, tipo, snrDb, n));
    }
  }

  const porBaixo: AudioPorBaixo[] = [];
  if (opcoes.partes.includes("interrupcao") && referencia) {
    // O ruído vai no nível em que estaria debaixo da voz de quem ligou (a mesma régua das frases).
    const ref = referencia;
    const falaRef = regiaoDaFala(ref, TAXA_LARGA);
    const amostrasDaJanela = JANELA_S * TAXA_LARGA;
    if (ref.length < amostrasDaJanela) throw new Error("a frase de referência não cobre a janela da interrupção");
    for (const tipo of TIPOS_DE_RUIDO)
      for (const snrDb of opcoes.niveis) {
        // A referência tem a cauda de ruído (`CAUDA_S`), então cobre a janela inteira.
        const { ruidoNoNivel } = misturar(ref, await ruidoDe(tipo, ref.length, 50), snrDb, falaRef);
        porBaixo.push({ caso: tipo, snrDb, pcm8k: para8k(ruidoNoNivel.subarray(0, amostrasDaJanela)) });
      }
    const uhum = await sintetizar("Uhum.", voz, pasta);
    const janela = new Float64Array(amostrasDaJanela);
    for (const s of UHUNS_S) janela.set(uhum.subarray(0, Math.max(0, amostrasDaJanela - Math.round(s * TAXA_LARGA))), Math.round(s * TAXA_LARGA));
    porBaixo.push({ caso: "uhum", snrDb: null, pcm8k: para8k(janela) });
  }

  const longas: AudioDaFrase[] = [];
  if (opcoes.partes.includes("longa")) {
    const pausa = new Float64Array(Math.round(PAUSA_DA_FRASE_LONGA_S * TAXA_LARGA));
    const pedacos: Float64Array[] = [];
    let amostrasDaFala = 0;
    for (const f of conjunto) {
      if (amostrasDaFala >= FRASE_LONGA_S * TAXA_LARGA) break;
      const s = await sintetizar(f.texto, voz, pasta);
      if (pedacos.length > 0) pedacos.push(pausa);
      pedacos.push(s);
      amostrasDaFala += (pedacos.length > 1 ? pausa.length : 0) + s.length;
    }
    if (amostrasDaFala < FRASE_LONGA_S * TAXA_LARGA) throw new Error(`o conjunto não chega a ${FRASE_LONGA_S} s de fala para a frase longa`);
    const fala = new Float64Array(amostrasDaFala);
    let o = 0;
    for (const p of pedacos) {
      fala.set(p, o);
      o += p.length;
    }
    const limpa = comFolga(fala, ANTES_S, CAUDA_S);
    for (const tipo of TIPOS_DE_RUIDO) longas.push(await mistura("longa", limpa, tipo, NIVEL_DA_FRASE_LONGA_DB, 900));
  }

  return { frases, porBaixo, longas, nFrases: opcoes.partes.includes("resposta") ? Math.min(opcoes.nFrases, conjunto.length) : 0 };
}
