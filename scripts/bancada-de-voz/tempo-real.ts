/**
 * Envio em tempo real: o áudio sai em pedaços de 20 ms, no ritmo do relógio, como numa ligação.
 *
 * Mandar o arquivo de uma vez mede a vazão do provedor, e não a latência da conversa. Aqui o
 * pedaço `i` só sai quando os 20 ms dele já "foram falados": em `inicio + (i + 1) · 20 ms`. A
 * espera é contra o horário absoluto, não somada pedaço a pedaço, para o atraso não se acumular.
 */

export const PEDACO_MS = 20;

/** O relógio da bancada. O de verdade lê `performance.now()`; o teste usa um falso. */
export interface Relogio {
  /** Milissegundos de um relógio monotônico. */
  agora(): number;
  /** Resolve quando `agora()` chega a `instanteMs` (ou já passou). */
  esperarAte(instanteMs: number): Promise<void>;
}

export const relogioDoSistema: Relogio = {
  agora: () => performance.now(),
  esperarAte: (instanteMs) =>
    new Promise((resolve) => {
      const falta = instanteMs - performance.now();
      if (falta <= 0) resolve();
      else setTimeout(resolve, falta);
    }),
};

/** Bytes de um pedaço de 20 ms de PCM16 mono na taxa dada (8 kHz: 320; 16 kHz: 640). */
export function bytesPorPedaco(taxaHz: number): number {
  return ((taxaHz * PEDACO_MS) / 1000) * 2;
}

/**
 * Manda `pcm16` (mono, `taxaHz`) em pedaços de 20 ms, cada um no seu horário. O último pedaço,
 * se incompleto, sai do tamanho que tem. Devolve o instante em que o envio começou (o zero do áudio)
 * e o instante do último pedaço.
 */
export async function enviarEmTempoReal(
  pcm16: Buffer,
  taxaHz: number,
  enviar: (pedaco: Buffer) => void,
  relogio: Relogio,
  parar: () => boolean = () => false,
): Promise<{ inicioMs: number; fimMs: number; pedacos: number }> {
  const tamanho = bytesPorPedaco(taxaHz);
  const inicioMs = relogio.agora();
  let pedacos = 0;
  let fimMs = inicioMs;
  for (let offset = 0; offset < pcm16.length; offset += tamanho) {
    if (parar()) break;
    await relogio.esperarAte(inicioMs + (pedacos + 1) * PEDACO_MS);
    enviar(pcm16.subarray(offset, Math.min(offset + tamanho, pcm16.length)));
    pedacos++;
    fimMs = relogio.agora();
  }
  return { inicioMs, fimMs, pedacos };
}
