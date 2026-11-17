/**
 * Envio em tempo real: o áudio sai em pedaços de 20 ms, no ritmo do relógio, como numa ligação.
 *
 * Mandar o arquivo de uma vez mede a vazão do provedor, e não a latência da conversa. Aqui o
 * pedaço `i` só sai quando os 20 ms dele já "foram falados": em `inicio + (i + 1) · 20 ms`. A
 * espera é contra o horário absoluto, não somada pedaço a pedaço, para o atraso não se acumular.
 */

export const PEDACO_MS = 20;

/**
 * Um item cujo envio (ou cuja espera depois dele) atrasou mais que isto contra o horário não foi
 * medido em tempo real: a bancada o tira das latências e o conta como "fora do ritmo" na tabela.
 * 100 ms são cinco pedaços: bem acima do tremor do `setTimeout`, bem abaixo de qualquer latência medida.
 */
export const LIMITE_FORA_DO_RITMO_MS = 100;

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
 * se incompleto, sai do tamanho que tem. Devolve o instante em que o envio começou (o zero do áudio),
 * o instante do último pedaço, quantos bytes saíram e o maior atraso de um pedaço contra o seu
 * horário. Quem chama confere o atraso: o envio não esconde que saiu do ritmo.
 */
export async function enviarEmTempoReal(
  pcm16: Buffer,
  taxaHz: number,
  enviar: (pedaco: Buffer) => void,
  relogio: Relogio,
  parar: () => boolean = () => false,
): Promise<{ inicioMs: number; fimMs: number; pedacos: number; bytes: number; atrasoMaxMs: number }> {
  const tamanho = bytesPorPedaco(taxaHz);
  const inicioMs = relogio.agora();
  let pedacos = 0;
  let fimMs = inicioMs;
  let bytes = 0;
  let atrasoMaxMs = 0;
  for (let offset = 0; offset < pcm16.length; offset += tamanho) {
    if (parar()) break;
    const horario = inicioMs + (pedacos + 1) * PEDACO_MS;
    await relogio.esperarAte(horario);
    const pedaco = pcm16.subarray(offset, Math.min(offset + tamanho, pcm16.length));
    enviar(pedaco);
    pedacos++;
    bytes += pedaco.length;
    fimMs = relogio.agora();
    atrasoMaxMs = Math.max(atrasoMaxMs, fimMs - horario);
  }
  return { inicioMs, fimMs, pedacos, bytes, atrasoMaxMs };
}
