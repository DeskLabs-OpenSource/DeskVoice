/** O Laya com o ajudante Python trocado por um falso: os mesmos pedidos do Jev, e a mesma conta. */
import { describe, expect, it } from "vitest";
import { carregarConjunto, vocabularioDoConjunto } from "../conjunto";
import { carregarFiltro, pedidosDoFiltro, type ItemDoFiltro } from "../filtro";
import { corpoDoPedido } from "./jev";
import { executarPorHttp, medirLaya } from "./laya";

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

  it("sem BANCADA_LAYA_URL nem BANCADA_PYTHON não mede", async () => {
    const anterior = { python: process.env.BANCADA_PYTHON, url: process.env.BANCADA_LAYA_URL };
    delete process.env.BANCADA_PYTHON;
    delete process.env.BANCADA_LAYA_URL;
    try {
      expect(await medirLaya(itens, vocabulario)).toBe("Laya: não medido (nem BANCADA_LAYA_URL nem BANCADA_PYTHON definido).");
    } finally {
      if (anterior.python !== undefined) process.env.BANCADA_PYTHON = anterior.python;
      if (anterior.url !== undefined) process.env.BANCADA_LAYA_URL = anterior.url;
    }
  });
});

describe("medirLaya contra o serviço (fatia 8a)", () => {
  /** O serviço de deploy/laya/ falso: `/health` com o tempo de CPU que cresce a cada pedido, e `/v1/decide`. */
  function servicoFalso(responder: (corpo: { state: string; questions: Record<string, { type: string }> }) => Response) {
    const chamadas: Array<{ url: string; corpo?: unknown }> = [];
    let cpu = 10;
    const buscar = (async (url: string, init?: RequestInit) => {
      const corpo = init?.body ? JSON.parse(String(init.body)) : undefined;
      chamadas.push({ url, corpo });
      if (url.endsWith("/health")) return Response.json({ ok: true, model: "convaiinnovations/laya/multilingual", revision: "e333cb7", package: "0.4.31", cpu_s: cpu, max_rss_mb: 2300 });
      cpu += 0.05;
      return responder(corpo);
    }) as unknown as typeof fetch;
    return { buscar, chamadas };
  }
  const certo = (corpo: { questions: Record<string, { type: string }> }) =>
    Response.json({ model: "m", answers: Object.fromEntries(Object.entries(corpo.questions).map(([nome, q]) => [nome, q.type === "choice" ? { type: "choice", choice: "Melgaço", confidence: 0.9 } : { type: "noul", noul: 0.9 }])) });

  it("manda ao /v1/decide os mesmos pedidos que o Jev recebe, e a tabela é a mesma do ajudante", async () => {
    const { buscar, chamadas } = servicoFalso(certo);
    const tabela = await medirLaya(itens, vocabulario, executarPorHttp("http://laya.teste:8000/", buscar));
    const pedidos = pedidosDoFiltro(itens, vocabulario);
    const decididos = chamadas.filter((c) => c.url === "http://laya.teste:8000/v1/decide").map((c) => c.corpo as { state: string; questions: unknown });
    // 3 de aquecimento, depois 1 linha e 3 linhas, cada uma com todos os pedidos.
    expect(decididos).toHaveLength(3 + pedidos.length * (1 + 3));
    expect(decididos.slice(3, 3 + pedidos.length).map((c) => corpoDoPedido({ estado: c.state, perguntas: c.questions } as never))).toEqual(pedidos.map((p) => corpoDoPedido(p)));
    expect(tabela).toContain("Modelo: convaiinnovations/laya/multilingual@e333cb7 (serviço em http://laya.teste:8000), pacote laya 0.4.31");
    expect(tabela).toContain("Carregamento: antes da medida, quando o serviço subiu.");
    expect(tabela).toContain("Memória máxima do processo: 2300 MB");
    expect(tabela).toContain("| 1 | leitura | 1 | 1/1 (100%) | 1/1 (100%) |");
    expect(tabela).toMatch(/Núcleos ocupados: 1 chamada\(s\): \d+\.\d\d; 3 chamada\(s\): \d+\.\d\d/);
  });

  it("o serviço ocupado ou fora da forma conta como falha do pedido, com o status", async () => {
    const { buscar } = servicoFalso(() => Response.json({ error: "busy" }, { status: 503 }));
    const tabela = await medirLaya(itens.slice(0, 1), vocabulario, executarPorHttp("http://laya.teste:8000", buscar));
    expect(tabela).toContain("erro do Laya (HTTP 503 busy)");
  });

  it("serviço que não responde ao /health para a medida, em vez de medir nada", async () => {
    const buscar = (async () => Response.json({ ok: false, error: "loading" }, { status: 503 })) as unknown as typeof fetch;
    await expect(medirLaya(itens, vocabulario, executarPorHttp("http://laya.teste:8000", buscar))).rejects.toThrow();
  });
});
