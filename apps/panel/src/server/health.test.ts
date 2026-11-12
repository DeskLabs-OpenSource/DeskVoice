import { describe, expect, it } from "vitest";
import en from "../i18n/en/health";
import es from "../i18n/es/health";
import ptBR from "../i18n/pt-BR/health";
import { agentLine, databaseLine, engineLine, healthReport, routinesLine, telephonyLine, trunkLine, voiceLine, whatsappLine, type EngineKeys, type HealthCheck } from "./health";
import type { KeyCheckView } from "./engine-key";
import type { VoiceHealth } from "./voice";
import type { WhatsAppView } from "./whatsapp";

const now = new Date("2026-03-01T15:00:00.000Z");
const ago = (minutes: number, seconds = 0): Date => new Date(now.getTime() - minutes * 60_000 - seconds * 1000);
const voice = (asterisk: "ok" | "fail", trunks: Array<"ok" | "warn" | "fail"> = []): VoiceHealth => ({
  asterisk: { status: asterisk, detail: "x" },
  trunks: trunks.map((status, index) => ({ id: String(index), status, detail: "x" })),
});
const view = (service: WhatsAppView["service"], status: WhatsAppView["status"] = "disconnected", available = true): WhatsAppView => ({
  available,
  service,
  serviceReason: null,
  serviceWarning: null,
  disk: null,
  agent: "responding",
  status,
  failure: null,
  phone: null,
  connectedAt: null,
  qr: null,
  replaces: null,
});
const brief = (line: HealthCheck): string => `${line.status} ${line.reason}`;
const keys = (count: number, checks: EngineKeys["checks"] = []): EngineKeys => ({ keys: count, checks });

describe("routines line", () => {
  const queue = (oldestDueAt: Date | null, listeners = 1) => routinesLine({ listeners, oldestDueAt }, now);

  it("fails when no process listens to the queue, even with nothing waiting", () => {
    expect(brief(queue(null, 0))).toBe("fail routines_not_listening");
    expect(brief(queue(ago(30), 0))).toBe("fail routines_not_listening");
  });

  it("is ok up to 2 minutes of wait, late from 2, and stuck from 10", () => {
    expect(brief(queue(null))).toBe("ok routines_ok");
    expect(brief(queue(ago(1, 59)))).toBe("ok routines_ok");
    expect(brief(queue(ago(2)))).toBe("warn routines_late");
    expect(brief(queue(ago(9, 59)))).toBe("warn routines_late");
    expect(queue(ago(10))).toEqual({ status: "fail", reason: "routines_stuck", params: { when: ago(10).toISOString() }, action: "routines_stuck" });
  });

  it("says why it could not check when the database is down", () => {
    expect(brief(routinesLine(null, now))).toBe("warn needs_database");
  });
});

describe("update agent line", () => {
  it("is ok while the agent talks, and silent once its last word is older than 5 minutes", () => {
    expect(agentLine({ lastSeenAt: ago(0, 30) }, now)).toEqual({ status: "ok", reason: "agent_ok", params: { when: ago(0, 30).toISOString() }, action: null });
    expect(brief(agentLine({ lastSeenAt: ago(5) }, now))).toBe("ok agent_ok");
    expect(agentLine({ lastSeenAt: ago(5, 1) }, now)).toEqual({ status: "warn", reason: "agent_silent", params: { when: ago(5, 1).toISOString() }, action: "agent_silent" });
    expect(brief(agentLine({ lastSeenAt: ago(60 * 24 * 30) }, now))).toBe("warn agent_silent");
  });

  it("says not installed when it never talked, and is never a failure", () => {
    expect(brief(agentLine({ lastSeenAt: null }, now))).toBe("warn agent_never");
    expect(brief(agentLine(null, now))).toBe("warn needs_database");
  });
});

describe("whatsapp line", () => {
  it("not installed is ok; installed and down is a warning", () => {
    expect(brief(whatsappLine(view("absent")))).toBe("ok whatsapp_absent");
    expect(brief(whatsappLine(view("absent", "disconnected", false)))).toBe("ok whatsapp_absent");
    expect(brief(whatsappLine(view("removing")))).toBe("ok whatsapp_absent");
    expect(brief(whatsappLine(view("preparing")))).toBe("ok whatsapp_preparing");
    expect(brief(whatsappLine(view("running", "connected")))).toBe("ok whatsapp_connected");
    expect(brief(whatsappLine("down"))).toBe("warn whatsapp_service_down");
    expect(brief(whatsappLine(view("failed")))).toBe("warn whatsapp_service_failed");
    expect(brief(whatsappLine(view("running", "failed")))).toBe("warn whatsapp_dropped");
    expect(brief(whatsappLine(view("running", "qr")))).toBe("warn whatsapp_no_number");
    expect(brief(whatsappLine(view("running", "connected", false)))).toBe("warn whatsapp_unavailable");
    expect(brief(whatsappLine(null))).toBe("warn needs_database");
  });
});

