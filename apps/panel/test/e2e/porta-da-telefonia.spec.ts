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

/** Anota a medida no relatório e no log do CI: o PR relata o código de resposta visto. */
function measured(label: string, answer: ProbeAnswer): void {
  const text = answer.answered ? `${answer.status} ${answer.reason} (a central viu a origem ${answer.received ?? "?"}:${answer.rport ?? "?"})` : "sem resposta";
  test.info().annotations.push({ type: label, description: text });
  process.stdout.write(`[sonda] ${label}: ${text}\n`);
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
    // apresenta como a linha (M1, origem que casa com uma linha mas está fora do permit).
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
  } finally {
    await probe.close();
    if (trunkId) await page.request.delete(`/api/v1/trunks/${trunkId}`);
  }
});
