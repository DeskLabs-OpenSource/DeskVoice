// Troncos aplicados a partir do banco, situação lida da ARI, ligação de saída e chamada simulada
// pela API interna.
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { withSystem } from "@deskvoice/core";
import { loadTools } from "@deskvoice/tools";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { openTestDbs } from "../../../packages/core/test/helpers";
import { putSetting, tasksOf } from "../../../packages/tools/test/helpers";
import { AsteriskCalls, type ExpectedCall } from "./asterisk-transport";
import { startOutboundCall } from "./outbound";
import { startVoiceServer, type VoiceServer } from "./server";
import {
  approvalsOf,
  callOf,
  callsOf,
  createAgent,
  createOrganization,
  createPhoneNumber,
  createTrunk,
  decideApproval,
  eventsOf,
  fakeAri,
  fakeClock,
  kindsOf,
  secretKey,
  testSchedule,
  type FakeAri,
} from "./testing/db";
import { waitFor } from "./testing/helpers";
import { applyTrunks, checkTrunks, type TrunksDeps } from "./trunks";
import { createSimulatedEngine } from "@deskvoice/voice-engine";

const { app, owner } = openTestDbs();
let scratch: string;
let server: VoiceServer | undefined;

beforeAll(async () => {
  scratch = await mkdtemp(path.join(tmpdir(), "deskvoice-control-"));
});
afterEach(async () => {
  await server?.close();
  server = undefined;
});
afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
  await app.close();
  await owner.close();
});

const trunkRow = (id: string) => withSystem(app, (q) => q.one<{ status: string; last_error: string | null; last_check_at: Date | null }>("select status, last_error, last_check_at from trunks where id = $1", [id]));

function trunksDeps(ari: FakeAri, file: string): TrunksDeps {
  return { db: app, ari, clock: fakeClock(), secretKey, file, publicIp: "203.0.113.10", log: () => undefined };
}

