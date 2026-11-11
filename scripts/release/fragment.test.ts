import { describe, expect, it } from "vitest";
import { InvalidFragment, parseFragment } from "./fragment";

const fragment = (frontmatter: string, body: string) => `---\n${frontmatter}\n---\n\n${body}\n`;
const VALID = "impact: new_capability\nsection: added\ntitle: O agente transfere a ligação";

describe("parseFragment", () => {
  it("lê um fragmento válido", () => {
    expect(parseFragment("a.md", fragment(VALID, "Agora dá para transferir.\nCrédito: @maria."))).toEqual({
      file: "a.md",
      impact: "new_capability",
      section: "added",
      title: "O agente transfere a ligação",
      body: "Agora dá para transferir.\nCrédito: @maria.",
      attention: null,
    });
  });

  it("separa o bloco de atenção do corpo", () => {
    const parsed = parseFragment(
      "a.md",
      fragment(VALID.replace("new_capability", "operator_action"), "Mudou a porta. Crédito: @maria.\n\n## Requer atenção\n\nLibere a porta 9093 no firewall."),
    );
    expect(parsed.body).toBe("Mudou a porta. Crédito: @maria.");
    expect(parsed.attention).toBe("Libere a porta 9093 no firewall.");
  });

  it("mantém aspas e `#` que fazem parte do título", () => {
    const text = fragment('impact: nothing_changes\nsection: fixed\ntitle: "Alô" deixa de cortar a ligação #12', "Texto. Crédito: @maria.");
    expect(parseFragment("a.md", text).title).toBe('"Alô" deixa de cortar a ligação #12');
    expect(parseFragment("a.md", fragment('impact: nothing_changes\nsection: fixed\ntitle: "Entre aspas"', "T. Crédito: @m.")).title).toBe("Entre aspas");
  });

  it.each([
    ["sem frontmatter", "Só texto.", /primeira linha/],
    ["frontmatter aberto", "---\nimpact: nothing_changes\n", /fecha o frontmatter/],
    ["impacto que é número", fragment(VALID.replace("new_capability", "minor"), "T. Crédito: @m."), /`impact` é `minor`/],
    ["seção ausente", fragment("impact: nothing_changes\ntitle: T", "T. Crédito: @m."), /falta `section`/],
    ["título vazio", fragment("impact: nothing_changes\nsection: fixed\ntitle:", "T. Crédito: @m."), /falta `title`/],
    ["campo desconhecido", fragment(`${VALID}\nimpacto: nada`, "T. Crédito: @m."), /desconhecida/],
    ["corpo vazio", fragment(VALID, ""), /corpo vazio/],
    ["dois parágrafos", fragment(VALID, "Um.\n\nDois. Crédito: @m."), /um parágrafo só/],
    ["sem crédito", fragment(VALID, "Texto sem autor."), /crédito/],
    ["título no corpo", fragment(VALID, "### Detalhes\nT. Crédito: @m."), /título dentro do fragmento/],
    ["ação sem instrução", fragment(VALID.replace("new_capability", "operator_action"), "T. Crédito: @m."), /sem bloco `## Requer atenção`/],
    ["instrução sem ação", fragment(VALID, "T. Crédito: @m.\n\n## Requer atenção\n\nFaça X."), /o impacto é `operator_action`/],
  ])("recusa %s", (_case, text, message) => {
    expect(() => parseFragment("a.md", text)).toThrow(InvalidFragment);
    expect(() => parseFragment("a.md", text)).toThrow(message);
  });
});
