import { IVR_MAX_PROMPT_MS, IVR_MIN_PROMPT_MS, parseRecordedSpeech, RECORDED_SPEECH_SAMPLE_RATE, recordedSpeechWav, withOrg } from "@deskvoice/core";
import { ApiError, failure, notFound, requireRole, requireSession, serverDeps } from "../../../../../../server/context";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** O corpo do upload: 1 MiB cobre os 60 s de PCM16 a 8 kHz (960 000 bytes) e o cabeçalho. */
const MAX_UPLOAD_BYTES = 1024 * 1024;

const FORMAT = `WAV, PCM 16 bits, mono, ${RECORDED_SPEECH_SAMPLE_RATE} Hz`;

/** Lê o corpo até o teto, e para de ler ao passar dele: um arquivo grande não chega inteiro à memória. */
async function readCapped(request: Request): Promise<Buffer> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_UPLOAD_BYTES) throw tooLarge();
  if (!request.body) return Buffer.alloc(0);
  const reader = request.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_UPLOAD_BYTES) {
      await reader.cancel();
      throw tooLarge();
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

const tooLarge = (): ApiError => new ApiError(413, "ivr_prompt_too_large", `The announcement must be at most ${MAX_UPLOAD_BYTES} bytes (${FORMAT}, up to 60 s).`);

/**
 * O anúncio do menu por teclas: o navegador converte o arquivo do operador (WAV, MP3, M4A) e manda o
 * WAV pronto; aqui o servidor é estrito, com o mesmo parser das falas do sistema
 * (`parseRecordedSpeech`). Outro formato, menos de 200 ms (`IVR_MIN_PROMPT_MS`, o mesmo número da
 * tela), mais de 60 s ou mais de 1 MiB são recusados com o formato esperado. O banco guarda só o
 * PCM, sem o cabeçalho; o expurgo e o apagamento do titular não o veem.
 */
export async function PUT(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const deps = serverDeps();
    const session = await requireSession(request, deps);
    requireRole(session);
    const { id } = await context.params;
    if (!UUID.test(id)) throw notFound();
    const type = (request.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase();
    if (type !== "audio/wav" && type !== "audio/x-wav" && type !== "audio/wave") throw new ApiError(415, "ivr_prompt_format", `Send the announcement as ${FORMAT}.`);
    const wav = await readCapped(request);
    let pcm: Buffer;
    try {
      pcm = parseRecordedSpeech(wav, "the announcement");
    } catch (error) {
      throw new ApiError(400, "ivr_prompt_format", `${error instanceof Error ? error.message : "the announcement could not be read"}. Expected ${FORMAT}.`);
    }
    if (pcm.length < 2 || pcm.length % 2 !== 0) throw new ApiError(400, "ivr_prompt_format", `The announcement has no audio. Expected ${FORMAT}.`);
    // O piso compara a duração medida, sem arredondar: 199,9 ms arredondado daria 200 e passaria.
    const measuredMs = (pcm.length / 2 / RECORDED_SPEECH_SAMPLE_RATE) * 1000;
    if (measuredMs < IVR_MIN_PROMPT_MS) throw new ApiError(400, "ivr_prompt_too_short", `The announcement lasts ${Math.floor(measuredMs)} ms; it must last at least ${IVR_MIN_PROMPT_MS} ms.`);
    const ms = Math.round(measuredMs);
    if (ms > IVR_MAX_PROMPT_MS) throw new ApiError(400, "ivr_prompt_too_long", `The announcement lasts ${Math.ceil(ms / 1000)} s; the limit is 60 s.`);
    const saved = await withOrg(deps.db, session.organizationId, (q) =>
      q.one<{ id: string; promptAudioMs: number }>(`update ivr_menus set prompt_audio = $2, prompt_audio_ms = $3, updated_at = $4 where id = $1 returning id, prompt_audio_ms as "promptAudioMs"`, [
        id,
        pcm,
        ms,
        deps.clock.now(),
      ]),
    );
    if (!saved) throw notFound();
    return Response.json({ ok: true, data: saved });
  } catch (error) {
    return failure(error);
  }
}

/** O anúncio como WAV, para o "Ouvir" da tela. Sem anúncio, 404. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const deps = serverDeps();
    const session = await requireSession(request, deps);
    const { id } = await context.params;
    if (!UUID.test(id)) throw notFound();
    const row = await withOrg(deps.db, session.organizationId, (q) => q.one<{ prompt_audio: Buffer | null }>("select prompt_audio from ivr_menus where id = $1", [id]));
    if (!row?.prompt_audio) throw notFound();
    const wav = recordedSpeechWav(row.prompt_audio);
    return new Response(new Uint8Array(wav), { headers: { "content-type": "audio/wav", "content-length": String(wav.length), "cache-control": "private, no-store" } });
  } catch (error) {
    return failure(error);
  }
}
