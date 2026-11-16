import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { CASE_PHRASE, REVIEW_CASES, TRANSFERRED_DETAILS, reviewCaseOf, reviewDetails, reviewTitle, type ReviewEvent } from "./review_call";

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

  it("só o caso 1 tem a frase da ligação transferida", () => {
    expect(reviewDetails("engine_failed", true)).toBe(TRANSFERRED_DETAILS);
    for (const found of REVIEW_CASES.filter((found) => found !== "engine_failed")) expect(reviewDetails(found, true)).toBe(reviewDetails(found));
  });

  it("a nova tentativa que saiu fecha o caso 4, mas não o caso 2", () => {
    const tr = (name: string, ok: boolean) => ev("tool_result", { name, ok });
    expect(reviewCaseOf([tr("send_whatsapp", false), tr("send_whatsapp", true)], null)).toBeNull();
    expect(reviewCaseOf([tr("transfer_to_human", false), tr("transfer_to_human", true)], null)).toBe("transfer_failed");
    // Só uma nova tentativa da própria send_whatsapp fecha: o sucesso de outra ferramenta não.
    expect(reviewCaseOf([tr("send_whatsapp", false), tr("transfer_to_human", true)], null)).toBe("whatsapp_not_sent");
  });

  it("ok que não é booleano não conta como falha", () => {
    expect(reviewCaseOf([ev("tool_result", { name: "transfer_to_human", ok: null })], null)).toBeNull();
  });

  it("a aprovação sem id, pedida e nunca decidida, conta quando quem ligou desligou", () => {
    expect(reviewCaseOf([ev("approval_requested")], "caller_hangup")).toBe("caller_hung_up_waiting");
  });

  it("caso 5: quem ligou desligando com a vez aberta (caller_waiting, tool_running) ou internal_error, numa recebida atendida, sem próximo passo", () => {
    const answered = [ev("call_answered")];
    const inbound = (openTurn: "agent_speaking" | "caller_waiting" | "tool_running" | null) => ({ direction: "inbound" as const, openTurn });
    for (const openTurn of ["caller_waiting", "tool_running"] as const) expect(reviewCaseOf(answered, "caller_hangup", inbound(openTurn))).toBe("call_dropped");
    // A vez fechada, outro fim, a ligação feita, a não atendida e a revisão sem os fatos da queda.
    expect(reviewCaseOf(answered, "caller_hangup", inbound(null))).toBeNull();
    // Quem desligou enquanto o agente falava: gravado, mas não conta (decisão de 16/11).
    expect(reviewCaseOf(answered, "caller_hangup", inbound("agent_speaking"))).toBeNull();
    // O sistema falhou numa recebida atendida: caso 5, com a vez nula; na feita ou na não atendida, nada.
    expect(reviewCaseOf(answered, "internal_error", inbound(null))).toBe("call_dropped");
    expect(reviewCaseOf(answered, "internal_error", { direction: "outbound", openTurn: null })).toBeNull();
    expect(reviewCaseOf([], "internal_error", inbound(null))).toBeNull();
    expect(reviewCaseOf([...answered, ev("transfer_started")], "internal_error", inbound(null))).toBeNull();
    expect(reviewCaseOf(answered, "end_call", inbound("caller_waiting"))).toBeNull();
    expect(reviewCaseOf(answered, "caller_hangup", { direction: "outbound", openTurn: "caller_waiting" })).toBeNull();
    expect(reviewCaseOf([], "caller_hangup", inbound("caller_waiting"))).toBeNull();
    expect(reviewCaseOf(answered, "caller_hangup")).toBeNull();
    // Alguém ficou com o próximo passo.
    for (const kind of ["transfer_started", "voicemail_left", "follow_up_created", "human_notified"]) expect(reviewCaseOf([...answered, ev(kind)], "caller_hangup", inbound("caller_waiting"))).toBeNull();
    expect(reviewCaseOf([...answered, ev("tool_result", { name: "send_whatsapp", ok: true })], "caller_hangup", inbound("caller_waiting"))).toBeNull();
    // A aprovação pendente continua no caso 3, que vem antes.
    expect(reviewCaseOf([...answered, ev("approval_requested")], "caller_hangup", inbound("tool_running"))).toBe("caller_hung_up_waiting");
  });
});
