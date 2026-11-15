/**
 * O Jev contra um servidor HTTP falso, em porta 0, sem chave de verdade: o pedido, as perguntas
 * (as mesmas do Laya), a leitura da resposta por zod, o acerto da leitura, o teto e a chave que
 * não sai.
 */
import { once } from "node:events";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { carregarConjunto, vocabularioDoConjunto, type Frase } from "../conjunto";
import { Orcamento } from "../orcamento";
import type { Relogio } from "../tempo-real";
import { leiturasCertas, medirJev, perguntas, semelhanca } from "./jev";

const CHAVE = "jev-chave-falsa-fedcba9876543210";

/** As opções da leitura que o `laya_local.py` monta para cada frase do conjunto (gerado com o `difflib` do Python 3). */
const OPCOES_DO_LAYA: Record<string, string[]> = {"nome-01": ["Rafael", "Melgaço", "Joaquim", "Iracema"], "nome-02": ["Iracema", "Tupinambá", "Rafael", "Heitor"], "nome-03": ["Joaquim", "Assunção", "Lúcia", "Rafael"], "nome-04": ["Heitor", "Bragança", "Joaquim", "Vivacor"], "nome-05": ["Conceição", "Araújo", "Assunção", "Iracema"], "nome-06": ["Thiago", "Gonçalves", "Magalhães", "Botafogo"], "empresa-01": ["DeskVoice", "Rafael", "Joaquim", "Mossoró"], "empresa-02": ["Magazine Ipiranga", "Magalhães", "Melgaço", "Assunção"], "empresa-03": ["Tapajós", "Heitor", "Rafael", "Mossoró"], "empresa-04": ["Vivacor", "Thiago", "Melgaço", "Assunção"], "empresa-05": ["São Benedito", "Heitor", "Assunção", "Vivacor"], "numero-01": ["Tupinambá", "Araújo", "Thiago", "Iracema"], "numero-02": ["Heitor", "Itaquaquecetuba", "São Benedito", "Botafogo"], "numero-03": ["Mossoró", "Assunção", "Tapajós", "Joaquim"], "numero-04": ["Heitor", "Vivacor", "São Benedito", "Botafogo"], "numero-05": ["Botafogo", "Heitor", "Conceição", "Gonçalves"], "lugar-01": ["Itaquaquecetuba", "Heitor", "Mossoró", "Melgaço"], "lugar-02": ["Mossoró", "Rafael", "Iracema", "Heitor"], "lugar-03": ["Paranapiacaba", "Melgaço", "Heitor", "Lúcia"], "lugar-04": ["Botafogo", "Voluntários da Pátria", "Thiago", "Rafael"], "lugar-05": ["Chapecó", "Joinville", "Araújo", "Botafogo"], "geral-01": ["Araújo", "Iracema", "Paranapiacaba", "Joaquim"], "geral-02": ["Melgaço", "Assunção", "DeskVoice", "Bragança"], "geral-03": ["Melgaço", "Assunção", "Lúcia", "Conceição"]};

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

/** Responde certo: a leitura escolhe o primeiro termo da frase que está entre as opções. */
function jevCerto(frases: readonly Frase[], tokens: number | ((r: Recebido) => number) = 100) {
  return (r: Recebido, res: ServerResponse): void => {
    const frase = frases.find((f) => r.corpo.state.endsWith(f.texto));
    const answers: Record<string, unknown> = {};
    for (const [nome, q] of Object.entries(r.corpo.questions)) {
      if (q.type === "noul") answers[nome] = { type: "noul", noul: 0.9 };
      else {
        const opcoes = Object.keys(q.criteria ?? {});
        answers[nome] = { type: "choice", choice: frase?.termos.find((t) => opcoes.includes(t)) ?? "nenhum", confidence: 0.8, probabilities: {} };
      }
    }
    json(res, 200, { model: "jev-1.14.0", answers, usage: { input_tokens: typeof tokens === "number" ? tokens : tokens(r), output_tokens: 3 } });
  };
}

function relogioFalso(): Relogio {
  let agora = 0;
  return { agora: () => (agora += 50), esperarAte: async () => {} };
}

const conjunto = carregarConjunto();
const vocabulario = vocabularioDoConjunto(conjunto);

describe("as perguntas do Jev são as do Laya", () => {
  it("semelhança igual à ratio() do difflib", () => {
    const pares: [string, string, number][] = [["melgaço", "melgaço,", 0.933333], ["rafael", "aqui", 0.2], ["tupinambá", "tupinambá?", 0.947368], ["deskvoice", "desk", 0.615385], ["abcd", "bcda", 0.75], ["assunção", "assim", 0.461538]];
    for (const [a, b, esperado] of pares) expect(semelhanca(a, b)).toBeCloseTo(esperado, 5);
    expect(semelhanca("", "")).toBe(1);
  });

  it("as opções da leitura de cada frase do conjunto saem iguais às do laya_local.py", () => {
    for (const frase of conjunto.frases) {
      const leitura = perguntas(frase.texto, vocabulario).leitura;
      expect(leitura?.type).toBe("choice");
      if (leitura?.type !== "choice") continue;
      expect(Object.keys(leitura.criteria), frase.id).toEqual([...(OPCOES_DO_LAYA[frase.id] ?? []), "nenhum"]);
    }
  });

  it("a leitura certa é um termo da frase entre as opções, ou 'nenhum'", () => {
    const comTermo = conjunto.frases.find((f) => f.id === "nome-01") as Frase;
    expect([...leiturasCertas(comTermo, { Rafael: "", Melgaço: "", Joaquim: "", nenhum: "" })]).toEqual(["Rafael", "Melgaço"]);
    expect([...leiturasCertas({ ...comTermo, termos: [] }, { Rafael: "", nenhum: "" })]).toEqual(["nenhum"]);
  });
});

