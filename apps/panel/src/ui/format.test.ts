import { describe, expect, it } from "vitest";
import { splitInlineCode } from "./format";

describe("splitInlineCode", () => {
  it("turns each pair of backticks into a code piece, without the backticks", () => {
    expect(splitInlineCode("Rode (`systemctl enable --now docker`) e confira `docker ps`.")).toEqual([
      { code: false, text: "Rode (" },
      { code: true, text: "systemctl enable --now docker" },
      { code: false, text: ") e confira " },
      { code: true, text: "docker ps" },
      { code: false, text: "." },
    ]);
  });

  it("keeps an unpaired backtick, an empty pair and markup as plain text", () => {
    expect(splitInlineCode("a crase ` sozinha")).toEqual([{ code: false, text: "a crase ` sozinha" }]);
    expect(splitInlineCode("`par` e uma ` solta")).toEqual([
      { code: true, text: "par" },
      { code: false, text: " e uma ` solta" },
    ]);
    expect(splitInlineCode("vazio `` aqui")).toEqual([{ code: false, text: "vazio `` aqui" }]);
    expect(splitInlineCode("`<b>x</b>`")).toEqual([{ code: true, text: "<b>x</b>" }]);
    expect(splitInlineCode("")).toEqual([]);
  });
});
