import { describe, expect, it } from "vitest";
import { contextoDaAgenda, crmSimulado, QUEM_LIGOU } from "../../test/agenda";
import { AgendaError } from "../connectors/agenda";
import { createAgendaMarcar } from "./agenda_marcar";

const ESCOLHIDO = "2026-11-18T14:00:00-03:00";

describe("agenda_marcar", () => {
  it("com a confirmação da pessoa, grava uma vez o horário escolhido", async () => {
    const crm = crmSimulado();
    const ctx = contextoDaAgenda();

    const result = await createAgendaMarcar({ agenda: crm }).run({ service_type: "Consulta", starts_at: ESCOLHIDO, confirmed: true }, ctx);

    expect(result).toMatchObject({ ok: true, data: { appointmentId: "agendamento-1", startsAt: ESCOLHIDO } });
    expect(result.message).toContain("marcado");
    expect(crm.pedidos.marcacoes).toEqual([{ serviceType: "Consulta", startsAt: ESCOLHIDO, callerE164: QUEM_LIGOU, callId: "call-1" }]);
    expect(ctx.said).toEqual(["Um instante, estou marcando."]);
  });

  it("sem a confirmação em voz alta, não escreve nada e pede a confirmação", async () => {
    const crm = crmSimulado();
    const result = await createAgendaMarcar({ agenda: crm }).run({ service_type: "Consulta", starts_at: ESCOLHIDO, confirmed: false }, contextoDaAgenda());

    expect(result.ok).toBe(false);
    expect(result.message).toContain("falta a confirmação");
    // Recusa antes de chamar a agenda: a vaga do teto por ligação volta.
    expect(result.noEffect).toBe(true);
    expect(result.message).toContain("confirmed=true");
    expect(crm.pedidos.marcacoes).toEqual([]);
    expect(crm.compromissos.size).toBe(0);
  });

  it("horário que já passou recusa sem escrever", async () => {
    const crm = crmSimulado();
    const result = await createAgendaMarcar({ agenda: crm }).run({ service_type: "Consulta", starts_at: "2026-11-17T09:00:00-03:00", confirmed: true }, contextoDaAgenda());

    expect(result.ok).toBe(false);
    expect(result.message).toContain("já passou");
    // Recusa antes de chamar a agenda: a vaga do teto por ligação volta.
    expect(result.noEffect).toBe(true);
    expect(crm.pedidos.marcacoes).toEqual([]);
  });

  it("sem agenda ligada, recusa em voz alta mesmo com a confirmação", async () => {
    const result = await createAgendaMarcar().run({ service_type: "Consulta", starts_at: ESCOLHIDO, confirmed: true }, contextoDaAgenda());

    expect(result.ok).toBe(false);
    expect(result.message).toContain("não está ligada");
    // Recusa antes de chamar a agenda: a vaga do teto por ligação volta.
    expect(result.noEffect).toBe(true);
    expect(result.message).toContain("create_task");
  });

  it("CRM fora do ar vira recusa falada, sem exceção, e não promete horário marcado", async () => {
    const crm = crmSimulado();
    crm.foraDoAr();

    const result = await createAgendaMarcar({ agenda: crm }).run({ service_type: "Consulta", starts_at: ESCOLHIDO, confirmed: true }, contextoDaAgenda());

    expect(result.ok).toBe(false);
    expect(result.message).toContain("não respondeu");
    expect(result.message).toContain("NÃO diga que está marcado");
    // O CRM pode ter marcado antes de falhar: na dúvida, a vaga fica gasta.
    expect(result.noEffect).toBeUndefined();
    expect(crm.compromissos.size).toBe(0);
  });

  it("agente em inglês: a espera sai em inglês", async () => {
    const ctx = contextoDaAgenda("en");

    const result = await createAgendaMarcar({ agenda: crmSimulado() }).run({ service_type: "Estimate", starts_at: ESCOLHIDO, confirmed: true }, ctx);

    expect(result.ok).toBe(true);
    expect(ctx.said).toEqual(["One moment, I'm booking that for you."]);
  });

  it("o número vem do registro da ligação: na feita, quem foi chamado", async () => {
    const crm = crmSimulado();
    const ctx = contextoDaAgenda("pt-BR", { direction: "outbound", from_e164: "+5531300000000", to_e164: "+14155550123" });

    await createAgendaMarcar({ agenda: crm }).run({ service_type: "Consulta", starts_at: ESCOLHIDO, confirmed: true }, ctx);

    expect(crm.pedidos.marcacoes[0]?.callerE164).toBe("+14155550123");
  });

  it.each([
    ["número oculto", null],
    ["o @lid da ligação pelo WhatsApp", "123456789@lid"],
  ])("%s: não marca, não chama a agenda e manda anotar o pedido", async (_label, numero) => {
    const crm = crmSimulado();
    const ctx = contextoDaAgenda("pt-BR", { direction: "inbound", from_e164: numero, to_e164: "+5531300000000" });

    const result = await createAgendaMarcar({ agenda: crm }).run({ service_type: "Consulta", starts_at: ESCOLHIDO, confirmed: true }, ctx);

    expect(result).toMatchObject({ ok: false, noEffect: true });
    expect(result.message).toContain("create_task");
    expect(crm.pedidos.marcacoes).toEqual([]);
    expect(ctx.said).toEqual([]);
  });

  it("reserva que a equipe ainda confirma não vira \"está reservado\"", async () => {
    const crm = crmSimulado({ awaitingConfirmation: true });

    const result = await createAgendaMarcar({ agenda: crm }).run({ service_type: "Consulta", starts_at: ESCOLHIDO, confirmed: true }, contextoDaAgenda());

    expect(result).toMatchObject({ ok: true, data: { awaitingConfirmation: true } });
    expect(result.message).toContain("a equipe confirma");
    expect(result.message).not.toContain("está reservado");
  });

  it("resultado incerto: não afirma nem nega, e manda não repetir", async () => {
    const crm = crmSimulado();
    crm.foraDoAr(new AgendaError("uncertain", "write did not finish: SafeFetchTimeoutError"));

    const result = await createAgendaMarcar({ agenda: crm }).run({ service_type: "Consulta", starts_at: ESCOLHIDO, confirmed: true }, contextoDaAgenda());

    expect(result).toMatchObject({ ok: false, outcome: "unknown" });
    expect(result.message).toContain("a equipe confere");
    expect(result.message).toContain("NÃO diga que não foi marcado");
    expect(result.message).toContain("NÃO chame a ferramenta de novo");
  });

  it.each([
    ["slot_unavailable", "agenda_horarios_livres"],
    ["ambiguous_contact", "mais de um cadastro"],
    ["not_published", "NÃO diga que está lotado"],
  ] as const)("recusa %s: a fala é a do DeskVoice, e nunca a do CRM", async (refusal, esperado) => {
    const crm = crmSimulado();
    crm.foraDoAr(new AgendaError("refused", "texto do CRM que não pode chegar ao modelo", refusal));

    const result = await createAgendaMarcar({ agenda: crm }).run({ service_type: "Consulta", starts_at: ESCOLHIDO, confirmed: true }, contextoDaAgenda());

    expect(result.ok).toBe(false);
    expect(result.outcome).toBeUndefined();
    expect(result.message).toContain(esperado);
    expect(result.message).not.toContain("texto do CRM");
  });
});
