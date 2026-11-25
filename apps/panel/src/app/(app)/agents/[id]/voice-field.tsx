"use client";

import { SpeakerHigh } from "@phosphor-icons/react";
import Link from "next/link";
import { useRef, useState } from "react";
import type { AgentsDictionary } from "../../../../i18n/pt-BR/agents";
import { fill } from "../../../../i18n/locales";
import { Button, Field, Select } from "../../../../ui/kit";
import type { Engine } from "../../../../ui/types";
import { sampleFor, selectedVoice, type VoiceSample } from "./voice-sample";

/** O nome do provedor pelo `provider` do motor; o provedor que o dicionário não conhece sai como veio. */
export const voiceProviderName = (t: AgentsDictionary, provider: string): string => t.voiceProviders[provider] ?? provider;

/**
 * O nome do motor ao lado do provedor, sem o provedor repetido: "Gemini Live (Google)" vira
 * "Gemini Live" quando o provedor já vem escrito antes. Só nesta tela: o `label` do motor continua o
 * mesmo nas outras (Configurações › IA, a ligação, a lista de agentes), onde ele aparece sozinho.
 */
export const engineNameBeside = (label: string, provider: string): string => {
  const suffix = ` (${provider})`;
  return label.endsWith(suffix) ? label.slice(0, -suffix.length) : label;
};

/**
 * O campo "Voz" da tela do agente (DESA-397, fatia 1a): as vozes num grupo com o provedor e o motor,
 * o botão "Ouvir" com a amostra da voz selecionada no idioma do agente, e a linha que diz onde ficam
 * as vozes da ElevenLabs. Nenhuma voz da ElevenLabs entra na lista: o motor do agente não as fala.
 */
export function VoiceField({ t, engine, voiceId, language, onChange }: { t: AgentsDictionary; engine: Engine | undefined; voiceId: string; language: string; onChange(next: string): void }) {
  const voices = engine?.voices ?? [];
  const defaultVoice = engine?.defaultVoice ?? null;
  const provider = engine ? voiceProviderName(t, engine.provider) : null;
  const engineName = engine && provider ? engineNameBeside(engine.label, provider) : null;
  const custom = voiceId !== "" && !voices.some((voice) => voice.id === voiceId);
  const options = (
    <>
      <option value="">{defaultVoice ? fill(t.voiceDefault, { voice: defaultVoice }) : t.voiceDefaultNone}</option>
      {voices.map((voice) => (
        <option key={voice.id} value={voice.id}>
          {[voice.id, voice.style, voice.recommended ? t.voiceRecommended : null].filter(Boolean).join(" · ")}
        </option>
      ))}
    </>
  );
  // A voz que a ligação usa, inclusive o padrão do motor; a salva fora da lista não tem amostra.
  const heard = custom ? undefined : selectedVoice(voices, voiceId, defaultVoice);
  const offersVoice = voices.length > 0 || defaultVoice !== null;
  return (
    <div className="grid content-start gap-2">
      <Field label={t.voiceId} hint={engine && provider && offersVoice ? fill(t.voiceHint, { provider, engine: engineName ?? engine.label }) : undefined}>
        <Select value={voiceId} onChange={(event) => onChange(event.target.value)}>
          {engine && provider ? <optgroup label={`${provider} · ${engineName ?? engine.label}`}>{options}</optgroup> : options}
          {custom ? <option value={voiceId}>{fill(t.voiceCustom, { voice: voiceId })}</option> : null}
        </Select>
      </Field>
      {engine && offersVoice ? (
        // A chave zera o "não tocou" quando a amostra muda: outra voz, outro idioma.
        <Listen key={`${engine.id}/${heard?.id ?? voiceId}/${language}`} t={t} voice={heard?.id ?? voiceId} sample={sampleFor(heard, language)} />
      ) : null}
      <p className="text-[0.87rem] text-muted">
        {t.voiceElevenLabs}{" "}
        <Link href="/settings/voice" className="font-bold underline underline-offset-4">
          {t.voiceElevenLabsLink}
        </Link>
      </p>
    </div>
  );
}

/** "Ouvir": nada é baixado antes do clique (`preload="none"`), e o clique sempre diz alguma coisa. */
function Listen({ t, voice, sample }: { t: AgentsDictionary; voice: string; sample: VoiceSample | null }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [failed, setFailed] = useState(false);
  const play = () => {
    const element = audio.current;
    if (!element) return;
    setFailed(false);
    element.currentTime = 0;
    element.play().catch(() => setFailed(true));
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" icon={<SpeakerHigh size={18} aria-hidden />} disabled={sample === null} onClick={play} aria-label={fill(t.voiceListenLabel, { voice })}>
        {t.voiceListen}
      </Button>
      {sample ? <audio ref={audio} preload="none" src={sample.src} onError={() => setFailed(true)} /> : null}
      {sample === null ? <span className="text-[0.87rem] text-muted">{t.voiceNoSample}</span> : null}
      {sample?.inPortuguese ? <span className="text-[0.87rem] text-muted">{t.voiceSampleInPortuguese}</span> : null}
      {failed ? (
        <span role="alert" className="text-[0.87rem] text-fail">
          {t.voiceSampleFailed}
        </span>
      ) : null}
    </div>
  );
}
