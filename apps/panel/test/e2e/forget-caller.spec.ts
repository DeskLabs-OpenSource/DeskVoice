import { randomInt } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import common from "../../src/i18n/pt-BR/common";
import { fill } from "../../src/i18n/locales";
import privacy from "../../src/i18n/pt-BR/privacy";
import timeline from "../../src/i18n/pt-BR/timeline";
import { formatPhone } from "../../src/ui/format";
import { signIn, unique } from "./session";

// Apagar uma nota e "Esquecer este número" (fatia 3b do desenho de 13/11). A nota é a que o roteiro da
// simulada guarda quando o agente tem a ferramenta (apps/voice/src/demo-script.ts); a pendência é a do
// `create_task` do mesmo roteiro.
const SCRIPTED_NOTE = "Prefere ser atendida às sextas de manhã.";
const e164 = (): string => `+55319${String(randomInt(0, 100_000_000)).padStart(8, "0")}`;

interface History {
  noteCount: number;
  openFollowUpCount: number;
  notes: { id: string; callId: string }[];
}

/** Um agente simulado com a ferramenta de notas marcada, e uma função que simula uma ligação do número. */
async function agentWithNotes(page: Page, from: string): Promise<{ simulate: () => Promise<string>; history: (callId: string) => Promise<History> }> {
  const created = await page.request.post("/api/v1/agents", { data: { name: `Esquecer ${unique()}`, engine: "simulated" } });
  expect(created.status()).toBe(200);
  const agentId = ((await created.json()) as { data: { id: string } }).data.id;
  // A ferramenta vem desligada e se liga na tela do agente.
  await page.goto(`/agents/${agentId}`);
  await page.getByRole("checkbox", { name: /remember_caller_note/ }).check();
  await page.getByRole("button", { name: common.actions.save, exact: true }).click();
  await expect(page.getByRole("status")).toHaveText(common.actions.saved);
  const history = async (callId: string): Promise<History> => ((await (await page.request.get(`/api/v1/calls/${callId}/caller-history`)).json()) as { data: History }).data;
  const simulate = async (): Promise<string> => {
    const response = await page.request.post("/api/v1/calls/simulate", { data: { agentId, from } });
    expect(response.status()).toBe(200);
    const callId = ((await response.json()) as { data: { callId: string } }).data.callId;
    // A simulada termina sozinha: espera a nota dela entrar.
    await expect.poll(async () => (await history(callId)).notes.some((note) => note.callId === callId), { timeout: 45_000 }).toBe(true);
    return callId;
  };
  return { simulate, history };
}

test("passo 1: apagar uma nota do bloco \"Este número\" pede confirmação, e depois dela a nota some", async ({ page }) => {
  await signIn(page);
  const { simulate, history } = await agentWithNotes(page, e164());
  const first = await simulate();
  const second = await simulate();

  await page.goto(`/calls/${second}`);
  const block = page.getByRole("region", { name: timeline.callerHistory.title });
  const origin = page.locator(`a[href="/calls/${first}"]`, { hasText: timeline.callerHistory.origin });
  const note = block.getByRole("listitem").filter({ hasText: SCRIPTED_NOTE }).filter({ has: origin });
  await expect(note).toBeVisible();

  // O primeiro clique só abre o pedido de confirmação; cancelar não apaga.
  await note.getByRole("button", { name: timeline.callerHistory.deleteNote, exact: true }).click();
  await expect(note.getByText(timeline.callerHistory.deleteNoteTitle)).toBeVisible();
  await note.getByRole("button", { name: common.actions.cancel, exact: true }).click();
  await expect(note.getByText(timeline.callerHistory.deleteNoteTitle)).toHaveCount(0);
  expect((await history(second)).noteCount).toBe(2);

  await note.getByRole("button", { name: timeline.callerHistory.deleteNote, exact: true }).click();
  await note.getByRole("button", { name: timeline.callerHistory.deleteNoteYes, exact: true }).click();
  await expect(note).toHaveCount(0);
  expect((await history(second)).noteCount).toBe(1);

  // O registro da organização diz que uma nota foi apagada, sem o texto dela.
  await page.goto("/settings/privacy");
  const entry = page.getByRole("listitem").filter({ hasText: fill(privacy.noteDeleted, { who: "" }).trim() }).first();
  await expect(entry).toBeVisible();
  await expect(entry).not.toContainText(SCRIPTED_NOTE);
});

