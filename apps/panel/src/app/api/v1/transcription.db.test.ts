import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { encryptSecret, recordingPath, withOrg } from "@deskvoice/core";
import { afterAll, describe, expect, it } from "vitest";
import { NOW, call, createCall, createOrganization, createUser, startPanel } from "../../../../test/kit";
import { POST } from "./calls/[id]/transcription/route";

const panel = startPanel();
afterAll(() => panel.close());

const KEY = "engine.openai-realtime.api_key";
const TEXT = "Oi, preciso remarcar a consulta de quinta.";

async function seed(org: string, options: { withKey?: boolean; withAudio?: boolean } = {}): Promise<string> {
  const callId = await createCall(panel.app, org, NOW);
  await withOrg(panel.app, org, async (q) => {
    await q.exec("update calls set engine = 'openai-realtime' where id = $1", [callId]);
    if (options.withKey !== false) {
      await q.exec("insert into settings (organization_id, key, value) values ($1, $2, to_jsonb($3::text))", [
        org,
        KEY,
        encryptSecret("sk-de-teste", panel.deps.secretKey),
      ]);
    }
  });
  const file = recordingPath(panel.deps.recordingsDir, org, callId);
  await mkdir(path.dirname(file), { recursive: true });
  if (options.withAudio !== false) await writeFile(file, Buffer.from("RIFF....WAVE"));
  return callId;
}

const post = (cookie: string, id: string) => call(POST, { method: "POST", cookie, params: { id } });

describe("transcrição da gravação", () => {
  it("transcreve, grava na linha do tempo e não chama o provedor duas vezes", async () => {
    const org = await createOrganization(panel.app, "transcribe one");
    const owner = await createUser(panel.app, org, "owner");
    const callId = await seed(org);

    panel.voice.requests.length = 0;
    panel.voice.respond = async () => new Response(JSON.stringify({ text: TEXT }), { status: 200, headers: { "content-type": "application/json" } });

    const first = await post(owner.cookie, callId);
    expect(first.status).toBe(200);
    expect(first.data).toEqual({ text: TEXT, cached: false });
    expect(panel.voice.requests).toHaveLength(1);

    const events = await withOrg(panel.app, org, (q) =>
      q.many<{ kind: string; payload: { text: string; source: string } }>("select kind, payload from call_events where call_id = $1 and kind = 'transcript_user'", [callId]),
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toMatchObject({ text: TEXT, source: "stt", engine: "openai-realtime" });

    const second = await post(owner.cookie, callId);
    expect(second.data).toEqual({ text: TEXT, cached: true });
    expect(panel.voice.requests).toHaveLength(1);
  });

  it("sem chave do provedor, recusa dizendo o que falta e não chama ninguém", async () => {
    const org = await createOrganization(panel.app, "transcribe no key");
    const owner = await createUser(panel.app, org, "owner");
    const callId = await seed(org, { withKey: false });
    panel.voice.requests.length = 0;

    const result = await post(owner.cookie, callId);
    expect([result.status, result.code]).toEqual([409, "no_key"]);
    expect(panel.voice.requests).toHaveLength(0);
  });

  it("sem gravação, 404", async () => {
    const org = await createOrganization(panel.app, "transcribe no audio");
    const owner = await createUser(panel.app, org, "owner");
    const callId = await seed(org, { withAudio: false });

    const result = await post(owner.cookie, callId);
    expect(result.status).toBe(404);
  });
});
