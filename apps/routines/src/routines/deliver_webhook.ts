import { withOrg } from "@deskvoice/core";
import { loadAllowedWebhooks, postToWebhook } from "@deskvoice/tools";
import { z } from "zod";
import type { Routine } from "../types";

const payloadSchema = z.object({ name: z.string().min(1), payload: z.record(z.string(), z.unknown()).default({}) });

/** Chama, depois da ligação, um webhook cadastrado pelo operador (`{ name, payload }`). */
const routine: Routine = {
  kind: "deliver_webhook",
  async run(task, deps) {
    const { name, payload } = payloadSchema.parse(task.payload);
    const hooks = await withOrg(deps.db, task.organizationId, (q) => loadAllowedWebhooks(q, deps.secretKey));
    const hook = hooks.find((candidate) => candidate.name === name);
    if (!hook) throw new Error(`Webhook ${JSON.stringify(name)} is not registered (setting webhooks.allowed)`);
    const response = await postToWebhook(hook, { callId: task.callId, ...payload }, deps);
    if (!response.ok) throw new Error(`Webhook ${hook.name} answered HTTP ${response.status}`);
  },
};

export default routine;
