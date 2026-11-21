import { describe, expect, it } from "vitest";
import { updatePath } from "./me";
import type { Me } from "./types";

const owner: Me = { name: "Dona", email: "dona@example.test", role: "owner", installationAdmin: true, installationExplicit: false };

// Central de configuração, parte 8: a tela de atualizar mora só na área da instalação, com a lista
// de quem a administra explícita ou não, e `/settings/system` só redireciona.
describe("updatePath", () => {
  it("leva quem administra a instalação à área da instalação, também com a lista implícita", () => {
    expect(updatePath(owner)).toBe("/installation/update");
    expect(updatePath({ ...owner, installationExplicit: true })).toBe("/installation/update");
  });

  it("não dá caminho a quem não administra, nem com a lista implícita", () => {
    expect(updatePath({ ...owner, role: "operator", installationAdmin: false })).toBeNull();
    expect(updatePath({ ...owner, installationAdmin: false, installationExplicit: true })).toBeNull();
  });

  it("não dá caminho sem ninguém na tela", () => {
    expect(updatePath(null)).toBeNull();
  });
});
