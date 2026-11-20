// Troncos aplicados a partir do banco, situação lida da ARI, ligação de saída e chamada simulada
// pela API interna.
import { randomInt } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
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
import { applyTrunks, BLOCK_TOO_WIDE_REASON, checkTrunks, extraNameReason, refreshAllowed, type ResolveName, type TrunksDeps } from "./trunks";
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
const allowedRow = (id: string) =>
  withSystem(app, (q) => q.one<{ inbound_allowed: string[]; inbound_resolved_at: Date | null }>("select inbound_allowed, inbound_resolved_at from trunks where id = $1", [id]));

/** O DNS dos testes: todo nome resolve para um endereço de documentação, salvo o que o caso pedir. */
const anyName: ResolveName = async () => ["192.0.2.53"];

function trunksDeps(ari: FakeAri, file: string, clock = fakeClock(), resolve: ResolveName = anyName): TrunksDeps {
  return { db: app, ari, clock, secretKey, file, publicIp: "203.0.113.10", resolve, log: () => undefined };
}

describe("troncos", { timeout: 120_000 }, () => {
  it("gera o arquivo com as linhas do banco (senha decifrada, IP da organização), recarrega o PJSIP e deixa de fora a linha maliciosa", async () => {
    const organizationId = await createOrganization(app, "trunks-apply");
    const good = await createTrunk(app, organizationId, { host: "sip.boa.example", username: "conta100", password: "s3nha-boa" });
    const evil = await createTrunk(app, organizationId, { host: "sip.ma.example\n[hacker]\ntype=endpoint", username: "conta200", password: "x" });
    await putSetting(app, organizationId, "network.public_ip", "198.51.100.77", false);
    const ari = fakeAri();
    const file = path.join(scratch, "apply", "pjsip_trunks.conf");
    ari.loadsFile = file;

    const result = await applyTrunks(trunksDeps(ari, file));
    expect(result).toMatchObject({ applied: true, detail: expect.stringContaining("listed by the telephony server") });
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

  it("escreve todos os blocos de uma linha; nome na entrada e bloco largo demais ficam de fora com o motivo", async () => {
    const organizationId = await createOrganization(app, "trunks-blocks");
    const options = { username: null, password: null, authMode: "ip" as const };
    const blocks = ["54.171.127.192/30", "35.156.191.128/30"];
    const twilio = await createTrunk(app, organizationId, { ...options, host: blocks[0] ?? "", matchExtra: [blocks[1] ?? ""], outboundHost: "conta.pstn.twilio.com" });
    // Linhas gravadas antes da recusa na tela: o arquivo não as escreve, e a tela da linha mostra o motivo.
    const named = await createTrunk(app, organizationId, { ...options, host: "54.65.63.192/30", matchExtra: ["blocos.operadora.example"] });
    const wide = await createTrunk(app, organizationId, { ...options, host: "10.0.0.0/8" });

    const file = path.join(scratch, "blocks", "pjsip_trunks.conf");
    const ari = fakeAri();
    ari.loadsFile = file;
    const result = await applyTrunks(trunksDeps(ari, file));
    // O banco é o mesmo do arquivo inteiro: as linhas de outros casos não importam aqui, só as três.
    expect(result.applied).toBe(true);
    expect(result.skipped.filter((entry) => [twilio, named, wide].includes(entry.id))).toEqual([
      { id: named, reason: extraNameReason(1) },
      { id: wide, reason: BLOCK_TOO_WIDE_REASON },
    ].sort((a, b) => a.id.localeCompare(b.id)));

    const conf = await readFile(file, "utf8");
    expect(conf).toContain("match=54.171.127.192/30\nmatch=35.156.191.128/30\n");
    expect(conf).toContain("contact=sip:conta.pstn.twilio.com\n");
    expect(conf).toContain(`[trunk-${twilio}-identify]`);
    expect(conf).not.toContain(named);
    expect(conf).not.toContain(wide);
    expect(conf).not.toContain("10.0.0.0/8");
    expect(await trunkRow(wide)).toMatchObject({ status: "fail", last_error: `This line was left out of the telephony configuration: ${BLOCK_TOO_WIDE_REASON}.` });
    expect(await trunkRow(named)).toMatchObject({ status: "fail", last_error: expect.stringContaining(extraNameReason(1)) });
  });

  it("endereço repetido: entre organizações ninguém em modo ip é emitido; dentro da mesma organização, só o de menor id; e nada de estado ao lado do arquivo", async () => {
    const first = await createOrganization(app, "trunks-shared-a");
    const second = await createOrganization(app, "trunks-shared-b");
    const options = { username: null, password: null, authMode: "ip" as const };
    const mine = await createTrunk(app, first, { ...options, host: "198.51.100.99" });
    // Outra organização, o mesmo endereço em outra grafia.
    const theirs = await createTrunk(app, second, { ...options, host: "198.051.100.099:5080" });
    // Na mesma organização, duas linhas no mesmo endereço.
    const twins = [await createTrunk(app, first, { ...options, host: "198.51.100.98" }), await createTrunk(app, first, { ...options, host: "198.51.100.98" })].sort();
    // Registro de uma organização no endereço da linha por IP de outra.
    const registered = await createTrunk(app, first, { host: "198.51.100.96" });
    const ipOnRegistered = await createTrunk(app, second, { ...options, host: "198.51.100.96" });

    const dir = path.join(scratch, "shared");
    const ari = fakeAri();
    const deps = trunksDeps(ari, path.join(dir, "pjsip_trunks.conf"));
    ari.loadsFile = deps.file;
    await applyTrunks(deps);
    await applyTrunks(deps);
    const conf = await readFile(deps.file, "utf8");
    expect(await readdir(dir)).toEqual(["pjsip_trunks.conf"]);

    for (const [id, other, otherOrg] of [[mine, theirs, second], [theirs, mine, first]] as const) {
      expect(conf).not.toContain(id);
      const row = await trunkRow(id);
      expect(row).toMatchObject({ status: "fail", last_error: expect.stringMatching(/already used by another line of this installation.*registration/) });
      for (const secret of [other, otherOrg, "198.51", "Operadora"]) expect(row?.last_error).not.toContain(secret);
    }
    expect(conf).not.toContain("198.51.100.99");

    expect(conf).toContain(`[trunk-${twins[0]}-identify]`);
    expect(conf).not.toContain(twins[1] ?? "");
    expect((await trunkRow(twins[0] ?? ""))?.status).toBe("unverified");
    expect((await trunkRow(twins[1] ?? ""))?.status).toBe("fail");

    expect(conf).toContain(`[trunk-${registered}-registration]`);
    expect(conf).toContain(`line=yes\nendpoint=trunk-${registered}\n`);
    expect(conf).not.toContain(`[trunk-${registered}-identify]`);
    expect(conf).not.toContain(ipOnRegistered);
    expect((await trunkRow(ipOnRegistered))?.status).toBe("fail");

    // A conferência de saúde mantém o motivo, em vez de trocar por "não carregada".
    const health = (await checkTrunks(deps)).find((trunk) => trunk.id === mine);
    expect(health).toMatchObject({ status: "fail", detail: expect.stringContaining("already used by another line") });
  });

  it("recarregou mas o Asterisk não lista a linha (arquivo ilegível ou com erro): não diz que aplicou, e a linha fica com a causa provável", async () => {
    const organizationId = await createOrganization(app, "trunks-unreadable");
    const trunk = await createTrunk(app, organizationId, { host: "198.51.100.90" });
    const ari = fakeAri(); // recarrega com sucesso, mas não lista endpoint nenhum
    // Confere algumas vezes antes de desistir (o Asterisk leva um instante para listar); aqui, sem esperar.
    const waits: number[] = [];
    const deps: TrunksDeps = { ...trunksDeps(ari, path.join(scratch, "unreadable", "pjsip_trunks.conf")), schedule: (fn, delayMs) => (waits.push(delayMs), setImmediate(fn), () => undefined) };
    const result = await applyTrunks(deps);
    expect(waits).toEqual([400, 400, 400, 400]);
    expect(ari.log).toEqual(["reload res_pjsip.so"]);
    expect(result).toMatchObject({ applied: false, detail: expect.stringMatching(/does not list the written lines.*cannot read the generated lines file.*syntax error/) });
    expect(await readFile(deps.file, "utf8")).toContain(`[trunk-${trunk}]`);
    expect(await trunkRow(trunk)).toMatchObject({ status: "fail", last_error: expect.stringMatching(/does not list this line.*owner or permissions/) });

    // Quando o Asterisk passa a ler o arquivo, a mesma aplicação diz que carregou.
    ari.loadsFile = deps.file;
    expect(await applyTrunks(deps)).toMatchObject({ applied: true });
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
    expect(await trunkRow(missing ?? "")).toMatchObject({ status: "fail", last_error: expect.stringMatching(/does not list this line.*cannot read the generated lines file/) });

    ari.failing = true;
    expect((await mine()).map((trunk) => trunk.status)).toEqual(["fail", "fail", "fail", "fail"]);
    expect(await trunkRow(online ?? "")).toMatchObject({ status: "fail", last_error: expect.stringContaining("ARI is down") });
  });
});

// R14, fatia 1: o conjunto liberado de cada linha, gravado pelo processo de voz para a tela mostrar.
describe("endereços liberados por linha", { timeout: 120_000 }, () => {
  const NAME = "sip.conjunto.example";

  it("grava o conjunto de cada formato de linha; a linha deixada de fora fica vazia; e o arquivo não muda", async () => {
    const organizationId = await createOrganization(app, "allowed-formats");
    // Endereços próprios desta rodada: uma linha por IP de rodada anterior no mesmo banco (outra
    // organização) tiraria a deste caso do arquivo pela regra de endereço compartilhado.
    // Fora de 100.64/16: o rules.db.test.ts do painel grava uma linha 100.64.0.0/16 no mesmo banco, e
    // a sobreposição tiraria a linha deste caso do arquivo (falhou assim no CI em 18/11, 1 vez em 64).
    const net = `100.${randomInt(65, 128)}.${randomInt(0, 256)}`;
    const v6 = `2001:db8:${randomInt(1, 0xffff).toString(16)}::140`;
    const ip = { username: null, password: null, authMode: "ip" as const };
    const byIp = await createTrunk(app, organizationId, { ...ip, host: `${net}.140` });
    const byIpExtra = await createTrunk(app, organizationId, { ...ip, host: `${net}.144/30`, matchExtra: [v6.toUpperCase(), `${net}.144/30`] });
    const registerIp = await createTrunk(app, organizationId, { host: "203.0.113.140:5080" });
    const registerName = await createTrunk(app, organizationId, { host: `${NAME}:5060`, matchExtra: ["198.51.100.150"] });
    const leftOut = await createTrunk(app, organizationId, { ...ip, host: "10.0.0.0/8" });
    // De fora por outro motivo, com um endereço que serviria: mesmo assim, vazio.
    const leftOutWithAddress = await createTrunk(app, organizationId, { ...ip, host: `${net}.170`, matchExtra: ["nome.example"] });
    const resolve: ResolveName = async (name) => (name === NAME ? ["203.0.113.152", "203.0.113.151"] : anyName(name));
    const ari = fakeAri();
    const deps = trunksDeps(ari, path.join(scratch, "allowed", "pjsip_trunks.conf"), fakeClock(), resolve);
    ari.loadsFile = deps.file;
    expect(await applyTrunks(deps)).toMatchObject({ applied: true });

    expect((await allowedRow(byIp))?.inbound_allowed).toEqual([`${net}.140`]);
    expect((await allowedRow(byIpExtra))?.inbound_allowed).toEqual([`${net}.144/30`, v6]);
    expect((await allowedRow(registerIp))?.inbound_allowed).toEqual(["203.0.113.140"]);
    expect((await allowedRow(registerName))?.inbound_allowed).toEqual(["203.0.113.151", "203.0.113.152", "198.51.100.150"]);
    expect(await allowedRow(leftOut)).toEqual({ inbound_allowed: [], inbound_resolved_at: null });
    expect(await allowedRow(leftOutWithAddress)).toEqual({ inbound_allowed: [], inbound_resolved_at: null });
    expect((await allowedRow(registerName))?.inbound_resolved_at).toEqual(deps.clock.now());

    // O extra da linha por registro não vira `identify`: só entra no filtro do endpoint dela (fatia 2).
    const conf = await readFile(deps.file, "utf8");
    expect(conf).not.toContain(`[trunk-${registerName}-identify]`);
    expect(conf).not.toContain("match=198.51.100.150");
    expect(conf.split("\n").filter((line) => line.endsWith("198.51.100.150"))).toEqual(["permit=198.51.100.150"]);
  });

  it("só grava quando o conjunto muda; nome que não resolve mantém o conjunto e deixa a linha 'warn'; voltando, o aviso sai", async () => {
    const organizationId = await createOrganization(app, "allowed-dns");
    const name = "sip.instavel.example";
    const line = await createTrunk(app, organizationId, { host: name });
    let answer: string[] | Error = ["203.0.113.160"];
    const resolve: ResolveName = async (asked) => {
      if (asked !== name) return anyName(asked);
      if (answer instanceof Error) throw answer;
      return answer;
    };
    const clock = fakeClock();
    const ari = fakeAri();
    const deps = trunksDeps(ari, path.join(scratch, "allowed-dns", "pjsip_trunks.conf"), clock, resolve);
    ari.loadsFile = deps.file;
    await applyTrunks(deps);
    const first = await allowedRow(line);
    expect(first?.inbound_allowed).toEqual(["203.0.113.160"]);

    // A mesma resposta não regrava a hora.
    clock.advance(60_000);
    expect(await refreshAllowed(deps)).toBe(false);
    expect(await allowedRow(line)).toEqual(first);

    // O DNS cai: o conjunto fica, e a linha pede atenção com o motivo.
    answer = Object.assign(new Error(`queryA ESERVFAIL ${name}`), { code: "ESERVFAIL" });
    clock.advance(60_000);
    expect(await refreshAllowed(deps)).toBe(false);
    expect(await allowedRow(line)).toEqual(first);
    expect(await trunkRow(line)).toMatchObject({ status: "warn", last_error: expect.stringMatching(/^The provider name could not be resolved \(sip\.instavel\.example: .*ESERVFAIL.*keeps the addresses it had/) });
    // Aplicar de novo (salvar a linha na tela) também não esvazia.
    await applyTrunks(deps);
    expect(await allowedRow(line)).toEqual(first);
    // A conferência de saúde não apaga o aviso enquanto o provedor responde.
    const healthOnline = async () => {
      // A conferência lê a situação da ARI; aqui, o provedor da linha responde.
      ari.loadsFile = undefined;
      ari.endpoints = [{ resource: `trunk-${line}`, state: "online" }];
      const health = (await checkTrunks(deps)).find((trunk) => trunk.id === line);
      ari.loadsFile = deps.file;
      return health;
    };
    expect(await healthOnline()).toMatchObject({ status: "warn", detail: expect.stringContaining("could not be resolved") });

    // Volta a resolver, para outro endereço: grava o novo conjunto com a hora, aplica de novo e tira o
    // aviso. O endereço anterior, visto há minutos, continua na janela de 24 horas (R14, fatia 2).
    answer = ["203.0.113.161"];
    clock.advance(60_000);
    ari.log.length = 0;
    expect(await refreshAllowed(deps)).toBe(true);
    expect(ari.log).toEqual(["reload res_pjsip.so"]);
    expect(await allowedRow(line)).toEqual({ inbound_allowed: ["203.0.113.160", "203.0.113.161"], inbound_resolved_at: clock.now() });
    expect(await trunkRow(line)).toMatchObject({ status: "unverified", last_error: null });
    expect(await healthOnline()).toMatchObject({ status: "ok" });
    // Passadas 24 horas sem o nome devolver o anterior, ele sai.
    clock.advance(24 * 3_600_000);
    expect(await refreshAllowed(deps)).toBe(true);
    expect(await allowedRow(line)).toEqual({ inbound_allowed: ["203.0.113.161"], inbound_resolved_at: clock.now() });
  });
});

describe("a linha da organização com lápide (R8, fatia 9b)", { timeout: 120_000 }, () => {
  it("sai do arquivo no relógio de 5 minutos, sem ninguém salvar nada: o conjunto de linhas mudou, e o relógio aplica de novo", async () => {
    const keeps = await createOrganization(app, "trunks-deleting-keeps");
    const leaving = await createOrganization(app, "trunks-deleting");
    const kept = await createTrunk(app, keeps, { host: "sip.fica.example", username: "conta-fica", password: "s3nha" });
    const gone = await createTrunk(app, leaving, { host: "sip.sai.example", username: "conta-sai", password: "s3nha" });
    const ari = fakeAri();
    const deps = trunksDeps(ari, path.join(scratch, "deleting", "pjsip_trunks.conf"));
    ari.loadsFile = deps.file;
    await applyTrunks(deps);
    expect(await readFile(deps.file, "utf8")).toContain(`[trunk-${gone}]`);

    // Nada mudou: o relógio não aplica.
    ari.log.length = 0;
    expect(await refreshAllowed(deps)).toBe(false);
    expect(ari.log).toEqual([]);

    // A lápide: os endereços das linhas que ficam são os mesmos, só o conjunto de linhas mudou.
    await withSystem(app, (q) => q.exec("update organizations set suspended_at = now(), suspended_reason = 'teste da lápide', deleting_at = now() where id = $1", [leaving]));
    expect(await refreshAllowed(deps)).toBe(true);
    expect(ari.log).toEqual(["reload res_pjsip.so"]);
    const conf = await readFile(deps.file, "utf8");
    expect(conf).not.toContain(gone);
    expect(conf).toContain(`[trunk-${kept}]`);

    // Aplicado, o próximo relógio volta a não aplicar.
    ari.log.length = 0;
    expect(await refreshAllowed(deps)).toBe(false);
    expect(ari.log).toEqual([]);
    await withSystem(app, (q) => q.exec("delete from organizations where id = $1", [leaving]));
  });
});

describe("o filtro de entrada por linha (R14, fatia 2)", { timeout: 120_000 }, () => {
  /** As regras `deny`/`permit` da seção `type=endpoint` de uma linha, como o arquivo gerado as tem. */
  const aclOf = (conf: string, id: string): string[] =>
    (conf.split("\n\n").find((block) => block.startsWith(`[trunk-${id}]\ntype=endpoint`)) ?? "").split("\n").filter((line) => /^(deny|permit)=/.test(line));
  const permitsOf = (conf: string, id: string): string[] => aclOf(conf, id).flatMap((line) => (line.startsWith("permit=") ? [line.slice("permit=".length)] : []));
  const fromNameOf = async (id: string): Promise<string[] | undefined> =>
    (await withSystem(app, (q) => q.one<{ inbound_from_name: string[] }>("select inbound_from_name from trunks where id = $1", [id])))?.inbound_from_name;
  const seenOf = async (id: string): Promise<Record<string, string> | undefined> =>
    (await withSystem(app, (q) => q.one<{ inbound_from_name_seen: Record<string, string> }>("select inbound_from_name_seen from trunks where id = $1", [id])))?.inbound_from_name_seen;
  const dnsDown: ResolveName = async (name) => {
    throw Object.assign(new Error(`queryA ESERVFAIL ${name}`), { code: "ESERVFAIL" });
  };

  it("isolamento: duas organizações, o mesmo nome de operadora resolvido em horas diferentes; nenhum endereço de uma no endpoint da outra", async () => {
    const name = `sip.${randomInt(1, 1_000_000)}.compartilhado.example`;
    const first = await createOrganization(app, "filter-iso-a");
    const second = await createOrganization(app, "filter-iso-b");
    // Fora de 100.64/16, pelo mesmo motivo do caso dos endereços liberados.
    const net = `100.${randomInt(65, 128)}.${randomInt(0, 256)}`;
    const mine = await createTrunk(app, first, { host: name, username: "conta-a" });
    const mineIp = await createTrunk(app, first, { host: `${net}.10`, username: null, password: null, authMode: "ip" });
    let answer = ["203.0.113.21"];
    const resolve: ResolveName = async (asked) => (asked === name ? answer : anyName(asked));
    const ari = fakeAri();
    const deps = trunksDeps(ari, path.join(scratch, "filter-iso", "pjsip_trunks.conf"), fakeClock(), resolve);
    ari.loadsFile = deps.file;
    await applyTrunks(deps);

    expect(await fromNameOf(mine)).toEqual(["203.0.113.21"]);

    // Mais tarde, a outra organização cadastra a linha dela no mesmo nome, que agora resolve outro
    // endereço; e na aplicação seguinte o DNS está fora. Cada linha fica com o que o nome DELA
    // resolveu da última vez (a segunda, gravada como se tivesse resolvido nessa outra hora).
    answer = ["198.51.100.21"];
    const theirs = await createTrunk(app, second, { host: name, username: "conta-b" });
    const theirsIp = await createTrunk(app, second, { host: `${net}.11`, username: null, password: null, authMode: "ip" });
    await withSystem(app, (q) => q.exec("update trunks set inbound_from_name = $2 where id = $1", [theirs, answer]));
    await applyTrunks({ ...deps, resolve: async (asked) => (asked === name ? dnsDown(asked) : anyName(asked)) });

    const conf = await readFile(deps.file, "utf8");
    expect(permitsOf(conf, mine)).toEqual(["203.0.113.21"]);
    expect(permitsOf(conf, theirs)).toEqual(["198.51.100.21"]);
    expect(permitsOf(conf, mineIp)).toEqual([`${net}.10`]);
    expect(permitsOf(conf, theirsIp)).toEqual([`${net}.11`]);
    for (const [id, other] of [[mine, theirs], [theirs, mine], [mineIp, theirsIp], [theirsIp, mineIp]] as const) {
      expect(aclOf(conf, id).slice(0, 2)).toEqual(["deny=0.0.0.0/0.0.0.0", "deny=::/0"]);
      for (const address of permitsOf(conf, other)) expect(aclOf(conf, id)).not.toContain(`permit=${address}`);
    }
    expect(conf).not.toContain("type=acl");
  });

  it("DNS fora: o permit é o inbound_allowed gravado; extra removido sai, extra mudado mantém a parte do nome", async () => {
    const organizationId = await createOrganization(app, "filter-dns");
    const name = `sip.${randomInt(1, 1_000_000)}.fora.example`;
    const line = await createTrunk(app, organizationId, { host: name, matchExtra: ["198.51.100.31"] });
    let resolve: ResolveName = async (asked) => (asked === name ? ["203.0.113.31"] : anyName(asked));
    const ari = fakeAri();
    const file = path.join(scratch, "filter-dns", "pjsip_trunks.conf");
    ari.loadsFile = file;
    const deps = () => trunksDeps(ari, file, fakeClock(), resolve);
    await applyTrunks(deps());
    expect(await fromNameOf(line)).toEqual(["203.0.113.31"]);
    expect((await allowedRow(line))?.inbound_allowed).toEqual(["203.0.113.31", "198.51.100.31"]);

    resolve = async (asked) => (asked === name ? dnsDown(asked) : anyName(asked));
    await applyTrunks(deps());
    const stored = (await allowedRow(line))?.inbound_allowed;
    expect(permitsOf(await readFile(file, "utf8"), line)).toEqual(stored);
    expect(await trunkRow(line)).toMatchObject({ status: "warn", last_error: expect.stringContaining("could not be resolved") });

    // Extra removido, DNS ainda fora: sai do permit e da tela.
    await withSystem(app, (q) => q.exec("update trunks set match_extra = '{}' where id = $1", [line]));
    await applyTrunks(deps());
    expect(permitsOf(await readFile(file, "utf8"), line)).toEqual(["203.0.113.31"]);
    expect((await allowedRow(line))?.inbound_allowed).toEqual(["203.0.113.31"]);

    // Extra mudado, DNS ainda fora: entra o novo, e a parte do nome fica.
    await withSystem(app, (q) => q.exec("update trunks set match_extra = '{198.51.100.32}' where id = $1", [line]));
    await applyTrunks(deps());
    expect(permitsOf(await readFile(file, "utf8"), line)).toEqual(["203.0.113.31", "198.51.100.32"]);
    expect(await fromNameOf(line)).toEqual(["203.0.113.31"]);
  });

  it("o conjunto do destino antigo não volta: a gravação do processo de voz só vale se o host e o modo lidos ainda são os da linha", async () => {
    const organizationId = await createOrganization(app, "filter-race");
    const name = `sip.${randomInt(1, 1_000_000)}.antigo.example`;
    const line = await createTrunk(app, organizationId, { host: name });
    const ari = fakeAri();
    const file = path.join(scratch, "filter-race", "pjsip_trunks.conf");
    ari.loadsFile = file;
    // O nome é resolvido, e no meio a tela troca o host (e zera as colunas, como faz o painel).
    const resolve: ResolveName = async (asked) => {
      if (asked === name) {
        await withSystem(app, (q) => q.exec("update trunks set host = 'sip.novo.example', inbound_from_name = '{}', inbound_from_name_seen = '{}', inbound_allowed = '{}', inbound_resolved_at = null where id = $1", [line]));
        return ["203.0.113.41"];
      }
      return anyName(asked);
    };
    await applyTrunks(trunksDeps(ari, file, fakeClock(), resolve));
    expect(await fromNameOf(line)).toEqual([]);
    expect(await seenOf(line)).toEqual({});
    expect(await allowedRow(line)).toEqual({ inbound_allowed: [], inbound_resolved_at: null });
  });

  it("DNS em rodízio: a parte do nome junta as respostas de 24 horas, gravada com a hora de cada endereço; o que não volta em 24 horas sai", async () => {
    const organizationId = await createOrganization(app, "filter-window");
    const name = `sip.${randomInt(1, 1_000_000)}.rodizio.example`;
    const line = await createTrunk(app, organizationId, { host: name, matchExtra: ["198.51.100.61"] });
    let answer = ["203.0.113.61", "203.0.113.62"];
    const resolve: ResolveName = async (asked) => (asked === name ? answer : anyName(asked));
    const ari = fakeAri();
    const file = path.join(scratch, "filter-window", "pjsip_trunks.conf");
    ari.loadsFile = file;
    const clock = fakeClock();
    const deps = () => trunksDeps(ari, file, clock, resolve);
    await applyTrunks(deps());
    const first = clock.now().toISOString();
    expect(await seenOf(line)).toEqual({ "203.0.113.61": first, "203.0.113.62": first });

    // Uma hora depois o DNS devolve a outra metade: as duas ficam liberadas.
    clock.advance(3_600_000);
    answer = ["203.0.113.63"];
    await applyTrunks(deps());
    expect(permitsOf(await readFile(file, "utf8"), line)).toEqual(["203.0.113.61", "203.0.113.62", "203.0.113.63", "198.51.100.61"]);
    expect(await fromNameOf(line)).toEqual(["203.0.113.61", "203.0.113.62", "203.0.113.63"]);
    expect(await seenOf(line)).toEqual({ "203.0.113.61": first, "203.0.113.62": first, "203.0.113.63": clock.now().toISOString() });
    expect((await allowedRow(line))?.inbound_allowed).toEqual(["203.0.113.61", "203.0.113.62", "203.0.113.63", "198.51.100.61"]);

    // 24 horas depois da primeira resposta e mais um pouco: só o que voltou na janela fica.
    clock.advance(23.5 * 3_600_000);
    await applyTrunks(deps());
    expect(permitsOf(await readFile(file, "utf8"), line)).toEqual(["203.0.113.63", "198.51.100.61"]);
    expect(await seenOf(line)).toEqual({ "203.0.113.63": clock.now().toISOString() });

    // A mesma resposta de novo, 23 horas depois: a lista não muda, mas a hora sim (é gravada), e
    // por isso o endereço segue liberado 24 horas a partir de agora, mesmo quando o nome passa a
    // devolver outro.
    clock.advance(23 * 3_600_000);
    await applyTrunks(deps());
    expect(await seenOf(line)).toEqual({ "203.0.113.63": clock.now().toISOString() });
    clock.advance(2 * 3_600_000);
    answer = ["203.0.113.64"];
    await applyTrunks(deps());
    expect(permitsOf(await readFile(file, "utf8"), line)).toEqual(["203.0.113.63", "203.0.113.64", "198.51.100.61"]);
  });

  it("nome que nunca resolveu, com extras: a linha sai SEM filtro e fica 'warn'; quando o nome resolve, o filtro liga com o nome e os extras", async () => {
    const organizationId = await createOrganization(app, "filter-extras-only");
    const name = `sip.${randomInt(1, 1_000_000)}.so-extras.example`;
    const line = await createTrunk(app, organizationId, { host: name, matchExtra: ["198.51.100.71"] });
    let resolve: ResolveName = async (asked) => (asked === name ? dnsDown(asked) : anyName(asked));
    const ari = fakeAri();
    const file = path.join(scratch, "filter-extras-only", "pjsip_trunks.conf");
    ari.loadsFile = file;
    const deps = () => trunksDeps(ari, file, fakeClock(), resolve);
    await applyTrunks(deps());
    expect(aclOf(await readFile(file, "utf8"), line)).toEqual([]);
    expect(await trunkRow(line)).toMatchObject({ status: "warn", last_error: expect.stringContaining("its filter stays off until the name") });
    expect((await allowedRow(line))?.inbound_allowed).toEqual([]);

    resolve = async (asked) => (asked === name ? ["203.0.113.71"] : anyName(asked));
    await applyTrunks(deps());
    expect(aclOf(await readFile(file, "utf8"), line)).toEqual(["deny=0.0.0.0/0.0.0.0", "deny=::/0", "permit=203.0.113.71", "permit=198.51.100.71"]);
  });

  it("conjunto vazio de linha ativa: sem deny, e a linha fica 'warn'; o nome resolve, o deny e o permit entram e o aviso sai", async () => {
    const organizationId = await createOrganization(app, "filter-empty");
    const name = `sip.${randomInt(1, 1_000_000)}.nunca.example`;
    const line = await createTrunk(app, organizationId, { host: name });
    let resolve: ResolveName = async (asked) => (asked === name ? dnsDown(asked) : anyName(asked));
    const ari = fakeAri();
    const file = path.join(scratch, "filter-empty", "pjsip_trunks.conf");
    ari.loadsFile = file;
    const deps = () => trunksDeps(ari, file, fakeClock(), resolve);
    expect(await applyTrunks(deps())).toMatchObject({ applied: true });
    const conf = await readFile(file, "utf8");
    expect(conf).toContain(`[trunk-${line}]\ntype=endpoint`);
    expect(aclOf(conf, line)).toEqual([]);
    expect(await trunkRow(line)).toMatchObject({ status: "warn", last_error: expect.stringContaining("its filter stays off until the name") });
    expect(await allowedRow(line)).toEqual({ inbound_allowed: [], inbound_resolved_at: null });

    resolve = async (asked) => (asked === name ? ["203.0.113.51"] : anyName(asked));
    expect(await refreshAllowed(deps())).toBe(true);
    expect(aclOf(await readFile(file, "utf8"), line)).toEqual(["deny=0.0.0.0/0.0.0.0", "deny=::/0", "permit=203.0.113.51"]);
    expect(await trunkRow(line)).toMatchObject({ status: "unverified", last_error: null });
  });

  it("filtro desligado na linha (contrato 11): o conjunto é calculado e gravado para a tela, mas o endpoint sai sem deny e a linha não fica 'warn'; ligado, o filtro entra", async () => {
    const organizationId = await createOrganization(app, "filter-switched-off");
    const name = `sip.${randomInt(1, 1_000_000)}.desligado.example`;
    const line = await createTrunk(app, organizationId, { host: name, matchExtra: ["198.51.100.71"] });
    await withSystem(app, (q) => q.exec("update trunks set inbound_filter = false where id = $1", [line]));
    const resolve: ResolveName = async (asked) => (asked === name ? ["203.0.113.71"] : anyName(asked));
    const ari = fakeAri();
    const file = path.join(scratch, "filter-switched-off", "pjsip_trunks.conf");
    ari.loadsFile = file;
    const deps = () => trunksDeps(ari, file, fakeClock(), resolve);
    expect(await applyTrunks(deps())).toMatchObject({ applied: true });
    const conf = await readFile(file, "utf8");
    expect(conf).toContain(`[trunk-${line}]\ntype=endpoint`);
    expect(aclOf(conf, line)).toEqual([]);
    expect((await allowedRow(line))?.inbound_allowed).toEqual(["203.0.113.71", "198.51.100.71"]);
    expect((await trunkRow(line))?.status).not.toBe("warn");

    await withSystem(app, (q) => q.exec("update trunks set inbound_filter = true where id = $1", [line]));
    expect(await applyTrunks(deps())).toMatchObject({ applied: true });
    expect(aclOf(await readFile(file, "utf8"), line)).toEqual(["deny=0.0.0.0/0.0.0.0", "deny=::/0", "permit=203.0.113.71", "permit=198.51.100.71"]);
  });

  it("a linha por registro com o filtro desligado que passa a IP filtra na hora: o filtro efetivo ignora a coluna (contrato 11)", async () => {
    const organizationId = await createOrganization(app, "filter-off-to-ip");
    const name = `sip.${randomInt(1, 1_000_000)}.vira-ip.example`;
    const line = await createTrunk(app, organizationId, { host: name });
    await withSystem(app, (q) => q.exec("update trunks set inbound_filter = false where id = $1", [line]));
    const ari = fakeAri();
    const file = path.join(scratch, "filter-off-to-ip", "pjsip_trunks.conf");
    ari.loadsFile = file;
    const deps = () => trunksDeps(ari, file, fakeClock(), async (asked) => (asked === name ? ["203.0.113.73"] : anyName(asked)));
    expect(await applyTrunks(deps())).toMatchObject({ applied: true });
    expect(aclOf(await readFile(file, "utf8"), line)).toEqual([]);

    // A troca de modo como o painel grava: zera o conjunto e NÃO mexe em `inbound_filter`. Endereço
    // sorteado, para não cair no grupo de outra linha deste banco.
    const ip = `100.${randomInt(65, 128)}.${randomInt(0, 256)}.${randomInt(1, 255)}`;
    await withSystem(app, (q) =>
      q.exec("update trunks set auth_mode = 'ip', host = $2, username = null, secret_enc = null, inbound_allowed = '{}', inbound_from_name = '{}', inbound_resolved_at = null where id = $1", [line, ip]),
    );
    expect((await withSystem(app, (q) => q.one<{ inbound_filter: boolean }>("select inbound_filter from trunks where id = $1", [line])))?.inbound_filter).toBe(false);
    expect(await applyTrunks(deps())).toMatchObject({ applied: true });
    expect(aclOf(await readFile(file, "utf8"), line)).toEqual(["deny=0.0.0.0/0.0.0.0", "deny=::/0", `permit=${ip}`]);
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
    // O fim sem áudio não passa por `finish`: a revisão é enfileirada ali mesmo (a religação depende dela).
    expect(await kindsOf(app, failed[0]?.id ?? "")).toEqual(["call_ended", "task_queued"]);
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
      audioSocketPort: 0, internalPort: 0, webPort: 0, internalToken: "token-de-teste", trunksFile: path.join(scratch, "simulate.conf"), publicIp: null, host: "127.0.0.1",
      schedule: timers.schedule, now: timers.now, resolveName: anyName,
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
    await waitFor(async () => (await kindsOf(app, callId)).filter((kind) => kind === "task_queued").length === 2, "the simulated call to end");

    const kinds = await kindsOf(app, callId);
    expect(kinds.filter((kind) => !kind.startsWith("transcript"))).toEqual([
      "call_started", "call_answered", "recording_notice", "tool_called", "follow_up_created", "tool_result", "tool_called", "human_notified", "tool_result",
      "tool_called", "approval_requested", "approval_decided", "tool_result", "tool_called", "transfer_started", "tool_result", "call_ended", "task_queued", "task_queued",
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
