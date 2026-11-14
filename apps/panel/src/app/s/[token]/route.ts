import { readFile } from "node:fs/promises";
import { consumeShareLink, recordOrgEvent, recordingPath, resolveShareLink, withOrg } from "@deskvoice/core";
import { serverDeps } from "../../../server/context";

/**
 * A única rota pública do produto: o titular baixa o que pediu sem abrir o painel.
 *
 * Inválido, vencido, revogado, esgotado, chamada apagada e áudio expurgado respondem **igual** —
 * 404 com a mesma mensagem — porque descobrir qual dos casos foi já é informação sobre o acervo.
 * Tudo aqui é `no-store`, `no-referrer` e `noindex`.
 */
const gone = (): Response =>
  new Response(JSON.stringify({ ok: false, error: { code: "not_found", message: "Link inválido ou expirado." } }), {
    status: 404,
    headers: { "content-type": "application/json", "cache-control": "no-store", "referrer-policy": "no-referrer", "x-robots-tag": "noindex" },
  });

const headers = (): Record<string, string> => ({
  "cache-control": "private, no-store",
  "referrer-policy": "no-referrer",
  "x-robots-tag": "noindex",
});

export async function GET(request: Request, context: { params: Promise<{ token: string }> }): Promise<Response> {
  const deps = serverDeps();
  const { token } = await context.params;
  const now = deps.clock.now();
  if (typeof token !== "string" || token.length < 20) return gone();

  const link = await resolveShareLink(deps.db, token, now);
  if (!link || link.callId === null) return gone();

  const call = await withOrg(deps.db, link.organizationId, (q) =>
    q.one<{ id: string; erased_at: Date | null; started_at: Date; ended_at: Date | null }>(
      "select id, erased_at, started_at, ended_at from calls where id = $1",
      [link.callId],
    ),
  );
  // Link criado antes do apagamento deixa de servir: o que foi apagado não sai por link antigo.
  if (!call || call.erased_at) return gone();

  const wantsAudio = new URL(request.url).searchParams.get("audio") === "1";
  const wav = wantsAudio ? await readFile(recordingPath(deps.recordingsDir, link.organizationId, call.id)).catch(() => null) : null;
  if (wantsAudio && !wav) return gone();

  // Só conta a abertura depois de o conteúdo existir: link que falhou não gasta uso.
  await withOrg(deps.db, link.organizationId, async (q) => {
    await consumeShareLink(q, link.id);
    await recordOrgEvent(q, "share_opened", { callId: call.id, kind: link.kind, audio: wantsAudio }, now, null);
  });

  if (wav) {
    return new Response(new Uint8Array(wav), {
      headers: {
        ...headers(),
        "content-type": "audio/wav",
        "content-length": String(wav.length),
        "content-disposition": `attachment; filename="chamada-${call.id}.wav"`,
      },
    });
  }

  return Response.json(
    { ok: true, data: { callId: call.id, startedAt: call.started_at, endedAt: call.ended_at, audio: `/s/${token}?audio=1`, expiresAt: link.expiresAt } },
    { headers: headers() },
  );
}
