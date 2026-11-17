/**
 * A medida da fatia 6 da R12: o filtro **do produto** sobre o conjunto do filtro. É o mesmo
 * `deciders/jev.ts`, as mesmas perguntas (`speech-filter.ts`), o mesmo `state` e o mesmo prazo de
 * 1 s que a chamada usa; a bancada só troca a fala de quem ligou pelo texto inventado do conjunto.
 *
 * O que ela diz, para o corpo do PR:
 * - a leitura **por tipo de item**: nos itens com termo, quantas vezes sugeriu o termo certo, quantas
 *   deixou de trocar (nenhuma sugestão) e quantas sugeriu o errado; nos de "nenhum", quantas ficaram
 *   como estão, quantas escolheram um termo abaixo do corte (sem efeito) e quantas sugeririam troca;
 * - o fundo como marca: falas de quem liga marcadas como fundo (o fracasso) e fundos marcados;
 * - o "terminou", como observação;
 * - p50 e p95 da passada de três perguntas, e quantas decisões chegaram a tempo (dentro de 1 s).
 *
 * Uso (manual, fora do CI): `JEV_API_KEY=… npx tsx scripts/bancada-de-voz/filtro-na-chamada.ts`.
 * Só o texto sintético do conjunto. Teto próprio de US$ 0,05 por rodada, além do teto de US$ 1 da
 * decisão 2: cada pedido reserva o pior caso antes de sair. A chave nunca sai: toda linha passa
 * por `semAsChaves`.
 */
import { fileURLToPath } from "node:url";
import jev, { JEV_PRICING } from "../../packages/voice-engine/src/deciders/jev";
import { DECISION_DEADLINE_MS, NO_TERM, readSpeechDecision, speechFilterQuestions, speechFilterState } from "../../packages/voice-engine/src/speech-filter";
import type { DecideInput, DecideResult } from "../../packages/voice-engine/src/types";
import { carregarConjunto, vocabularioDoConjunto } from "./conjunto";
import { carregarFiltro, type ItemDoFiltro } from "./filtro";
import { percentil } from "./metricas";
import { semAsChaves } from "./rodada";

export type Decidir = (input: DecideInput) => Promise<DecideResult>;

export interface Registro {
  item: ItemDoFiltro;
  resultado: DecideResult;
}

/** O pior caso de um pedido, em micro-centavos: um token por byte do corpo, mais 1000 de sobra (medido em 15/11). */
export function piorCaso(input: DecideInput): number {
  const tokens = Buffer.byteLength(JSON.stringify(input)) + 1000;
  return Math.ceil(tokens * (JEV_PRICING.centsPerMillionInputTokens ?? 0));
}

/** Roda os itens com `concorrencia` pedidos ao mesmo tempo. Para antes de passar do teto. */
export async function rodar(itens: readonly ItemDoFiltro[], vocabulario: readonly string[], decidir: Decidir, concorrencia: number, teto: { microcents: number; gasto: number }): Promise<{ registros: Registro[]; parou: boolean }> {
  const registros: Registro[] = [];
  const fila = [...itens];
  let parou = false;
  const trabalhar = async (): Promise<void> => {
    for (let item = fila.shift(); item; item = fila.shift()) {
      const input = { state: speechFilterState(item.agente, item.trecho), questions: speechFilterQuestions(item.trecho, vocabulario) };
      const reserva = piorCaso(input);
      if (teto.gasto + reserva > teto.microcents) {
        parou = true;
        return;
      }
      teto.gasto += reserva;
      const resultado = await decidir(input);
      teto.gasto += resultado.costMicrocents - reserva;
      registros.push({ item, resultado });
    }
  };
  await Promise.all(Array.from({ length: concorrencia }, trabalhar));
  return { registros, parou };
}

const fracao = (a: number, b: number): string => (b === 0 ? "—" : `${a}/${b} (${Math.round((100 * a) / b)} %)`);
const ms = (v: number | null): string => (v === null ? "—" : String(Math.round(v)));

