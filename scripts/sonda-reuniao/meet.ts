// A entrada no Google Meet como convidado: o link aceito, o nome com "(IA)" e os passos na tela.
// Os passos dependem da página do Google, que muda sem aviso. Por isso cada passo tem um nome no
// relatório e uma captura de tela quando falha: quem rodar vê em qual deles a entrada quebrou.
import type { Page } from "./dependencias";

/** Só o endereço de uma reunião do Meet (`https://meet.google.com/abc-defg-hij`). Qualquer outro é recusado antes de abrir o navegador. */
export function meetingCode(link: string): string | null {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.hostname !== "meet.google.com" || url.port || url.username || url.password) return null;
  const code = /^\/([a-z]{3}-[a-z]{4}-[a-z]{3})$/.exec(url.pathname)?.[1];
  return code ?? null;
}

/** O código da reunião abre a sala: no relatório, só as pontas aparecem. */
export const maskCode = (code: string): string => `${code.slice(0, 3)}-****-${code.slice(-3)}`;

/** O nome de exibição sempre termina com "(IA)" (seção 6 do desenho). O sufixo não sai. */
export function displayName(name: string): string {
  const clean = name.replace(/\s*\(IA\)\s*$/i, "").trim() || "Sonda DeskVoice";
  return `${clean} (IA)`;
}

export type Admission = "admitted" | "denied" | "waited_too_long" | "no_join_button";

export interface Step {
  name: string;
  atMs: number;
  ok: boolean;
  detail?: string;
}

// Inglês e português: a língua da tela segue o navegador (`--lang`), mas o Google às vezes ignora.
const JOIN = /^(Ask to join|Pedir para participar|Join now|Participar agora|Participar)$/i;
const LEAVE = /Leave call|Sair da chamada/i;
const DENIED = /denied your request|recusou (o seu|seu) pedido|You can't join this video call|Não é possível participar desta videochamada|removed you|removeu você/i;
const DISMISS = /^(Got it|Entendi|Dismiss|Dispensar|Fechar|Close)$/i;
const NAME = /Your name|Seu nome|Qual é o seu nome|What's your name/i;
const CAMERA_OFF = /Turn off camera|Desativar câmera|Desligar câmera/i;

/** Abre o link, escreve o nome, desliga a câmera e pede para entrar. Espera o anfitrião até `waitMs`. */
export async function join(page: Page, link: string, name: string, waitMs: number, now: () => number, steps: Step[]): Promise<Admission> {
  const step = (stepName: string, ok: boolean, detail?: string): void => {
    steps.push({ name: stepName, atMs: now(), ok, ...(detail ? { detail } : {}) });
  };
  await page.goto(link, { waitUntil: "domcontentloaded" });
  step("abriu_o_link", true);
  for (const button of await page.getByRole("button", { name: DISMISS }).all()) await button.click({ timeout: 2000 }).catch(() => undefined);
  const nameBox = page.getByRole("textbox", { name: NAME }).first();
  const hasName = await nameBox.waitFor({ timeout: 20_000 }).then(() => true, () => false);
  if (hasName) await nameBox.fill(name);
  step("escreveu_o_nome", hasName, hasName ? undefined : "sem caixa de nome: a página pode estar pedindo login");
  const camera = page.getByRole("button", { name: CAMERA_OFF }).first();
  if (await camera.isVisible().catch(() => false)) await camera.click().catch(() => undefined);
  const joinButton = page.getByRole("button", { name: JOIN }).first();
  if (!(await joinButton.waitFor({ timeout: 20_000 }).then(() => true, () => false))) {
    step("pediu_para_entrar", false, "sem botão de pedir para entrar");
    return "no_join_button";
  }
  await joinButton.click();
  step("pediu_para_entrar", true);
  const outcome = await Promise.race([
    page.getByRole("button", { name: LEAVE }).first().waitFor({ timeout: waitMs }).then(() => "admitted" as const),
    page.getByText(DENIED).first().waitFor({ timeout: waitMs }).then(() => "denied" as const),
  ]).catch(() => "waited_too_long" as const);
  step("resposta_do_anfitriao", outcome === "admitted", outcome);
  return outcome;
}

/** Sai pelo botão da reunião. Se o botão sumiu (a reunião acabou), a página fecha mesmo assim. */
export async function leave(page: Page): Promise<boolean> {
  const button = page.getByRole("button", { name: LEAVE }).first();
  return button.click({ timeout: 5000 }).then(() => true, () => false);
}
