import { describe, expect, it } from "vitest";
import { AsteriskCalls, type AsteriskCallsDeps } from "./asterisk-transport";
import type { AudioSocketConnection } from "./audiosocket";

// `attach` só fala com a conexão; o resto das dependências não é tocado aqui.
const calls = () => new AsteriskCalls({} as AsteriskCallsDeps);

/** Dublê de AudioSocket: só o que `attach` liga ao transporte, com o tocado controlado pelo teste. */
function connection(id: string, spoken: { ms: number }): AudioSocketConnection {
  return {
    id,
    onAudio: () => undefined,
    onDtmf: () => undefined,
    onClose: () => undefined,
    sendAudio: () => undefined,
    sendTone: async () => undefined,
    clearAudio: () => undefined,
    spokenMs: () => spoken.ms,
    drained: async () => undefined,
    close: () => undefined,
  };
}

describe("AsteriskCalls.attach", () => {
  it("o transporte diz quanto tocou pelo spokenMs da conexão (é o que o motor usa para cortar a fala interrompida)", () => {
    const asterisk = calls();
    asterisk.expect({ callId: "call-1", channelId: "chan-1", organizationId: "org-1", agentId: "agent-1", trunkId: "trunk-1" });
    const spoken = { ms: 0 };
    const attached = asterisk.attach(connection("call-1", spoken));
    expect(attached?.transport.playedMs?.()).toBe(0);
    spoken.ms = 1340;
    expect(attached?.transport.playedMs?.()).toBe(1340);
  });
});
