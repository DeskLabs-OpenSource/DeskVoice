"use client";

import en from "../../../../i18n/en/voice";
import es from "../../../../i18n/es/voice";
import { useDict } from "../../../../i18n/provider";
import ptBR from "../../../../i18n/pt-BR/voice";
import { useApi } from "../../../../ui/api";
import { useErrorText } from "../../../../ui/errors";
import { Notice, Panel, Skeleton } from "../../../../ui/kit";
import { SynthesizerCard, type SynthesizerView } from "./card";

export default function VoiceSettings() {
  const t = useDict(ptBR, en, es);
  const errorText = useErrorText();
  const synthesizers = useApi<SynthesizerView[]>("/synthesizers");
  if (synthesizers.error && !synthesizers.data) return <Notice tone="fail">{errorText(synthesizers.error)}</Notice>;
  if (!synthesizers.data) return <Skeleton lines={4} />;
  return (
    <Panel title={t.title} description={t.lead}>
      <p className="text-sm text-muted">{t.guide}</p>
      <ul className="grid">
        {synthesizers.data.map((voice) => (
          <SynthesizerCard key={voice.id} voice={voice} t={t} onChanged={synthesizers.reload} />
        ))}
      </ul>
    </Panel>
  );
}
