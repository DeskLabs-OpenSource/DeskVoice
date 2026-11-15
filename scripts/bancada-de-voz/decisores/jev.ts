/**
 * Jev (TypeSafe AI) na bancada: acerto da leitura e latência, com as **mesmas três perguntas** do
 * Laya (`laya_local.py`: fundo, fim do pensamento, leitura certa), o mesmo estado ("Agente: Em que
 * posso ajudar?" e a frase do manifesto, como se a transcrição tivesse acertado) e a mesma saída:
 * uma tabela em Markdown, por número de chamadas simultâneas (1 e 3), com a passada das três
 * perguntas num pedido e cada pergunta sozinha. As três primeiras passadas aquecem e não contam.
 *
 * O Jev é uma API fechada, nos EUA. Por isso: **só texto sintético da bancada** (as frases
 * inventadas do conjunto), nunca de ligação, e o teto da rodada (`--teto-usd`) vale para ele.
 *
 * Fontes, conferidas em 15/11/2026:
 * - API: docs.typesafe.ai/api. `POST https://api.typesafe.ai/v1/systemone`, `Authorization: Bearer`,
 *   corpo `{ model, state, questions }`; resposta `{ model, answers, usage }`, em que cada resposta
 *   tem `type` (`noul` com `noul` de 0 a 1; `choice` com `choice`, `confidence` e `probabilities`)
 *   e `usage` tem `input_tokens` e `output_tokens`. Erros: 400 e 422, com `detail`;
 * - modelo e preço: docs.typesafe.ai/models. `jev-latest` aponta para `jev-1.14.0`. US$ 0,042 por
 *   milhão de tokens de entrada, saída grátis. A página não diz quais idiomas o modelo lê.
 *
 * Acerto: o conjunto só tem a resposta esperada da **leitura** (os termos marcados na frase). A
 * resposta certa é um dos termos da frase que estão entre as opções, ou "nenhum" se a frase não
 * tem termo. Para "fundo" e "terminou" o conjunto não tem resposta esperada: a tabela dá a média
 * do valor devolvido, e não um acerto.
 *
 * Chave: `JEV_API_KEY` (cofre do Paperclip, `jev_api_key`). O valor nunca sai em erro ou tabela.
 */
import type { Frase } from "../conjunto";
import { z } from "../dependencias";
import { percentil } from "../metricas";
import { camposComProblema } from "../servicos/_externo";
import type { Orcamento } from "../orcamento";
import { relogioDoSistema, type Relogio } from "../tempo-real";

export const VARIAVEL_DA_CHAVE = "JEV_API_KEY";
export const URL_DO_JEV = "https://api.typesafe.ai/v1/systemone";
export const MODELO_PEDIDO = "jev-latest";
export const USD_POR_MILHAO_DE_ENTRADA = 0.042;
export const FONTE_DO_PRECO = "docs.typesafe.ai/models (US$ 0,042 por milhão de tokens de entrada, saída grátis), conferido em 2026-11-15";
const AGENTE = "Agente: Em que posso ajudar?";
const PRAZO_MS = 15_000;
const AQUECIMENTO = 3;
const CONCORRENCIAS = [1, 3] as const;

type Pergunta = { type: "noul"; instructions: string } | { type: "choice"; instructions: string; criteria: Record<string, string> };

const Resposta = z.object({
  model: z.string(),
  answers: z.record(
    z.string(),
    z.union([
      z.object({ type: z.literal("noul"), noul: z.number().min(0).max(1) }),
      z.object({ type: z.literal("choice"), choice: z.string(), confidence: z.number().nullable().optional(), probabilities: z.record(z.string(), z.number()).optional() }),
    ]),
  ),
  usage: z.object({ input_tokens: z.number().int().nonnegative(), output_tokens: z.number().int().nonnegative() }),
});
export type RespostaDoJev = z.infer<typeof Resposta>;

/** Quantos caracteres as duas palavras têm em comum, pelos blocos de Ratcliff/Obershelp (os do `difflib`). */
function emComum(a: string, b: string): number {
  if (!a || !b) return 0;
  let tamanho = 0;
  let ia = 0;
  let ib = 0;
  let anterior = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const atual = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] !== b[j - 1]) continue;
      atual[j] = (anterior[j - 1] ?? 0) + 1;
      if ((atual[j] ?? 0) > tamanho) {
        tamanho = atual[j] ?? 0;
        ia = i - tamanho;
        ib = j - tamanho;
      }
    }
    anterior = atual;
  }
  if (tamanho === 0) return 0;
  return tamanho + emComum(a.slice(0, ia), b.slice(0, ib)) + emComum(a.slice(ia + tamanho), b.slice(ib + tamanho));
}

/** A `ratio()` do `SequenceMatcher` do Python, para as opções da leitura saírem iguais às do Laya. */
export function semelhanca(a: string, b: string): number {
  const total = a.length + b.length;
  return total === 0 ? 1 : (2 * emComum(a, b)) / total;
}

