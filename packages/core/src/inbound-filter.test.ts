import { describe, expect, it } from "vitest";
import { inboundFilterOn } from "./inbound-filter";

describe("inboundFilterOn (R14, contrato 11)", () => {
  it("a linha por IP filtra sempre; a coluna só vale para a linha por registro, e ausente vale ligada", () => {
    expect(inboundFilterOn({ authMode: "ip", inboundFilter: false })).toBe(true);
    expect(inboundFilterOn({ authMode: "ip", inboundFilter: true })).toBe(true);
    expect(inboundFilterOn({ authMode: "register", inboundFilter: false })).toBe(false);
    expect(inboundFilterOn({ authMode: "register", inboundFilter: true })).toBe(true);
    expect(inboundFilterOn({ authMode: "register" })).toBe(true);
  });
});
