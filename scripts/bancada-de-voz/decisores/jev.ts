/**
 * Jev (TypeSafe AI) na bancada: acerto e latência das três perguntas do filtro (leitura com a
 * transcrição errada, fundo, fim do pensamento), sobre o conjunto do filtro (`filtro.ts`), com os
 * **mesmos pedidos** que o Laya recebe. Por item, dois pedidos: as três perguntas numa passada, e
 * a pergunta do item sozinha. Com 1 e com 3 chamadas simultâneas. Os três primeiros pedidos
 * aquecem e não contam.
 *
 * O Jev é uma API fechada, nos EUA. Por isso: **só texto sintético da bancada** (os itens
 * inventados do conjunto), nunca de ligação, e o teto da rodada (`--teto-usd`) vale para ele.
 *
 * Fontes, conferidas em 15/11/2026:
 * - API: docs.typesafe.ai/api. `POST https://api.typesafe.ai/v1/systemone`, `Authorization: Bearer`,
 *   corpo `{ model, state, questions }`; resposta `{ model, answers, usage }`, em que cada resposta
 *   tem `type` (`noul` com `noul` de 0 a 1; `choice` com `choice`, `confidence` e `probabilities`)
 *   e `usage` tem `input_tokens` e `output_tokens`. Erros: 400 e 422, com `detail`;
 * - modelo e preço: docs.typesafe.ai/models. `jev-latest` aponta para `jev-1.14.0`. US$ 0,042 por
 *   milhão de tokens de entrada, saída grátis. A página não diz quais idiomas o modelo lê.
 *
 * Teto: cada pedido reserva o pior caso (um token por byte do corpo) antes de sair. Se o custo
 * real de um pedido passar do reservado, o orçamento não reserva mais nada, e a medida para e diz
 * quanto passou (`Orcamento.excesso`).
 *
 * Chave: `JEV_API_KEY` (cofre do Paperclip, `jev_api_key`). O valor nunca sai em erro ou tabela.
 */
import { z } from "../dependencias";
import { RespostaDaPergunta, pedidosDoFiltro, tabelaDoFiltro, type ItemDoFiltro, type PedidoDoFiltro, type Registro } from "../filtro";
import { camposComProblema } from "../servicos/_externo";
import type { Orcamento } from "../orcamento";
import { relogioDoSistema, type Relogio } from "../tempo-real";

export const VARIAVEL_DA_CHAVE = "JEV_API_KEY";
export const URL_DO_JEV = "https://api.typesafe.ai/v1/systemone";
export const MODELO_PEDIDO = "jev-latest";
export const USD_POR_MILHAO_DE_ENTRADA = 0.042;
export const FONTE_DO_PRECO = "docs.typesafe.ai/models (US$ 0,042 por milhão de tokens de entrada, saída grátis), conferido em 2026-11-15";
const PRAZO_MS = 15_000;
const AQUECIMENTO = 3;
const CONCORRENCIAS = [1, 3] as const;

const Resposta = z.object({
  model: z.string(),
  answers: z.record(z.string(), RespostaDaPergunta),
  usage: z.object({ input_tokens: z.number().int().nonnegative(), output_tokens: z.number().int().nonnegative() }),
});
export type RespostaDoJev = z.infer<typeof Resposta>;

/** O corpo do pedido ao Jev, para o teto estimar o pior caso. */
export function corpoDoPedido(pedido: Pick<PedidoDoFiltro, "estado" | "perguntas">): string {
  return JSON.stringify({ model: MODELO_PEDIDO, state: pedido.estado, questions: pedido.perguntas });
}

export interface OpcoesDoJev {
  url?: string;
  chave?: string;
  relogio?: Relogio;
  /** Concorrências medidas. Padrão: 1 e 3, como o Laya. */
  concorrencias?: readonly number[];
}

class Teto extends Error {}

/**
 * Um pedido ao Jev. Nunca lança, exceto `Teto` (para antes de gastar). A estimativa fica reservada
 * no orçamento antes do pedido, e só é trocada pelo valor real depois da resposta: com pedidos
 * simultâneos, o que está em voo conta, e o teto não estoura.
 */
