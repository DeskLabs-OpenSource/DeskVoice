import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CALL_BACK_REFUSAL_CODES } from "@deskvoice/core";
import { MAX_AGENT_HANDOFFS_PER_CALL } from "@deskvoice/tools";
import { describe, expect, it } from "vitest";
import enAgents from "../i18n/en/agents";
import esAgents from "../i18n/es/agents";
import ptBRAgents from "../i18n/pt-BR/agents";
import enTimeline from "../i18n/en/timeline";
import esTimeline from "../i18n/es/timeline";
import ptBR from "../i18n/pt-BR/timeline";
import { formatMoney } from "./format";
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

    it("a leitura que chegou a tempo, sem observação, não vira a linha \"terminou (0,00)\"", () => {
      // Com `finished` nulo e com `finished` ausente: as duas formas do payload a tempo.
      for (const finished of [{ finished: null }, {}]) {
        const html = render([
          { id: "1", kind: "transcript_user", payload: { text: "bom dia" } },
          { id: "2", kind: "caller_speech_read", payload: { onTime: true, marked: false, background: 0, ...finished } },
        ]);
        expect(html).toContain("bom dia");
        expect(html).not.toContain("tinha terminado o pensamento");
        expect(html).not.toContain("0,00");
        expect(html).not.toContain(ptBR.events.unknown);
      }
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
  describe("de quem é a escolha do cérebro (R4, fatia 5)", () => {
    const at = "2026-11-18T12:00:00.000Z";
    const render = (kind: string, payload: Record<string, unknown>) =>
      renderToStaticMarkup(createElement(Timeline, { events: [{ id: "1", kind, at, payload }], live: false, agentName: "Vendas" }));
    const brain = { brain: "anthropic", model: "claude-sonnet" };

    it.each([
      ["call_analyzed", { score: 8, rubricVersion: 1, costCents: 1, droppedObjections: 0, ...brain, costMeasured: true }, "Ligação analisada: nota 8 de 10"],
      ["outcome_not_classified", { reason: "brain_no_key", ...brain }, ptBR.events.outcome_not_classified],
      ["analysis_not_done", { reason: "brain_no_key", ...brain }, "Ligação não analisada: o cérebro escolhido não tem chave cadastrada"],
    ])("%s com a escolha do agente diz \"(escolha do agente)\"; com a da organização ou do motor, nada muda", (kind, payload, frase) => {
      expect(render(kind, { ...payload, choiceFrom: "agent" })).toContain(`${frase} (escolha do agente)`);
      for (const other of [{ ...payload, choiceFrom: "organization" }, payload]) {
        const html = render(kind, other);
        expect(html).toContain(frase);
        expect(html).not.toContain("(escolha do agente)");
        expect(html).not.toContain("escolha da organização");
      }
    });
  });

  describe("a religação da ligação que caiu (R2, fatia 4)", () => {
    const at = "2026-11-18T12:00:00.000Z";
    const CALL_BACK = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b";
    const r = ptBR.events.drop_follow_up_result;
    const d = ptBR.events.drop_follow_up;
    const render = (kind: string, payload: Record<string, unknown>) =>
      renderToStaticMarkup(createElement(Timeline, { events: [{ id: "1", kind, at, payload }], live: false, agentName: "Ana" }));
    // O que nenhuma frase da religação pode dizer: a do WhatsApp, a da pendência e o evento desconhecido.
    // A pendência de reserva é aberta de verdade quando a religação não pode ser agendada, e a frase
    // dela termina com a mesma oração da pendência: ali, `task_opened` sozinha é que não pode aparecer.
    const notOtherModes = (html: string, { opensTask = false } = {}) => {
      const others = [r.whatsapp_sent, r.whatsapp_failed, d.whatsapp_queued, d.mode_unavailable, d.recent_follow_up, d.do_not_call, ptBR.events.unknown];
      for (const other of opensTask ? others : [...others, d.task_opened]) expect(html).not.toContain(other);
    };
    const link = `href="/calls/${CALL_BACK}"`;

    it("o agendamento tem frase própria, também na simulada, e nunca cai na pendência", () => {
      const scheduled = render("drop_follow_up", { case: "call_dropped", mode: "call_back", action: "call_back_scheduled", simulated: false, openTurn: "caller_waiting" });
      expect(scheduled).toContain(d.call_back_scheduled);
      notOtherModes(scheduled);
      const simulated = render("drop_follow_up", { case: "call_dropped", mode: "call_back", action: "call_back_scheduled", simulated: true, openTurn: "caller_waiting" });
      expect(simulated).toContain(d.simulated.call_back_scheduled);
      expect(simulated).not.toContain(d.simulated.task_opened);
    });

    it("os motivos de não agendar no modo religação falam da religação, não da mensagem", () => {
      for (const reason of ["do_not_call", "mode_unavailable", "recent_follow_up"] as const) {
        const html = render("drop_follow_up", { case: "engine_failed", mode: "call_back", action: "skipped", reason, simulated: false });
        expect(html).toContain(d[`call_back_${reason}`]);
        notOtherModes(html, { opensTask: reason !== "do_not_call" });
        const sim = render("drop_follow_up", { case: "engine_failed", mode: "call_back", action: "skipped", reason, simulated: true });
        expect(sim).toContain(d.simulated[`call_back_${reason}`]);
        expect(sim).not.toContain(d.simulated[reason]);
      }
    });

    it("o modo WhatsApp e o modo pendência continuam com as frases de antes", () => {
      expect(render("drop_follow_up", { case: "call_dropped", mode: "whatsapp", action: "skipped", reason: "mode_unavailable", simulated: false })).toContain(d.mode_unavailable);
      expect(render("drop_follow_up", { case: "call_dropped", mode: "whatsapp", action: "skipped", reason: "recent_follow_up", simulated: true })).toContain(d.simulated.recent_follow_up);
      expect(render("drop_follow_up", { case: "call_dropped", mode: "task", action: "task_opened", simulated: false })).toContain(d.task_opened);
      expect(render("drop_follow_up_result", { action: "whatsapp_sent" })).toContain(r.whatsapp_sent);
      expect(render("drop_follow_up_result", { action: "whatsapp_failed" })).toContain(r.whatsapp_failed);
    });

    it("a tentativa que saiu diz isso, com o link para a religação", () => {
      const html = render("drop_follow_up_result", { action: "call_back_placed", attempt: 1, callId: CALL_BACK });
      expect(html).toContain("A religação saiu (tentativa 1).");
      expect(html).toContain(link);
      expect(html).toContain(r.link);
      notOtherModes(html);
    });

    it("atendida e não atendida dizem o resultado, o custo da religação e o link", () => {
      const answered = render("drop_follow_up_result", { action: "call_back_answered", attempt: 1, callId: CALL_BACK, costCents: 37 });
      expect(answered).toContain("A religação foi atendida (tentativa 1).");
      expect(answered).toContain(`Custo da religação: ${formatMoney(37, "pt-BR")}.`);
      expect(answered).toContain(link);
      notOtherModes(answered);
      const notAnswered = render("drop_follow_up_result", { action: "call_back_not_answered", attempt: 1, callId: CALL_BACK, costCents: 0 });
      expect(notAnswered).toContain("A religação não foi atendida (tentativa 1).");
      expect(notAnswered).toContain(`Custo da religação: ${formatMoney(0, "pt-BR")}.`);
      expect(notAnswered).toContain(link);
      notOtherModes(notAnswered);
    });

    it("cada código de recusa tem frase fixa, com o link só quando a chamada chegou a existir", () => {
      for (const code of CALL_BACK_REFUSAL_CODES) {
        const html = render("drop_follow_up_result", { action: "call_back_refused", attempt: 1, refusalCode: code });
        expect(html).toContain(`A religação não saiu (tentativa 1): ${r.refusals[code]}.`);
        expect(html).not.toContain(code);
        expect(html).not.toContain("href=");
        notOtherModes(html);
      }
      const withCall = render("drop_follow_up_result", { action: "call_back_refused", attempt: 1, refusalCode: "outside_window", callId: CALL_BACK });
      expect(withCall).toContain(link);
      // Um código que esta versão não conhece vira frase fixa, nunca o código cru.
      const unknown = render("drop_follow_up_result", { action: "call_back_refused", attempt: 1, refusalCode: "novo_codigo" });
      expect(unknown).toContain(r.refusals.unknown);
      expect(unknown).not.toContain("novo_codigo");
    });

    it("a expirada diz que o processo de voz não discou, sem link", () => {
      const html = render("drop_follow_up_result", { action: "call_back_expired", attempt: 1 });
      expect(html).toContain("A religação não saiu (tentativa 1): o processo de voz não discou a tempo.");
      expect(html).not.toContain("href=");
      notOtherModes(html);
    });

    it("nenhuma frase da religação mostra texto que não seja dela: campo estranho no payload não aparece", () => {
      for (const action of ["call_back_placed", "call_back_refused", "call_back_expired", "call_back_answered", "call_back_not_answered"]) {
        const html = render("drop_follow_up_result", { action, attempt: 1, callId: "<script>Maria</script>", refusalCode: "do_not_call", costCents: 10, text: "Maria Souza", summary: "Maria Souza" });
        expect(html).not.toContain("Maria");
        // `callId` que não é um id não vira link.
        expect(html).not.toContain("href=");
      }
    });

    it("os três dicionários têm frase para todo código de recusa", () => {
      for (const dict of [ptBR, enTimeline, esTimeline]) {
        for (const code of CALL_BACK_REFUSAL_CODES) expect(dict.events.drop_follow_up_result.refusals[code]).toMatch(/\S/);
      }
    });
  });
});
