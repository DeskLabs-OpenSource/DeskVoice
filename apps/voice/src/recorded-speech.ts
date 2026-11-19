import { readFile } from "node:fs/promises";
import { parseRecordedSpeech, type SpokenLanguage } from "@deskvoice/core";

/**
 * Uma fala já gravada, como PCM16 mono a 8 kHz, a forma em que a linha toca: o aviso da caixa
 * postal (`voicemail.ts`) e a fala de indisponível da organização suspensa (`unavailable.ts`). Os
 * arquivos são gerados por script versionado (`scripts/aviso-da-caixa-postal/gerar.sh`,
 * `scripts/fala-de-indisponivel/gerar.sh`); um arquivo em outro formato é recusado aqui, e não
 * tocado como ruído. O parser é um só, em `@deskvoice/core` (`parseRecordedSpeech`): o painel valida
 * o anúncio do menu por teclas com ele.
 */
export async function readRecordedSpeech(dir: URL, label: string, language: SpokenLanguage): Promise<Buffer> {
  return parseRecordedSpeech(await readFile(new URL(`${language}.wav`, dir)), `${label} ${language}`);
}
