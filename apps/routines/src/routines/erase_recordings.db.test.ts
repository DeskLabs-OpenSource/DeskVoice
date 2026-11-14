import { access, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ERASE_RECORDINGS_TASK, recordingPath, withSystem } from "@deskvoice/core";
import { afterAll, describe, expect, it } from "vitest";
import { createCall, createOrganization, depsFor, openTestDbs, t0, task } from "../../test/helpers";
import eraseRecordings from "./erase_recordings";

const { app, owner } = openTestDbs();
afterAll(async () => {
  await app.close();
  await owner.close();
});

async function recorded(dir: string, org: string, erased: boolean): Promise<string> {
  const callId = await createCall(app, org, t0);
  if (erased) await withSystem(app, (q) => q.exec("update calls set erased_at = $2 where id = $1", [callId, t0]));
  const file = recordingPath(dir, org, callId);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, "RIFF....WAVE");
  return file;
}

describe("erase_recordings", () => {
  it("apaga só a gravação das chamadas apagadas a pedido do titular e registra quantas saíram", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "deskvoice-erase-"));
    const org = await createOrganization(app, "erase recordings");
    const erased = await recorded(dir, org, true);
    const kept = await recorded(dir, org, false);

    await eraseRecordings.run(task(org, ERASE_RECORDINGS_TASK), depsFor(app, { recordingsDir: dir }));

    await expect(access(erased)).rejects.toThrow();
    await expect(access(kept)).resolves.toBeUndefined();
    const events = await withSystem(app, (q) => q.many<{ payload: unknown }>("select payload from organization_events where organization_id = $1 and kind = 'caller_recordings_erased'", [org]));
    expect(events.map((event) => event.payload)).toEqual([{ removed: 1, left: 0 }]);
  });

  it("falha, para a fila tentar de novo, quando um arquivo não sai ou não há pasta de gravações", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "deskvoice-erase-"));
    const org = await createOrganization(app, "erase recordings stuck");
    const callId = await createCall(app, org, t0);
    await withSystem(app, (q) => q.exec("update calls set erased_at = $2 where id = $1", [callId, t0]));
    // No lugar do arquivo, uma pasta: `rm` sem `recursive` recusa.
    await mkdir(path.join(recordingPath(dir, org, callId), "dentro"), { recursive: true });

    await expect(eraseRecordings.run(task(org, ERASE_RECORDINGS_TASK), depsFor(app, { recordingsDir: dir }))).rejects.toThrow(/1 recording\(s\) of erased calls were not removed/);
    await expect(eraseRecordings.run(task(org, ERASE_RECORDINGS_TASK), depsFor(app))).rejects.toThrow(/needs RECORDINGS_DIR/);
  });
});
