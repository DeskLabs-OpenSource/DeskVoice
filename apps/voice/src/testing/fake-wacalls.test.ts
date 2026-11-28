// O WaCalls falso, quando o cliente desiste no meio da espera (`hangMs`): DESA-534.
import { afterEach, expect, it } from "vitest";
import { wacallsLogoutSession } from "../wacalls-client";
import { startFakeWacalls } from "./fake-wacalls";

const unhandled: unknown[] = [];
const collect = (reason: unknown): void => {
  unhandled.push(reason);
};
afterEach(() => {
  process.off("unhandledRejection", collect);
  unhandled.length = 0;
});

it("F1: a client that gives up while the fake hangs leaves no rejection behind, even after the hang would have ended", async () => {
  const wacalls = await startFakeWacalls();
  process.on("unhandledRejection", collect);
  const session = wacalls.paired("F1");
  wacalls.state.hangMs = 300;
  await expect(wacallsLogoutSession({ ...wacalls.options, timeoutMs: 50 }, session.id)).rejects.toMatchObject({ code: "timeout" });
  // Passa da espera inteira: é aí que o falso antigo lia o corpo da requisição abortada.
  await new Promise((resolve) => setTimeout(resolve, 450));
  expect(unhandled).toEqual([]);
  // O pedido chegou, mas o falso não o atendeu: a sessão segue pareada.
  expect(wacalls.requests.map((request) => `${request.method} ${request.path}`)).toEqual([`POST /api/sessions/${session.id}/logout`]);
  expect(session.paired).toBe(true);
  await wacalls.stop();
});

it("F2: without anybody giving up, the hang still ends in the answer", async () => {
  const wacalls = await startFakeWacalls();
  const session = wacalls.paired("F2");
  wacalls.state.hangMs = 100;
  await wacallsLogoutSession(wacalls.options, session.id);
  expect(session.paired).toBe(false);
  await wacalls.stop();
});
