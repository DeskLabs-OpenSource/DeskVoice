import { describe, expect, it } from "vitest";
import { AGORA, HORARIOS_LIVRES, contextoDaAgenda, crmSimulado } from "../../test/agenda";
import { createAgendaHorariosLivres } from "./agenda_horarios_livres";

describe("agenda_horarios_livres", () => {
  it("consulta a janela pedida e devolve os horários livres com fuso", async () => {
    const crm = crmSimulado();
    const ctx = contextoDaAgenda();

    const result = await createAgendaHorariosLivres({ agenda: crm }).run({ service_type: "Consulta", from: "2026-11-18T00:00:00-03:00", to: "2026-11-19T00:00:00-03:00" }, ctx);

    expect(result).toMatchObject({ ok: true, data: { slots: HORARIOS_LIVRES, timezone: "America/Sao_Paulo" } });
    expect(crm.pedidos.horarios).toEqual([
      { serviceType: "Consulta", from: "2026-11-18T03:00:00.000Z", to: "2026-11-19T03:00:00.000Z", durationMinutes: undefined, callId: "call-1" },
    ]);
    // O agente recebe a fala pronta do primeiro horário, e a ordem de confirmar antes de marcar.
    expect(result.message).toContain("18/11");
    expect(result.message).toContain("09:00");
    expect(result.message).toContain("confirmed=true");
    expect(ctx.said).toEqual(["Um instante, estou conferindo a agenda."]);
  });

  it("sem período, consulta os próximos sete dias a partir do relógio da chamada", async () => {
    const crm = crmSimulado();
    await createAgendaHorariosLivres({ agenda: crm }).run({ service_type: "Consulta" }, contextoDaAgenda());

    expect(crm.pedidos.horarios[0]?.from).toBe(AGORA.toISOString());
    expect(crm.pedidos.horarios[0]?.to).toBe(new Date(AGORA.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString());
  });

  it("sem agenda ligada, recusa em voz alta e não chama ninguém", async () => {
    const ctx = contextoDaAgenda();
    const result = await createAgendaHorariosLivres().run({ service_type: "Consulta" }, ctx);

    expect(result.ok).toBe(false);
    expect(result.message).toContain("não está ligada");
    expect(result.message).toContain("create_task");
    expect(ctx.said).toEqual([]);
  });

  it("janela invertida recusa sem consultar a agenda", async () => {
    const crm = crmSimulado();
    const result = await createAgendaHorariosLivres({ agenda: crm }).run({ service_type: "Consulta", from: "2026-11-19T00:00:00-03:00", to: "2026-11-18T00:00:00-03:00" }, contextoDaAgenda());

    expect(result.ok).toBe(false);
    expect(result.message).toContain("depois do começo");
    expect(crm.pedidos.horarios).toEqual([]);
  });

  it("agenda sem vaga devolve lista vazia e não inventa horário", async () => {
    const crm = crmSimulado({ slots: [] });
    const result = await createAgendaHorariosLivres({ agenda: crm }).run({ service_type: "Consulta" }, contextoDaAgenda());

    expect(result).toMatchObject({ ok: true, data: { slots: [] } });
    expect(result.message).toContain("Não há horário livre");
    expect(result.message).toContain("Não invente horário");
  });

  it("CRM fora do ar vira recusa falada, sem exceção", async () => {
    const crm = crmSimulado();
    crm.foraDoAr();

    const result = await createAgendaHorariosLivres({ agenda: crm }).run({ service_type: "Consulta" }, contextoDaAgenda());

    expect(result.ok).toBe(false);
    expect(result.message).toContain("não respondeu");
    expect(result.message).toContain("create_task");
  });

  it("agente em inglês: espera e horário em inglês, hora em 12 horas", async () => {
    const crm = crmSimulado({ timezone: "America/New_York", slots: [{ startsAt: "2026-11-18T09:00:00-05:00", endsAt: "2026-11-18T10:00:00-05:00" }] });
    const ctx = contextoDaAgenda("en");

    const result = await createAgendaHorariosLivres({ agenda: crm }).run({ service_type: "Estimate" }, ctx);

    expect(ctx.said).toEqual(["One moment, I'm checking the schedule."]);
    expect(result.message).toContain("Wednesday, 11/18, 9:00");
    expect(result.message).toContain("AM");
    expect(result.message).not.toContain("quarta");
  });

  it("agente em espanhol: espera e horário em espanhol", async () => {
    const ctx = contextoDaAgenda("es");

    const result = await createAgendaHorariosLivres({ agenda: crmSimulado() }).run({ service_type: "Consulta" }, ctx);

    expect(ctx.said).toEqual(["Un momento, estoy revisando la agenda."]);
    expect(result.message).toContain("miércoles, 18/11, 09:00");
  });

  it("idioma fora do mapa cai no pt-BR, como o aviso da caixa postal", async () => {
    const ctx = contextoDaAgenda("fr");

    const result = await createAgendaHorariosLivres({ agenda: crmSimulado() }).run({ service_type: "Consulta" }, ctx);

    expect(ctx.said).toEqual(["Um instante, estou conferindo a agenda."]);
    expect(result.message).toContain("quarta-feira, 18/11, 09:00");
  });

  it("lista vazia com mais horários na agenda não vira \"está lotado\"", async () => {
    const crm = crmSimulado({ slots: [], hasMore: true });

    const result = await createAgendaHorariosLivres({ agenda: crm }).run({ service_type: "Consulta" }, contextoDaAgenda());

    expect(result).toMatchObject({ ok: true, data: { slots: [], hasMore: true } });
    expect(result.message).toContain("NÃO diga que está lotado");
    expect(result.message).not.toContain("Não há horário livre");
  });

  it("horário provisório é oferecido pedindo confirmação", async () => {
    const crm = crmSimulado({ provisional: true });

    const result = await createAgendaHorariosLivres({ agenda: crm }).run({ service_type: "Consulta" }, contextoDaAgenda());

    expect(result).toMatchObject({ ok: true, data: { provisional: true } });
    expect(result.message).toContain("a equipe confirma");
  });
});

