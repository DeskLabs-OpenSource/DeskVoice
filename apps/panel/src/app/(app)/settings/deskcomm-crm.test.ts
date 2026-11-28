// O nome do canal do CRM com mais caracteres que o teto (DESA-460, contexto: o conector de
// @edgariamaguti, #590). O nome vem do CRM, e a tela é quem garante que a gravação o aceita.
import { DESKCOMM_CHANNEL_LABEL_MAX } from "@deskvoice/tools/deskcomm-channel";
import { describe, expect, it } from "vitest";
import { settingDefinition } from "../../../server/settings";
import { channelLabelOf } from "./deskcomm-crm";

const CRM = "https://crm.example.test";
const CHANNEL_ID = "6f1c2a8e-3b4d-4c5e-9f60-718293a4b5c6";
const KEY = Buffer.alloc(32, 7);
const channel = (name: string, phone: string | null = null) => ({ id: CHANNEL_ID, provider: "whatsapp", name, phone });

/** Grava o conector como a rota grava, com o nome que a tela manda: lança se a API recusar. */
async function save(channelLabel: string): Promise<unknown> {
  const definition = await settingDefinition("whatsapp.connector");
  return definition!.store({ type: "deskcomm", url: CRM, crmUrl: CRM, token: "t", channelSessionId: CHANNEL_ID, channelLabel }, KEY, undefined);
}

describe("o nome do canal do CRM", () => {
  it("um nome curto vai inteiro", async () => {
    expect(channelLabelOf(channel("Vendas"))).toBe("Vendas");
    await expect(save(channelLabelOf(channel("Vendas")))).resolves.toMatchObject({ channelLabel: "Vendas" });
  });

  it("com 121 caracteres ou mais, a tela corta no teto e a gravação aceita", async () => {
    for (const name of ["a".repeat(DESKCOMM_CHANNEL_LABEL_MAX + 1), `Atendimento ${"x".repeat(200)}`, "😀".repeat(100)]) {
      const label = channelLabelOf(channel(name));
      expect(label.length, name).toBeLessThanOrEqual(DESKCOMM_CHANNEL_LABEL_MAX);
      expect(label.endsWith("…"), name).toBe(true);
      expect(label.slice(0, -1), name).toBe(name.slice(0, label.length - 1));
      await expect(save(label), name).resolves.toMatchObject({ channelLabel: label });
    }
  });

  it("o número entra na conta: nome perto do teto com o número também cabe", async () => {
    const label = channelLabelOf(channel("b".repeat(DESKCOMM_CHANNEL_LABEL_MAX - 3), "+5511999990000"));
    expect(label.length).toBeLessThanOrEqual(DESKCOMM_CHANNEL_LABEL_MAX);
    await expect(save(label)).resolves.toMatchObject({ channelLabel: label });
  });

  it("acima do teto, a API recusa: o teto da tela e o da API são o mesmo número", async () => {
    await expect(save("a".repeat(DESKCOMM_CHANNEL_LABEL_MAX + 1))).rejects.toThrow();
    await expect(save("a".repeat(DESKCOMM_CHANNEL_LABEL_MAX))).resolves.toBeTruthy();
  });
});