describe("troncos", { timeout: 120_000 }, () => {
  it("gera o arquivo com as linhas do banco (senha decifrada, IP da organização), recarrega o PJSIP e deixa de fora a linha maliciosa", async () => {
    const organizationId = await createOrganization(app, "trunks-apply");
    const good = await createTrunk(app, organizationId, { host: "sip.boa.example", username: "conta100", password: "s3nha-boa" });
    const evil = await createTrunk(app, organizationId, { host: "sip.ma.example\n[hacker]\ntype=endpoint", username: "conta200", password: "x" });
    await putSetting(app, organizationId, "network.public_ip", "198.51.100.77", false);
    const ari = fakeAri();
    const file = path.join(scratch, "apply", "pjsip_trunks.conf");

    const result = await applyTrunks(trunksDeps(ari, file));
    expect(result.applied).toBe(true);
    expect(result.skipped).toContainEqual({ id: evil, reason: expect.stringContaining("host") });
    expect(ari.log).toEqual(["reload res_pjsip.so"]);

    const conf = await readFile(file, "utf8");
    expect(conf).toContain(`[trunk-${good}-registration]`);
    expect(conf).toContain("password=s3nha-boa\n");
    expect(conf).toContain(`[trunk-${good}]\ntype=endpoint`);
    expect(conf.slice(conf.indexOf(`[trunk-${good}]`), conf.indexOf(`[trunk-${good}-auth]`))).toContain("from_domain=198.51.100.77");
    expect(conf).toContain(`line=yes\nendpoint=trunk-${good}\n`);
    expect(conf).not.toContain("hacker");
    expect(conf).not.toContain(evil);
    expect(await trunkRow(evil)).toMatchObject({ status: "fail", last_error: expect.stringContaining("left out") });
    expect((await trunkRow(good))?.status).toBe("unverified");
  });

  it("dois troncos por endereço no mesmo host, em organizações diferentes: nenhum é emitido e cada um vê o erro, sem nada do outro", async () => {
    const first = await createOrganization(app, "trunks-shared-a");
    const second = await createOrganization(app, "trunks-shared-b");
    const options = { host: "198.51.100.99", username: null, password: null, authMode: "ip" as const };
    const mine = await createTrunk(app, first, options);
    const theirs = await createTrunk(app, second, { ...options, host: "198.51.100.99:5080" });
    const ari = fakeAri();
    const deps = trunksDeps(ari, path.join(scratch, "shared", "pjsip_trunks.conf"));
    await applyTrunks(deps);

    const conf = await readFile(deps.file, "utf8");
    expect(conf).not.toContain(mine);
    expect(conf).not.toContain(theirs);
    expect(conf).not.toContain("198.51.100.99");
    for (const [id, other, otherOrg] of [[mine, theirs, second], [theirs, mine, first]] as const) {
      const row = await trunkRow(id);
      expect(row).toMatchObject({ status: "fail", last_error: expect.stringMatching(/already used by another line of this installation.*registration/) });
      expect(row?.last_error).not.toContain(other);
      expect(row?.last_error).not.toContain(otherOrg);
    }
    // A conferência de saúde mantém o motivo, em vez de trocar por "não carregada".
    const health = (await checkTrunks(deps)).find((trunk) => trunk.id === mine);
    expect(health).toMatchObject({ status: "fail", detail: expect.stringContaining("already used by another line") });
    expect((await trunkRow(mine))?.last_error).toContain("already used by another line");
  });

  it("sem Asterisk no ar o arquivo é escrito mesmo assim e o resultado diz que falta recarregar", async () => {
    const ari = fakeAri();
    ari.failing = true;
    const file = path.join(scratch, "down", "pjsip_trunks.conf");
    const result = await applyTrunks(trunksDeps(ari, file));
    expect(result).toMatchObject({ applied: false, detail: expect.stringContaining("did not reload") });
    expect(await readFile(file, "utf8")).toContain("Gerado pelo DeskVoice");
  });

  it("lê da ARI a situação de cada linha e grava em trunks", async () => {
    const organizationId = await createOrganization(app, "trunks-check");
    const [online, offline, unknown, missing] = await Promise.all([1, 2, 3, 4].map(() => createTrunk(app, organizationId)));
    const ari = fakeAri();
    ari.endpoints = [
      { resource: `trunk-${online}`, state: "online" },
      { resource: `trunk-${offline}`, state: "offline" },
      { resource: `trunk-${unknown}`, state: "unknown" },
    ];
    const deps = trunksDeps(ari, path.join(scratch, "check.conf"));
    const mine = async () => (await checkTrunks(deps)).filter((trunk) => [online, offline, unknown, missing].includes(trunk.id));
    expect(Object.fromEntries((await mine()).map((trunk) => [trunk.id, trunk.status]))).toEqual({ [online ?? ""]: "ok", [offline ?? ""]: "fail", [unknown ?? ""]: "warn", [missing ?? ""]: "fail" });
    expect(await trunkRow(online ?? "")).toMatchObject({ status: "ok", last_error: null, last_check_at: expect.any(Date) });
    expect(await trunkRow(offline ?? "")).toMatchObject({ status: "fail", last_error: expect.stringContaining("does not answer") });
    expect(await trunkRow(missing ?? "")).toMatchObject({ status: "fail", last_error: expect.stringContaining("not loaded") });

    ari.failing = true;
    expect((await mine()).map((trunk) => trunk.status)).toEqual(["fail", "fail", "fail", "fail"]);
    expect(await trunkRow(online ?? "")).toMatchObject({ status: "fail", last_error: expect.stringContaining("ARI is down") });
  });
});

