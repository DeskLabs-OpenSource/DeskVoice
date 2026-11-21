// Os opcionais (desfecho, análise e transcrição) saíram de /settings/ai para /settings/after-call
// (parte 5 da central de configuração). O texto que manda ligar a transcrição precisa levar ao
// cartão que tem o interruptor, em cada idioma e na mensagem da API, e não à tela das chaves.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import enCommon from "../../../../i18n/en/common";
import esCommon from "../../../../i18n/es/common";
import ptCommon from "../../../../i18n/pt-BR/common";
import enSettings from "../../../../i18n/en/settings";
import esSettings from "../../../../i18n/es/settings";
import ptSettings from "../../../../i18n/pt-BR/settings";

const locales = [
  ["pt-BR", ptCommon, ptSettings],
  ["en", enCommon, enSettings],
  ["es", esCommon, esSettings],
] as const;

describe("o texto que manda ligar a transcrição aponta para o cartão dos opcionais", () => {
  for (const [locale, common, settings] of locales) {
    it(locale, () => {
      const text = common.errors.transcription_disabled;
      expect(text).toContain(settings.hub.cards.outcome.title);
      expect(text).not.toContain(settings.hub.groups.ai);
    });
  }

  it("a mensagem da API, em inglês", () => {
    const route = readFileSync(fileURLToPath(new URL("../../../api/v1/calls/[id]/transcription/route.ts", import.meta.url)), "utf8");
    const line = route.split("\n").find((l) => l.includes('"transcription_disabled"'));
    expect(line).toBeDefined();
    expect(line).toContain(enSettings.hub.cards.outcome.title);
    expect(line).not.toContain(enSettings.hub.groups.ai);
  });
});