/** As três perguntas de `laya_local.py`, com as mesmas opções na leitura (até 4 termos parecidos, mais "nenhum"). */
export function perguntas(frase: string, vocabulario: readonly string[]): Record<string, Pergunta> {
  const palavras = frase.split(/\s+/).filter(Boolean);
  const nota = new Map(vocabulario.map((t) => [t, Math.max(0, ...palavras.map((p) => semelhanca(t.toLowerCase(), p.toLowerCase())))]));
  const parecidos = [...vocabulario].sort((x, y) => (nota.get(y) ?? 0) - (nota.get(x) ?? 0)).slice(0, 4);
  const opcoes: Record<string, string> = {};
  for (const t of parecidos) opcoes[t] = `a pessoa disse ${t}`;
  opcoes.nenhum = "nenhum destes termos foi dito";
  return {
    fundo: { type: "noul", instructions: "A fala é de quem está na ligação, conversando com o agente (e não fala de fundo)?" },
    terminou: { type: "noul", instructions: "A pessoa terminou o pensamento, ou só fez uma pausa no meio?" },
    leitura: { type: "choice", instructions: "Qual destes termos a pessoa disse?", criteria: opcoes },
  };
}

/** As respostas certas da leitura: os termos da frase entre as opções, ou "nenhum". */
export function leiturasCertas(frase: Frase, opcoes: Record<string, string>): Set<string> {
  const certas = frase.termos.filter((t) => t in opcoes);
  return new Set(frase.termos.length === 0 || certas.length === 0 ? ["nenhum"] : certas);
}

export interface OpcoesDoJev {
  url?: string;
  chave?: string;
  relogio?: Relogio;
  /** Concorrências medidas. Padrão: 1 e 3, como o Laya. */
  concorrencias?: readonly number[];
}

type Pedido = { ok: true; resposta: RespostaDoJev; ms: number } | { ok: false; motivo: string; ms: number };

class Teto extends Error {}

