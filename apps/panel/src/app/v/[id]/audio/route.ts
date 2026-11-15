import { readFile } from "node:fs/promises";
import { callerAudioAccessible, markCallerAccessOpened, recordingPath } from "@deskvoice/core";
import { notFound, serverDeps } from "../../../server/context";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * O áudio, e só depois de o código ser confirmado. Servido em um pedido só, sem anexo: nada fica
 * copiado no aparelho por um "download" que ninguém pediu.
 *
 * Apagamento a pedido do titular, prazo vencido e código não confirmado respondem todos igual (404):
 * a rota não conta se existe gravação para um número.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;
  if (!UUID.test(id)) throw notFound();
  const deps = serverDeps();
  const now = new Date();
  const access = await callerAudioAccessible(deps.db, id, now);
  if (!access) throw notFound();

  const wav = await readFile(recordingPath(deps.recordingsDir, access.organizationId, access.callId)).catch(() => null);
  if (!wav) throw notFound();

  await markCallerAccessOpened(deps.db, id, now);
  return new Response(new Uint8Array(wav), {
    headers: { "content-type": "audio/wav", "content-length": String(wav.length), "cache-control": "no-store", "x-robots-tag": "noindex" },
  });
}
