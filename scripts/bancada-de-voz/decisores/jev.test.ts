/**
 * O Jev contra um servidor HTTP falso, em porta 0, sem chave de verdade: o pedido (os mesmos do
 * Laya, de `filtro.ts`), a leitura da resposta por zod, o acerto por pergunta, o teto (também
 * quando o custo real passa do reservado) e a chave que não sai.
 */
import { once } from "node:events";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { carregarConjunto, vocabularioDoConjunto } from "../conjunto";
import { carregarFiltro, pedidosDoFiltro, type ItemDoFiltro } from "../filtro";
import { Orcamento } from "../orcamento";
import type { Relogio } from "../tempo-real";
import { corpoDoPedido, medirJev } from "./jev";

const CHAVE = "jev-chave-falsa-fedcba9876543210";

interface Recebido {
  autorizacao: string;
  corpo: { model: string; state: string; questions: Record<string, { type: string; instructions: string; criteria?: Record<string, string> }> };
}

const paradas: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(paradas.splice(0).map((p) => p()));
});

async function servidorFalso(responder: (r: Recebido, res: ServerResponse) => void): Promise<{ url: string; recebidos: Recebido[] }> {
  const recebidos: Recebido[] = [];
  const servidor = createServer((pedido: IncomingMessage, res) => {
    let corpo = "";
    pedido.on("data", (d: Buffer) => (corpo += d.toString()));
    pedido.on("end", () => {
      const r: Recebido = { autorizacao: pedido.headers.authorization ?? "", corpo: JSON.parse(corpo) as Recebido["corpo"] };
      recebidos.push(r);
      responder(r, res);
    });
  });
  servidor.listen(0, "127.0.0.1");
  await once(servidor, "listening");
  paradas.push(() => new Promise((resolve) => servidor.close(() => resolve())));
  return { url: `http://127.0.0.1:${(servidor.address() as AddressInfo).port}/v1/systemone`, recebidos };
}

function json(res: ServerResponse, status: number, corpo: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(corpo));
}

/**
 * Responde certo cada pergunta do item, pela resposta esperada. Com `errar`, os itens marcados
 * recebem a resposta errada na pergunta deles. As outras perguntas da passada recebem 0,9.
 */
function jevCerto(itens: readonly ItemDoFiltro[], tokens: number | ((r: Recebido) => number) = 100, errar: (i: ItemDoFiltro) => boolean = () => false) {
  return (r: Recebido, res: ServerResponse): void => {
    const item = itens.find((i) => r.corpo.state.endsWith(i.trecho));
    const answers: Record<string, unknown> = {};
    for (const [nome, q] of Object.entries(r.corpo.questions)) {
      const doItem = item?.tipo === nome;
      const erra = doItem && item !== undefined && errar(item);
      if (q.type === "noul") {
        const sim = doItem ? item?.esperado === "pessoa" || item?.esperado === "terminou" : true;
        answers[nome] = { type: "noul", noul: (erra ? !sim : sim) ? 0.9 : 0.1 };
      } else {
        const opcoes = Object.keys(q.criteria ?? {});
        const certa = doItem ? (item?.esperado ?? "nenhum") : "nenhum";
        const errada = opcoes.find((o) => o !== certa) ?? "nenhum";
        answers[nome] = { type: "choice", choice: erra ? errada : certa, confidence: 0.9, probabilities: {} };
      }
    }
    json(res, 200, { model: "jev-1.14.0", answers, usage: { input_tokens: typeof tokens === "number" ? tokens : tokens(r), output_tokens: 3 } });
  };
}

/** O custo de pior caso de um pedido, como a bancada estima: um token por byte do corpo. */
const piorCaso = (r: Recebido): number => Buffer.byteLength(JSON.stringify(r.corpo));

function relogioFalso(): Relogio {
  let agora = 0;
  return { agora: () => (agora += 50), esperarAte: async () => {} };
}

