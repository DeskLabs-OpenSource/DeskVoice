// Issue #348: o campo "Idioma da conversa" do agente é texto livre, e o rótulo com região (`en-US`,
// `es-MX`) caía no pt-BR na saudação da passagem entre agentes e nas falas da agenda. A escolha do
// idioma é uma só (`spokenLanguageOf`), e este arquivo mede as três falas fixas pelos três pontos de
// entrada. O aviso da caixa postal lê o ajuste da organização (três opções na tela), não o do agente:
// aqui ele só prova que passa pelo mesmo normalizador.
import { DEFAULT_SPOKEN_LANGUAGE, spokenLanguageOf, voicemailLanguageOf } from "@deskvoice/core";
import { describe, expect, it } from "vitest";
// As falas da agenda moram num módulo interno de `@deskvoice/tools` (a raiz do pacote exporta as
// peças pelo carregador, não os textos): o teste entra pelo arquivo, como o teste de cada ferramenta.
import { AGENDA_WAIT_LINES, agendaWaitLine, speakSlot } from "../../../packages/tools/src/agenda-speech";
import { HANDOFF_GREETINGS, handoffGreetingFor } from "./call-session";
import { voicemailNotice } from "./voicemail";

/** O aviso da caixa postal que a pessoa ouve: o arquivo do idioma que sobrou do normalizador. */
const aviso = (language: string) => voicemailNotice(voicemailLanguageOf(language));

/** O horário da agenda em palavras, no fuso da regra e no idioma do agente. */
const horario = (language: string) => speakSlot("2026-11-18T09:00:00-05:00", "America/New_York", language);

describe("as falas fixas seguem o idioma do agente, com ou sem região", () => {
  it("en-US: o aviso, a passagem e a agenda saem em inglês", async () => {
    expect(voicemailLanguageOf("en-US")).toBe("en");
    expect(await aviso("en-US")).toEqual(await voicemailNotice("en"));
    expect(handoffGreetingFor("en-US")).toBe(HANDOFF_GREETINGS.en);
    expect(agendaWaitLine("checking", "en-US")).toBe("One moment, I'm checking the schedule.");
    expect(agendaWaitLine("booking", "en-US")).toBe("One moment, I'm booking that for you.");
    expect(agendaWaitLine("rescheduling", "en-US")).toBe("One moment, I'm rescheduling that for you.");
    expect(horario("en-US")).toBe("Wednesday, 11/18, 9:00 AM");
  });

  it("es-MX: o aviso, a passagem e a agenda saem em espanhol", async () => {
    expect(voicemailLanguageOf("es-MX")).toBe("es");
    expect(await aviso("es-MX")).toEqual(await voicemailNotice("es"));
    expect(handoffGreetingFor("es-MX")).toBe(HANDOFF_GREETINGS.es);
    expect(agendaWaitLine("checking", "es-MX")).toBe("Un momento, estoy revisando la agenda.");
    expect(agendaWaitLine("booking", "es-MX")).toBe("Un momento, estoy agendando.");
    expect(agendaWaitLine("rescheduling", "es-MX")).toBe("Un momento, estoy cambiando la cita.");
    expect(horario("es-MX")).toBe("miércoles, 18/11, 09:00");
  });

  it("pt-BR, en e es continuam exatamente como hoje", async () => {
    // As frases, uma por uma: é a caracterização do que já era falado antes do conserto.
    expect(HANDOFF_GREETINGS["pt-BR"]).toBe("Oi, vou continuar o seu atendimento a partir daqui.");
    expect(HANDOFF_GREETINGS.en).toBe("Hi, I'll take it from here and continue helping you.");
    expect(HANDOFF_GREETINGS.es).toBe("Hola, voy a continuar con su atención a partir de aquí.");
    expect(AGENDA_WAIT_LINES["pt-BR"]).toEqual({
      checking: "Um instante, estou conferindo a agenda.",
      booking: "Um instante, estou marcando.",
      rescheduling: "Um instante, estou remarcando.",
    });
    expect(AGENDA_WAIT_LINES.en).toEqual({
      checking: "One moment, I'm checking the schedule.",
      booking: "One moment, I'm booking that for you.",
      rescheduling: "One moment, I'm rescheduling that for you.",
    });
    expect(AGENDA_WAIT_LINES.es).toEqual({
      checking: "Un momento, estoy revisando la agenda.",
      booking: "Un momento, estoy agendando.",
      rescheduling: "Un momento, estoy cambiando la cita.",
    });
    // E o caminho inteiro, para os três valores que a configuração já aceitava.
    for (const language of ["pt-BR", "en", "es"] as const) {
      expect(voicemailLanguageOf(language)).toBe(language);
      expect(await aviso(language)).toEqual(await voicemailNotice(language));
      expect(handoffGreetingFor(language)).toBe(HANDOFF_GREETINGS[language]);
      expect(agendaWaitLine("checking", language)).toBe(AGENDA_WAIT_LINES[language].checking);
    }
    expect(horario("pt-BR")).toBe("quarta-feira, 18/11, 09:00");
    expect(horario("en")).toBe("Wednesday, 11/18, 9:00 AM");
    expect(horario("es")).toBe("miércoles, 18/11, 09:00");
  });

  it("fr-FR, vazio, nulo e lixo caem no padrão, sem lançar", async () => {
    for (const value of ["fr-FR", "", " ", "lixo", "english", null, undefined, 42, {}, ["en"]]) {
      expect(spokenLanguageOf(value)).toBe(DEFAULT_SPOKEN_LANGUAGE);
    }
    // O campo de tela é texto livre: o que não é idioma não pode derrubar a ligação.
    for (const value of ["fr-FR", "", "  ", "lixo"]) {
      expect(handoffGreetingFor(value)).toBe(HANDOFF_GREETINGS["pt-BR"]);
      expect(agendaWaitLine("booking", value)).toBe(AGENDA_WAIT_LINES["pt-BR"].booking);
      expect(await aviso(value)).toEqual(await voicemailNotice("pt-BR"));
    }
    expect(DEFAULT_SPOKEN_LANGUAGE).toBe("pt-BR");
  });
});
