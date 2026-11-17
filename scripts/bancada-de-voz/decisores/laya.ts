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
  carregamento_s: z.number(),
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

/** Roda a medida e devolve a tabela em Markdown. Sem `BANCADA_PYTHON` (e sem `executar`), diz que não mediu. */
export async function medirLaya(itens: readonly ItemDoFiltro[], vocabulario: readonly string[], executar?: Executar): Promise<string> {
  const python = process.env.BANCADA_PYTHON;
  if (!executar && !python) return "Laya: não medido (BANCADA_PYTHON não definido).";
  const pedidos = pedidosDoFiltro(itens, vocabulario);
  const entrada = JSON.stringify({ pedidos: pedidos.map((p) => ({ estado: p.estado, perguntas: p.perguntas })), aquecimento: AQUECIMENTO, concorrencias: CONCORRENCIAS });
  const r = SaidaDoLaya.parse(JSON.parse(await (executar ?? executarNoPython(python as string))(entrada)));
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
    `Modelo: ${r.modelo}, pacote laya ${r.versao}, CPU. Carregamento: ${r.carregamento_s.toFixed(1)} s. Memória máxima do processo: ${Math.round(r.memoria_mb)} MB. Núcleos ocupados: ${nucleos.join("; ")}. ${AQUECIMENTO} pedidos de aquecimento, fora da tabela.`,
    "",
    tabelaDoFiltro(porConcorrencia),
  ].join("\n");
}
