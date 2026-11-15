import { z } from "zod";

/**
 * Caixa postal por organização: quando ninguém pode atender, a chamada é atendida e o recado é
 * gravado em vez de desligada na cara de quem ligou.
 *
 * Desligada de fábrica. Ligar é escolha do operador, em Configurações (chave `voicemail.enabled`
 * em `settings`): atender sem uma pessoa do outro lado muda o que quem liga ouve, e atender gera
 * minuto pago na operadora que cobra a ligação recebida. E ela só atende com a gravação da
 * organização ligada (`calls.recording_enabled`, decisão 0018, escolha 5A): uma chave só diz se
 * esta empresa grava voz.
 *
 * `voicemail.max_seconds` corta o recado mesmo com quem ligou falando, entre 5 e 300 segundos,
 * contados depois do aviso. Sem valor gravado, vale o de fábrica.
 *
 * `voicemail.language` escolhe em que idioma o aviso gravado toca antes do recado (escolha 1A).
 */
export const VOICEMAIL_ENABLED_SETTING = "voicemail.enabled";
export const VOICEMAIL_MAX_SECONDS_SETTING = "voicemail.max_seconds";
export const DEFAULT_VOICEMAIL_MAX_SECONDS = 60;
/** O maior tempo máximo que o operador pode gravar: também é o que mais dura um recado vivo. */
export const MAX_VOICEMAIL_SECONDS = 300;
export const voicemailMaxSecondsSchema = z.number().int().min(5).max(MAX_VOICEMAIL_SECONDS);

/** Só `true` liga. Ausente, `false`, texto ou número não ligam: o padrão é nunca atender sozinho. */
export function voicemailEnabledOf(stored: unknown): boolean {
  return stored === true;
}

/** O teto que vale para um valor lido de `settings`: ausente ou fora da faixa cai no de fábrica. */
export function voicemailMaxSecondsOf(stored: unknown): number {
  const parsed = voicemailMaxSecondsSchema.safeParse(stored);
  return parsed.success ? parsed.data : DEFAULT_VOICEMAIL_MAX_SECONDS;
}

export const VOICEMAIL_LANGUAGE_SETTING = "voicemail.language";
/** Os idiomas em que o aviso existe gravado, um arquivo cada (`apps/voice/assets/voicemail-notice`). */
export const VOICEMAIL_LANGUAGES = ["pt-BR", "en", "es"] as const;
export type VoicemailLanguage = (typeof VOICEMAIL_LANGUAGES)[number];
export const DEFAULT_VOICEMAIL_LANGUAGE: VoicemailLanguage = "pt-BR";
export const voicemailLanguageSchema = z.enum(VOICEMAIL_LANGUAGES);

/** O idioma do aviso para um valor lido de `settings`: ausente ou desconhecido cai no de fábrica. */
export function voicemailLanguageOf(stored: unknown): VoicemailLanguage {
  const parsed = voicemailLanguageSchema.safeParse(stored);
  return parsed.success ? parsed.data : DEFAULT_VOICEMAIL_LANGUAGE;
}
