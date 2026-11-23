import { describe, expect, it } from "vitest";
import { updatePath } from "./me";
import type { Me } from "./types";

const owner: Me = { name: "Dona", email: "dona@example.test", role: "owner", installationAdmin: true };

// Central de configuração, parte 8: a tela de atualizar mora só na área da instalação, e quem chega
// lá é decidido por administrar a instalação, nunca pelo papel na organização.
describe("updatePath", () => {
  it("leva quem administra a instalação à área da instalação", () => {
    expect(updatePath(owner)).toBe("/installation/update");
  });

  it("não dá caminho à dona da organização que não administra a instalação", () => {
    expect(updatePath({ ...owner, installationAdmin: false })).toBeNull();
    expect(updatePath({ ...owner, installationAdmin: undefined })).toBeNull();
  });

  it("não dá caminho a quem opera sem administrar a instalação", () => {
    expect(updatePath({ ...owner, role: "operator", installationAdmin: false })).toBeNull();
  });

  it("não dá caminho sem ninguém na tela", () => {
    expect(updatePath(null)).toBeNull();
  });
});
