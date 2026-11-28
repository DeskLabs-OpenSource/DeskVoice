/**
 * Bancada do cérebro do pipeline (R5, fatias 2, 2b e 2c): o tempo do pedido ao primeiro `text` de `Brain.chat`.
 * Fora do CI; só roda com as chaves que a R4 já usa, entregues por canal privado.
 *
 *   # export BANCADA_OPENAI_API_KEY=...  BANCADA_OPENROUTER_API_KEY=...  BANCADA_DEEPSEEK_API_KEY=...
 *   # export BANCADA_ANTHROPIC_API_KEY=...  BANCADA_GEMINI_API_KEY=...
 *   pnpm exec tsx scripts/bancada-de-voz/cerebro-primeiro-texto.ts [--modelo openai=gpt-4.1-mini] [--limite 30]
 *
 * O que ela mede, e como:
 * - **Pedido → primeiro texto:** 30 pedidos curtos, um de cada vez, com texto sintético (uma fala de
 *   quem liga, inventada) e sem ferramenta, como o orçamento da seção 3.5 do desenho. O relógio começa
 *   na chamada de `chat` e para no primeiro `text` não vazio. Sai p50 e p95 pelo vizinho mais próximo
 *   (`percentil` de `metricas.ts`). Assim que o primeiro texto chega, o pedido é cancelado: o resto da
 *   resposta não interessa à medida e não precisa ser gerado.
 * - **Consumo:** o `usage` que o próprio `chat` emite. Como o pedido é cancelado, ele vem quase sempre
 *   estimado (um token por byte); a bancada soma e diz quantos vieram estimados. Não compara com a conta.
 *
 * Cérebro sem chave sai como "não medido (chave não entregue: VAR)", e a bancada sai com 0.
 * A chave nunca aparece na saída.
 */
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { Brain, BrainChatRequest } from "../../packages/voice-engine/src/brain";
import anthropic from "../../packages/voice-engine/src/brains/anthropic";
import deepseek from "../../packages/voice-engine/src/brains/deepseek";
import gemini from "../../packages/voice-engine/src/brains/gemini";
import openai from "../../packages/voice-engine/src/brains/openai";
import openrouter from "../../packages/voice-engine/src/brains/openrouter";
import { PIPELINE_BRAIN_MAX_TOKENS } from "../../packages/voice-engine/src/engines/pipeline";
import type { Usage } from "../../packages/voice-engine/src/types";
import { percentil } from "./metricas";

/** Os cérebros que conversam nesta fatia, a variável da chave e o modelo padrão (barato e rápido). */
export const CEREBROS: readonly { brain: Brain; variavel: string; modelo: string }[] = [
  { brain: openai, variavel: "BANCADA_OPENAI_API_KEY", modelo: "gpt-4.1-mini" },
  { brain: openrouter, variavel: "BANCADA_OPENROUTER_API_KEY", modelo: "openai/gpt-4.1-mini" },
  { brain: deepseek, variavel: "BANCADA_DEEPSEEK_API_KEY", modelo: "deepseek-chat" },
  // O mais barato da tabela `PRICES` de `brains/anthropic.ts` (US$ 1 e US$ 5 por milhão).
  { brain: anthropic, variavel: "BANCADA_ANTHROPIC_API_KEY", modelo: "claude-haiku-4-5-20251001" },
  // O mais barato da tabela `PRICES` de `brains/gemini.ts` (US$ 0,10 e US$ 0,40 por milhão).
  { brain: gemini, variavel: "BANCADA_GEMINI_API_KEY", modelo: "gemini-2.5-flash-lite" },
];

export const INSTRUCAO = "Você atende o telefone de uma clínica. Responda em uma frase curta, em português.";

