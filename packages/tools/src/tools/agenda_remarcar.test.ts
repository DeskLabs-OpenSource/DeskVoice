import { describe, expect, it } from "vitest";
import { contextoDaAgenda, crmSimulado } from "../../test/agenda";
import { createAgendaRemarcar } from "./agenda_remarcar";

const NOVO_HORARIO = "2026-11-18T14:00:00-03:00";

describe("agenda_remarcar", () => {
  it("troca o horário do compromisso que existe, depois da confirmação", async () => {
    const crm = crmSimulado();
    const marcado = await crm.book({ serviceType: "Consulta", startsAt: "2026-11-18T09:00:00-03:00", callId: "call-1" });

    const result = await createAgendaRemarcar({ agenda: crm }).run({ appointment_id: marcado.id, starts_at: NOVO_HORARIO, confirmed: true }, contextoDaAgenda());

    expect(result).toMatchObject({ ok: true, data: { appointmentId: marcado.id, startsAt: NOVO_HORARIO } });
    expect(crm.pedidos.remarcacoes).toEqual([{ appointmentId: marcado.id, startsAt: NOVO_HORARIO, callId: "call-1" }]);
    expect(crm.compromissos.get(marcado.id)?.startsAt).toBe(NOVO_HORARIO);
  });

  it("sem a confirmação em voz alta, não altera nada", async () => {
    const crm = crmSimulado();
    const marcado = await crm.book({ serviceType: "Consulta", startsAt: "2026-11-18T09:00:00-03:00", callId: "call-1" });

    const result = await createAgendaRemarcar({ agenda: crm }).run({ appointment_id: marcado.id, starts_at: NOVO_HORARIO, confirmed: false }, contextoDaAgenda());

    expect(result.ok).toBe(false);
    expect(result.message).toContain("falta a confirmação");
    // Recusa antes de chamar a agenda: a vaga do teto por ligação volta.
    expect(result.noEffect).toBe(true);
    expect(crm.pedidos.remarcacoes).toEqual([]);
    expect(crm.compromissos.get(marcado.id)?.startsAt).toBe("2026-11-18T09:00:00-03:00");
  });

  it("compromisso que o CRM não conhece vira recusa falada, sem exceção", async () => {
    const crm = crmSimulado();

    const result = await createAgendaRemarcar({ agenda: crm }).run({ appointment_id: "nao-existe", starts_at: NOVO_HORARIO, confirmed: true }, contextoDaAgenda());

    expect(result.ok).toBe(false);
    expect(result.message).toContain("não respondeu");
    expect(result.message).toContain("create_task");
  });
});