/** A tabela de uma rodada, pela regra do produto (`readSpeechDecision`, corte ≥ 0,8). */
export function tabela(registros: readonly Registro[], vocabulario: readonly string[]): string {
  const ok = registros.filter((r): r is Registro & { resultado: Extract<DecideResult, { ok: true }> } => r.resultado.ok);
  const lido = ok.map((r) => ({ item: r.item, leitura: readSpeechDecision(r.resultado.answers, vocabulario) }));
  const comTermo = lido.filter((r) => r.item.tipo === "leitura" && r.item.esperado !== NO_TERM);
  const semTermo = lido.filter((r) => r.item.tipo === "leitura" && r.item.esperado === NO_TERM);
  const sugestao = (r: (typeof lido)[number]): string | undefined => r.leitura.marks.suggestion?.term;
  const pessoas = lido.filter((r) => r.item.tipo === "fundo" && r.item.esperado === "pessoa");
  const fundos = lido.filter((r) => r.item.tipo === "fundo" && r.item.esperado === "fundo");
  const terminou = lido.filter((r) => r.item.tipo === "terminou");
  const acertouTerminou = terminou.filter((r) => ((r.leitura.finished ?? 0) >= 0.5 ? "terminou" : "pausa") === r.item.esperado);
  const latencias = registros.map((r) => r.resultado.latencyMs);
  const falhas = new Map<string, number>();
  for (const r of registros) if (!r.resultado.ok) falhas.set(r.resultado.failure, (falhas.get(r.resultado.failure) ?? 0) + 1);
  return [
    "| O que | Resultado |",
    "|---|---|",
    `| Leitura, itens com termo: sugeriu o termo certo (≥ 0,8) | ${fracao(comTermo.filter((r) => sugestao(r) === r.item.esperado).length, comTermo.length)} |`,
    `| Leitura, itens com termo: deixou de trocar (sem sugestão) | ${fracao(comTermo.filter((r) => sugestao(r) === undefined).length, comTermo.length)} |`,
    `| Leitura, itens com termo: deixou de trocar, mas escolheu o certo abaixo do corte | ${fracao(comTermo.filter((r) => sugestao(r) === undefined && r.leitura.reading?.choice === r.item.esperado).length, comTermo.length)} |`,
    `| Leitura, itens com termo: sugeriu o termo errado (≥ 0,8) | ${fracao(comTermo.filter((r) => sugestao(r) !== undefined && sugestao(r) !== r.item.esperado).length, comTermo.length)} |`,
    `| Leitura, "nenhuma troca": ficou como está | ${fracao(semTermo.filter((r) => sugestao(r) === undefined).length, semTermo.length)} |`,
    `| Leitura, "nenhuma troca": escolheu um termo abaixo do corte (sem efeito) | ${fracao(semTermo.filter((r) => sugestao(r) === undefined && r.leitura.reading?.choice !== NO_TERM).length, semTermo.length)} |`,
    `| Leitura, "nenhuma troca": sugeriria troca (≥ 0,8) | ${fracao(semTermo.filter((r) => sugestao(r) !== undefined).length, semTermo.length)} |`,
    `| Fundo: fala de quem liga marcada como fundo (≥ 0,8) | ${fracao(pessoas.filter((r) => r.leitura.marks.background).length, pessoas.length)} |`,
    `| Fundo: fala de fundo marcada (≥ 0,8) | ${fracao(fundos.filter((r) => r.leitura.marks.background).length, fundos.length)} |`,
    `| Terminou (observação, fronteira 0,5) | ${fracao(acertouTerminou.length, terminou.length)} |`,
    `| Passada de 3 perguntas, p50 / p95 (ms) | ${ms(percentil(latencias, 50))} / ${ms(percentil(latencias, 95))} |`,
    `| Chegaram a tempo (resposta em até ${DECISION_DEADLINE_MS} ms) | ${fracao(ok.length, registros.length)} |`,
    `| Falhas | ${[...falhas].map(([m, n]) => `${n}× ${m}`).join("; ") || "0"} |`,
  ].join("\n");
}

async function principal(): Promise<void> {
  const chave = process.env.JEV_API_KEY;
  const print = (linha = ""): void => void process.stdout.write(`${semAsChaves(linha)}\n`);
  if (!chave) return print("Jev: não medido (JEV_API_KEY não definido).");
  const vocabulario = vocabularioDoConjunto(carregarConjunto());
  const itens = carregarFiltro(vocabulario).itens;
  // US$ 0,05 = 5 centavos = 5 000 000 micro-centavos.
  const teto = { microcents: 5 * 1_000_000, gasto: 0 };
  const modelos = new Set<string>();
  const decidir: Decidir = async (input) => {
    const resultado = await jev.decide(chave, input, { timeoutMs: DECISION_DEADLINE_MS });
    modelos.add(resultado.model);
    return resultado;
  };
  // Aquece a conexão: três pedidos fora da conta, como na rodada 2.
  await rodar(itens.slice(0, 3), vocabulario, decidir, 1, teto);
  print(`Preço: ${JEV_PRICING.source}, conferido em ${JEV_PRICING.checkedOn}. ${itens.length} itens, prazo de ${DECISION_DEADLINE_MS} ms por pedido.`);
  for (const concorrencia of [1, 3]) {
    const { registros, parou } = await rodar(itens, vocabulario, decidir, concorrencia, teto);
    print();
    print(`### ${concorrencia} chamada(s) simultânea(s)`);
    print();
    print(tabela(registros, vocabulario));
    if (parou) print(`\nParou no teto da rodada antes de terminar (${registros.length} de ${itens.length}).`);
  }
  print();
  print(`Modelo que respondeu: ${[...modelos].join(", ")}. Gasto da rodada: US$ ${(teto.gasto / 1e8).toFixed(6)}.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await principal();