/** Falas curtas de quem liga. Inventadas: sem nome de pessoa real nem dado pessoal. */
export const PEDIDOS: readonly string[] = [
  "Bom dia, queria marcar uma consulta.",
  "Vocês atendem no sábado?",
  "Qual é o endereço da clínica?",
  "Tem horário amanhã de manhã?",
  "Quanto custa a consulta?",
  "Aceitam cartão de crédito?",
  "Preciso remarcar o meu horário.",
  "Quero cancelar a consulta de terça.",
  "Vocês têm estacionamento?",
  "Que horas vocês abrem?",
  "Posso levar o meu filho junto?",
  "O exame precisa de jejum?",
  "Quanto tempo demora o resultado?",
  "Vocês atendem convênio?",
  "Tem vaga para hoje à tarde?",
  "Onde fica a entrada?",
  "Posso pagar por pix?",
  "Esqueci o horário da minha consulta.",
  "O médico atende criança?",
  "Preciso de uma segunda via do recibo.",
  "Como faço para chegar de ônibus?",
  "Vocês fecham para o almoço?",
  "Posso chegar um pouco atrasado?",
  "Tem retorno sem custo?",
  "Qual é o telefone do laboratório?",
  "Quero falar com um atendente.",
  "A consulta é presencial?",
  "Vocês mandam lembrete por mensagem?",
  "Posso marcar para a minha mãe?",
  "Obrigado, era só isso.",
];

export interface MedidaDoCerebro {
  /** Do `chat` ao primeiro `text` não vazio. Nulo se não veio texto. */
  primeiroTextoMs: number | null;
  usage: Usage | null;
  estimado: boolean;
  erro?: string;
}

export interface ResumoDoCerebro {
  pedidos: number;
  comTexto: number;
  primeiroTextoP50Ms: number | null;
  primeiroTextoP95Ms: number | null;
  tokensDeEntrada: number;
  tokensDeSaida: number;
  /** Quantos consumos vieram estimados (o pedido cancelado não recebe o consumo declarado). */
  consumosEstimados: number;
  erros: string[];
}

export function resumir(medidas: readonly MedidaDoCerebro[]): ResumoDoCerebro {
  const tempos = medidas.map((m) => m.primeiroTextoMs).filter((v): v is number => v !== null);
  const soma = (campo: (u: Usage) => number | undefined): number => medidas.reduce((total, m) => total + (m.usage ? (campo(m.usage) ?? 0) : 0), 0);
  return {
    pedidos: medidas.length,
    comTexto: tempos.length,
    primeiroTextoP50Ms: percentil(tempos, 50),
    primeiroTextoP95Ms: percentil(tempos, 95),
    tokensDeEntrada: soma((u) => (u.inputTokens ?? 0) + (u.cachedInputTokens ?? 0)),
    tokensDeSaida: soma((u) => u.outputTokens),
    consumosEstimados: medidas.filter((m) => m.usage !== null && m.estimado).length,
    erros: medidas.flatMap((m) => (m.erro ? [m.erro] : [])),
  };
}

export interface Relogio {
  agora(): number;
}
const RELOGIO_REAL: Relogio = { agora: () => performance.now() };

/** Prazo de cada pedido: o primeiro texto que não veio em 15 s não vem. */
export const PRAZO_MS = 15_000;

/** Um pedido: mede até o primeiro texto, cancela, e espera o consumo (ou o fim com falha). */
export function medirUm(brain: Brain, apiKey: string, modelo: string, fala: string, opcoes: { relogio?: Relogio; fetch?: typeof fetch } = {}): Promise<MedidaDoCerebro> {
  const relogio = opcoes.relogio ?? RELOGIO_REAL;
  const pedido: BrainChatRequest = {
    model: modelo,
    messages: [
      { role: "system", content: INSTRUCAO },
      { role: "user", content: fala },
    ],
    tools: [],
    timeoutMs: PRAZO_MS,
    // O mesmo teto de saída do motor pipeline: a bancada mede o pedido que a ligação manda.
    maxTokens: PIPELINE_BRAIN_MAX_TOKENS,
  };
  return new Promise((resolve) => {
    if (!brain.chat) {
      resolve({ primeiroTextoMs: null, usage: null, estimado: false, erro: `${brain.id}: sem chat` });
      return;
    }
    const inicio = relogio.agora();
    const chat = brain.chat(apiKey, pedido, { fetch: opcoes.fetch });
    const medida: MedidaDoCerebro = { primeiroTextoMs: null, usage: null, estimado: false };
    chat.on("text", (pedaco) => {
      if (medida.primeiroTextoMs !== null || pedaco === "") return;
      medida.primeiroTextoMs = relogio.agora() - inicio;
      chat.cancel();
    });
    chat.on("usage", (usage, estimado) => {
      medida.usage = usage;
      medida.estimado = estimado;
      // Depois do cancel, o consumo é o último evento.
      if (medida.primeiroTextoMs !== null) resolve(medida);
    });
    chat.on("done", () => resolve(medida));
    chat.on("error", (falha, status) => resolve({ ...medida, erro: `${falha} (${status ?? "sem status"})` }));
  });
}

