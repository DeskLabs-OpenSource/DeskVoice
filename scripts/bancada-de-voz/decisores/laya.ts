/**
 * Laya na bancada: só CPU e latência, na VPS, com as três perguntas fixas do desenho da R12
 * (fundo, fim do pensamento, leitura certa). O acerto das perguntas é da fatia 6.
 *
 * O Laya é Python sobre PyTorch. Roda em `laya_local.py`, num venv à parte, fora do repositório e do
 * produto (entrar no produto é a decisão 3 da DESA-25). O estado de cada pergunta é a frase do
 * manifesto, como se a transcrição tivesse acertado: o que se mede aqui é o tempo, não a leitura.
 *
 * Fontes, conferidas em 14/11/2026: huggingface.co/convaiinnovations/laya (cartão e licença
 * Apache 2.0) e o pacote `laya` no PyPI (Apache 2.0).
 * Ambiente: BANCADA_PYTHON (venv com `laya` e `torch` de CPU). Os pesos baixam no primeiro uso.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { Frase } from "../conjunto";

const AJUDANTE = fileURLToPath(new URL("./laya_local.py", import.meta.url));

interface PorConcorrencia {
  chamadas: number;
  passada_p50_ms: number | null;
  passada_p95_ms: number | null;
  pergunta_p50_ms: number | null;
  pergunta_p95_ms: number | null;
  nucleos_ocupados: number;
}

interface SaidaDoLaya {
  versao: string;
  modelo: string;
  carregamento_s: number;
  memoria_mb: number;
  por_concorrencia: Record<string, PorConcorrencia>;
}

const ms = (v: number | null): string => (v === null ? "—" : String(Math.round(v)));

/** Roda a medida e devolve a tabela em Markdown. Sem `BANCADA_PYTHON`, diz que não mediu. */
export async function medirLaya(frases: readonly Frase[], vocabulario: readonly string[]): Promise<string> {
  const python = process.env.BANCADA_PYTHON;
  if (!python) return "Laya: não medido (BANCADA_PYTHON não definido).";
  const saida = await new Promise<string>((resolve, reject) => {
    const filho = spawn(python, [AJUDANTE], { stdio: ["pipe", "pipe", "pipe"] });
    let texto = "";
    let erro = "";
    filho.stdout.on("data", (d: Buffer) => (texto += d.toString()));
    filho.stderr.on("data", (d: Buffer) => (erro += d.toString()));
    filho.on("exit", (codigo) => (codigo === 0 ? resolve(texto) : reject(new Error(`laya_local.py saiu com ${codigo}: ${erro.slice(-500)}`))));
    filho.stdin.end(JSON.stringify({ frases: frases.map((f) => f.texto), vocabulario, concorrencias: [1, 3] }));
  });
  const r = JSON.parse(saida) as SaidaDoLaya;
  const linhas = [
    `Modelo: ${r.modelo}, pacote laya ${r.versao}, CPU. Carregamento: ${r.carregamento_s.toFixed(1)} s. Memória máxima do processo: ${Math.round(r.memoria_mb)} MB.`,
    "",
    "| Chamadas simultâneas | Passadas medidas | Passada de 3 perguntas p50/p95 (ms) | Uma pergunta p50/p95 (ms) | Núcleos ocupados |",
    "|---:|---:|---:|---:|---:|",
    ...Object.entries(r.por_concorrencia).map(
      ([n, c]) => `| ${n} | ${c.chamadas} | ${ms(c.passada_p50_ms)} / ${ms(c.passada_p95_ms)} | ${ms(c.pergunta_p50_ms)} / ${ms(c.pergunta_p95_ms)} | ${c.nucleos_ocupados.toFixed(2)} |`,
    ),
  ];
  return linhas.join("\n");
}
