import { readFile } from "node:fs/promises";
import { recordingPath, withOrg } from "@deskvoice/core";
import { failure, notFound, requireSession, serverDeps } from "../../../../../../server/context";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Gravação da chamada (WAV): só quem é da organização dona da chamada ouve. A chamada é conferida
// no banco, com o isolamento por organização, antes de o arquivo ser lido; sem gravação, 404.
export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const deps = serverDeps();
    const session = await requireSession(request, deps);
    const { id } = await context.params;
    if (!UUID.test(id)) throw notFound();
    const call = await withOrg(deps.db, session.organizationId, (q) => q.one("select id from calls where id = $1", [id]));
    if (!call) throw notFound();
    const file = recordingPath(deps.recordingsDir, session.organizationId, id);
    const wav = await readFile(file).catch(() => null);
    if (!wav) throw notFound();
    return new Response(new Uint8Array(wav), { headers: { "content-type": "audio/wav", "content-length": String(wav.length), "cache-control": "private, no-store" } });
  } catch (error) {
    return failure(error);
  }
}
