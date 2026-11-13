import { CALL_RECORDING_SETTING, callRecordingOf, withOrg } from "@deskvoice/core";
import { failure, notFound, requireSession, serverDeps } from "../../../../../../../server/context";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Pedido, feito no painel, para parar a gravação de uma chamada em andamento — porque a pessoa na
 * linha pediu. Quem aplica é o processo de voz, que lê esta marca durante a ligação: o painel não
 * fala com ele por outro caminho. O trecho já dito, inclusive o pedido, fica gravado.
 *
 * Recusa quando a organização não grava: prometer parada de algo que não existe seria mentira.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const deps = serverDeps();
    const session = await requireSession(request, deps);
    const { id } = await context.params;
    if (!UUID.test(id)) throw notFound();

    const body = (await request.json().catch(() => null)) as { reason?: unknown } | null;
    const texto = typeof body?.reason === "string" ? body.reason.trim().slice(0, 300) : "";
    const reason = texto === "" ? null : texto;

    const resultado = await withOrg(deps.db, session.organizationId, async (q) => {
      const gravacao = await q.one<{ value: unknown }>("select value from settings where key = $1", [CALL_RECORDING_SETTING]);
      if (!callRecordingOf(gravacao?.value)) return "sem_gravacao" as const;
      const pedido = await q.one<{ id: string }>(
        "update calls set recording_pause_requested_at = now(), recording_pause_requested_by = $2, recording_pause_request = $3 where id = $1 and ended_at is null and recording_paused_at is null returning id",
        [id, session.userId, reason],
      );
      return pedido ? ("pedido" as const) : ("nao_acontece" as const);
    });

    if (resultado === "pedido") return Response.json({ requested: true });
    if (resultado === "sem_gravacao") return Response.json({ error: "call_not_recorded" }, { status: 409 });
    throw notFound();
  } catch (error) {
    return failure(error);
  }
}