/** Um pedido ao Jev. Nunca lança, exceto `Teto` (para antes de gastar). */
async function pedir(url: string, chave: string, estado: string, questions: Record<string, Pergunta>, orcamento: Orcamento, relogio: Relogio): Promise<Pedido> {
  const corpo = JSON.stringify({ model: MODELO_PEDIDO, state: estado, questions });
  // Pior caso: um token por byte do corpo. Sobra muito, e nunca falta.
  const estimativa = (Buffer.byteLength(corpo) / 1e6) * USD_POR_MILHAO_DE_ENTRADA;
  if (!orcamento.cabe(estimativa)) throw new Teto();
  const inicio = relogio.agora();
  let resposta: Response;
  try {
    resposta = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${chave}`, "content-type": "application/json" },
      body: corpo,
      signal: AbortSignal.timeout(PRAZO_MS),
    });
  } catch (erro) {
    orcamento.somar(estimativa, "jev");
    return { ok: false, motivo: (erro as Error).name === "TimeoutError" ? `sem resposta em ${PRAZO_MS} ms` : "falha de rede", ms: relogio.agora() - inicio };
  }
  const texto = await resposta.text();
  const ms = relogio.agora() - inicio;
  if (!resposta.ok) {
    // Pedido recusado não deveria cobrar; a bancada conta a estimativa mesmo assim.
    orcamento.somar(estimativa, "jev");
    return { ok: false, motivo: `HTTP ${resposta.status}`, ms };
  }
  let json: unknown;
  try {
    json = JSON.parse(texto);
  } catch {
    orcamento.somar(estimativa, "jev");
    return { ok: false, motivo: "resposta que não é JSON", ms };
  }
  const lido = Resposta.safeParse(json);
  if (!lido.success) {
    orcamento.somar(estimativa, "jev");
    return { ok: false, motivo: `resposta fora do esquema (${camposComProblema(lido.error.issues)})`, ms };
  }
  orcamento.somar((lido.data.usage.input_tokens / 1e6) * USD_POR_MILHAO_DE_ENTRADA, "jev");
  const faltando = Object.keys(questions).filter((nome) => lido.data.answers[nome]?.type !== questions[nome]?.type);
  if (faltando.length > 0) return { ok: false, motivo: `sem resposta do tipo pedido para ${faltando.join(", ")}`, ms };
  return { ok: true, resposta: lido.data, ms };
}

interface PorConcorrencia {
  passadas: number[];
  umaPergunta: number[];
  leituras: number;
  leiturasCertas: number;
  fundo: number[];
  terminou: number[];
  falhas: Map<string, number>;
}

const ms = (v: number | null): string => (v === null ? "—" : String(Math.round(v)));
const media = (v: readonly number[]): string => (v.length === 0 ? "—" : (v.reduce((a, b) => a + b, 0) / v.length).toFixed(2));

/**
 * Roda a medida e devolve a tabela em Markdown. Sem a chave, diz que não mediu. Para antes de
 * passar do teto, e diz onde parou.
 */
export async function medirJev(frases: readonly Frase[], vocabulario: readonly string[], orcamento: Orcamento, opcoes: OpcoesDoJev = {}): Promise<string> {
  const chave = opcoes.chave ?? process.env[VARIAVEL_DA_CHAVE];
  if (!chave) return `Jev: não medido (${VARIAVEL_DA_CHAVE} não definido).`;
  const url = opcoes.url ?? URL_DO_JEV;
  const relogio = opcoes.relogio ?? relogioDoSistema;
  const semChave = (texto: string): string => texto.split(chave).join("***");
  const estado = (frase: Frase): string => `${AGENTE}\nPessoa: ${frase.texto}`;
  const modelos = new Set<string>();
  let parouNoTeto: string | null = null;
  const resultado = new Map<number, PorConcorrencia>();

  try {
    for (const frase of frases.slice(0, AQUECIMENTO)) await pedir(url, chave, estado(frase), perguntas(frase.texto, vocabulario), orcamento, relogio);
    for (const concorrencia of opcoes.concorrencias ?? CONCORRENCIAS) {
      const r: PorConcorrencia = { passadas: [], umaPergunta: [], leituras: 0, leiturasCertas: 0, fundo: [], terminou: [], falhas: new Map() };
      resultado.set(concorrencia, r);
      const falhou = (motivo: string): void => void r.falhas.set(motivo, (r.falhas.get(motivo) ?? 0) + 1);
      const trabalhar = async (): Promise<void> => {
        for (const frase of frases) {
          const q = perguntas(frase.texto, vocabulario);
          const passada = await pedir(url, chave, estado(frase), q, orcamento, relogio);
          if (passada.ok) {
            r.passadas.push(passada.ms);
            modelos.add(passada.resposta.model);
            const { fundo, terminou, leitura } = passada.resposta.answers;
            if (fundo?.type === "noul") r.fundo.push(fundo.noul);
            if (terminou?.type === "noul") r.terminou.push(terminou.noul);
            if (leitura?.type === "choice" && q.leitura?.type === "choice") {
              r.leituras++;
              if (leiturasCertas(frase, q.leitura.criteria).has(leitura.choice)) r.leiturasCertas++;
            }
          } else falhou(passada.motivo);
          for (const [nome, pergunta] of Object.entries(q)) {
            const uma = await pedir(url, chave, estado(frase), { [nome]: pergunta }, orcamento, relogio);
            if (uma.ok) r.umaPergunta.push(uma.ms);
            else falhou(uma.motivo);
          }
        }
      };
      await Promise.all(Array.from({ length: concorrencia }, trabalhar));
    }
  } catch (erro) {
    if (!(erro instanceof Teto)) throw new Error(semChave(String(erro)));
    parouNoTeto = `parou no teto (US$ ${orcamento.gasto.toFixed(4)} gastos na rodada) antes de terminar`;
  }

  const linhas = [
    `Modelo pedido: ${MODELO_PEDIDO}; modelo que respondeu: ${[...modelos].join(", ") || "—"}. Preço: ${FONTE_DO_PRECO}.`,
    `Gasto do Jev: US$ ${(orcamento.porServico().find(([s]) => s === "jev")?.[1] ?? 0).toFixed(6)}. ${AQUECIMENTO} passadas de aquecimento, fora da tabela.`,
    "",
    "| Chamadas simultâneas | Passadas medidas | Passada de 3 perguntas p50/p95 (ms) | Uma pergunta p50/p95 (ms) | Acerto da leitura | Média de \"fundo\" (sem resposta esperada) | Média de \"terminou\" (sem resposta esperada) | Falhas |",
    "|---:|---:|---:|---:|---:|---:|---:|---|",
    ...[...resultado].map(([n, r]) => {
      const falhas = [...r.falhas].map(([motivo, vezes]) => `${vezes}× ${semChave(motivo)}`).join("; ") || "0";
      const acerto = r.leituras === 0 ? "—" : `${r.leiturasCertas}/${r.leituras} (${Math.round((100 * r.leiturasCertas) / r.leituras)}%)`;
      return `| ${n} | ${r.passadas.length} | ${ms(percentil(r.passadas, 50))} / ${ms(percentil(r.passadas, 95))} | ${ms(percentil(r.umaPergunta, 50))} / ${ms(percentil(r.umaPergunta, 95))} | ${acerto} | ${media(r.fundo)} | ${media(r.terminou)} | ${falhas} |`;
    }),
  ];
  if (parouNoTeto) linhas.push("", `Jev: ${parouNoTeto}.`);
  return linhas.join("\n");
}
