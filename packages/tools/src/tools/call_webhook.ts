import { createHash } from "node:crypto";
import { z } from "zod";
import { loadAllowedWebhooks, postToWebhook } from "../connectors/webhook";
import { defineTool } from "../define-tool";
import { configSecretKey, type ToolDeps } from "../deps";
import { SafeFetchTimeoutError } from "../net/safe-fetch";

/** JSON com as chaves dos objetos em ordem, em todo nível: a mesma entrada dá o mesmo texto. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item === undefined ? null : item)).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value).filter(([, item]) => item !== undefined);
    entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * A chave de idempotência: a mesma ligação, a mesma integração e os mesmos dados dão a mesma chave.
 * Quem repete o pedido depois de um "não sei" manda a mesma chave, e o sistema que a respeita não duplica.
 */
export function webhookIdempotencyKey(callId: string, name: string, payload: Record<string, unknown>): string {
  return createHash("sha256").update(`${callId}\n${name}\n${canonicalJson(payload)}`).digest("hex");
}

/**
 * O que o modelo ouve quando a integração não responde a tempo. Só manda prometer que alguém vai
 * conferir quando há quem confira: a pendência (`create_task`) ou o aviso à equipe (`notify_human`),
 * e só se o motor recebeu a ferramenta neste trecho. Sem nenhuma das duas, não promete retorno.
 */
export function unknownMessage(name: string, offeredTools: ReadonlySet<string> = new Set()): string {
  const head = `A integração "${name}" não respondeu a tempo. Não sei se o pedido foi registrado. NÃO chame de novo sem confirmar com a pessoa.`;
  if (offeredTools.has("create_task")) {
    return `${head} Abra com create_task uma pendência para conferir se a integração "${name}" registrou o pedido, e diga à pessoa que a equipe vai conferir e dar retorno.`;
  }
  if (offeredTools.has("notify_human")) {
    return `${head} Avise a equipe com notify_human que a integração "${name}" não respondeu e é preciso conferir, e diga à pessoa que a equipe vai conferir.`;
  }
  return `${head} Diga à pessoa que não foi possível confirmar agora e que ela pode ligar de novo mais tarde para saber. Não diga que alguém vai entrar em contato: ninguém foi avisado.`;
}

export function createCallWebhook(deps: ToolDeps = {}) {
  return defineTool({
    name: "call_webhook",
    description:
      "Chama uma integração que o operador cadastrou (por exemplo, consultar um pedido ou abrir um chamado em outro sistema) e devolve a resposta dela. Use só quando as suas instruções mandarem usar uma integração pelo nome. NÃO use por iniciativa própria nem invente nomes: se o nome não existir, a ferramenta devolve a lista dos cadastrados. Você nunca informa endereço, só o nome. Se a integração não responder a tempo, não chame de novo: siga o que a resposta da ferramenta disser.",
    inputSchema: z.object({
      name: z.string().min(1).describe("Nome da integração, exatamente como aparece nas suas instruções."),
      payload: z.record(z.string(), z.unknown()).default({}).describe("Dados enviados à integração, no formato que as suas instruções descrevem."),
    }),
    async run(input, ctx) {
      const hooks = await loadAllowedWebhooks(ctx.q, (deps.secretKey ?? configSecretKey)());
      const hook = hooks.find((candidate) => candidate.name === input.name);
      if (!hook) {
        const names = hooks.map((candidate) => candidate.name).join(", ");
        return {
          ok: false,
          noEffect: true,
          message: `Não existe integração chamada "${input.name}", e nada foi chamado. ${names ? `Cadastradas: ${names}.` : "Nenhuma integração está cadastrada nesta central."} Não tente outro nome por conta própria.`,
        };
      }
      const key = webhookIdempotencyKey(ctx.callId, hook.name, input.payload);
      let response;
      try {
        response = await postToWebhook(hook, { callId: ctx.callId, ...input.payload }, deps, key);
      } catch (error) {
        if (!(error instanceof SafeFetchTimeoutError)) throw error;
        // Sem resposta não é falha: o pedido pode ter sido registrado. O modelo não pode repetir às cegas.
        return { ok: false, outcome: "unknown", message: unknownMessage(hook.name, ctx.offeredTools) };
      }
      const data = { status: response.status, body: response.body, truncated: response.truncated };
      if (!response.ok) {
        return { ok: false, message: `A integração "${hook.name}" respondeu com erro (HTTP ${response.status}). Diga à pessoa que o sistema não respondeu agora e ofereça outra forma de ajudar.`, data };
      }
      return { ok: true, message: `A integração "${hook.name}" respondeu. A resposta está em data.body; use o que ela diz para continuar a conversa.`, data };
    },
  });
}

export default createCallWebhook();
