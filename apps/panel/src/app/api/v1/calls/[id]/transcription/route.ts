import { readFile } from "node:fs/promises";
import { decryptSecret, recordEvent, recordingPath, withOrg } from "@deskvoice/core";
// Pelo caminho do arquivo: o índice do pacote carrega a descoberta por pasta, que não existe no Next.
import { canTranscribe, transcribeRecording } from "@deskvoice/voice-engine/transcription";
import { ApiError, failure, notFound, requireSession, serverDeps } from "../../../../../../server/context";
import { engineKeySetting } from "../../../../../../server/pieces";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Transcreve a gravação de uma chamada que ficou sem texto — recado de caixa postal, chamada cuja
 * transcrição em tempo real falhou, ou gravação anterior ao motor atual.
 *
 * Idempotente: se já existe transcrição feita por aqui (`source: "stt"`), devolve a mesma, sem
 * chamar o provedor de novo. Sem chave do provedor, 409 dizendo o que falta — nunca texto vazio
 * com cara de transcrito.
 *
 * A transcrição entra como fala de quem ligou: é a verdade de um recado (só o chamador fala) e é
 * o que o resumo e o desfecho já sabem ler. Sem diarização: numa chamada com dois lados, o texto
 * é o da conversa inteira.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const deps = serverDeps();
    const session = await requireSession(request, deps);
    const { id } = await context.params;
    if (!UUID.test(id)) throw notFound();

    const call = await withOrg(deps.db, session.organizationId, (q) => q.one<{ engine: string }>("select engine from calls where id = $1", [id]));
    if (!call) throw notFound();

    const done = await withOrg(deps.db, session.organizationId, (q) =>
      q.one<{ payload: { text?: unknown } }>(
        "select payload from call_events where call_id = $1 and kind = 'transcript_user' and payload->>'source' = 'stt' order by at desc limit 1",
        [id],
      ),
    );
    if (done && typeof done.payload.text === "string" && done.payload.text !== "") {
      return Response.json({ ok: true, data: { text: done.payload.text, cached: true } });
    }

    if (!canTranscribe(call.engine)) {
      throw new ApiError(409, "engine_cannot_transcribe", "O motor deste agente não transcreve áudio gravado. Use um agente com OpenAI ou Google.");
    }

    const wav = await readFile(recordingPath(deps.recordingsDir, session.organizationId, id)).catch(() => null);
    if (!wav) throw notFound();

    const stored = await withOrg(deps.db, session.organizationId, (q) =>
      q.one<{ value: unknown }>("select value from settings where key = $1", [engineKeySetting(call.engine)]),
    );
    if (!stored || typeof stored.value !== "string" || stored.value === "") {
      throw new ApiError(409, "no_key", "Este agente não tem chave do provedor configurada: a transcrição não pode ser feita.");
    }

    const result = await transcribeRecording({
      engine: call.engine,
      apiKey: decryptSecret(stored.value, deps.secretKey),
      audio: new Uint8Array(wav),
      fetch: deps.fetch,
    });

    await withOrg(deps.db, session.organizationId, (q) =>
      recordEvent(q, id, "transcript_user", { text: result.text, source: "stt", engine: result.engine, model: result.model }, deps.clock.now()),
    );

    return Response.json({ ok: true, data: { text: result.text, cached: false } });
  } catch (error) {
    return failure(error);
  }
}