describe("medirJev", () => {
  const frases = conjunto.frases.slice(0, 6);

  it("manda o modelo, o estado sintético e as três perguntas, com a chave no cabeçalho; conta o acerto e o gasto", async () => {
    const s = await servidorFalso(jevCerto(frases));
    const orcamento = new Orcamento(1);
    const tabela = await medirJev(frases, vocabulario, orcamento, { url: s.url, chave: CHAVE, relogio: relogioFalso(), concorrencias: [1] });

    // 3 de aquecimento + 6 frases × (1 passada + 3 perguntas sozinhas).
    expect(s.recebidos).toHaveLength(3 + 6 * 4);
    expect(s.recebidos.every((r) => r.autorizacao === `Bearer ${CHAVE}`)).toBe(true);
    const primeira = s.recebidos[3] as Recebido;
    expect(primeira.corpo.model).toBe("jev-latest");
    expect(primeira.corpo.state).toBe(`Agente: Em que posso ajudar?\nPessoa: ${frases[0]?.texto}`);
    expect(Object.keys(primeira.corpo.questions)).toEqual(["fundo", "terminou", "leitura"]);
    expect(primeira.corpo.questions).toEqual(perguntas(frases[0]?.texto ?? "", vocabulario));
    // A chave só vai no cabeçalho, nunca no corpo.
    expect(JSON.stringify(s.recebidos.map((r) => r.corpo))).not.toContain(CHAVE);

    expect(tabela).toContain("modelo que respondeu: jev-1.14.0");
    expect(tabela).toMatch(/\| 1 \| 6 \| 50 \/ 50 \| 50 \/ 50 \| 6\/6 \(100%\) \| 0\.90 \| 0\.90 \| 0 \|/);
    // 27 pedidos de 100 tokens a US$ 0,042 por milhão.
    expect(orcamento.porServico()).toEqual([["jev", expect.closeTo((27 * 100 * 0.042) / 1e6, 12)]]);
    expect(tabela).not.toContain(CHAVE);
  });

  it("resposta recusada, fora do esquema, ou sem a pergunta pedida conta como falha, com o motivo", async () => {
    let n = 0;
    const s = await servidorFalso((r, res) => {
      n++;
      // Com uma frase só, o aquecimento é um pedido.
      if (n === 1) return jevCerto(frases)(r, res);
      if (n % 3 === 0) return json(res, 422, { detail: [{ loc: ["body"], msg: `chave ${CHAVE}` }] });
      if (n % 3 === 1) return json(res, 200, { model: "jev", answers: { fundo: { type: "noul", noul: 2 } }, usage: { input_tokens: 1, output_tokens: 0 } });
      return json(res, 200, { model: "jev", answers: {}, usage: { input_tokens: 1, output_tokens: 0 } });
    });
    const tabela = await medirJev(frases.slice(0, 1), vocabulario, new Orcamento(1), { url: s.url, chave: CHAVE, relogio: relogioFalso(), concorrencias: [1] });
    expect(tabela).toContain("HTTP 422");
    expect(tabela).toContain("resposta fora do esquema (answers.fundo.noul)");
    expect(tabela).toMatch(/sem resposta do tipo pedido para (fundo|terminou|leitura)/);
    expect(tabela).not.toContain(CHAVE);
  });

  it("para antes de passar do teto e diz quanto gastou", async () => {
    // O pior caso que o serviço pode cobrar: um token por byte do corpo, que é a estimativa da bancada.
    const s = await servidorFalso(jevCerto(frases, (r) => Buffer.byteLength(JSON.stringify(r.corpo))));
    const teto = 1e-4;
    const orcamento = new Orcamento(teto);
    const tabela = await medirJev(frases, vocabulario, orcamento, { url: s.url, chave: CHAVE, relogio: relogioFalso() });
    expect(s.recebidos.length).toBeGreaterThan(0);
    expect(s.recebidos.length).toBeLessThan(3 + 6 * 4);
    expect(orcamento.gasto).toBeLessThanOrEqual(teto);
    // O próximo pedido teria passado do teto.
    const custoDoMaior = Math.max(...s.recebidos.map((r) => Buffer.byteLength(JSON.stringify(r.corpo)))) * 0.042e-6;
    expect(orcamento.gasto + custoDoMaior).toBeGreaterThan(teto - custoDoMaior);
    expect(tabela).toContain(`Jev: parou no teto (US$ ${orcamento.gasto.toFixed(4)} gastos na rodada) antes de terminar.`);
    expect(tabela).toContain(`Gasto do Jev: US$ ${orcamento.gasto.toFixed(6)}`);
  });

  it("sem a chave não mede e não pede nada", async () => {
    const s = await servidorFalso(jevCerto(frases));
    const anterior = process.env.JEV_API_KEY;
    delete process.env.JEV_API_KEY;
    try {
      expect(await medirJev(frases, vocabulario, new Orcamento(1), { url: s.url })).toBe("Jev: não medido (JEV_API_KEY não definido).");
    } finally {
      if (anterior !== undefined) process.env.JEV_API_KEY = anterior;
    }
    expect(s.recebidos).toHaveLength(0);
  });
});
