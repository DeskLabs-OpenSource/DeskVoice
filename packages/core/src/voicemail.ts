import { z } from "zod";

/**
 * Caixa postal por organização: quando ninguém pode atender, a chamada é atendida e o recado é
 * gravado em vez de desligada na cara de quem ligou.
 *
 * Desligada de fábrica. Ligar é escolha do operador, em Configurações (chave `voicemail.enabled`
 * em `settings`): atender sem uma pessoa do outro lado muda o que quem liga ouve, e o padrão não
 * pode prometer isso numa instalação que nunca pediu.
 *
 * `voicemail.max_seconds` corta o recado mesmo com quem ligou falando, entre 5 e 300 segundos.
 * Sem valor gravado, vale o de fábrica.
 */
export const VOICEMAIL_ENABLED_SETTING = "voicemail.enabled";
export const VOICEMAIL_MAX_SECONDS_SETTING = "voicemail.max_seconds";
export const DEFAULT_VOICEMAIL_MAX_SECONDS = 60;
export const voicemailMaxSecondsSchema = z.number().int().min(5).max(300);

/** Só `true` liga. Ausente, `false`, texto ou número não ligam: o padrão é nunca atender sozinho. */
export function voicemailEnabledOf(stored: unknown): boolean {
  return stored === true;
}

/** O teto que vale para um valor lido de `settings`: ausente ou fora da faixa cai no de fábrica. */
export function voicemailMaxSecondsOf(stored: unknown): number {
  const parsed = voicemailMaxSecondsSchema.safeParse(stored);
  return parsed.success ? parsed.data : DEFAULT_VOICEMAIL_MAX_SECONDS;
}