test("passo 2: esquecer um número nomeia o número, diz o que fica, apaga as notas e as pendências fechadas e deixa as abertas", async ({ page }) => {
  await signIn(page);
  const phone = e164();
  const shown = formatPhone(phone);
  const { simulate, history } = await agentWithNotes(page, phone);
  const first = await simulate();
  const second = await simulate();
  // Fecha a pendência da primeira; a da segunda fica aberta.
  const followUps = (await (await page.request.get(`/api/v1/follow-ups?callId=${first}`)).json()) as { data: { items: { id: string }[] } };
  const closing = followUps.data.items[0]?.id ?? "";
  expect((await page.request.post(`/api/v1/follow-ups/${closing}/close`, { data: { status: "done", note: "Retornei." } })).status()).toBe(200);
  const before = await history(second);
  expect(before.noteCount).toBe(2);
  expect(before.openFollowUpCount).toBeGreaterThanOrEqual(1);

  await page.goto("/settings/privacy");
  const panel = page.locator("section").filter({ has: page.getByRole("heading", { name: privacy.forgetTitle, exact: true }) });
  await panel.getByLabel(privacy.forgetPhone).fill(phone);
  await panel.getByRole("button", { name: privacy.forgetRun, exact: true }).click();

  // A confirmação nomeia o número e diz o que não sai: as ligações e as pendências abertas.
  await expect(panel.getByText(fill(privacy.forgetConfirmTitle, { phone: shown }), { exact: true })).toBeVisible();
  await expect(panel.getByText(privacy.forgetKeeps)).toBeVisible();
  expect(privacy.forgetKeeps).toContain("as pendências abertas, que continuam");
  expect(privacy.forgetKeeps).toContain("as ligações e as falas desse número");
  // Antes de confirmar, nada saiu.
  expect((await history(second)).noteCount).toBe(2);

  await panel.getByRole("button", { name: fill(privacy.forgetConfirmYes, { phone: shown }), exact: true }).click();
  await expect(panel.getByText(fill(privacy.forgetDone, { phone: shown, notes: 2, followUps: 1 }))).toBeVisible();

  const after = await history(second);
  expect(after.noteCount).toBe(0);
  expect(after.openFollowUpCount).toBe(before.openFollowUpCount);

  // O registro mostra quem esqueceu qual número, com as contagens e sem o texto da nota.
  const entry = page.getByRole("listitem").filter({ hasText: fill(privacy.history.caller_notes_deleted, { who: "", phone: shown, notes: 2, followUps: 1 }).trim() });
  await expect(entry).toBeVisible();
  await expect(page.getByText(SCRIPTED_NOTE)).toHaveCount(0);
});

test("encurtar o prazo da memória pede confirmação antes de apagar; cancelar não muda nada", async ({ page }) => {
  await signIn(page);
  // Parte de um prazo conhecido; a organização dos testes não tem prazo de guarda das conversas que o limite.
  const state = (await (await page.request.get("/api/v1/privacy")).json()) as { data: { retentionDays: number | null } };
  const start = state.data.retentionDays === null ? 120 : Math.min(120, state.data.retentionDays);
  test.skip(start <= 31, "o prazo de guarda das conversas da organização dos testes não deixa encurtar");
  expect((await page.request.put("/api/v1/privacy/caller-notes-retention", { data: { days: start } })).status()).toBe(200);
  const shorter = start - 1;

  await page.goto("/settings/privacy");
  const panel = page.locator("section").filter({ has: page.getByRole("heading", { name: privacy.notesTitle, exact: true }) });
  await panel.getByLabel(privacy.notesDays).fill(String(shorter));
  await panel.getByRole("button", { name: privacy.notesSave, exact: true }).click();
  await expect(panel.getByText(fill(privacy.notesConfirmTitle, { days: shorter }), { exact: true })).toBeVisible();
  await panel.getByRole("button", { name: common.actions.cancel, exact: true }).click();
  const read = async (): Promise<number> => ((await (await page.request.get("/api/v1/privacy")).json()) as { data: { notesRetention: { days: number } } }).data.notesRetention.days;
  expect(await read()).toBe(start);

  await panel.getByRole("button", { name: privacy.notesSave, exact: true }).click();
  await panel.getByRole("button", { name: fill(privacy.notesConfirmYes, { days: shorter }), exact: true }).click();
  await expect.poll(read).toBe(shorter);
});