describe("ligação de saída", { timeout: 120_000 }, () => {
  async function scene(label: string, policy: "on" | "off") {
    const organizationId = await createOrganization(app, label);
    const agentId = await createAgent(app, organizationId);
    const trunkId = await createTrunk(app, organizationId, { callerId: "+553133334444" });
    await createPhoneNumber(app, organizationId, trunkId, "+553133334444", agentId);
    if (policy === "on") await withSystem(app, (q) => q.exec("insert into outbound_policy (organization_id, enabled, window_start, window_end) values ($1, true, '00:00', '23:59')", [organizationId]));
    const ari = fakeAri();
    const clock = fakeClock();
    const expected: ExpectedCall[] = [];
    const calls = new AsteriskCalls({ ari, db: app, clock, log: () => undefined });
    const track = calls.expect.bind(calls);
    calls.expect = (call) => (expected.push(call), track(call));
    const dial = (toE164: string) => startOutboundCall({ db: app, ari, clock, calls, log: () => undefined }, { organizationId, agentId, toE164 });
    return { organizationId, agentId, trunkId, ari, expected, dial };
  }

  it("com a política desligada (o padrão) não origina nada, e a recusa fica auditável", async () => {
    const { organizationId, ari, expected, dial } = await scene("outbound-off", "off");
    expect(await dial("(31) 99999-8888")).toEqual({ code: "outbound_disabled", message: expect.any(String) });
    expect(ari.originated).toEqual([]);
    expect(expected).toEqual([]);
    const calls = await callsOf(app, organizationId);
    expect(calls).toMatchObject([{ direction: "outbound", status: "refused", end_reason: "outbound_disabled", to_e164: "+5531999998888", ended_at: expect.any(Date) }]);
    expect(await eventsOf(app, calls[0]?.id ?? "")).toEqual([{ kind: "call_refused", payload: { reason: "outbound_disabled", message: expect.any(String), to: "+5531999998888" } }]);
  });

  it("permitida: cria a chamada e origina pelo tronco do agente, com o id da chamada como canal e UUID do áudio", async () => {
    const { organizationId, agentId, trunkId, ari, expected, dial } = await scene("outbound-on", "on");
    const result = await dial("(31) 99999-8888");
    const calls = await callsOf(app, organizationId);
    expect(calls).toMatchObject([{ direction: "outbound", status: "ringing", from_e164: "+553133334444", to_e164: "+5531999998888", agent_id: agentId }]);
    const callId = calls[0]?.id ?? "";
    expect(result).toEqual({ callId });
    expect(ari.originated).toEqual([
      { endpoint: `PJSIP/5531999998888@trunk-${trunkId}`, context: "deskvoice-audio", extension: "s", channelId: callId, callerId: "+553133334444", variables: { AUDIOSOCKET_UUID: callId } },
    ]);
    expect(expected).toEqual([{ callId, channelId: callId, organizationId, agentId, trunkId }]);
  });

  // Corrida: sem a trava na política, as duas transações contam zero e as duas ligam.
  for (const [limit, code] of [["daily_cap_per_line", "daily_cap_reached"], ["max_attempts_per_contact", "attempts_exhausted"]] as const) {
    it(`duas ligações em paralelo com ${limit} = 1: exatamente uma sai, a outra recebe ${code}`, async () => {
      for (let round = 0; round < 5; round++) {
        const { organizationId, ari, dial } = await scene(`outbound-race-${limit}-${round}`, "on");
        await withSystem(app, (q) => q.exec(`update outbound_policy set ${limit} = 1 where organization_id = $1`, [organizationId]));
        const results = await Promise.all([dial("+5531999998888"), dial("+5531999998888"), dial("+5531999998888")]);
        expect(results.filter((result) => "callId" in result), `round ${round}`).toHaveLength(1);
        expect(results.filter((result) => "code" in result).map((result) => ("code" in result ? result.code : ""))).toEqual([code, code]);
        expect(ari.originated).toHaveLength(1);
        expect((await callsOf(app, organizationId)).map((call) => call.status).sort()).toEqual(["refused", "refused", "ringing"]);
      }
    });
  }

  it("ligação que o Asterisk não consegue originar fica como falha e conta como tentativa", async () => {
    const { organizationId, ari, dial } = await scene("outbound-failed-counts", "on");
    await withSystem(app, (q) => q.exec("update outbound_policy set max_attempts_per_contact = 1 where organization_id = $1", [organizationId]));
    ari.failing = true;
    expect(await dial("+5531999998888")).toMatchObject({ code: "originate_failed" });
    ari.failing = false;
    expect(await dial("+5531999998888")).toMatchObject({ code: "attempts_exhausted" });
    expect(ari.originated).toEqual([]);
  });

  it("número inválido, agente de outra organização e Asterisk fora do ar devolvem código, sem originar", async () => {
    const { organizationId, agentId, ari, dial } = await scene("outbound-errors", "on");
    expect(await dial("abc")).toMatchObject({ code: "invalid_number" });
    const other = await createOrganization(app, "outbound-errors-other");
    const clock = fakeClock();
    const calls = new AsteriskCalls({ ari, db: app, clock, log: () => undefined });
    expect(await startOutboundCall({ db: app, ari, clock, calls, log: () => undefined }, { organizationId: other, agentId, toE164: "+5531999998888" })).toMatchObject({ code: "agent_not_found" });
    expect(await callsOf(app, organizationId)).toEqual([]);

    ari.failing = true;
    expect(await dial("+5531999998888")).toMatchObject({ code: "originate_failed" });
    expect(ari.originated).toEqual([]);
    const failed = await callsOf(app, organizationId);
    expect(failed).toMatchObject([{ status: "failed", end_reason: "no_answer" }]);
    expect(await kindsOf(app, failed[0]?.id ?? "")).toEqual(["call_ended"]);
  });
});

