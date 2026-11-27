import { execFileSync } from "node:child_process";
import { networkInterfaces } from "node:os";
import { expect, test, type Page } from "@playwright/test";
import { SipProbe, type ProbeAnswer } from "../../../../scripts/sonda-sip/sonda";
import line from "../../src/i18n/pt-BR/line";
import { signIn, unique } from "./session";

/**
 * O endereço desta máquina que a central vê como origem: o primeiro IPv4 de uma interface de rede
 * que não é a de laço nem uma ponte do Docker. Pela porta publicada, o pacote entra no Asterisk com
 * este endereço de origem (medida M3). `DESKVOICE_E2E_SIP_HOST` troca, para rodar de outra máquina.
 */
function sipHost(): string {
  const given = process.env.DESKVOICE_E2E_SIP_HOST;
  if (given) return given;
  for (const [name, addresses] of Object.entries(networkInterfaces())) {
    if (/^(lo|docker|br-|veth)/.test(name)) continue;
    const v4 = addresses?.find((address) => address.family === "IPv4" && !address.internal);
    if (v4) return v4.address;
  }
  throw new Error("no non-loopback IPv4 address on this machine; set DESKVOICE_E2E_SIP_HOST");
}

/**
 * O endereço desta máquina na rede do Docker da central (o gateway da rede do contêiner do
 * Asterisk): um segundo endereço de origem, diferente do de `sipHost`, que a central alcança.
 * `DESKVOICE_E2E_BRIDGE_HOST` troca.
 */
function bridgeAddress(): string {
  const given = process.env.DESKVOICE_E2E_BRIDGE_HOST;
  if (given) return given;
  const id = execFileSync("docker", ["ps", "-q", "--filter", "label=com.docker.compose.service=asterisk"], { encoding: "utf8" }).trim().split("\n")[0];
  if (!id) throw new Error("no asterisk container found; set DESKVOICE_E2E_BRIDGE_HOST");
  const gateway = execFileSync("docker", ["inspect", "--format", "{{range .NetworkSettings.Networks}}{{.Gateway}} {{end}}", id], { encoding: "utf8" }).trim().split(/\s+/)[0];
  if (!gateway) throw new Error("the asterisk container has no network gateway; set DESKVOICE_E2E_BRIDGE_HOST");
  return gateway;
}

/** Anota a medida no relatório e no log do CI: o PR relata o código de resposta visto. */
function measured(label: string, answer: ProbeAnswer): void {
  const text = answer.answered ? `${answer.status} ${answer.reason} (a central viu a origem ${answer.received ?? "?"}:${answer.rport ?? "?"})` : "sem resposta";
  test.info().annotations.push({ type: label, description: text });
  process.stdout.write(`[sonda] ${label}: ${text}\n`);
}

/**
 * O que o Asterisk registrou sobre os pedidos da sonda (o motivo da recusa: "No matching endpoint
 * found" ou "Not match Endpoint ACL"), achado pelo Call-ID. Só quando esta máquina alcança o Docker
 * da instalação (no runner, sim); fora disso, a medida fica só com o código de resposta.
 */
