/**
 * Laya na bancada: acerto e latência das três perguntas do filtro, em CPU, na VPS, sobre o
 * conjunto do filtro (`filtro.ts`), com os **mesmos pedidos** que o Jev recebe. Sem custo por
 * pedido: o custo é CPU, e a tabela diz quantos núcleos a medida ocupou.
 *
 * O Laya é Python sobre PyTorch. Roda em `laya_local.py`, num venv à parte, fora do repositório e do
 * produto (entrar no produto é a decisão 3 da DESA-25). O ajudante não monta pergunta nenhuma:
 * executa os pedidos que chegam daqui, e a conta do acerto é a mesma do Jev (`tabelaDoFiltro`).
 *
 * Fontes, conferidas em 14/11/2026: huggingface.co/convaiinnovations/laya (cartão e licença
 * Apache 2.0) e o pacote `laya` no PyPI (Apache 2.0).
 * Ambiente: BANCADA_PYTHON (venv com `laya` e `torch` de CPU). Os pesos baixam no primeiro uso.
 *
 * Ou contra o serviço (R12, fatia 8a): com `BANCADA_LAYA_URL` (por exemplo `http://127.0.0.1:8000`,
 * o contêiner de `deploy/laya/`), os mesmos pedidos vão por HTTP ao `/v1/decide`, e os núcleos e a
 * memória vêm do `/health` do serviço (tempo de CPU e memória máxima do processo). A URL vence o
 * Python, e a tabela é a mesma: é assim que se confere que o serviço acerta o que a bancada acertou.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { z } from "../dependencias";
import { RespostaDaPergunta, pedidosDoFiltro, tabelaDoFiltro, type ItemDoFiltro, type PedidoDoFiltro, type Registro } from "../filtro";

const AJUDANTE = fileURLToPath(new URL("./laya_local.py", import.meta.url));
const AQUECIMENTO = 3;
const CONCORRENCIAS = [1, 3] as const;

const SaidaDoLaya = z.object({
  versao: z.string(),
  modelo: z.string(),
  /** `null` contra o serviço: o modelo carregou antes, quando o contêiner subiu. */
  carregamento_s: z.number().nullable(),
  memoria_mb: z.number(),
  por_concorrencia: z.record(
    z.string(),
    z.object({
      nucleos_ocupados: z.number(),
      resultados: z.array(z.object({ i: z.number().int().nonnegative(), ms: z.number(), respostas: z.record(z.string(), z.unknown()).optional(), erro: z.string().optional() })),
    }),
  ),
});
export type SaidaDoLaya = z.infer<typeof SaidaDoLaya>;

/** Executa o ajudante com a entrada dada e devolve a saída dele, em texto. */
export type Executar = (entrada: string) => Promise<string>;

function executarNoPython(python: string): Executar {
  return (entrada) =>
    new Promise<string>((resolve, reject) => {
      const filho = spawn(python, [AJUDANTE], { stdio: ["pipe", "pipe", "pipe"] });
      let texto = "";
      let erro = "";
      filho.stdout.on("data", (d: Buffer) => (texto += d.toString()));
      filho.stderr.on("data", (d: Buffer) => (erro += d.toString()));
      filho.on("exit", (codigo) => (codigo === 0 ? resolve(texto) : reject(new Error(`laya_local.py saiu com ${codigo}: ${erro.slice(-500)}`))));
      filho.stdin.end(entrada);
    });
}

const EntradaDoAjudante = z.object({
  pedidos: z.array(z.object({ estado: z.string(), perguntas: z.record(z.string(), z.unknown()) })),
  aquecimento: z.number().int().nonnegative(),
  concorrencias: z.array(z.number().int().positive()),
});
const SaudeDoServico = z.object({ ok: z.literal(true), model: z.string(), revision: z.string(), package: z.string(), cpu_s: z.number(), max_rss_mb: z.number() });

/**
 * O mesmo papel do `laya_local.py`, contra o serviço por HTTP: aquece, e com N chamadas
 * simultâneas cada uma das N linhas executa todos os pedidos. Os núcleos ocupados são o tempo de CPU
 * do processo do serviço (do `/health`) dividido pelo tempo de parede de cada concorrência.
 */
