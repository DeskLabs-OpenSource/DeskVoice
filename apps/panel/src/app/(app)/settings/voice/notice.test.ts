// O aviso da voz diz só o que as páginas da ElevenLabs dizem (desenho R5, fatia 1b e seção 9.1,
// resposta A da DESA-103): a retenção como a página diz, o armazenamento nos EUA com a fonte, e o
// processamento como não declarado. O único nome de país é o do armazenamento, junto da fonte.
import { describe, expect, it } from "vitest";
import en from "../../../../i18n/en/voice";
import es from "../../../../i18n/es/voice";
import type { Locale } from "../../../../i18n/locales";
import ptBR from "../../../../i18n/pt-BR/voice";
import { noticeOf, VOICE_SOURCES } from "./notice";

// A ElevenLabs como a rota a devolve (o teste de rota confere que `synthesizers/elevenlabs.ts` declara isto).
const elevenlabs = { provider: "elevenlabs", processingLocation: { kind: "undeclared" } } as const;

const DICTIONARIES: Array<[Locale, typeof ptBR]> = [
  ["pt-BR", ptBR],
  ["en", en],
  ["es", es],
];

// Nomes e siglas de país que um aviso poderia presumir, nos três idiomas.
const COUNTRY = /estados unidos|united states|\bEUA\b|\bUSA?\b|\bU\.S\.|eeuu|brasil|brazil|europ|irland|ireland|canad|alemanha|germany|alemania/gi;

const PRIVACY_POLICY = "https://elevenlabs.io/privacy-policy";
const ZERO_RETENTION = "https://elevenlabs.io/docs/eleven-api/resources/zero-retention-mode";

describe("o aviso de para onde vai o texto que o agente fala", () => {
  it.each(DICTIONARIES)("o único país é o do armazenamento, e ele aparece junto do endereço e da data da fonte (%s)", (locale, t) => {
    const lines = noticeOf(t, elevenlabs, locale);
    const withCountry = lines.filter((line) => `${line.text} ${line.source?.text ?? ""}`.match(COUNTRY));
    expect(withCountry).toHaveLength(1);
    const [storage] = withCountry;
    // Uma vez só, e é a frase do armazenamento, não a do processamento.
    expect(storage?.text.match(COUNTRY)).toHaveLength(1);
    expect(storage?.text).toBe(t.storage.replace("{provider}", "ElevenLabs").replace("{country}", t.countries.US ?? ""));
    expect(storage?.source?.url).toBe(PRIVACY_POLICY);
    // A data que a página traz (9/10/2026) e a da leitura (17/11/2026).
    expect(storage?.source?.text).toMatch(/2026/);
    expect(storage?.source?.text).toMatch(/09|9\b/);
    expect(storage?.source?.text).toMatch(/17/);
    // Nenhuma fonte nem frase fora dela cita país.
    for (const line of lines.filter((each) => each !== storage)) expect(`${line.text} ${line.source?.text ?? ""}`).not.toMatch(COUNTRY);
  });

  it.each(DICTIONARIES)("diz que a ElevenLabs não declara onde processa (%s)", (locale, t) => {
    const lines = noticeOf(t, elevenlabs, locale);
    expect(lines.at(-1)?.text).toBe(t.location.undeclared.replace("{provider}", "ElevenLabs"));
    expect(lines.at(-1)?.source).toBeUndefined();
  });

  it.each(DICTIONARIES)("diz a retenção como a página diz, com a fonte, e o que vai (%s)", (locale, t) => {
    const lines = noticeOf(t, elevenlabs, locale);
    const retention = t.retention.elevenlabs ?? [];
    expect(lines.map((line) => line.text)).toEqual([
      t.goes.replace("{provider}", "ElevenLabs"),
      ...retention,
      t.storage.replace("{provider}", "ElevenLabs").replace("{country}", t.countries.US ?? ""),
      t.location.undeclared.replace("{provider}", "ElevenLabs"),
    ]);
    // Histórico até apagar, 30 dias de cópia, registros sem prazo e o modo sem retenção só no Enterprise.
    expect(retention).toHaveLength(4);
    expect(retention[1]).toMatch(/30/);
    expect(retention[3]).toMatch(/Enterprise/);
    expect(lines[retention.length]?.source?.url).toBe(ZERO_RETENTION);
    // Nenhuma frase promete o que a página não diz.
    expect(retention.join(" ")).not.toMatch(/não guarda|does not keep|no guarda|apaga sozinh|deletes automatically|borra sol/i);
  });

  it("a fonte do armazenamento é a política de 9/10/2026, lida em 17/11/2026", () => {
    expect(VOICE_SOURCES.elevenlabs?.storage).toEqual({ country: "US", url: PRIVACY_POLICY, updated: "2026-10-09", read: "2026-11-17" });
    expect(VOICE_SOURCES.elevenlabs?.retention).toEqual({ url: ZERO_RETENTION, read: "2026-11-17" });
  });

  // O texto da seção 9.1 do desenho, nos três idiomas.
  const CONFIRM: Record<Locale, string> = {
    "pt-BR": "O texto que o agente fala na ligação vai para a ElevenLabs. Ele pode repetir o que a pessoa disse, como nome, endereço e telefone.",
    en: "The text the agent speaks on the call goes to ElevenLabs. It may repeat what the caller said, such as name, address and phone number.",
    es: "El texto que el agente dice en la llamada va a ElevenLabs. Puede repetir lo que la persona dijo, como nombre, dirección y teléfono.",
  };
  it.each(DICTIONARIES)("a confirmação nomeia o fornecedor e diz o que vai (%s)", (locale, t) => {
    expect(t.confirm.replace("{provider}", t.providers.elevenlabs ?? "")).toBe(CONFIRM[locale]);
  });

  it.each(DICTIONARIES)("fornecedor sem página lida diz isso, e não inventa retenção nem país (%s)", (locale, t) => {
    const lines = noticeOf(t, { provider: "acme", processingLocation: { kind: "undeclared" } }, locale);
    expect(lines.map((line) => line.text)).toEqual([t.goes.replace("{provider}", "acme"), t.retentionUnread, t.location.undeclared.replace("{provider}", "acme")]);
  });
});
