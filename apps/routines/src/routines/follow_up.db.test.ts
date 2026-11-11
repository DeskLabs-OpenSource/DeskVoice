import { afterAll, describe, expect, it } from "vitest";
import { createCall, createOrganization, depsFor, notificationsOf, openTestDbs, t0, task } from "../../test/helpers";
import followUp from "./follow_up";

const { app, owner } = openTestDbs();
afterAll(async () => {
  await app.close();
  await owner.close();
});

describe("follow_up", () => {
  it("cria um aviso de painel com o título e os detalhes, ligado à chamada", async () => {
    const org = await createOrganization(app, "follow up");
    const callId = await createCall(app, org, t0);
    await followUp.run(task(org, "follow_up", { title: "Retornar para Maria", details: "Quer o orçamento por e-mail." }, callId), depsFor(app));
    expect(await notificationsOf(app, org)).toEqual([
      { id: expect.any(String), channel: "panel", target: null, body: "Pendência: Retornar para Maria\n\nQuer o orçamento por e-mail.", status: "sent", call_id: callId },
    ]);
  });

  it("recusa tarefa sem título", async () => {
    const org = await createOrganization(app, "follow up invalid");
    await expect(followUp.run(task(org, "follow_up", { details: "x" }), depsFor(app))).rejects.toThrow();
    expect(await notificationsOf(app, org)).toEqual([]);
  });
});
