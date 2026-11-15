import { stat } from "node:fs/promises";
import { createCallerVerification, enqueueTask, newCallerCode, recordOrgEvent, recordingPath, withOrg } from "@deskvoice/core";
import { CONFIG_ROLES, failure, notFound, requireSession, serverDeps } from "../../../../../../server/context";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Gera o acesso do titular à própria gravação — e **prova de quem** é, com um código de seis dígitos
 * entregue no número de origem da chamada.
 *
 * `channel: "call"` é o caso mais forte que existe: o pedido veio na própria ligação, o operador está
 * falando com a pessoa naquele número agora, e o código é ditado na hora. Os outros canais entregam o
 * código por WhatsApp (o número que recebe é a prova de posse).
 *
 * O código não volta na resposta do canal `whatsapp`: quem o recebe é o titular, não o painel.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const deps = serverDeps();
    const session = await requireSession(request, deps);
    if (!CONFIG_ROLES.includes(session.role)) {
      return failure(new Error("Only an owner or admin can grant access to a caller's recording"));
    }
    const { id } = await context.params;
    if (!UUID.test(id)) throw notFound();

    let body: { channel?: unknown } = {};
    try {
      body = (await request.json()) as { channel?: unknown };
    } catch {
      // Sem corpo vale o padrão: WhatsApp.
    }
    const channel = body.channel === "call" ? "call" : "whatsapp";

    // Sem arquivo não há o que liberar: gerar código para uma chamada sem gravação só produziria
    // frustração depois de o titular provar que é ele. Conferir aqui também fecha o caminho de
    // chamada apagada depois da verificação (o áudio volta a conferir na hora de servir).
    const hasRecording = await stat(recordingPath(deps.recordingsDir, session.organizationId, id)).then(() => true).catch(() => false);
    if (!hasRecording) throw notFound();

    const created = await withOrg(deps.db, session.organizationId, async (q) => {
      const call = await q.one<{ from_e164: string | null; erased_at: Date | null }>("select from_e164, erased_at from calls where id = $1", [id]);
      if (!call || call.erased_at !== null) throw notFound();
      // Sem o número de origem não há posse a provar — e o código não pode ir para um número escolhido
      // por quem pede, senão a prova some.
      if (!call.from_e164) throw notFound();

      const now = deps.clock.now();
      const code = newCallerCode();
      const verification = await createCallerVerification(q, {
        callId: id,
        phoneE164: call.from_e164,
        channel,
        code,
        now,
        createdBy: session.userId,
      });

      if (channel === "whatsapp") {
        // A origem vem do pedido: nada de variável de ambiente nova para o instalador cuidar.
        const base = new URL(request.url).origin;
        const notification = await q.one<{ id: string }>(
          "insert into notifications (organization_id, call_id, channel, target, body, created_at) values ($1, $2, 'whatsapp', $3, $4, $5) returning id",
          [q.organizationId, id, call.from_e164, `Seu código de acesso à gravação é ${code}. Abra ${base}/v/${verification.id} e digite em até 5 minutos.`, now],
        );
        if (!notification) throw new Error("Notification for the caller's access was not created");
        await enqueueTask(q, { kind: "deliver_notification", payload: { notificationId: notification.id }, callId: id, runAt: now });
      }

      await recordOrgEvent(q, "caller_verification_sent", { callId: id, channel, verificationId: verification.id, phone: call.from_e164 }, now, session.userId);
      return { verification, code };
    });

    // O código só sai na resposta no canal `call`, porque é o operador quem o dita na ligação em curso.
    return Response.json(
      channel === "call"
        ? { id: created.verification.id, channel, code: created.code, expiresAt: created.verification.expiresAt }
        : { id: created.verification.id, channel, phone: created.verification.phoneE164, expiresAt: created.verification.expiresAt },
      { status: 201, headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return failure(error);
  }
}
