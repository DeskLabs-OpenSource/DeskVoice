import { queueHealth, withOrg, withSystem, type OrgQuery } from "@deskvoice/core";
import { ApiError, SESSION_COOKIE, findSession, handlePublic, readCookie } from "../../../../../server/context";
import { keyCheckSetting, readKeyCheck } from "../../../../../server/engine-key";
import { agentLine, databaseLine, engineLine, healthReport, panelLine, routinesLine, telephonyLine, trunkLine, voiceLine, whatsappLine, type EngineKeys, type HealthCheck, type HealthId } from "../../../../../server/health";
import { listEngines } from "../../../../../server/pieces";
import { voiceHealthSchema, voiceRequest, type VoiceHealth } from "../../../../../server/voice";
import { observe, type WhatsAppView } from "../../../../../server/whatsapp";

/**
 * Pública: o instalador e o `healthcheck.sh` chamam sem sessão. Sem sessão, só as peças da
 * instalação, com estado e um motivo, nunca endereço, nome de linha ou conteúdo de configuração. É
 * também o motivo de usar `withSystem`: sem sessão não há organização para abrir `withOrg`. Com
 * sessão (a tela), entram as linhas que são da organização: o agente de atualização e o WhatsApp.
 *
 * Devolve `checks` (na ordem de depuração), `worst`, e cada linha também pela chave do id: é por
 * ela que o `healthcheck.sh`, inclusive o de uma versão anterior durante a atualização, lê
 * `panel`, `trunk` e `engine`.
 */
export const GET = handlePublic({}, async ({ request, deps }) => {
  const now = deps.clock.now();
  const lines: Partial<Record<HealthId, HealthCheck>> = { panel: panelLine() };

  const labels = new Map((await listEngines()).map((engine) => [keyCheckSetting(engine.id), engine.label]));
  let engineKeys: EngineKeys | null = null;
  try {
    // Só o código do último teste de cada chave: a chave mesma nunca sai do banco por aqui.
    const rows = await withSystem(deps.db, (q) =>
      q.many<{ key: string; value: unknown }>("select key, case when secret then null else value end as value from settings where key like 'engine.%.api_key' or key like 'engine.%.key_check'"),
    );
    engineKeys = {
      keys: rows.filter((row) => row.key.endsWith(".api_key")).length,
      checks: rows.flatMap((row) => {
        const check = readKeyCheck(row.value);
        return check ? [{ engine: labels.get(row.key) ?? row.key, check }] : [];
      }),
    };
  } catch (error) {
    // A falha do banco é a própria linha do banco: o resto da conferência segue sem ele.
    process.stderr.write(`[panel] health: the database did not answer: ${error instanceof Error ? error.message : String(error)}\n`);
  }
  const database = engineKeys !== null;
  lines.database = databaseLine(database);

  let voice: VoiceHealth | null = null;
  try {
    voice = await voiceRequest(deps, "GET", "/health", voiceHealthSchema);
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
  }
  lines.voice = voiceLine(voice);
  lines.telephony = telephonyLine(voice);
  lines.routines = routinesLine(database ? await queueHealth(deps.db, now) : null, now);

  const token = readCookie(request, SESSION_COOKIE);
  const session = database ? await findSession(deps, token) : null;
  if (session) {
    const org = <T>(run: (q: OrgQuery) => Promise<T>): Promise<T> => withOrg(deps.db, session.organizationId, run);
    const agent = await org((q) => q.one<{ lastSeenAt: Date }>(`select last_seen_at as "lastSeenAt" from update_agent_status`));
    lines.agent = agentLine({ lastSeenAt: agent?.lastSeenAt ?? null }, now);
    let whatsapp: WhatsAppView | "down";
    try {
      whatsapp = await observe(deps, org, session.organizationId, { withQr: false });
    } catch (error) {
      // O WAHA não respondeu: é o que esta linha existe para dizer.
      if (!(error instanceof ApiError)) throw error;
      whatsapp = "down";
    }
    lines.whatsapp = whatsappLine(whatsapp);
  } else if (!database && token) {
    // Sem banco não se confere a sessão: para a tela, as linhas da organização dizem por que faltam.
    lines.agent = agentLine(null, now);
    lines.whatsapp = whatsappLine(null);
  }

  lines.trunk = trunkLine(voice);
  const engine = engineLine(engineKeys);
  // Sem sessão, a linha do motor diz o estado, a data e o que fazer, mas não qual provedor nem
  // qual modelo: é configuração da instalação, e a rota é pública. O `healthcheck.sh` só precisa do
  // estado e da frase.
  lines.engine = session || !("engine" in engine.params) ? engine : { ...engine, params: { ...engine.params, engine: "voz", model: "configurado" } };
  const report = healthReport(lines);
  return { ...report, ...Object.fromEntries(report.checks.map((line) => [line.id, line])) };
});
