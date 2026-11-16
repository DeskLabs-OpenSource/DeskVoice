import { describe, expect, it } from "vitest";
import { amountShown } from "./amount";

describe("amountShown", () => {
  it("sem linha não medida, o valor como sempre, inclusive o zero", () => {
    expect(amountShown(0, false)).toBe("money");
    expect(amountShown(1234, false)).toBe("money");
  });

  it("o zero com linha não medida nunca aparece como valor", () => {
    expect(amountShown(0, true)).toBe("unmeasured");
  });

  it("com parte medida, o valor e a marca juntos", () => {
    expect(amountShown(12, true)).toBe("money-and-unmeasured");
  });
});
