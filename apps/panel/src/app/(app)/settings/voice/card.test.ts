// O cartão da voz: o aviso fica à vista com e sem a chave gravada, a confirmação aparece para quem
// configura, e a chave nunca é preenchida de volta (desenho R5, fatia 1b).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ptBR from "../../../../i18n/pt-BR/voice";
import { SynthesizerCard, type SynthesizerView } from "./card";

const base: SynthesizerView = {
  id: "elevenlabs",
  label: "ElevenLabs",
  provider: "elevenlabs",
  processingLocation: { kind: "undeclared" },
  keyUrl: "https://elevenlabs.io/app/settings/api-keys",
  configured: false,
  keyCheck: null,
  consent: null,
};

const render = (voice: SynthesizerView): string => renderToStaticMarkup(createElement(SynthesizerCard, { voice, t: ptBR, onChanged: () => undefined }));

describe("o cartão da voz", () => {
  it("o aviso aparece sem chave e não some com a chave gravada e aceita", () => {
    const saved: SynthesizerView = {
      ...base,
      configured: true,
      keyCheck: { result: "accepted", checkedAt: "2026-11-17T17:00:00.000Z" },
      consent: { name: "Ana", at: "2026-11-17T17:00:00.000Z" },
    };
    for (const voice of [base, saved]) {
      const html = render(voice);
      expect(html).toContain('data-testid="voice-notice"');
      expect(html).toContain("https://elevenlabs.io/privacy-policy");
      expect(html).toContain("não declara onde processa");
      expect(html).toContain("O texto que o agente fala na ligação vai para a ElevenLabs. Ele pode repetir");
    }
    const html = render(saved);
    expect(html).toContain("Envio confirmado por Ana");
    expect(html).toContain("aceita.");
  });

  it("quem confirmou e saiu da equipe aparece como tal, sem nome inventado", () => {
    const html = render({ ...base, configured: true, consent: { name: null, at: "2026-11-17T17:00:00.000Z" } });
    expect(html).toContain("Envio confirmado por uma pessoa que saiu da equipe");
  });

  it("o campo da chave nasce vazio, mesmo com a chave gravada", () => {
    const html = render({ ...base, configured: true });
    expect(html).toMatch(/<input[^>]*type="password"[^>]*value=""/);
  });
});
