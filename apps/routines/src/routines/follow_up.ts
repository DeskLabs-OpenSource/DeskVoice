import { withOrg } from "@deskvoice/core";
import { z } from "zod";
import type { Routine } from "../types";

const payloadSchema = z.object({ title: z.string().min(1), details: z.string().default("") });

/** A pendência criada na ligação (`create_task`) aparece no painel quando a hora chega. */
const routine: Routine = {
  kind: "follow_up",
  async run(task, deps) {
    const { title, details } = payloadSchema.parse(task.payload);
    await withOrg(deps.db, task.organizationId, (q) =>
      // Nasce `sent`: aviso de painel não tem mais nada a entregar.
      q.exec("insert into notifications (organization_id, call_id, channel, body, status, created_at) values ($1, $2, 'panel', $3, 'sent', $4)", [
        task.organizationId,
        task.callId,
        details ? `Pendência: ${title}\n\n${details}` : `Pendência: ${title}`,
        deps.clock.now(),
      ]),
    );
  },
};

export default routine;
