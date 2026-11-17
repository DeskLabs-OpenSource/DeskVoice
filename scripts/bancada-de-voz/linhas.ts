/**
 * As duas linhas do desenho da R12 ("Linha estreita e linha larga"):
 *
 * - **estreita:** a frase em banda larga (16 kHz) desce a 8 kHz com o `resample` de `origin/main`,
 *   como na ponte (`apps/voice/src/transport.ts`). Para o serviço que o motor do OpenAI usaria, passa
 *   também por μ-law ida e volta. Se o serviço só aceita 16 kHz, sobe de novo com o mesmo `resample`
 *   (o corrigido do #161, sem imagem): ouve 16 kHz, mas com a banda de telefone;
 * - **larga:** a mesma frase a 16 kHz, sem passar pela ponte.
 */
import { pcm16ToUlaw, resample, ulawToPcm16 } from "../../packages/voice-engine/src/resample";
import { TAXA_LARGA } from "./voz";

export type Linha = "estreita" | "larga";
export const LINHAS: readonly Linha[] = ["estreita", "larga"];

/** O que o serviço recebe: taxa e se o áudio passa pelo μ-law da linha do OpenAI. */
export interface Entrega {
  taxaHz: 8000 | 16000;
  mulaw: boolean;
}

export const TAXA_DA_PONTE = 8000;

/** `pcm16_16k` é a frase em banda larga. Devolve o áudio que o serviço recebe, na taxa da entrega. */
export function passarPelaLinha(pcm16_16k: Buffer, linha: Linha, entrega: Entrega): Buffer {
  if (linha === "larga") {
    if (entrega.taxaHz !== TAXA_LARGA) throw new Error("linha larga pede um serviço que aceite 16 kHz");
    return pcm16_16k;
  }
  let ponte = resample(pcm16_16k, TAXA_LARGA, TAXA_DA_PONTE);
  if (entrega.mulaw) ponte = ulawToPcm16(pcm16ToUlaw(ponte));
  return entrega.taxaHz === TAXA_DA_PONTE ? ponte : resample(ponte, TAXA_DA_PONTE, entrega.taxaHz);
}
