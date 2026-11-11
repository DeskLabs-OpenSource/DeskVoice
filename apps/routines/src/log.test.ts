import { describe, expect, it } from "vitest";
import { createLogger } from "./log";

describe("createLogger", () => {
  it("escreve uma linha de JSON por evento, com a hora do relógio injetado", () => {
    const lines: string[] = [];
    const log = createLogger({ now: () => new Date("2031-03-01T09:00:00Z") }, (line) => lines.push(line));
    log("error", "task finished", { taskId: "t1", outcome: "failed" });
    expect(lines).toEqual(['{"at":"2031-03-01T09:00:00.000Z","level":"error","message":"task finished","taskId":"t1","outcome":"failed"}\n']);
  });
});
