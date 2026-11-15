import {
  CALLER_ACCESS_TTL_MS,
  callerAudioAccessible,
  callerCodeHash,
  callerVerificationById,
  confirmCallerVerification,
  createCallerVerification,
  newCallerCode,
  withOrg,
} from "@deskvoice/core";
import { afterAll, describe, expect, it } from "vitest";
import { createCall, createOrganization, startPanel } from "../../../../test/kit";

/**
 * A prova de posse do número: o que separa "quem tem o link abre" de "quem recebeu no telefone abre".
 * Tudo o que pode dar errado aqui é o que a lei manda e o atacante tenta: código errado, código
 * vencido, força bruta, reuso e gravação apagada.
 */
const panel = startPanel();
const NOW = new Date("2026-11-14T12:00:00.000Z");

afterAll(async () => {
  await panel.close();
});

async function chamada(label: string): Promise<{ org: string; callId: string }> {
  const org = await createOrganization(panel.app, label);
  const callId = await createCall(panel.app, org, NOW);
  return { org, callId };
}

const criar = (org: string, callId: string, now = NOW, code = "123456") =>
  withOrg(panel.app, org, (q) =>
    createCallerVerification(q, { callId, phoneE164: "+5541998765432", channel: "whatsapp", code, now, createdBy: null }),
  );

const confirmar = (org: string, id: string, code: string, now = NOW) =>
  withOrg(panel.app, org, (q) => confirmCallerVerification(q, { id, code, now }));

describe("a verificação do titular", () => {
  it("o código certo libera, e o banco guarda só o hash", async () => {
    const { org, callId } = await chamada("Certo");
    const verification = await criar(org, callId);

    expect(await confirmar(org, verification.id, "123456")).toBe("ok");

    const row = await callerVerificationById(panel.app, verification.id);
    expect(row?.verifiedAt).not.toBeNull();
    // O claro não existe em lugar nenhum: nem no retorno, nem na tabela.
    expect(JSON.stringify(row)).not.toContain("123456");
    expect(row).not.toHaveProperty("code");
  });

  it("três erros bloqueiam, e o certo depois não passa", async () => {
    const { org, callId } = await chamada("Forca bruta");
    const verification = await criar(org, callId);

    expect(await confirmar(org, verification.id, "000000")).toBe("wrong");
    expect(await confirmar(org, verification.id, "111111")).toBe("wrong");
    expect(await confirmar(org, verification.id, "222222")).toBe("blocked");
    // Bloqueado continua bloqueado: não adianta acertar depois.
    expect(await confirmar(org, verification.id, "123456")).toBe("blocked");
  });

  it("código vencido não vale, mesmo certo", async () => {
    const { org, callId } = await chamada("Vencido");
    const dezMinutosAtras = new Date(NOW.getTime() - 10 * 60 * 1000);
    const verification = await criar(org, callId, dezMinutosAtras);

    expect(await confirmar(org, verification.id, "123456")).toBe("expired");
  });

  it("depois de confirmado, o titular pode reouvir dentro da janela, e não depois", async () => {
    const { org, callId } = await chamada("Reouvir");
    const verification = await criar(org, callId);
    expect(await confirmar(org, verification.id, "123456")).toBe("ok");

    const dentro = new Date(NOW.getTime() + CALLER_ACCESS_TTL_MS - 1000);
    expect(await confirmar(org, verification.id, "123456", dentro)).toBe("ok");

    const fora = new Date(NOW.getTime() + CALLER_ACCESS_TTL_MS + 1000);
    expect(await confirmar(org, verification.id, "123456", fora)).toBe("expired");
  });

  it("o áudio só é acessível depois de confirmado, e some se a chamada for apagada", async () => {
    const { org, callId } = await chamada("Audio");
    const verification = await criar(org, callId);

    expect(await callerAudioAccessible(panel.app, verification.id, NOW)).toBeNull();
    await confirmar(org, verification.id, "123456");
    expect(await callerAudioAccessible(panel.app, verification.id, NOW)).toEqual({ organizationId: org, callId });

    // Apagamento a pedido do titular derruba o acesso já concedido.
    await withOrg(panel.app, org, (q) => q.exec("update calls set erased_at = $2 where id = $1", [callId, NOW]));
    expect(await callerAudioAccessible(panel.app, verification.id, NOW)).toBeNull();
  });

  it("id desconhecido responde igual a id de outra organização", async () => {
    expect(await confirmar(await createOrganization(panel.app, "Vazia"), "00000000-0000-4000-8000-000000000000", "123456")).toBe("not_found");
  });

  it("o código é de seis dígitos e o hash não é reversível", () => {
    const code = newCallerCode();
    expect(code).toMatch(/^\d{6}$/);
    expect(callerCodeHash(code)).toHaveLength(64);
    expect(callerCodeHash(code)).not.toBe(code);
  });
});
