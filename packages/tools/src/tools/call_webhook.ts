import { z } from "zod";
import { loadAllowedWebhooks, postToWebhook } from "../connectors/webhook";
import { defineTool } from "../define-tool";
import { configSecretKey, type ToolDeps } from "../deps";

export function createCallWebhook(deps: ToolDeps = {}) {
  return defineTool({
    name: "call_webhook",
    description:
      "Chama uma integração que o operador cadastrou (por exemplo, consultar um pedido ou abrir um chamado em outro sistema) e devolve a resposta dela. Use só quando as suas instruções mandarem usar uma integração pelo nome. NÃO use por iniciativa própria nem invente nomes: se o nome não existir, a ferramenta devolve a lista dos cadastrados. Você nunca informa endereço, só o nome.",
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
          message: `Não existe integração chamada "${input.name}", e nada foi chamado. ${names ? `Cadastradas: ${names}.` : "Nenhuma integração está cadastrada nesta central."} Não tente outro nome por conta própria.`,
        };
      }
      const response = await postToWebhook(hook, { callId: ctx.callId, ...input.payload }, deps);
      const data = { status: response.status, body: response.body, truncated: response.truncated };
      if (!response.ok) {
        return { ok: false, message: `A integração "${hook.name}" respondeu com erro (HTTP ${response.status}). Diga à pessoa que o sistema não respondeu agora e ofereça outra forma de ajudar.`, data };
      }
      return { ok: true, message: `A integração "${hook.name}" respondeu. A resposta está em data.body; use o que ela diz para continuar a conversa.`, data };
    },
  });
}

export default createCallWebhook();
