import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MAX_AGENT_HANDOFFS_PER_CALL } from "@deskvoice/tools";
import { describe, expect, it } from "vitest";
import enAgents from "../i18n/en/agents";
import esAgents from "../i18n/es/agents";
import ptBRAgents from "../i18n/pt-BR/agents";
import ptBR from "../i18n/pt-BR/timeline";
import { Timeline } from "./timeline";

const sha256 = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";

describe("linha do tempo", () => {
  it("a gravação fechada mostra o tamanho e o começo da impressão digital, com a inteira à mão", () => {
    const html = renderToStaticMarkup(
      createElement(Timeline, {
        events: [{ id: "1", kind: "recording_saved", at: "2026-11-15T12:00:00.000Z", payload: { bytes: 1_920_044, sha256 } }],
        live: false,
        agentName: "Ana",
      }),
    );
    expect(html).toContain("Gravação fechada: 1,9 MB, impressão digital 9f86d081884c…");
    expect(html).toContain(sha256);
    expect(html).not.toContain(ptBR.events.unknown);
  });

  it("a gravação fechada sem impressão digital diz que ela não pôde ser calculada, e que o áudio está salvo (issue 278)", () => {
    const html = renderToStaticMarkup(
      createElement(Timeline, {
        events: [{ id: "1", kind: "recording_saved", at: "2026-11-15T12:00:00.000Z", payload: { bytes: 1_920_044, sha256: null } }],
        live: false,
        agentName: "Ana",
      }),
    );
    expect(html).toContain("Gravação fechada: 1,9 MB. A impressão digital não pôde ser calculada; o áudio está salvo do mesmo jeito.");
    expect(html).not.toContain("SHA-256");
    expect(html).not.toContain(ptBR.events.unknown);
  });
  describe("a passagem entre agentes (fatia 4b)", () => {
    const from = { id: "a-1", name: "Recepção" };
    const to = { id: "a-2", name: "Vendas" };
    const at = "2026-11-16T12:00:00.000Z";
    const render = (handoff: Record<string, unknown>) =>
      renderToStaticMarkup(
        createElement(Timeline, {
          events: [
            { id: "1", kind: "transcript_agent", at, payload: { text: "Vou passar para vendas." } },
            { id: "2", kind: "agent_handoff", at, payload: handoff },
            { id: "3", kind: "transcript_agent", at, payload: { text: "Vendas, pois não.", agentId: to.id } },
            { id: "4", kind: "transcript_agent", at, payload: { text: "Qual produto?", agentId: to.id } },
          ],
          live: false,
          agentName: "Recepção",
        }),
      );

    it("vira um cartão com de quem, para quem e o motivo, e o resumo fica recolhido", () => {
      const html = render({ from, to, reason: "quer comprar", summary: "Cliente quer o plano anual." });
      expect(html).toContain("Passou para Vendas");
      expect(html).toContain("De Recepção");
      expect(html).toContain("quer comprar");
      expect(html).toMatch(/<details[^>]*><summary[^>]*>Resumo para o próximo agente<\/summary><p[^>]*>Cliente quer o plano anual\.<\/p><\/details>/);
      expect(html).not.toContain(ptBR.events.unknown);
    });

    it("as falas do segundo agente levam o nome dele, uma vez por bloco", () => {
      const html = render({ from, to, reason: "quer comprar", summary: "x" });
      expect(html.indexOf(">Recepção<")).toBeLessThan(html.indexOf("Vou passar para vendas."));
      expect(html.split(">Vendas<").length - 1).toBe(1);
      expect(html.indexOf(">Vendas<")).toBeLessThan(html.indexOf("Vendas, pois não."));
    });

    it("depois do prazo ou do apagamento a pedido do titular, o cartão mostra só de quem e para quem", () => {
      for (const marker of [{ purged: true }, { purged: true, erased: true }]) {
        const html = render({ from, to, ...marker });
        expect(html).toContain("Passou para Vendas");
        expect(html).toContain("De Recepção");
        expect(html).not.toContain("<details");
        expect(html).not.toContain(ptBR.events.agent_handoff_summary);
      }
    });
  });

  it(`os textos de "Pode passar a ligação para" dizem o limite de ${MAX_AGENT_HANDOFFS_PER_CALL} passagens, nos três idiomas`, () => {
    for (const dictionary of [ptBRAgents, enAgents, esAgents]) expect(dictionary.handoffMax).toContain(String(MAX_AGENT_HANDOFFS_PER_CALL));
  });

  describe("o filtro da fala", () => {
    const at = "2026-11-17T12:00:00.000Z";
    const render = (events: Array<{ id: string; kind: string; payload: Record<string, unknown> }>): string =>
      renderToStaticMarkup(createElement(Timeline, { events: events.map((event) => ({ ...event, at })) as never, live: false, agentName: "Ana" }));

    it("a marca de fundo e a sugestão aparecem como sugestão, com o texto ouvido intacto ao lado", () => {
      const html = render([
        { id: "1", kind: "transcript_user", payload: { text: "quero falar com o meu gasto", read: { background: { confidence: 0.82 }, suggestion: { term: "Melgaço", confidence: 0.91 } } } },
        { id: "2", kind: "caller_speech_read", payload: { onTime: true, marked: true, background: 0.82, reading: { confidence: 0.91, suggested: true }, finished: null } },
      ]);
      // O texto ouvido fica como foi gravado; a leitura provável vem ao lado, sem trocá-lo.
      expect(html).toContain("quero falar com o meu gasto");
      expect(html).toContain("Pode ser fala de fundo (confiança 0,82)");
      expect(html).toContain("Leitura provável: Melgaço (confiança 0,91)");
      expect(html).toContain(ptBR.events.speech_marks.note);
      // A leitura a tempo, sem observação, não vira uma linha a mais.
      expect(html).not.toContain(ptBR.events.unknown);
    });

    it("a decisão tardia aparece como observação, e o prazo vencido e a falha dizem que nada mudou", () => {
      const html = render([
        { id: "1", kind: "transcript_user", payload: { text: "era isso" } },
        { id: "2", kind: "caller_speech_read", payload: { onTime: true, marked: false, background: 0, finished: { confidence: 0.93, observation: true } } },
        { id: "3", kind: "caller_speech_read", payload: { onTime: false, failure: "late", status: null } },
        { id: "4", kind: "caller_speech_read", payload: { onTime: false, failure: "key_missing", model: "jev" } },
      ]);
      expect(html).toContain("era isso");
      expect(html).toContain("a pessoa tinha terminado o pensamento (confiança 0,93). Não mudou nada na ligação.");
      expect(html).toContain(ptBR.events.caller_speech_read.late);
      expect(html).toContain("O filtro de fala não leu esta fala (falta a chave do modelo, em Configurações → Filtro de fala). A ligação seguiu sem ele.");
      expect(html).not.toContain("Pode ser fala de fundo");
    });

    it("sem filtro, a fala sai como antes: nenhuma marca", () => {
      const html = render([{ id: "1", kind: "transcript_user", payload: { text: "bom dia" } }]);
      expect(html).not.toContain(ptBR.events.speech_marks.note);
    });
  });

  describe("o analista ao vivo (R6, fatia 4)", () => {
    const at = "2026-11-17T12:00:00.000Z";
    const analysts = [
      {
        id: "an-1",
        name: "Jev",
        decisionModel: "jev",
        temperature: true,
        objections: [{ key: "preco", label: "Preço", guidance: "Reforce o que está incluso; não ofereça desconto." }],
        providerConfirmedBy: null,
        providerConfirmedByName: null,
        providerConfirmedAt: null,
      },
    ];
    const render = (events: Array<{ id: string; kind: string; payload: Record<string, unknown> }>, withAnalysts: { list: typeof analysts | undefined } = { list: analysts }): string =>
      renderToStaticMarkup(createElement(Timeline, { events: events.map((event) => ({ ...event, at })) as never, live: false, agentName: "Ana", analysts: withAnalysts.list }));
    const read = { analystId: "an-1", agentId: "ag-1", model: "jev", latencyMs: 300, onTime: true, temperature: { score: 2, confidence: 0.9 }, objection: { key: "preco", confidence: 0.95 }, failure: null, status: 200 };

    it("a linha mostra o rótulo do cadastro (Preço), e nunca a key (preco)", () => {
      const html = render([
        { id: "1", kind: "analyst_read", payload: read },
        { id: "2", kind: "analyst_guidance", payload: { analystId: "an-1", agentId: "ag-1", objection: "preco", outcome: "delivered" } },
        { id: "3", kind: "analyst_guidance_leaked", payload: { analystId: "an-1", agentId: "ag-1", objection: "preco" } },
      ]);
      expect(html).toContain("Objeção reconhecida: Preço (confiança 95%).");
      expect(html).toContain("O agente recebeu a orientação do analista para a objeção Preço.");
      expect(html).toContain("repetiu trechos da orientação para a objeção Preço.");
      expect(html).not.toMatch(/\bpreco\b/);
    });

    it("a orientação entregue mostra o texto do cadastro atual, com o limite escrito ao lado (seção 3.5)", () => {
      const html = render([{ id: "1", kind: "analyst_guidance", payload: { analystId: "an-1", agentId: "ag-1", objection: "preco", outcome: "delivered" } }]);
      expect(html).toContain("Orientação no cadastro atual: “Reforce o que está incluso; não ofereça desconto.”");
      expect(html).toContain(ptBR.events.analyst_guidance.currentNote);
    });

    it("a objeção que saiu do cadastro diz isso no lugar do rótulo, sem mostrar a key crua", () => {
      const gone = [{ ...analysts[0]!, objections: [] }];
      const html = render(
        [
          { id: "1", kind: "analyst_read", payload: read },
          { id: "2", kind: "analyst_guidance", payload: { analystId: "an-1", agentId: "ag-1", objection: "preco", outcome: "delivered" } },
        ],
        { list: gone },
      );
      expect(html).toContain(`Objeção reconhecida: ${ptBR.events.analyst_objection_removed} (confiança 95%).`);
      expect(html).not.toContain(ptBR.events.analyst_guidance.currentNote);
      expect(html).not.toMatch(/\bpreco\b/);
      // O analista apagado: o mesmo.
      expect(render([{ id: "1", kind: "analyst_read", payload: read }], { list: [] })).toContain(ptBR.events.analyst_objection_removed);
      // Sem o cadastro (não carregou), a tela não presume que a objeção saiu, e também não mostra a key.
      const unread = render([{ id: "1", kind: "analyst_read", payload: read }], { list: undefined });
      expect(unread).toContain(ptBR.events.analyst_objection_unread);
      expect(unread).not.toMatch(/\bpreco\b/);
    });

    it("no motor sem orientação, a explicação aparece uma vez por chamada, e cada objeção fica numa linha curta", () => {
      const analystsTwo = [{ ...analysts[0]!, objections: [...analysts[0]!.objections, { key: "prazo", label: "Prazo", guidance: "Diga o prazo de entrega." }] }];
      const unsupported = (id: string, objection: string) => ({ id, kind: "analyst_guidance", payload: { analystId: "an-1", agentId: "ag-1", objection, outcome: "engine_unsupported" } });
      const html = render([unsupported("1", "preco"), unsupported("2", "prazo"), unsupported("3", "preco")], { list: analystsTwo });
      expect(html.split(ptBR.events.analyst_guidance.engineUnsupportedWhy)).toHaveLength(2);
      expect(html.split("Objeção reconhecida: Preço, não entregue.")).toHaveLength(3);
      expect(html).toContain("Objeção reconhecida: Prazo, não entregue.");
    });

    it("a objeção abaixo do corte também usa o rótulo; fora da lista, diz isso", () => {
      const html = render([
        { id: "1", kind: "analyst_read", payload: { ...read, objection: { key: "preco", confidence: 0.6 } } },
        { id: "2", kind: "analyst_read", payload: { ...read, objection: { key: null, confidence: 0.9 } } },
      ]);
      expect(html).toContain("Objeção possível: Preço, com confiança 60%");
      expect(html).toContain(ptBR.events.analyst_read.objectionOutside);
    });
  });
});