async function pedir(url: string, chave: string, pedido: PedidoDoFiltro, orcamento: Orcamento, relogio: Relogio, modelos: Set<string>): Promise<Registro> {
  const corpo = corpoDoPedido(pedido);
  // Pior caso: um token por byte do corpo. Sobra muito, e nunca falta (se faltar, o orçamento trava).
  const estimativa = (Buffer.byteLength(corpo) / 1e6) * USD_POR_MILHAO_DE_ENTRADA;
  const reserva = orcamento.reservar(estimativa, "jev");
  if (!reserva) throw new Teto();
  const inicio = relogio.agora();
  const falha = (motivo: string, ms = relogio.agora() - inicio): Registro => {
    // Sem resposta lida, a bancada conta a estimativa como gasto.
    reserva.fechar(estimativa);
    return { pedido, ms, ok: false, motivo };
  };
  let resposta: Response;
  try {
    resposta = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${chave}`, "content-type": "application/json" },
      body: corpo,
      signal: AbortSignal.timeout(PRAZO_MS),
    });
  } catch (erro) {
    return falha((erro as Error).name === "TimeoutError" ? `sem resposta em ${PRAZO_MS} ms` : "falha de rede");
  }
  let texto: string;
  try {
    texto = await resposta.text();
  } catch {
    return falha("falha de rede");
  }
  const ms = relogio.agora() - inicio;
  if (!resposta.ok) return falha(`HTTP ${resposta.status}`, ms);
  let json: unknown;
  try {
    json = JSON.parse(texto);
  } catch {
    return falha("resposta que não é JSON", ms);
  }
  const lido = Resposta.safeParse(json);
  if (!lido.success) return falha(`resposta fora do esquema (${camposComProblema(lido.error.issues)})`, ms);
  reserva.fechar((lido.data.usage.input_tokens / 1e6) * USD_POR_MILHAO_DE_ENTRADA);
  modelos.add(lido.data.model);
  const faltando = Object.entries(pedido.perguntas).filter(([nome, q]) => lido.data.answers[nome]?.type !== q?.type).map(([nome]) => nome);
  if (faltando.length > 0) return { pedido, ms, ok: false, motivo: `sem resposta do tipo pedido para ${faltando.join(", ")}` };
  return { pedido, ms, ok: true, respostas: lido.data.answers };
}

/**
 * Roda a medida e devolve a tabela em Markdown. Sem a chave, diz que não mediu. Para antes de
 * passar do teto (ou quando um pedido custou mais que o reservado), e diz onde parou.
 */
export async function medirJev(itens: readonly ItemDoFiltro[], vocabulario: readonly string[], orcamento: Orcamento, opcoes: OpcoesDoJev = {}): Promise<string> {
  const chave = opcoes.chave ?? process.env[VARIAVEL_DA_CHAVE];
  if (!chave) return `Jev: não medido (${VARIAVEL_DA_CHAVE} não definido).`;
  const url = opcoes.url ?? URL_DO_JEV;
  const relogio = opcoes.relogio ?? relogioDoSistema;
  const semChave = (texto: string): string => texto.split(chave).join("***");
  const pedidos = pedidosDoFiltro(itens, vocabulario);
  const modelos = new Set<string>();
  const teto = { bateu: false };
  const resultado = new Map<number, Registro[]>();

  // Quando um pedido bate no teto, nenhum outro começa, e a tabela só sai depois que os que
  // estavam em voo voltam: o gasto que ela mostra é o final.
  const ateOTeto = async (trabalho: () => Promise<void>): Promise<void> => {
    try {
      await trabalho();
    } catch (erro) {
      if (!(erro instanceof Teto)) throw new Error(semChave(String(erro)));
      teto.bateu = true;
    }
  };
  await ateOTeto(async () => {
    for (const pedido of pedidos.slice(0, AQUECIMENTO)) await pedir(url, chave, pedido, orcamento, relogio, modelos);
  });
  for (const concorrencia of opcoes.concorrencias ?? CONCORRENCIAS) {
    if (teto.bateu) break;
    const registros: Registro[] = [];
    resultado.set(concorrencia, registros);
    const trabalhar = async (): Promise<void> => {
      for (const pedido of pedidos) {
        if (teto.bateu) return;
        registros.push(await pedir(url, chave, pedido, orcamento, relogio, modelos));
      }
    };
    // Espera todos os trabalhadores, mesmo quando um bate no teto ou falha, antes de seguir.
    const fim = await Promise.allSettled(Array.from({ length: concorrencia }, () => ateOTeto(trabalhar)));
    const falha = fim.find((f) => f.status === "rejected");
    if (falha) throw falha.reason;
  }

  const linhas = [
    `Modelo pedido: ${MODELO_PEDIDO}; modelo que respondeu: ${[...modelos].join(", ") || "—"}. Preço: ${FONTE_DO_PRECO}.`,
    `Gasto do Jev: US$ ${(orcamento.porServico().find(([s]) => s === "jev")?.[1] ?? 0).toFixed(6)}. ${AQUECIMENTO} pedidos de aquecimento, fora da tabela.`,
    "",
    tabelaDoFiltro(resultado, semChave),
  ];
  if (teto.bateu) linhas.push("", `Jev: ${orcamento.motivoDaParada()} antes de terminar.`);
  return linhas.join("\n");
}
