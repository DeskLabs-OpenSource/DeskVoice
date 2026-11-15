import { describe, expect, it } from "vitest";
import { contextoDaAgenda, crmSimulado } from "../../test/agenda";
import { createAgendaMarcar } from "./agenda_marcar";

const ESCOLHIDO = "2026-11-18T14:00:00-03:00";

describe("agenda_marcar", () => {
  it("com a confirmação da pessoa, grava uma vez o horário escolhido", async () => {
    const crm = crmSimulado();
    const ctx = contextoDaAgenda();

    const result = await createAgendaMarcar({ agenda: crm }).run({ service_type: "Consulta", starts_at: ESCOLHIDO, confirmed: true }, ctx);

    expect(result).toMatchObject({ ok: true, data: { appointmentId: "agendamento-1", startsAt: ESCOLHIDO } });
    expect(result.message).toContain("marcado");
    expect(crm.pedidos.marcacoes).toEqual([{ serviceType: "Consulta", startsAt: ESCOLHIDO, callId: "call-1" }]);
    expect(ctx.said).toEqual(["Um instante, estou marcando."]);
  });

  it("sem a confirmação em voz alta, não escreve nada e pede a confirmação", async () => {
    const crm = crmSimulado();
    const result = await createAgendaMarcar({ agenda: crm }).run({ service_type: "Consulta", starts_at: ESCOLHIDO, confirmed: false }, contextoDaAgenda());

    expect(result.ok).toBe(false);
    expect(result.message).toContain("falta a confirmação");
    expect(result.message).toContain("confirmed=true");
    expect(crm.pedidos.marcacoes).toEqual([]);
    expect(crm.compromissos.size).toBe(0);
  });

  it("horário que já passou recusa sem escrever", async () => {
    const crm = crmSimulado();
    const result = await createAgendaMarcar({ agenda: crm }).run({ service_type: "Consulta", starts_at: "2026-11-17T09:00:00-03:00", confirmed: true }, contextoDaAgenda());

    expect(result.ok).toBe(false);
    expect(result.message).toContain("já passou");
    expect(crm.pedidos.marcacoes).toEqual([]);
  });

  it("sem agenda ligada, recusa em voz alta mesmo com a confirmação", async () => {
    const result = await createAgendaMarcar().run({ service_type: "Consulta", starts_at: ESCOLHIDO, confirmed: true }, contextoDaAgenda());

    expect(result.ok).toBe(false);
    expect(result.message).toContain("não está ligada");
    expect(result.message).toContain("create_task");
  });

  it("CRM fora do ar vira recusa falada, sem exceção, e não promete horário marcado", async () => {
    const crm = crmSimulado();
    crm.foraDoAr();

    const result = await createAgendaMarcar({ agenda: crm }).run({ service_type: "Consulta", starts_at: ESCOLHIDO, confirmed: true }, contextoDaAgenda());

    expect(result.ok).toBe(false);
    expect(result.message).toContain("não respondeu");
    expect(result.message).toContain("NÃO diga que está marcado");
    expect(crm.compromissos.size).toBe(0);
  });
});
