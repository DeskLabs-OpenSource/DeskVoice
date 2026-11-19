// T8 da URA (#223): o anúncio do menu por teclas fica no banco (`ivr_menus.prompt_audio`), e não em
// `recordings/`, porque não é dado de quem liga. O expurgo por prazo e o apagamento a pedido do
// titular rodam numa organização com menu, apagam o que é deles, e o anúncio continua lá.
import { access, mkdir, mkdtemp, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ERASE_RECORDINGS_TASK, eraseCaller, recordingPath, withOrg, withSystem } from "@deskvoice/core";
import { afterAll, describe, expect, it } from "vitest";
import { createCall, createOrganization, depsFor, openTestDbs, putSetting, t0, task } from "../test/helpers";
import eraseRecordings from "./routines/erase_recordings";
import purgeTranscripts from "./routines/purge_transcripts";

const { app, owner } = openTestDbs();
afterAll(async () => {
  await app.close();
  await owner.close();
});

const CALLER = "+5531999998888";
const DAY_MS = 24 * 60 * 60 * 1000;

/** O menu, com o anúncio e as opções, e a foto de tudo o que ele guarda. */
async function menuOf(org: string): Promise<{ id: string; snapshot: () => Promise<unknown> }> {
  const prompt = Buffer.alloc(16_000, 7);
  const row = await withSystem(app, (q) =>
    q.one<{ id: string }>(
      "insert into ivr_menus (organization_id, name, prompt_audio, prompt_audio_ms, created_at, updated_at) values ($1, 'Menu principal', $2, 1000, $3, $3) returning id",
      [org, prompt, t0],
    ),
  );
  const id = row?.id ?? "";
  // A pessoa do menu tem o mesmo número de quem pede o apagamento: o menu é configuração, não dado dele.
  await withSystem(app, (q) => q.exec("insert into ivr_options (organization_id, menu_id, digit, label, action, transfer_e164) values ($1, $2, '1', 'Recepção', 'transfer', $3)", [org, id, CALLER]));
  const snapshot = () =>
    withSystem(app, async (q) => ({
      menu: await q.one("select name, prompt_audio, prompt_audio_ms from ivr_menus where id = $1", [id]),
      options: await q.many("select digit, label, action, transfer_e164 from ivr_options where menu_id = $1", [id]),
    }));
  return { id, snapshot };
}

async function recordedCall(dir: string, org: string, at: Date): Promise<{ callId: string; file: string }> {
  const callId = await createCall(app, org, at);
  await withSystem(app, (q) => q.exec("update calls set from_e164 = $2, ended_at = $3, status = 'completed' where id = $1", [callId, CALLER, at]));
  const file = recordingPath(dir, org, callId);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, "RIFF....WAVE");
  await utimes(file, at, at);
  return { callId, file };
}

describe("o anúncio do menu por teclas sobrevive ao expurgo e ao apagamento do titular", () => {
  it("o expurgo por prazo apaga a gravação velha da organização, e o anúncio continua", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "deskvoice-ivr-purge-"));
    const org = await createOrganization(app, "ivr purge");
    await putSetting(app, org, "transcripts.retention_days", 30, false);
    const menu = await menuOf(org);
    const before = await menu.snapshot();
    const old = await recordedCall(dir, org, new Date(t0.getTime() - 40 * DAY_MS));

    await purgeTranscripts.run(task(org, "purge_transcripts"), depsFor(app, { recordingsDir: dir }));

    await expect(access(old.file)).rejects.toThrow();
    expect(await menu.snapshot()).toEqual(before);
    expect(((await menu.snapshot()) as { menu: { prompt_audio: Buffer } }).menu.prompt_audio).toHaveLength(16_000);
  });

  it("o apagamento a pedido do titular apaga a chamada e a gravação dele, e o anúncio e as opções continuam", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "deskvoice-ivr-erase-"));
    const org = await createOrganization(app, "ivr erase");
    const menu = await menuOf(org);
    const before = await menu.snapshot();
    const call = await recordedCall(dir, org, t0);

    const counts = await withOrg(app, org, (q) => eraseCaller(q, { dir, phoneE164: CALLER, now: t0 }));
    expect(counts).toMatchObject({ calls: 1 });
    await eraseRecordings.run(task(org, ERASE_RECORDINGS_TASK), depsFor(app, { recordingsDir: dir }));

    await expect(access(call.file)).rejects.toThrow();
    expect(await menu.snapshot()).toEqual(before);
  });
});
