import { randomUUID } from "node:crypto";
import { spokenLanguageOf, withSystem, type Db, type IvrAction, type IvrNoChoice } from "@deskvoice/core";
import type { IvrTransport } from "../ivr-session";

export interface MenuOption {
  digit: string;
  label: string;
  action: IvrAction;
  agentId?: string;
  transferE164?: string;
}

export interface MenuOptions {
  name?: string;
  language?: string;
  /** PCM16 do anúncio; `null` deixa o menu sem anúncio. Padrão: 1 s de um tom. */
  prompt?: Buffer | null;
  timeoutMs?: number;
  maxAttempts?: number;
  onNoChoice?: IvrNoChoice;
  options: MenuOption[];
}

/** 1 s de um tom a 440 Hz, PCM16 mono a 8 kHz: um anúncio que dá para reconhecer no que saiu. */
export function promptTone(ms = 1000): Buffer {
  const samples = (ms * 8000) / 1000;
  const pcm = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) pcm.writeInt16LE(Math.round(6000 * Math.sin((2 * Math.PI * 440 * i) / 8000)), i * 2);
  return pcm;
}

/** Um menu com as opções, gravado direto no banco (o painel é do PR 1b). */
export async function createIvrMenu(app: Db, organizationId: string, menu: MenuOptions): Promise<string> {
  const id = randomUUID();
  const prompt = menu.prompt === undefined ? promptTone() : menu.prompt;
  await withSystem(app, async (q) => {
    await q.exec(
      `insert into ivr_menus (id, organization_id, name, language, prompt_audio, prompt_audio_ms, timeout_ms, max_attempts, on_no_choice, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now(), now())`,
      [
        id,
        organizationId,
        menu.name ?? "Menu principal",
        spokenLanguageOf(menu.language),
        prompt,
        prompt === null ? null : Math.round(prompt.length / 16),
        menu.timeoutMs ?? 5000,
        menu.maxAttempts ?? 3,
        menu.onNoChoice ?? "person",
      ],
    );
    for (const option of menu.options) {
      await q.exec("insert into ivr_options (organization_id, menu_id, digit, label, action, agent_id, transfer_e164) values ($1, $2, $3, $4, $5, $6, $7)", [
        organizationId,
        id,
        option.digit,
        option.label,
        option.action,
        option.agentId ?? null,
        option.transferE164 ?? null,
      ]);
    }
  });
  return id;
}

/** Põe o número para atender pelo menu. */
export const answerByMenu = (app: Db, phoneNumberId: string, menuId: string): Promise<number> =>
  withSystem(app, (q) => q.exec("update phone_numbers set mode = 'ivr', ivr_menu_id = $2 where id = $1", [phoneNumberId, menuId]));

/** O transporte com teclado nas mãos do teste: ele faz o papel de quem ligou. */
export interface KeypadFake extends IvrTransport {
  /** Cada `sendAudio`, em ordem. */
  sent: Buffer[];
  cleared: number;
  hangups: number;
  closes: number;
  transferredTo: string | null;
  /** Quantos handlers de desligar foram registrados (no Asterisk, eles acumulam). */
  hangupHandlers: number;
  /** O anúncio fica "tocando" até `finishPlaying` ou `clearAudio`. Sem isto, termina no próximo ciclo. */
  holdPlayback: boolean;
  finishPlaying(): void;
  press(digit: string): void;
  callerHangup(): void;
}

export function keypadFake(): KeypadFake {
  let dtmf: ((digit: string) => void) | undefined;
  const hangupHandlers: Array<() => void> = [];
  const waiting: Array<() => void> = [];
  const release = (): void => {
    for (const resolve of waiting.splice(0)) resolve();
  };
  const fake: KeypadFake = {
    sent: [],
    cleared: 0,
    hangups: 0,
    closes: 0,
    transferredTo: null,
    hangupHandlers: 0,
    holdPlayback: false,
    onAudio: () => undefined,
    sendAudio: (pcm) => void fake.sent.push(pcm),
    clearAudio() {
      fake.cleared += 1;
      release();
    },
    drained: () => (fake.holdPlayback ? new Promise<void>((resolve) => waiting.push(resolve)) : new Promise<void>((resolve) => setImmediate(resolve))),
    // Como no Asterisk: os ouvintes de desligar acumulam, não trocam.
    onHangup(handler) {
      hangupHandlers.push(handler);
      fake.hangupHandlers = hangupHandlers.length;
    },
    onDtmf: (handler) => void (dtmf = handler),
    hangup: async () => void (fake.hangups += 1),
    transfer: async (to) => void (fake.transferredTo = to),
    close: async () => void (fake.closes += 1),
    finishPlaying: release,
    press: (digit) => dtmf?.(digit),
    callerHangup() {
      for (const handler of hangupHandlers) handler();
    },
  };
  return fake;
}
