import { open } from "node:fs/promises";
import { Readable } from "node:stream";
import { consumeShareUse, findLiveShare, recordOrgEvent, recordingPath, withOrg } from "@deskvoice/core";
import { serverDeps } from "../../../../server/context";

/**
 * O download da gravação pelo link de quem ligou, sem sessão. Cada download gasta um uso.
 *
 * Inválido, vencido, revogado, esgotado, chamada apagada e áudio que saiu pelo prazo respondem
 * **igual**: voltam para a página do link, que diz que ele não vale mais. Descobrir qual dos casos
 * foi já é informação sobre o acervo.
 *
 * O arquivo é aberto antes de gastar o uso (download que falharia não gasta) e sai em fluxo do
 * disco, com o tamanho no cabeçalho: uma chamada longa não vai inteira para a memória do painel.
 */
const NO_TRACE = { "cache-control": "private, no-store", "referrer-policy": "no-referrer", "x-robots-tag": "noindex" };

export async function GET(_request: Request, context: { params: Promise<{ token: string }> }): Promise<Response> {
  const { token } = await context.params;
  const back = (): Response => new Response(null, { status: 303, headers: { ...NO_TRACE, location: `/s/${encodeURIComponent(token)}` } });
  const deps = serverDeps();
  const now = deps.clock.now();

  const share = await findLiveShare(deps.db, token, now);
  if (!share) return back();
  const file = await open(recordingPath(deps.recordingsDir, share.organizationId, share.callId)).catch(() => null);
  if (!file) return back();
  try {
    const { size } = await file.stat();
    const used = await withOrg(deps.db, share.organizationId, async (q) => {
      const use = await consumeShareUse(q, share.id, now);
      if (use) await recordOrgEvent(q, "share_downloaded", { callId: share.callId, linkId: share.id, use: use.uses, maxUses: use.maxUses }, now, null);
      return use;
    });
    if (!used) {
      await file.close();
      return back();
    }
    // O fluxo fecha o arquivo ao terminar, ou quando quem baixa desiste no meio.
    return new Response(Readable.toWeb(file.createReadStream()) as ReadableStream<Uint8Array>, {
      headers: {
        ...NO_TRACE,
        "content-type": "audio/wav",
        "content-length": String(size),
        "content-disposition": `attachment; filename="chamada-${share.callId}.wav"`,
      },
    });
  } catch (error) {
    await file.close();
    throw error;
  }
}

/** Sem isto o Next responde HEAD chamando o GET, e uma sondagem gastaria um download. */
export function HEAD(): Response {
  return new Response(null, { status: 405, headers: { ...NO_TRACE, allow: "GET" } });
}