const vocabulario = vocabularioDoConjunto(carregarConjunto());
const filtro = carregarFiltro(vocabulario).itens;
/** Dois itens de cada pergunta, com as duas respostas esperadas de cada uma. */
const itens = ["leitura-02", "leitura-29", "fundo-01", "fundo-13", "terminou-01", "terminou-13"].map((id) => filtro.find((i) => i.id === id) as ItemDoFiltro);
const linha = (tabela: string, pergunta: string): string => tabela.split("\n").find((l) => l.startsWith(`| 1 | ${pergunta} |`)) ?? "";

describe("medirJev", () => {
  it("manda o modelo, o estado sintético e os pedidos do filtro, com a chave no cabeçalho; conta o acerto por pergunta e o gasto", async () => {
    const s = await servidorFalso(jevCerto(itens));
    const orcamento = new Orcamento(1);
    const tabela = await medirJev(itens, vocabulario, orcamento, { url: s.url, chave: CHAVE, relogio: relogioFalso(), concorrencias: [1] });

    // 3 de aquecimento + 6 itens × (1 passada + 1 pergunta sozinha).
    expect(s.recebidos).toHaveLength(3 + 6 * 2);
    expect(s.recebidos.every((r) => r.autorizacao === `Bearer ${CHAVE}`)).toBe(true);
    const pedidos = pedidosDoFiltro(itens, vocabulario);
    expect(s.recebidos.slice(3).map((r) => JSON.stringify(r.corpo))).toEqual(pedidos.map((p) => corpoDoPedido(p)));
    const primeira = s.recebidos[3] as Recebido;
    expect(primeira.corpo.model).toBe("jev-latest");
    expect(primeira.corpo.state).toBe(`Agente: ${itens[0]?.agente}\nPessoa: ${itens[0]?.trecho}`);
    expect(Object.keys(primeira.corpo.questions)).toEqual(["fundo", "terminou", "leitura"]);
    expect(Object.keys((s.recebidos[4] as Recebido).corpo.questions)).toEqual(["leitura"]);
    // A chave só vai no cabeçalho, nunca no corpo.
    expect(JSON.stringify(s.recebidos.map((r) => r.corpo))).not.toContain(CHAVE);

    expect(tabela).toContain("modelo que respondeu: jev-1.14.0");
    for (const p of ["leitura", "fundo", "terminou"]) expect(linha(tabela, p)).toMatch(new RegExp(`^\\| 1 \\| ${p} \\| 2 \\| 2/2 \\(100%\\) \\| 2/2 \\(100%\\) \\| 50 / 50 \\| 50 / 50 \\| 0 \\|$`));
    expect(tabela).toContain("fala de quem liga marcada como fundo com confiança ≥ 0.8: 0 de 1 (passada), 0 de 1 (sozinha).");
    // 15 pedidos de 100 tokens a US$ 0,042 por milhão.
    expect(orcamento.porServico()).toEqual([["jev", expect.closeTo((15 * 100 * 0.042) / 1e6, 12)]]);
    expect(tabela).not.toContain(CHAVE);
  });

  it("conta a resposta errada como errada, em cada pergunta", async () => {
    // Erra o primeiro item de cada pergunta: 1 de 2 em cada uma.
    const erradas = new Set(["leitura-02", "fundo-01", "terminou-01"]);
    const s = await servidorFalso(jevCerto(itens, 100, (i) => erradas.has(i.id)));
    const tabela = await medirJev(itens, vocabulario, new Orcamento(1), { url: s.url, chave: CHAVE, relogio: relogioFalso(), concorrencias: [1] });
    for (const p of ["leitura", "fundo", "terminou"]) expect(linha(tabela, p)).toContain("| 1/2 (50%) | 1/2 (50%) |");
    // fundo-01 é de quem liga, e o falso disse "fundo" com 0,9: é o fracasso que a tabela conta à parte.
    expect(tabela).toContain("fala de quem liga marcada como fundo com confiança ≥ 0.8: 1 de 1 (passada), 1 de 1 (sozinha).");
    // leitura-02 recebeu outro termo com 0,9: trocaria errado.
    expect(tabela).toContain("leitura que trocaria por um termo errado com confiança ≥ 0.8: 1 de 2 (passada), 1 de 2 (sozinha).");
  });

  it("resposta recusada, fora do esquema, ou sem a pergunta pedida conta como falha, com o motivo", async () => {
    let n = 0;
    const s = await servidorFalso((r, res) => {
      n++;
      if (n <= 3) return jevCerto(itens)(r, res);
      if (n % 3 === 0) return json(res, 422, { detail: [{ loc: ["body"], msg: `chave ${CHAVE}` }] });
      if (n % 3 === 1) return json(res, 200, { model: "jev", answers: { fundo: { type: "noul", noul: 2 } }, usage: { input_tokens: 1, output_tokens: 0 } });
      return json(res, 200, { model: "jev", answers: {}, usage: { input_tokens: 1, output_tokens: 0 } });
    });
    const tabela = await medirJev(itens.slice(0, 2), vocabulario, new Orcamento(1), { url: s.url, chave: CHAVE, relogio: relogioFalso(), concorrencias: [1] });
    expect(tabela).toContain("HTTP 422");
    expect(tabela).toContain("resposta fora do esquema (answers.fundo.noul)");
    expect(tabela).toMatch(/sem resposta do tipo pedido para (fundo|terminou|leitura)/);
    expect(linha(tabela, "leitura")).toContain("| — | — |");
    expect(tabela).not.toContain(CHAVE);
  });

  it("para antes de passar do teto e diz quanto gastou", async () => {
    // O pior caso que o serviço pode cobrar: um token por byte do corpo, que é a estimativa da bancada.
    const s = await servidorFalso(jevCerto(itens, piorCaso));
    // Cabem uns 8 pedidos de pior caso: o aquecimento e um pedaço da fase de 1.
    const teto = 8.5 * Math.max(...pedidosDoFiltro(itens, vocabulario).map((p) => Buffer.byteLength(corpoDoPedido(p)))) * 0.042e-6;
    const orcamento = new Orcamento(teto);
    const tabela = await medirJev(itens, vocabulario, orcamento, { url: s.url, chave: CHAVE, relogio: relogioFalso() });
    expect(s.recebidos.length).toBeGreaterThan(3);
    expect(s.recebidos.length).toBeLessThan(3 + 6 * 2 * 4);
    expect(orcamento.gasto).toBeLessThanOrEqual(teto);
    expect(orcamento.excesso).toBe(0);
    expect(tabela).toContain(`Jev: parou no teto (US$ ${orcamento.gasto.toFixed(4)} gastos) antes de terminar.`);
    expect(tabela).toContain(`Gasto do Jev: US$ ${orcamento.gasto.toFixed(6)}`);
  });

  it("um pedido que custa mais que o reservado: nenhum pedido novo sai, e a medida diz quanto passou", async () => {
    // O quinto pedido cobra o dobro do pior caso reservado; os outros, 10 tokens.
    let n = 0;
    let excesso = 0;
    const s = await servidorFalso((r, res) => {
      n++;
      const tokens = n === 5 ? 2 * piorCaso(r) : 10;
      if (n === 5) excesso = (piorCaso(r) * 0.042) / 1e6;
      jevCerto(itens, tokens)(r, res);
    });
    const orcamento = new Orcamento(1);
    const tabela = await medirJev(itens, vocabulario, orcamento, { url: s.url, chave: CHAVE, relogio: relogioFalso(), concorrencias: [1] });
    // O teto (US$ 1) estava longe: quem parou foi o excesso, logo depois do quinto pedido.
    expect(s.recebidos).toHaveLength(5);
    expect(orcamento.excesso).toBeCloseTo(excesso, 12);
    expect(tabela).toContain(`Jev: parou porque o custo real passou do pior caso reservado em US$ ${excesso.toFixed(6)} (US$ ${orcamento.gasto.toFixed(4)} gastos) antes de terminar.`);
  });

  it("com 3 chamadas em voo, o excesso de uma não deixa as outras abrirem pedido novo, e a tabela só sai depois que as em voo voltam", async () => {
    let n = 0;
    const s = await servidorFalso((r, res) => {
      n++;
      const tokens = n === 6 ? 3 * piorCaso(r) : 10;
      setTimeout(() => jevCerto(itens, tokens)(r, res), 15);
    });
    const orcamento = new Orcamento(1);
    const tabela = await medirJev(itens, vocabulario, orcamento, { url: s.url, chave: CHAVE, relogio: relogioFalso(), concorrencias: [3] });
    const pedidos = s.recebidos.length;
    // 3 de aquecimento + as 3 primeiras em voo; a 6ª passa do reservado, e só as que já estavam em voo terminam.
    expect(pedidos).toBeGreaterThanOrEqual(6);
    expect(pedidos).toBeLessThanOrEqual(8);
    expect(orcamento.excesso).toBeGreaterThan(0);
    expect(tabela).toContain("parou porque o custo real passou do pior caso reservado");
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(s.recebidos.length).toBe(pedidos);
    expect(tabela).toContain(`Gasto do Jev: US$ ${orcamento.gasto.toFixed(6)}`);
  });

  it("com 3 chamadas simultâneas, o teto não estoura, e a tabela só sai depois que todas voltam", async () => {
    const s = await servidorFalso((r, res) => void setTimeout(() => jevCerto(itens, piorCaso)(r, res), 15));
    const corpos = pedidosDoFiltro(itens, vocabulario).map((p) => Buffer.byteLength(corpoDoPedido(p)));
    // O aquecimento cabe, e a fase de 3 bate no teto no meio, uns 6 pedidos depois.
    const teto = (corpos.slice(0, 3).reduce((a, b) => a + b, 0) + 6.5 * Math.max(...corpos)) * 0.042e-6;
    const orcamento = new Orcamento(teto);
    const tabela = await medirJev(itens, vocabulario, orcamento, { url: s.url, chave: CHAVE, relogio: relogioFalso(), concorrencias: [3] });
    const pedidos = s.recebidos.length;
    const gasto = orcamento.gasto;
    expect(pedidos).toBeGreaterThan(3 + 3);
    expect(pedidos).toBeLessThan(3 + 3 * 6 * 2);
    expect(tabela).toContain("| 3 |");
    expect(tabela).toContain("Jev: parou no teto");
    expect(gasto).toBeLessThanOrEqual(teto);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(s.recebidos.length).toBe(pedidos);
    expect(orcamento.gasto).toBe(gasto);
    expect(tabela).toContain(`Gasto do Jev: US$ ${gasto.toFixed(6)}`);
  });

  it("a reserva de cada pedido volta quando a resposta chega: o teto conta o gasto real, e não a soma das estimativas", async () => {
    const s = await servidorFalso(jevCerto(itens, 10));
    const maior = Math.max(...pedidosDoFiltro(itens, vocabulario).map((p) => Buffer.byteLength(corpoDoPedido(p))));
    const orcamento = new Orcamento(3 * maior * 0.042e-6);
    const tabela = await medirJev(itens, vocabulario, orcamento, { url: s.url, chave: CHAVE, relogio: relogioFalso(), concorrencias: [1] });
    expect(s.recebidos).toHaveLength(3 + 6 * 2);
    expect(tabela).not.toContain("parou");
    expect(orcamento.gasto).toBeCloseTo((15 * 10 * 0.042) / 1e6, 12);
  });

  it("sem a chave não mede e não pede nada", async () => {
    const s = await servidorFalso(jevCerto(itens));
    const anterior = process.env.JEV_API_KEY;
    delete process.env.JEV_API_KEY;
    try {
      expect(await medirJev(itens, vocabulario, new Orcamento(1), { url: s.url })).toBe("Jev: não medido (JEV_API_KEY não definido).");
    } finally {
      if (anterior !== undefined) process.env.JEV_API_KEY = anterior;
    }
    expect(s.recebidos).toHaveLength(0);
  });
});