describe("chamada simulada pela API interna", { timeout: 120_000 }, () => {
  it("responde logo com o callId e roda o roteiro de demonstração em segundo plano, esperando a aprovação do painel", async () => {
    const organizationId = await createOrganization(app, "simulate-api");
    // O agente usa um motor com chave e não tem as ferramentas do roteiro: a simulação troca os dois.
    const agentId = await createAgent(app, organizationId, { engine: "openai-realtime", transferTo: "+5531988887777", greeting: "Clínica Bem Viver, bom dia." });
    const timers = testSchedule();
    const clock = fakeClock();
    const ari = fakeAri();
    ari.failing = true; // sem Asterisk: a simulação não depende dele
    server = await startVoiceServer({
      db: app, clock, engines: new Map([["simulated", createSimulatedEngine()]]), tools: await loadTools(), ari, secretKey,
      audioSocketPort: 0, internalPort: 0, internalToken: "token-de-teste", trunksFile: path.join(scratch, "simulate.conf"), publicIp: null, host: "127.0.0.1",
      schedule: timers.schedule, now: timers.now,
    });
    const post = (body: object) =>
      fetch(`http://127.0.0.1:${server?.internalPort}/calls/simulate`, { method: "POST", headers: { "x-internal-token": "token-de-teste", "content-type": "application/json" }, body: JSON.stringify(body) });

    const response = await post({ organizationId, agentId });
    expect(response.status).toBe(200);
    const { callId } = (await response.json()) as { callId: string };

    const approval = await waitFor(async () => (await approvalsOf(app, callId)).find((candidate) => candidate.status === "pending"), "the approval to wait for the panel");
    expect(approval.question).toMatch(/desconto/);
    expect((await callOf(app, callId)).status).toBe("in_progress");
    await decideApproval(app, approval.id, "approved", clock.now());
    await waitFor(async () => (await kindsOf(app, callId)).includes("task_queued"), "the simulated call to end");

    const kinds = await kindsOf(app, callId);
    expect(kinds.filter((kind) => !kind.startsWith("transcript"))).toEqual([
      "call_started", "call_answered", "tool_called", "human_notified", "tool_result", "tool_called", "approval_requested", "approval_decided", "tool_result",
      "tool_called", "transfer_started", "tool_result", "call_ended", "task_queued",
    ]);
    expect(kinds.filter((kind) => kind === "transcript_user")).toHaveLength(1);
    expect(await callOf(app, callId)).toMatchObject({ status: "transferred", end_reason: "transferred", engine: "simulated" });
    expect((await tasksOf(app, organizationId)).filter((task) => task.kind === "summarize_call")).toHaveLength(1);

    // Agente que não existe nesta organização: recusa com código.
    const refused = await post({ organizationId: await createOrganization(app, "simulate-api-other"), agentId });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ code: "agent_not_found" });

    const health = await (await fetch(`http://127.0.0.1:${server.internalPort}/health`)).json();
    expect(health).toMatchObject({ asterisk: { status: "fail", detail: "ARI is down" } });
  });
});