describe("panel, voice and the lines that ask the voice process", () => {
  it("separates the voice process from its link to Asterisk", () => {
    expect([databaseLine(true), databaseLine(false)].map(brief)).toEqual(["ok database_ok", "fail database_down"]);
    expect([voiceLine(voice("ok")), voiceLine(null)].map(brief)).toEqual(["ok voice_ok", "fail voice_down"]);
    expect([telephonyLine(voice("ok")), telephonyLine(voice("fail")), telephonyLine(null)].map(brief)).toEqual(["ok telephony_ok", "fail telephony_down", "warn needs_voice"]);
  });

  it("phone line and voice engine keep their meaning", () => {
    expect([trunkLine(voice("ok")), trunkLine(voice("ok", ["ok"])), trunkLine(voice("ok", ["ok", "warn"])), trunkLine(voice("ok", ["fail", "ok"])), trunkLine(null)].map(brief)).toEqual([
      "warn trunk_none",
      "ok trunk_ok",
      "warn trunk_down",
      "fail trunk_down",
      "warn needs_voice",
    ]);
    expect(trunkLine(voice("ok", ["fail", "ok"])).params).toEqual({ down: 1, total: 2 });
    expect([engineLine(keys(1)), engineLine(keys(0)), engineLine(null)].map(brief)).toEqual(["ok engine_ok", "warn engine_none", "warn needs_database"]);
  });

  it("voice engine uses the last stored key test: rejected is a failure with what to do; never tested stays as before", () => {
    const tested = (result: KeyCheckView["result"], at = "2026-03-01T14:00:00.000Z") => ({ engine: "Gemini Live (Google)", check: { result, model: "modelo-x", checkedAt: at } });
    expect(
      [
        engineLine(keys(1, [tested("accepted")])),
        engineLine(keys(2, [tested("accepted")])),
        engineLine(keys(1, [tested("rejected")])),
        engineLine(keys(2, [tested("accepted"), tested("model_unavailable")])),
        engineLine(keys(1, [tested("no_credit")])),
        engineLine(keys(1, [tested("unreachable")])),
        engineLine(keys(2, [tested("rate_limited"), tested("rejected")])),
      ].map(brief),
    ).toEqual([
      "ok engine_key_accepted",
      "ok engine_ok",
      "fail engine_key_rejected",
      "fail engine_model_unavailable",
      "fail engine_no_credit",
      "warn engine_check_inconclusive",
      "fail engine_key_rejected",
    ]);
    const rejected = engineLine(keys(1, [tested("rejected")]));
    expect(rejected.action).toBe("engine_key_rejected");
    expect(rejected.params).toEqual({ engine: "Gemini Live (Google)", when: "2026-03-01T14:00:00.000Z", model: "modelo-x" });
    // A frase do terminal (`install/healthcheck.sh` só lê esta) já diz o que fazer.
    expect(healthReport({ engine: rejected }).checks[0]?.detail).toMatch(/^a chave de Gemini Live \(Google\) foi recusada .*Cadastre uma chave válida em Configurações/);
    // Duas chaves aceitas: vale a data do teste mais antigo.
    expect(engineLine(keys(2, [tested("accepted", "2026-03-01T14:00:00.000Z"), tested("accepted", "2026-02-01T10:00:00.000Z")])).params.when).toBe("2026-02-01T10:00:00.000Z");
  });
});

describe("the report", () => {
  it("orders the lines from the outside in, whatever order they were measured in, and names the worst state", () => {
    const report = healthReport({ engine: engineLine(keys(0)), routines: routinesLine({ listeners: 0, oldestDueAt: null }, now), database: databaseLine(true), panel: { status: "ok", reason: "panel_ok", params: {}, action: null } });
    expect(report.checks.map((line) => line.id)).toEqual(["panel", "database", "routines", "engine"]);
    expect(report.worst).toBe("fail");
    expect(healthReport({ engine: engineLine(keys(0)) }).worst).toBe("warn");
    expect(healthReport({ engine: engineLine(keys(1)) }).worst).toBe("ok");
  });

  it("gives the terminal the pt-BR sentence, with the values filled in", () => {
    const [line] = healthReport({ trunk: trunkLine(voice("ok", ["fail", "ok"])) }).checks;
    expect(line?.detail).toBe("1 de 2 linha(s) com problema");
  });

  it("every failing line says what to do, in the three languages", () => {
    const failing = [
      databaseLine(false),
      voiceLine(null),
      telephonyLine(voice("fail")),
      routinesLine({ listeners: 0, oldestDueAt: null }, now),
      routinesLine({ listeners: 1, oldestDueAt: ago(10) }, now),
      trunkLine(voice("ok", ["fail"])),
    ];
    for (const line of failing) {
      expect(line.status).toBe("fail");
      expect(line.action).not.toBeNull();
      for (const t of [ptBR, en, es]) expect(t.actions[line.action ?? "needs_voice"].length).toBeGreaterThan(10);
    }
  });
});
