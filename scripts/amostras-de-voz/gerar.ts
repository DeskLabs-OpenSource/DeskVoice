/**
 * Liga `amostras.ts` às peças de verdade: os dois motores de `packages/voice-engine`, o `ffmpeg`
 * (MP3 mono) e o relógio. Como rodar, o que custa e o que devolver: `README.md`, nesta pasta.
 *
 *   pnpm exec tsx scripts/amostras-de-voz/gerar.ts --teto-usd 2
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { semAsChaves } from "../bancada-de-voz/rodada";
import { gerarAmostras } from "./amostras";
import { MOTORES } from "./motores";

const FFMPEG = process.env.AMOSTRAS_FFMPEG ?? "ffmpeg";

function rodar(args: string[], entrada?: Buffer): Promise<{ codigo: number | null; saida: string }> {
  return new Promise((resolve) => {
    const filho = spawn(FFMPEG, args, { stdio: ["pipe", "pipe", "pipe"] });
    let saida = "";
    filho.stdout.on("data", (d: Buffer) => (saida += d.toString()));
    filho.stderr.on("data", (d: Buffer) => (saida += d.toString()));
    filho.on("error", (erro) => resolve({ codigo: -1, saida: erro.message }));
    filho.on("close", (codigo) => resolve({ codigo, saida }));
    filho.stdin.end(entrada);
  });
}

async function main(): Promise<void> {
  const codigo = await gerarAmostras(process.argv.slice(2), {
    motores: MOTORES,
    async conferirCodificador() {
      const { codigo: c, saida } = await rodar(["-hide_banner", "-encoders"]);
      if (c !== 0) return `"${FFMPEG}" não rodou (instale com \`brew install ffmpeg\`, ou aponte AMOSTRAS_FFMPEG)`;
      return saida.includes("libmp3lame") ? null : `"${FFMPEG}" sem libmp3lame`;
    },
    async codificar(pcm, destino) {
      // A fala vem do motor a 8 kHz, como na ligação. O MP3 sai a 16 kHz (MPEG-2, que todo navegador
      // toca; 8 kHz seria MPEG-2.5): subir a taxa não acrescenta nada ao som da linha.
      const { codigo: c, saida } = await rodar(
        ["-hide_banner", "-loglevel", "error", "-y", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "pipe:0", "-ar", "16000", "-ac", "1", "-codec:a", "libmp3lame", "-b:a", "32k", destino],
        pcm,
      );
      if (c !== 0) throw new Error(`ffmpeg falhou em ${destino}: ${saida.trim()}`);
    },
    esperar: (ms) => new Promise((resolve) => setTimeout(resolve, ms).unref()),
    agora: () => new Date(),
    saida: (linha) => void process.stdout.write(`${linha}\n`),
    ambiente: process.env,
    saidaPadrao: fileURLToPath(new URL("../../apps/panel/public/voice-samples", import.meta.url)),
  });
  process.exitCode = codigo;
}

// Nenhuma falha sai crua: a mensagem passa pela mesma troca da chave por "***".
await main().catch((erro: unknown) => {
  process.stderr.write(`${semAsChaves(erro instanceof Error ? (erro.stack ?? erro.message) : String(erro))}\n`);
  process.exitCode = 1;
});