function asteriskSaid(answers: ProbeAnswer[]): void {
  try {
    const id = execFileSync("docker", ["ps", "-q", "--filter", "label=com.docker.compose.service=asterisk"], { encoding: "utf8" }).trim().split("\n")[0];
    if (!id) return;
    const log = execFileSync("docker", ["logs", "--since", "10m", id], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    for (const answer of answers) {
      for (const entry of log.split("\n").filter((text) => answer.callId !== undefined && text.includes(answer.callId))) {
        const said = entry.replace(/\u001b\[[0-9;]*m/g, "");
        test.info().annotations.push({ type: "Asterisk", description: said });
        process.stdout.write(`[sonda] Asterisk: ${said}\n`);
      }
    }
  } catch (error) {
    process.stdout.write(`[sonda] log do Asterisk não lido: ${error instanceof Error ? error.message : String(error)}\n`);
  }
}

/** Repete a sonda (uma por segundo, até 20) até o código esperado; devolve a última resposta vista. */
async function until(probe: SipProbe, host: string, user: string, accept: (answer: ProbeAnswer) => boolean, attempts = 20): Promise<ProbeAnswer> {
  let answer = await probe.options(host, { user });
  for (let attempt = 1; attempt < attempts && !accept(answer); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    answer = await probe.options(host, { user });
  }
  return answer;
}

/** O campo pelo começo do rótulo: o nome acessível também leva a dica, e "Provedor" aparece em outros rótulos. */
const label = (text: string): RegExp => new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
const section = (page: Page, name: string) => page.locator("section").filter({ has: page.getByRole("heading", { level: 2, name, exact: true }) });

// R14, fatia 2: a central só aceita a ligação de uma linha que vem dos endereços dela. Contra o
// Asterisk de verdade da instalação do runner, pela porta 5060/udp publicada. O runner não é a
// internet: a origem é o próprio runner, entrando pela porta publicada.
test("porta da telefonia: sem linha, recusa; a linha libera só o endereço dela; o resto é recusado", async ({ page }) => {
  test.setTimeout(240_000);
  const host = sipHost();
  const name = `Sonda ${unique()}`;
  const probe = await SipProbe.open(host);
  let trunkId: string | null = null;
  let registerId: string | null = null;
  let switchId: string | null = null;
  await signIn(page);
  try {
    // Sem linha no endereço da sonda: a central recusa (M1, origem que não casa com linha).
    const stranger = `sonda-${unique()}`;
    const noLine = await probe.options(host, { user: stranger });
    measured("M1 sem linha", noLine);
    expect(noLine.answered, "the telephony server did not answer the probe at all").toBe(true);
    expect(noLine.status).not.toBe(200);
    // M3: a central vê como origem o endereço de quem mandou, e não o da ponte do Docker.
    test.info().annotations.push({ type: "M3", description: `sonda saiu de ${probe.local.address}:${probe.local.port}; a central viu ${noLine.received}:${noLine.rport}` });
    expect(noLine.received).toBe(probe.local.address);

    // Uma linha por IP no endereço da sonda, cadastrada pela tela. O contato aponta para a porta da
    // sonda, que responde à qualificação da central (M2).
    await page.goto("/line");
    const form = section(page, line.newLine);
    await form.getByLabel(label(line.name)).fill(name);
    await form.getByLabel(label(line.host)).fill(`${host}:${probe.local.port}`);
    await form.getByLabel(label(line.authMode)).selectOption({ label: line.authIp });
    await form.getByRole("button", { name: line.saveLine }).click();
    const panel = section(page, name);
    await expect(panel.getByText(`${line.allowed}:`)).toBeVisible();
    await expect(panel).toContainText(host);
    await expect(panel).toContainText(line.allowedOthers);
    const listed = (await (await page.request.get("/api/v1/trunks")).json()) as { data: Array<{ id: string; name: string }> };
    trunkId = listed.data.find((entry) => entry.name === name)?.id ?? null;
    expect(trunkId).not.toBeNull();

    // A origem liberada passa: a central responde 200, reconhecendo pelo endereço e pelo nome da linha.
    const allowed = await until(probe, host, stranger, (answer) => answer.status === 200);
    measured("M1 linha no endereço da sonda", allowed);
    expect(allowed.status).toBe(200);
    const asLine = await until(probe, host, `trunk-${trunkId}`, (answer) => answer.status === 200);
    measured("M1 linha no endereço da sonda, apresentando-se como a linha", asLine);
    expect(asLine.status).toBe(200);

    // M2: a qualificação que a central manda ao endereço liberado tem resposta, e a linha fica
    // "Funcionando". A resposta à central não é barrada pelo filtro.
    await expect(async () => {
      await panel.getByRole("button", { name: line.test }).click();
      await expect(panel.getByText(line.status.ok, { exact: true })).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 120_000, intervals: [5_000] });
    const qualify = probe.seen.filter((request) => request.method === "OPTIONS");
    test.info().annotations.push({ type: "M2", description: `linha Funcionando; ${qualify.length} OPTIONS da central recebidos, de ${[...new Set(qualify.map((request) => request.from.address))].join(", ")}` });
    process.stdout.write(`[sonda] M2: linha Funcionando; OPTIONS da central vindos de ${qualify.map((request) => `${request.from.address}:${request.from.port}`).join(", ")}\n`);

    // A linha passa para outro endereço: a mesma origem agora é recusada, também quando se
    // apresenta com o nome da linha (M1: o nome no From não reconhece a linha).
    const elsewhere = "198.51.100.77";
    await panel.getByLabel(label(line.host)).fill(elsewhere);
    await panel.getByRole("button", { name: line.saveLine }).click();
    await expect(panel.getByText(`${line.allowed}:`).locator("..")).toContainText(elsewhere);
    const refusedAsLine = await until(probe, host, `trunk-${trunkId}`, (answer) => answer.answered && answer.status !== 200);
    measured("M1 linha em outro endereço, apresentando-se como a linha", refusedAsLine);
    expect(refusedAsLine.answered).toBe(true);
    expect(refusedAsLine.status).not.toBe(200);
    const refused = await probe.options(host, { user: stranger });
    measured("M1 linha em outro endereço", refused);
    expect(refused.status).not.toBe(200);
    const seen = [noLine, allowed, asLine, refusedAsLine, refused];

    // Uma linha por registro com um nome que nunca resolve fica sem filtro (contrato 8), e a tela diz
    // isso. Sem filtro, ainda assim ninguém entra por ela só se apresentando com o nome da linha no
    // From: a central reconhece a linha por registro pelo `line`, e não pelo nome.
    const created = await page.request.post("/api/v1/trunks", {
      data: { name: `${name} registro`, host: "sip.invalid", username: "sonda", password: `sonda-${unique()}${unique()}`, authMode: "register" },
    });
    expect(created.status()).toBe(200);
    registerId = ((await created.json()) as { data: { id: string } }).data.id;
    await page.reload();
    await expect(section(page, `${name} registro`)).toContainText(line.allowedEmpty);
    // Com um extra noutro endereço, a linha continua sem filtro: os extras sozinhos não ligam o filtro
    // de um nome que nunca resolveu, para não recusar a entrega pelo servidor do registro.
    const patched = await page.request.patch(`/api/v1/trunks/${registerId}`, { data: { matchExtra: ["198.51.100.78"] } });
    expect(patched.status()).toBe(200);
    // A gravação volta a linha a "não verificada"; a aplicação com o extra a devolve a "warn" (conjunto vazio), ou "fail" se a conferência já passou.
    // Esperar a aplicação garante que a recusa abaixo não é da linha ainda não escrita.
    await expect
      .poll(async () => ((await (await page.request.get("/api/v1/trunks")).json()) as { data: Array<{ id: string; status: string; matchExtra: string[] }> }).data.find((entry) => entry.id === registerId), {
        timeout: 60_000,
      })
      .toMatchObject({ status: expect.stringMatching(/^(warn|fail)$/), matchExtra: ["198.51.100.78"] });
    await page.reload();
    await expect(section(page, `${name} registro`)).toContainText(line.allowedEmpty);
    const byNameOnly = await probe.options(host, { user: `trunk-${registerId}` });
    measured("linha por registro sem filtro (nome que não resolve, um extra), apresentando-se só pelo nome da linha", byNameOnly);
    expect(byNameOnly.answered).toBe(true);
    expect(byNameOnly.status).toBe(401);

    // O filtro da linha por registro (contrato 11). O registro vai para uma segunda sonda, no
    // endereço da ponte do Docker da instalação: é dela o `permit`, e não da primeira sonda. A
    // segunda sonda guarda o `line` que a central põe no Contact do registro, e a primeira o usa
    // como a operadora o usaria. A linha nova nasce com o filtro ligado: a primeira sonda é
    // recusada pelo filtro. Desligado pela tela, ela passa pelo `line` (o controle: a central
    // reconhece a linha, e a recusa de antes é do filtro), mas não pelo nome. Religado, é recusada.
    const registrar = await SipProbe.open(bridgeAddress());
    try {
      const switchName = `${name} filtro`;
      const withName = await page.request.post("/api/v1/trunks", {
        data: { name: switchName, host: `${registrar.local.address}:${registrar.local.port}`, username: "sonda", password: `sonda-${unique()}${unique()}`, authMode: "register" },
      });
      expect(withName.status()).toBe(200);
      const born = ((await withName.json()) as { data: { id: string; inboundFilter: boolean } }).data;
      switchId = born.id;
      expect(born.inboundFilter).toBe(true);
      // O `line` mais novo: a central pode refazer o registro numa recarga, com outro `line`.
      const lineToken = (): string | undefined => registrar.seen.filter((request) => request.method === "REGISTER" && request.line !== undefined).at(-1)?.line;
      await expect.poll(lineToken, { timeout: 60_000 }).toBeDefined();
      test.info().annotations.push({ type: "registro", description: `REGISTER da central chegou à segunda sonda (${registrar.local.address}) com line` });
      await page.reload();
      const switchPanel = section(page, switchName);
      await expect(switchPanel).toContainText(line.allowedOthers);
      const byLine = async (accept: (answer: ProbeAnswer) => boolean): Promise<ProbeAnswer> => {
        let answer = await probe.options(host, { user: stranger, line: lineToken() });
        for (let attempt = 1; attempt < 20 && !accept(answer); attempt++) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          answer = await probe.options(host, { user: stranger, line: lineToken() });
        }
        return answer;
      };
      const bornOn = await byLine((answer) => answer.answered && answer.status !== 200);
      measured("contrato 11: linha por registro nova, filtro ligado, com o line do registro", bornOn);
      expect(bornOn.status).toBe(401);

      await switchPanel.getByRole("button", { name: line.filterOff, exact: true }).click();
      await expect(switchPanel).toContainText(line.filterSwitchedOff);
      await expect(switchPanel).not.toContainText(line.allowedOthers);
      const switchedOff = await byLine((answer) => answer.status === 200);
      measured("contrato 11: mesma linha com o filtro desligado pela tela, com o line do registro", switchedOff);
      expect(switchedOff.status).toBe(200);
      const offByName = await probe.options(host, { user: `trunk-${switchId}` });
      measured("mesma linha com o filtro desligado, apresentando-se só pelo nome da linha", offByName);
      expect(offByName.status).toBe(401);

      await switchPanel.getByRole("button", { name: line.filterOn, exact: true }).click();
      await expect(switchPanel).not.toContainText(line.filterSwitchedOff);
      await expect(switchPanel.getByRole("button", { name: line.filterOff, exact: true })).toBeVisible();
      const switchedOn = await byLine((answer) => answer.answered && answer.status !== 200);
      measured("contrato 11: mesma linha com o filtro religado pela tela, com o line do registro", switchedOn);
      expect(switchedOn.status).toBe(401);
      asteriskSaid([...seen, byNameOnly, bornOn, switchedOff, offByName, switchedOn]);
    } finally {
      await registrar.close();
    }
  } finally {
    await probe.close();
    if (trunkId) await page.request.delete(`/api/v1/trunks/${trunkId}`);
    if (registerId) await page.request.delete(`/api/v1/trunks/${registerId}`);
    if (switchId) await page.request.delete(`/api/v1/trunks/${switchId}`);
  }
});
