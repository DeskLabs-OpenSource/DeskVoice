import type { EngineVoice } from "@deskvoice/voice-engine";

/** A amostra que o botão "Ouvir" toca, e se ela é a de pt-BR no lugar da do idioma do agente. */
export interface VoiceSample {
  src: string;
  inPortuguese: boolean;
}

type SampleLanguage = keyof NonNullable<EngineVoice["sample"]>;

/** O idioma sem a região (`en-US` → `en`), em minúsculas. */
const baseOf = (tag: string): string => (tag.trim().toLowerCase().split("-")[0] ?? "");

/**
 * A voz que a pessoa ouve na ligação: a escolhida, ou o padrão do motor quando o campo está em
 * "Padrão do motor". A voz salva fora da lista do motor (`voiceCustom`) não tem objeto: sem amostra.
 */
export function selectedVoice(voices: readonly EngineVoice[], voiceId: string, defaultVoice: string | null): EngineVoice | undefined {
  const id = voiceId === "" ? defaultVoice : voiceId;
  return id === null ? undefined : voices.find((voice) => voice.id === id);
}

/**
 * A amostra da voz no idioma do agente, pelo prefixo (`es-MX` toca a de `es`); sem ela, a de pt-BR,
 * marcada para a tela dizer "amostra em português". `null`: a voz não tem amostra nenhuma que sirva.
 * O caminho vira endereço da raiz do painel (`apps/panel/public/` é servido em `/`).
 */
export function sampleFor(voice: EngineVoice | undefined, agentLanguage: string): VoiceSample | null {
  const sample = voice?.sample;
  if (!sample) return null;
  const wanted = baseOf(agentLanguage);
  const own = (Object.keys(sample) as SampleLanguage[]).find((language) => baseOf(language) === wanted && sample[language]);
  const src = own ? sample[own] : sample["pt-BR"];
  if (!src) return null;
  return { src: `/${src.replace(/^\/+/, "")}`, inPortuguese: own === undefined };
}
