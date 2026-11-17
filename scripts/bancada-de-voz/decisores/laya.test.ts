/** O Laya com o ajudante Python trocado por um falso: os mesmos pedidos do Jev, e a mesma conta. */
import { describe, expect, it } from "vitest";
import { carregarConjunto, vocabularioDoConjunto } from "../conjunto";
import { carregarFiltro, pedidosDoFiltro, type ItemDoFiltro } from "../filtro";
import { corpoDoPedido } from "./jev";
import { medirLaya } from "./laya";

const vocabulario = vocabularioDoConjunto(carregarConjunto());
const filtro = carregarFiltro(vocabulario).itens;
const itens = ["leitura-02", "fundo-13", "terminou-13"].map((id) => filtro.find((i) => i.id === id) as ItemDoFiltro);

interface Entrada {
  pedidos: { estado: string; perguntas: Record<string, { type: string; criteria?: Record<string, string> }> }[];
  aquecimento: number;
  concorrencias: number[];
}

describe("medirLaya", () => {
  it("manda ao ajudante os mesmos pedidos que o Jev recebe, e conta o acerto pela mesma regra", async () => {
    let recebida: Entrada | null = null;
    const tabela = await medirLaya(itens, vocabulario, async (texto) => {
      const entrada = JSON.parse(texto) as Entrada;
      recebida = entrada;
      // Responde como o Laya (com campos a mais): certo em tudo, menos o "fundo" de fundo-13.
      const resultados = entrada.pedidos.map((p, i) => {
        const respostas: Record<string, unknown> = {};
        for (const [nome, q] of Object.entries(p.perguntas)) {
          if (q.type === "choice") respostas[nome] = { type: "choice", choice: "Melgaço", confidence: 0.9, answer_confidence: 0.9, probabilities: {} };
          else respostas[nome] = { type: "noul", noul: 0.9, confidence: 0.9 };
        }
        return { i, ms: 40, respostas };
      });
      return JSON.stringify({ versao: "0.0-falso", modelo: "laya falso", carregamento_s: 1, memoria_mb: 100, por_concorrencia: { "1": { nucleos_ocupados: 1, resultados } } });
    });
    const pedidos = pedidosDoFiltro(itens, vocabulario);
    const entrada = recebida as unknown as Entrada;
    expect(entrada.aquecimento).toBe(3);
    expect(entrada.concorrencias).toEqual([1, 3]);
    // Mesmo estado e mesmas perguntas, byte a byte, que o corpo do Jev.
    expect(entrada.pedidos.map((p) => corpoDoPedido(p))).toEqual(pedidos.map((p) => corpoDoPedido(p)));
    expect(tabela).toContain("| 1 | leitura | 1 | 1/1 (100%) | 1/1 (100%) | 40 / 40 | 40 / 40 | 0 |");
    // fundo-13 é rádio; 0,9 de "é de quem liga" é erro, e o terminou-13 é pausa: 0,9 de "terminou" é erro.
    expect(tabela).toContain("| 1 | fundo | 1 | 0/1 (0%) | 0/1 (0%) |");
    expect(tabela).toContain("| 1 | terminou | 1 | 0/1 (0%) | 0/1 (0%) |");
    expect(tabela).toContain("Núcleos ocupados: 1 chamada(s): 1.00");
  });

  it("resposta fora do esquema, ou erro do ajudante num pedido, conta como falha", async () => {
    const tabela = await medirLaya(itens.slice(0, 1), vocabulario, async () =>
      JSON.stringify({
        versao: "0",
        modelo: "laya falso",
        carregamento_s: 1,
        memoria_mb: 1,
        por_concorrencia: { "1": { nucleos_ocupados: 1, resultados: [{ i: 0, ms: 10, erro: "RuntimeError" }, { i: 1, ms: 10, respostas: { leitura: { type: "noul", noul: 0.5 } } }] } },
      }),
    );
    expect(tabela).toContain("1× erro do Laya (RuntimeError)");
    expect(tabela).toContain("1× sem resposta do tipo pedido para leitura");
  });

  it("sem BANCADA_PYTHON não mede", async () => {
    const anterior = process.env.BANCADA_PYTHON;
    delete process.env.BANCADA_PYTHON;
    try {
      expect(await medirLaya(itens, vocabulario)).toBe("Laya: não medido (BANCADA_PYTHON não definido).");
    } finally {
      if (anterior !== undefined) process.env.BANCADA_PYTHON = anterior;
    }
  });
});
