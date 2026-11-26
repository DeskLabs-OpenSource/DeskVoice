// `/api/v1/brains` com um cérebro que não conversa (ressalva 3 da DESA-437, fatia 5b-2 do pipeline):
// todo cérebro da pasta tem `chat` hoje, então a pasta ganha aqui um a mais, sem `chat`. Ele sai com
// `chat: false`, mesmo com a chave aceita, e o bloco "Pipeline" não o oferece.
import { withSystem } from "@deskvoice/core";
import { afterAll, describe, expect, it, vi } from "vitest";
import { NOW, call, createOrganization, createUser, startPanel } from "../../../../../test/kit";
import type * as BrainsModule from "../../../../server/brains";
import { conversationalBrains, type PipelineBrainOption } from "../../../(app)/agents/[id]/pipeline-block";
import { GET as listAll } from "./route";

/** O cérebro a mais: o OpenRouter da pasta, com outro id e sem `chat`, como um cérebro que só lê ligações. */
const MUTE = "cerebro-que-so-le";

vi.mock("../../../../server/brains", async (original) => {
  const real = await original<typeof BrainsModule>();
  return {
    ...real,
    async listBrains() {
      const all = await real.listBrains();
      const base = all.find((brain) => brain.id === "openrouter");
      if (!base) throw new Error("the openrouter brain is not in the folder");
      const { chat: _chat, ...withoutChat } = base;
      return [...all, { ...withoutChat, id: MUTE, label: "Cérebro que só lê" }];
    },
  };
});

const panel = startPanel();
afterAll(() => panel.close());

describe("GET /api/v1/brains: o cérebro sem chat", () => {
  it("sai com `chat: false`, mesmo com a chave aceita, e o bloco Pipeline não o oferece; os da pasta saem com `chat: true`", async () => {
    const org = await createOrganization(panel.app, "cérebro sem chat");
    const owner = await createUser(panel.app, org, "owner");
    // A chave aceita nos dois: o único motivo para o cérebro a mais ficar de fora é não conversar.
    await withSystem(panel.app, async (q) => {
      for (const id of [MUTE, "openrouter"]) {
        await q.exec("insert into settings (organization_id, key, value, secret) values ($1, $2, $3, true)", [org, `brain.${id}.api_key`, JSON.stringify("cifrada-de-teste")]);
        await q.exec("insert into settings (organization_id, key, value, secret) values ($1, $2, $3, false)", [org, `brain.${id}.key_check`, JSON.stringify({ result: "accepted", status: 200, checkedAt: NOW.toISOString() })]);
      }
    });

    const listed = await call(listAll, { cookie: owner.cookie });
    expect(listed.status).toBe(200);
    const brains = listed.data as Array<PipelineBrainOption & { keyUrl: string }>;
    const mute = brains.find((brain) => brain.id === MUTE);
    expect(mute).toEqual(expect.objectContaining({ id: MUTE, chat: false, configured: true, keyCheck: expect.objectContaining({ result: "accepted" }) }));
    // Os da pasta conversam.
    for (const brain of brains.filter((candidate) => candidate.id !== MUTE)) expect([brain.id, brain.chat]).toEqual([brain.id, true]);

    // O bloco lê esta lista: o cérebro sem chat fica de fora, e o OpenRouter, com a mesma chave aceita, entra.
    expect(conversationalBrains(brains).map((brain) => brain.id)).toEqual(["openrouter"]);
  });
});
