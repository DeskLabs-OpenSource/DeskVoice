// A consulta da rodada (fatia 7c): para em `passed`, `failed` e `error`, inclusive
// `process_restarted`, e desiste depois do teto, para a tela não ficar girando.
import { describe, expect, it } from "vitest";
import { POLL_GIVE_UP_MS, pollRun, type RunStatus } from "./poll";

const sequence = (...statuses: Array<RunStatus | { status: RunStatus; errorCode: string }>) => {
  let index = 0;
  const reads: number[] = [];
  const fetchRun = async (): Promise<{ status: RunStatus; errorCode: string | null }> => {
    reads.push(index);
    const next = statuses[Math.min(index, statuses.length - 1)] ?? "running";
    index += 1;
    return typeof next === "string" ? { status: next, errorCode: null } : next;
  };
  return { fetchRun, reads };
};

describe("a consulta da rodada", () => {
  for (const final of ["passed", "failed", "error"] as const) {
    it(`para em ${final}`, async () => {
      const { fetchRun, reads } = sequence("running", "running", final);
      const slept: number[] = [];
      const outcome = await pollRun(fetchRun, { sleep: async (ms) => void slept.push(ms) });
      expect(outcome).toEqual({ finished: true, run: { status: final, errorCode: null } });
      expect([reads.length, slept]).toEqual([3, [1000, 1000]]);
    });
  }

  it("para na rodada que o processo de voz fechou ao reiniciar", async () => {
    const { fetchRun } = sequence("running", { status: "error", errorCode: "process_restarted" });
    expect(await pollRun(fetchRun, { sleep: async () => undefined })).toEqual({ finished: true, run: { status: "error", errorCode: "process_restarted" } });
  });

  it("desiste depois do teto (mais que os 7 min da rodada órfã) e diz que não terminou", async () => {
    const { fetchRun, reads } = sequence("running");
    let waited = 0;
    const outcome = await pollRun(fetchRun, {
      sleep: async (ms) => {
        waited += ms;
      },
    });
    expect(outcome).toEqual({ finished: false, run: { status: "running", errorCode: null }, reason: "gave_up" });
    expect(POLL_GIVE_UP_MS).toBeGreaterThan(7 * 60_000);
    expect(waited).toBe(POLL_GIVE_UP_MS);
    expect(reads).toHaveLength(POLL_GIVE_UP_MS / 1000);
  });

  it("para quando a página sai, e repassa o erro da leitura", async () => {
    let gone = false;
    const { fetchRun } = sequence("running");
    const outcome = await pollRun(fetchRun, {
      sleep: async () => {
        gone = true;
      },
      cancelled: () => gone,
    });
    expect(outcome).toMatchObject({ finished: false, reason: "cancelled" });
    await expect(pollRun(async () => Promise.reject(new Error("not_found")), { sleep: async () => undefined })).rejects.toThrow("not_found");
  });
});
