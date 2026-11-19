// O aviso do painel (R8, fatia 10) e o arquivo do Asterisk usam a mesma regra de endereço repetido.
// Este teste roda a massa inteira de `trunks.test.ts` de novo, anotando cada lista de linhas que
// passou por `renderTrunksConf`, e confere que, em cada uma, as linhas por IP que a regra pura diz
// "fora por sobreposição entre organizações" são as que o arquivo pulou com esse motivo.
import { hostsOverlap, ipTrunksOutByOverlap, parseTrunkHost } from "@deskvoice/core";
import { afterAll, expect, vi } from "vitest";
import type * as Trunks from "./trunks";
import type { TrunkConfig } from "./trunks";

const seen = vi.hoisted(() => [] as Array<{ input: unknown[]; skipped: Array<{ id: string; reason: string }>; emitted: string[] }>);

vi.mock("./trunks", async (load) => {
  const real = await load<typeof Trunks>();
  return {
    ...real,
    renderTrunksConf: (...args: Parameters<typeof real.renderTrunksConf>) => {
      const result = real.renderTrunksConf(...args);
      seen.push({ input: structuredClone(args[0]), skipped: result.skipped, emitted: result.emitted });
      return result;
    },
  };
});

await import("./trunks.test");

const addresses = (trunk: TrunkConfig) =>
  [trunk.host, ...(trunk.authMode === "ip" ? (trunk.matchExtra ?? []) : [])].map((value) => parseTrunkHost(value)).filter((host) => host?.kind === "address");

afterAll(async () => {
  const { SHARED_HOST_REASON, trunkProblem } = await vi.importActual<typeof Trunks>("./trunks");
  let withCrossOrganization = 0;
  for (const { input, skipped, emitted } of seen) {
    const trunks = input as TrunkConfig[];
    const valid = trunks.filter((trunk) => trunkProblem(trunk) === null);
    const out = ipTrunksOutByOverlap(valid);
    const shared = new Set(skipped.filter((entry) => entry.reason === SHARED_HOST_REASON).map((entry) => entry.id));
    const context = JSON.stringify(trunks.map(({ id, organizationId, host, authMode, matchExtra }) => ({ id, organizationId, host, authMode, matchExtra })));
    if (out.size > 0) withCrossOrganization += 1;
    // Toda linha que a regra pura tira do ar, o arquivo pulou pelo endereço repetido.
    for (const id of out) expect(shared.has(id), `${id} em ${context}`).toBe(true);
    // E o arquivo não pulou por esse motivo nenhuma outra linha, a não ser a repetida da própria
    // organização: há outra linha dela, emitida, que cruza a faixa.
    for (const id of shared) {
      if (out.has(id)) continue;
      const mine = valid.find((trunk) => trunk.id === id);
      expect(mine, `${id} em ${context}`).toBeDefined();
      const sameOrganization = valid.filter(
        (other) =>
          other.id !== id &&
          other.organizationId === mine?.organizationId &&
          emitted.includes(other.id) &&
          addresses(other).some((theirs) => addresses(mine as TrunkConfig).some((ours) => ours && theirs && hostsOverlap(ours, theirs))),
      );
      expect(sameOrganization.length, `${id} em ${context}`).toBeGreaterThan(0);
    }
  }
  // A massa tem casos de sobreposição entre organizações: sem eles o teste não diria nada.
  expect(seen.length).toBeGreaterThan(30);
  expect(withCrossOrganization).toBeGreaterThan(5);
});
