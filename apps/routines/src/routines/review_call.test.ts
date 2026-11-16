import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { CASE_PHRASE, REVIEW_CASES, reviewCaseOf, reviewDetails, reviewTitle, type ReviewEvent } from "./review_call";

const ev = (kind: string, extra: Partial<ReviewEvent> = {}): ReviewEvent => ({ kind, name: null, ok: null, reason: null, approvalId: null, ...extra });

describe("review_call: as regras fixas", () => {
  it("não importa nada que chame modelo ou rede: só o núcleo e os tipos da fila", async () => {
    const source = await readFile(new URL("./review_call.ts", import.meta.url), "utf8");
    const imports = [...source.matchAll(/^import .* from "([^"]+)";$/gm)].map((match) => match[1]);
    expect(imports.sort()).toEqual(["../types", "@deskvoice/core"]);
  });

  it("o título e os detalhes são texto fixo por caso, com o número", () => {
    for (const found of REVIEW_CASES) {
      expect(reviewTitle("+5531988887777", found)).toBe(`Retornar para +5531988887777: ${CASE_PHRASE[found]}`);
      expect(reviewDetails(found)).toContain(CASE_PHRASE[found]);
      expect(reviewTitle("+5531988887777", found).length).toBeLessThanOrEqual(200);
    }
  });

  it("ok que não é booleano não conta como falha", () => {
    expect(reviewCaseOf([ev("tool_result", { name: "transfer_to_human", ok: null })], null)).toBeNull();
  });

  it("a aprovação sem id, pedida e nunca decidida, conta quando quem ligou desligou", () => {
    expect(reviewCaseOf([ev("approval_requested")], "caller_hangup")).toBe("caller_hung_up_waiting");
  });
});
