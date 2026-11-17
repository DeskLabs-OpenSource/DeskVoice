/**
 * A voz sintética da bancada: Piper (TTS aberto, roda na VPS, sem chave), chamado como processo.
 * O Piper e as vozes ficam **fora** do repositório e do produto; o caminho vem do ambiente:
 *   BANCADA_PIPER   binário do Piper 1.5 ou mais novo (o pacote `piper-tts`, num venv à parte)
 *   BANCADA_VOZES   pasta com os `.onnx` e `.onnx.json` das vozes abaixo
 *
 * Licença de cada voz, conferida no MODEL_CARD em huggingface.co/rhasspy/piper-voices, 14/11/2026.
 * Nenhuma é voz de pessoa real usada sem consentimento: todas vêm de bases gravadas para TTS.
 * As quatro são vozes diferentes, e **não** sotaques regionais: o caso "sotaque" da tabela mede
 * erro por voz, e diz isso.
 *
 * A segunda fonte do desenho (o TTS do provedor já autorizado) pede a chave da DESA-10, que não
 * chegou: não está implementada nesta fatia.
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resample } from "../../packages/voice-engine/src/resample";
import { amostras, lerWav } from "./audio";

export interface Voz {
  id: string;
  arquivo: string;
  licenca: string;
}

export const VOZES: readonly Voz[] = [
  { id: "cadu", arquivo: "pt_BR-cadu-medium", licenca: "CC0 (base OHF-Voice/voice-datasets; afinada sobre a voz rdh, CC0)" },
  { id: "jeff", arquivo: "pt_BR-jeff-medium", licenca: "CC0 (base OHF-Voice/voice-datasets; afinada sobre a voz rdh, CC0)" },
  { id: "faber", arquivo: "pt_BR-faber-medium", licenca: "CC0 (base OHF-Voice/voice-datasets; afinada sobre hifi_tts_92, Hi-Fi TTS, CC BY 4.0)" },
  { id: "edresson", arquivo: "pt_BR-edresson-low", licenca: "CC BY 4.0 (Edresson/TTS-Portuguese-Corpus)" },
];

/** A voz das frases sem a marca "sotaque". */
export const VOZ_PADRAO = "cadu";

/** Taxa de trabalho da bancada: a "banda larga" de onde sai a linha estreita. */
export const TAXA_LARGA = 16000;

function ambiente(nome: string): string {
  const valor = process.env[nome];
  if (!valor) throw new Error(`${nome} não definido (veja scripts/bancada-de-voz/README.md)`);
  return valor;
}

export function vozPorId(id: string): Voz {
  const voz = VOZES.find((v) => v.id === id);
  if (!voz) throw new Error(`voz desconhecida: ${id}`);
  return voz;
}

/** Sintetiza `texto` na voz dada e devolve PCM16 mono a 16 kHz, como amostras. */
export async function sintetizar(texto: string, voz: Voz, pasta: string): Promise<Float64Array> {
  const saida = join(pasta, `tts-${voz.id}-${Math.random().toString(36).slice(2)}.wav`);
  await new Promise<void>((resolve, reject) => {
    const filho = execFile(ambiente("BANCADA_PIPER"), ["-m", join(ambiente("BANCADA_VOZES"), `${voz.arquivo}.onnx`), "-f", saida], (erro) => (erro ? reject(erro) : resolve()));
    filho.stdin?.end(texto);
  });
  const { pcm16, taxaHz } = lerWav(await readFile(saida));
  await rm(saida, { force: true });
  return amostras(resample(pcm16, taxaHz, TAXA_LARGA));
}

/** Frases inventadas da conversa de fundo. Nunca as do manifesto: o fundo não pode "acertar" a frase. */
const FALAS_DE_FUNDO = [
  "Você viu onde eu deixei a chave do carro? Acho que ficou na cozinha.",
  "Amanhã cedo eu passo no mercado e compro o pão.",
  "O jogo de ontem foi muito ruim, o time não acertou nada.",
  "Liga para a sua tia depois, ela perguntou de você.",
  "Será que vai chover hoje à tarde? O céu está escuro.",
  "Eu preciso terminar aquele relatório antes da reunião.",
];

/**
 * Conversa de fundo: três ou mais vozes diferentes falando ao mesmo tempo, cada uma começando num
 * ponto, repetidas até cobrir `amostrasTotais`. A relação com a voz principal é aplicada depois.
 */
export async function conversaDeFundo(amostrasTotais: number, pasta: string): Promise<Float64Array> {
  const out = new Float64Array(amostrasTotais);
  const vozes = VOZES.filter((v) => v.id !== VOZ_PADRAO);
  if (vozes.length < 3) throw new Error("a conversa de fundo pede três ou mais vozes");
  for (const [n, voz] of vozes.entries()) {
    const trechos: Float64Array[] = [];
    for (let k = 0; k < 2; k++) trechos.push(await sintetizar(FALAS_DE_FUNDO[(n * 2 + k) % FALAS_DE_FUNDO.length] ?? "", voz, pasta));
    const fala = Float64Array.from(trechos.flatMap((t) => [...t]));
    if (fala.length === 0) continue;
    const inicio = Math.floor((n * fala.length) / vozes.length);
    for (let i = 0; i < amostrasTotais; i++) out[i] = (out[i] ?? 0) + (fala[(inicio + i) % fala.length] ?? 0);
  }
  return out;
}

export async function pastaTemporaria(): Promise<string> {
  return mkdtemp(join(tmpdir(), "bancada-de-voz-"));
}

