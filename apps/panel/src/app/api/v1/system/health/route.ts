import { queueHealth, withOrg, withSystem, type OrgQuery } from "@deskvoice/core";
import { ApiError, SESSION_COOKIE, findSession, handlePublic, readCookie } from "../../../../../server/context";
import { agentLine, databaseLine, engineLine, healthReport, panelLine, routinesLine, telephonyLine, trunkLine, voiceLine, whatsappLine, type HealthCheck, type HealthId } from "../../../../../server/health";
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

  let engineKeys: number | null = null;
  try {
    const row = await withSystem(deps.db, (q) => q.one<{ keys: number }>("select count(*)::int as keys from settings where secret and key like 'engine.%.api_key'"));
    engineKeys = row?.keys ?? 0;
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
      whatsapp = await observe(deps, org, session.organizationId);
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
  lines.engine = engineLine(engineKeys);
  const report = healthReport(lines);
  return { ...report, ...Object.fromEntries(report.checks.map((line) => [line.id, line])) };
});
