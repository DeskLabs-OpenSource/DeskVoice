// O aviso da tela diz só o que a fonte do fornecedor diz (desenho R12, fatia 7b): país só com fonte,
// e, da TypeSafe, as três afirmações da página de privacidade, nem uma a mais.
import { describe, expect, it } from "vitest";
import en from "../../../../i18n/en/speech-filter";
import es from "../../../../i18n/es/speech-filter";
import type { Locale } from "../../../../i18n/locales";
import ptBR from "../../../../i18n/pt-BR/speech-filter";
import { noticeOf } from "./notice";

// O Jev como a rota o devolve (o teste de rota confere que `deciders/jev.ts` declara isto).
const jev = { provider: "typesafe", processingLocation: { kind: "country", country: "US", source: { url: "https://typesafe.ai/legal/privacy-policy", checkedOn: "2026-11-16" } } } as const;

const DICTIONARIES: Array<[Locale, typeof ptBR]> = [
  ["pt-BR", ptBR],
  ["en", en],
  ["es", es],
];

// Nomes e siglas de país que um aviso poderia presumir, nos três idiomas.
const COUNTRY = /estados unidos|united states|\bEUA\b|\bUSA?\b|\bU\.S\.|eeuu|brasil|brazil|europ|irland|ireland|canad|alemanha|germany|alemania/i;

describe("o aviso de para onde vai o texto", () => {
  it.each(DICTIONARIES)("com o lugar não declarado, não nomeia país (%s)", (locale, t) => {
    for (const provider of ["typesafe", "acme"]) {
      const notice = noticeOf(t, { provider, processingLocation: { kind: "undeclared" } }, locale);
      const text = [...notice.lines, ...notice.sources.map((source) => source.text)].join(" ");
      expect(text).not.toMatch(COUNTRY);
      expect(notice.lines.at(-1)).toBe(t.location.undeclared.replace("{provider}", t.providers[provider] ?? provider));
    }
  });

  it.each(DICTIONARIES)("do Jev, diz as três coisas da página da TypeSafe e cita a página com a data (%s)", (locale, t) => {
    const notice = noticeOf(t, jev, locale);
    // Guarda enquanto achar necessário (sem prazo), apaga a pedido, e é hospedado nos EUA. Só isso.
    expect(notice.lines).toEqual([...(t.retention.typesafe ?? []), t.location.country.replace("{provider}", "TypeSafe").replace("{country}", t.countries.US ?? "")]);
    expect(notice.lines).toHaveLength(3);
    // A página da retenção é a mesma do lugar: uma fonte só, com a data dela e a da leitura.
    expect(notice.sources).toHaveLength(1);
    expect(notice.sources[0]?.url).toBe("https://typesafe.ai/legal/privacy-policy");
    expect(notice.sources[0]?.text).toMatch(/2025/);
    expect(notice.sources[0]?.text).toMatch(/2026/);
  });

  it.each(DICTIONARIES)("nenhuma frase da TypeSafe promete prazo ou o que a retenção não diz (%s)", (_locale, t) => {
    const text = (t.retention.typesafe ?? []).join(" ");
    expect(text).not.toMatch(/\d+\s*(dias|days|días|meses|months|horas|hours)/i);
    expect(text).not.toMatch(/trein|train|entren|zero data|não guarda|does not keep|no guarda/i);
  });

  // A exclusão, como a página a escreve: a pedido, quando não for mais razoavelmente necessário, salvo
  // obrigação legal (ajuste do Arquiteto de 17/11). Sem as duas condições, a frase promete mais que a página.
  const DELETION: Record<Locale, string> = {
    "pt-BR": "A pedido, ela apaga esses dados ou os guarda de um jeito que não identifique a pessoa, quando eles não forem mais razoavelmente necessários, salvo se a lei a obrigar a guardá-los por mais tempo.",
    en: "On request, it deletes this data or keeps it in a form that does not identify the person once it is no longer reasonably necessary, unless the law requires it to keep the data longer.",
    es: "A pedido, borra esos datos o los guarda de una forma que no identifique a la persona cuando ya no sean razonablemente necesarios, salvo que la ley la obligue a guardarlos por más tiempo.",
  };
  it.each(DICTIONARIES)("a frase da exclusão leva as duas condições da página (%s)", (locale, t) => {
    expect(t.retention.typesafe?.[1]).toBe(DELETION[locale]);
  });

  // A confirmação cobre tudo o que vai (a fala de quem ligou, a última do agente e termos do vocabulário).
  const CONFIRM: Record<Locale, string> = {
    "pt-BR": "O texto da ligação vai para a TypeSafe.",
    en: "The call's text goes to TypeSafe.",
    es: "El texto de la llamada va a TypeSafe.",
  };
  it.each(DICTIONARIES)("a confirmação diz que o texto da ligação vai para a TypeSafe (%s)", (locale, t) => {
    expect(t.confirm.replace("{provider}", t.providers.typesafe ?? "")).toBe(CONFIRM[locale]);
  });

  it.each(DICTIONARIES)("o modelo que roda aqui não pede aviso de fornecedor (%s)", (locale, t) => {
    expect(noticeOf(t, { provider: "none", processingLocation: { kind: "this-server" } }, locale)).toEqual({ lines: [t.location["this-server"]], sources: [] });
  });

  it.each(DICTIONARIES)("fornecedor sem política lida diz isso, e não inventa retenção (%s)", (locale, t) => {
    const notice = noticeOf(t, { provider: "acme", processingLocation: { kind: "undeclared" } }, locale);
    expect(notice.lines[0]).toBe(t.retentionUnread);
    expect(notice.sources).toEqual([]);
  });
});