export function executarPorHttp(url: string, buscar: typeof fetch = fetch): Executar {
  const base = url.replace(/\/+$/, "");
  const saude = async () => SaudeDoServico.parse(await (await buscar(`${base}/health`)).json());
  const pedir = async (i: number, pedido: z.infer<typeof EntradaDoAjudante>["pedidos"][number]) => {
    const inicio = performance.now();
    try {
      const resposta = await buscar(`${base}/v1/decide`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ state: pedido.estado, questions: pedido.perguntas }) });
      const corpo = (await resposta.json()) as { answers?: Record<string, unknown>; error?: string };
      const ms = performance.now() - inicio;
      if (!resposta.ok || corpo.answers === undefined) return { i, ms, erro: `HTTP ${resposta.status}${corpo.error ? ` ${corpo.error}` : ""}` };
      return { i, ms, respostas: corpo.answers };
    } catch (erro) {
      return { i, ms: performance.now() - inicio, erro: erro instanceof Error ? erro.name : "erro" };
    }
  };
  return async (texto) => {
    const entrada = EntradaDoAjudante.parse(JSON.parse(texto));
    await saude();
    for (const [i, pedido] of entrada.pedidos.slice(0, entrada.aquecimento).entries()) await pedir(i, pedido);
    const porConcorrencia: SaidaDoLaya["por_concorrencia"] = {};
    for (const n of entrada.concorrencias) {
      const resultados: SaidaDoLaya["por_concorrencia"][string]["resultados"] = [];
      const cpu0 = (await saude()).cpu_s;
      const parede0 = performance.now();
      await Promise.all(
        Array.from({ length: n }, async () => {
          for (const [i, pedido] of entrada.pedidos.entries()) resultados.push(await pedir(i, pedido));
        }),
      );
      const parede = (performance.now() - parede0) / 1000;
      porConcorrencia[String(n)] = { nucleos_ocupados: ((await saude()).cpu_s - cpu0) / parede, resultados };
    }
    const fim = await saude();
    const saida: SaidaDoLaya = { versao: fim.package, modelo: `${fim.model}@${fim.revision} (serviço em ${base})`, carregamento_s: null, memoria_mb: fim.max_rss_mb, por_concorrencia: porConcorrencia };
    return JSON.stringify(saida);
  };
}

/** Lê o resultado de um pedido. Resposta fora do esquema conta como falha, com a pergunta. */
function registro(pedido: PedidoDoFiltro, r: SaidaDoLaya["por_concorrencia"][string]["resultados"][number]): Registro {
  if (r.erro !== undefined || r.respostas === undefined) return { pedido, ms: r.ms, ok: false, motivo: `erro do Laya (${r.erro ?? "sem respostas"})` };
  const respostas: Record<string, RespostaDaPergunta> = {};
  for (const [nome, q] of Object.entries(pedido.perguntas)) {
    const lida = RespostaDaPergunta.safeParse(r.respostas[nome]);
    if (!lida.success || lida.data.type !== q?.type) return { pedido, ms: r.ms, ok: false, motivo: `sem resposta do tipo pedido para ${nome}` };
    respostas[nome] = lida.data;
  }
  return { pedido, ms: r.ms, ok: true, respostas };
}

/**
 * Roda a medida e devolve a tabela em Markdown. Sem `executar`, usa o serviço (`BANCADA_LAYA_URL`) ou
 * o Python (`BANCADA_PYTHON`), nessa ordem; sem nenhum dos dois, diz que não mediu.
 */
export async function medirLaya(itens: readonly ItemDoFiltro[], vocabulario: readonly string[], executar?: Executar): Promise<string> {
  const url = process.env.BANCADA_LAYA_URL;
  const python = process.env.BANCADA_PYTHON;
  const escolhido = executar ?? (url ? executarPorHttp(url) : python ? executarNoPython(python) : undefined);
  if (!escolhido) return "Laya: não medido (nem BANCADA_LAYA_URL nem BANCADA_PYTHON definido).";
  const pedidos = pedidosDoFiltro(itens, vocabulario);
  const entrada = JSON.stringify({ pedidos: pedidos.map((p) => ({ estado: p.estado, perguntas: p.perguntas })), aquecimento: AQUECIMENTO, concorrencias: CONCORRENCIAS });
  const r = SaidaDoLaya.parse(JSON.parse(await escolhido(entrada)));
  const porConcorrencia = new Map<number, Registro[]>();
  const nucleos: string[] = [];
  for (const [n, c] of Object.entries(r.por_concorrencia)) {
    porConcorrencia.set(
      Number(n),
      c.resultados.map((x) => {
        const pedido = pedidos[x.i];
        if (!pedido) throw new Error(`laya_local.py respondeu a um pedido que não existe: ${x.i}`);
        return registro(pedido, x);
      }),
    );
    nucleos.push(`${n} chamada(s): ${c.nucleos_ocupados.toFixed(2)}`);
  }
  return [
    `Modelo: ${r.modelo}, pacote laya ${r.versao}, CPU. Carregamento: ${r.carregamento_s === null ? "antes da medida, quando o serviço subiu" : `${r.carregamento_s.toFixed(1)} s`}. Memória máxima do processo: ${Math.round(r.memoria_mb)} MB. Núcleos ocupados: ${nucleos.join("; ")}. ${AQUECIMENTO} pedidos de aquecimento, fora da tabela.`,
    "",
    tabelaDoFiltro(porConcorrencia),
  ].join("\n");
}
