import { withSystem } from "@deskvoice/core";
import { afterAll, describe, expect, it } from "vitest";
import { NOW, call, createCall, createOrganization, createUser, startPanel } from "../../../../test/kit";
import { GET as detail } from "./calls/[id]/route";

/**
 * O cabeçalho da religação (desenho 2026-11-16-follow-up-da-ligacao-que-caiu, seção 3.6, fatia 4): o
 * detalhe da chamada diz de qual ligação ela é o retorno e quando a original começou. Só o id e a hora.
 */
const panel = startPanel();
afterAll(() => panel.close());

describe("call-back of a dropped call in the panel API", () => {
  it("gives the call-back the original call and its start time, and every other call nulls", async () => {
    const organizationId = await createOrganization(panel.app, "call-back-of");
    const { cookie } = await createUser(panel.app, organizationId, "operator");
    const original = await createCall(panel.app, organizationId, NOW);
    const callBack = await createCall(panel.app, organizationId, new Date(NOW.getTime() + 30 * 60 * 1000));
    await withSystem(panel.app, (q) => q.exec("update calls set direction = 'outbound', call_back_of = $2 where id = $1", [callBack, original]));

    const shown = await call(detail, { cookie, params: { id: callBack } });
    expect(shown.data).toMatchObject({ callBackOf: original });
    expect(new Date(String((shown.data as { callBackOfStartedAt: string }).callBackOfStartedAt)).getTime()).toBe(NOW.getTime());
    expect((await call(detail, { cookie, params: { id: original } })).data).toMatchObject({ callBackOf: null, callBackOfStartedAt: null });
  });
});