/** A rodada inteira; devolve o texto do relatório. Sem nenhuma chave, só "não medido". */
export async function rodar(
  env: Record<string, string | undefined>,
  opcoes: { modelos?: Record<string, string>; limite?: number; relogio?: Relogio; fetch?: typeof fetch; escrever?: (linha: string) => void } = {},
): Promise<string> {
  const linhas: string[] = [];
  const escrever = opcoes.escrever ?? (() => undefined);
  const segredos: string[] = [];
  for (const { brain, variavel, modelo: padrao } of CEREBROS) {
    const apiKey = env[variavel];
    const modelo = opcoes.modelos?.[brain.id] ?? padrao;
    if (!apiKey) {
      linhas.push(`- ${brain.id} (${modelo}): não medido (chave não entregue: ${variavel})`);
      continue;
    }
    segredos.push(apiKey);
    const medidas: MedidaDoCerebro[] = [];
    for (const fala of PEDIDOS.slice(0, opcoes.limite ?? PEDIDOS.length)) {
      medidas.push(await medirUm(brain, apiKey, modelo, fala, opcoes));
      escrever(`${brain.id}: ${medidas.length}`);
    }
    const r = resumir(medidas);
    const ms = (v: number | null): string => (v === null ? "sem texto" : `${Math.round(v)} ms`);
    linhas.push(
      `- ${brain.id} (${modelo}): pedido → primeiro texto p50 ${ms(r.primeiroTextoP50Ms)}, p95 ${ms(r.primeiroTextoP95Ms)} ` +
        `(${r.comTexto}/${r.pedidos} com texto; ${r.tokensDeEntrada} tokens de entrada e ${r.tokensDeSaida} de saída, ${r.consumosEstimados} consumos estimados)` +
        (r.erros.length > 0 ? `; erros: ${r.erros.join(", ")}` : ""),
    );
  }
  let texto = `Pedido → primeiro texto do cérebro (R5, fatias 2, 2b e 2c)\n${linhas.join("\n")}\n`;
  // A chave nunca sai na saída, nem dentro de uma mensagem de erro.
  for (const segredo of segredos) texto = texto.split(segredo).join("***");
  return texto;
}

async function principal(): Promise<void> {
  const { values } = parseArgs({ options: { modelo: { type: "string", multiple: true }, limite: { type: "string" } } });
  const modelos: Record<string, string> = {};
  for (const par of values.modelo ?? []) {
    const [id, modelo] = par.split("=");
    if (!id || !modelo) throw new Error(`--modelo ${par}: use cerebro=modelo`);
    modelos[id] = modelo;
  }
  const limite = values.limite === undefined ? undefined : Number(values.limite);
  if (limite !== undefined && (!Number.isInteger(limite) || limite < 1)) throw new Error("--limite precisa ser um inteiro positivo");
  process.stdout.write(await rodar(process.env, { modelos, limite, escrever: (linha) => process.stderr.write(`${linha}\n`) }));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  principal().catch((erro: unknown) => {
    process.stderr.write(`${erro instanceof Error ? erro.message : String(erro)}\n`);
    process.exitCode = 1;
  });
}
