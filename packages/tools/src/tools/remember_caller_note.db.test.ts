import { MAX_CALLER_NOTES_PER_CALL, withSystem } from "@deskvoice/core";
import { afterAll, describe, expect, it } from "vitest";
import { openTestDbs } from "../../../core/test/helpers";
import { createFixture, eventsOf, tasksOf } from "../../test/helpers";
import { runTool } from "../run-tool";
import rememberCallerNote from "./remember_caller_note";

const { app, owner } = openTestDbs();
afterAll(async () => {
  await app.close();
  await owner.close();
});

const PHONE = "+5531922221111";
const NOTE = "Prefere ser atendida de manhã; o pedido é o 4471.";
const notesOf = (organizationId: string) => withSystem(app, (q) => q.many<{ call_id: string; caller_e164: string; text: string }>("select call_id, caller_e164, text from caller_notes where organization_id = $1 order by created_at, id", [organizationId]));
const withPhone = (callId: string, phone: string | null) => withSystem(app, (q) => q.exec("update calls set from_e164 = $2 where id = $1", [callId, phone]));

describe("remember_caller_note", () => {
  it("vem desligada: nenhum agente nasce com ela", () => {
    expect(rememberCallerNote.offByDefault).toBe(true);
    expect(rememberCallerNote.personalTextArgs).toBe(true);
  });

  it("guarda a nota com o telefone da chamada, e nem o tool_called nem o resultado repetem o texto", async () => {
    const ctx = await createFixture(app, "note tool");
    await withPhone(ctx.callId, PHONE);
    // O modelo não escolhe o telefone: um campo a mais é ignorado pelo zod, e o telefone vem da chamada.
    const result = await runTool(rememberCallerNote, { text: NOTE, phone: "+5531900000000" }, ctx);

    expect(result).toMatchObject({ ok: true });
    expect(await notesOf(ctx.organizationId)).toEqual([{ call_id: ctx.callId, caller_e164: PHONE, text: NOTE }]);
    expect(JSON.stringify(result)).not.toMatch(/manhã|4471/);
    const events = await eventsOf(app, ctx.callId);
    expect(events.map((event) => event.kind)).toEqual(["tool_called", "tool_result"]);
    expect(events[0]?.payload).toEqual({ name: "remember_caller_note", args: { omitted: "personal_text" } });
    expect(JSON.stringify(events)).not.toMatch(/manhã|4471|\+5531900000000/);
  });

  it("numa ligação sem número não grava nada e devolve uma fala para seguir sem anotar", async () => {
    const ctx = await createFixture(app, "note tool no number");
    await withPhone(ctx.callId, null);
    const result = await runTool(rememberCallerNote, { text: NOTE }, ctx);
    expect(result).toMatchObject({ ok: false, noEffect: true });
    expect(result.message).toMatch(/nada foi anotado/);
    expect(result.message).not.toMatch(/manhã|4471/);
    expect(await notesOf(ctx.organizationId)).toEqual([]);
    expect(await tasksOf(app, ctx.organizationId)).toEqual([]);
  });

  it(`recusa a ${MAX_CALLER_NOTES_PER_CALL + 1}ª nota da mesma ligação`, async () => {
    const ctx = await createFixture(app, "note tool limit");
    await withPhone(ctx.callId, PHONE);
    for (let index = 0; index < MAX_CALLER_NOTES_PER_CALL; index += 1) expect((await runTool(rememberCallerNote, { text: `Nota ${index}` }, ctx)).ok).toBe(true);
    const refused = await runTool(rememberCallerNote, { text: "A décima primeira." }, ctx);
    expect(refused.ok).toBe(false);
    expect(await notesOf(ctx.organizationId)).toHaveLength(MAX_CALLER_NOTES_PER_CALL);
    expect(JSON.stringify(await eventsOf(app, ctx.callId))).not.toContain("décima primeira");
  });

  it("recusa texto vazio ou acima de 300 caracteres sem gravar, e o erro não ecoa o texto", async () => {
    const ctx = await createFixture(app, "note tool invalid");
    await withPhone(ctx.callId, PHONE);
    expect((await runTool(rememberCallerNote, { text: "   " }, ctx)).ok).toBe(false);
    const long = `${"Texto longo demais sobre a pessoa. ".repeat(9)}fim`;
    expect(long.length).toBeGreaterThan(300);
    const refused = await runTool(rememberCallerNote, { text: long }, ctx);
    expect(refused.ok).toBe(false);
    expect(JSON.stringify(refused)).not.toContain("Texto longo");
    expect(await notesOf(ctx.organizationId)).toEqual([]);
  });
});
