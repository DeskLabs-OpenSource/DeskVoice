import { queueHealth, withOrg, withSystem, type OrgQuery } from "@deskvoice/core";
import { ApiError, SESSION_COOKIE, findSession, handlePublic, readCookie, type Session } from "../../../../../server/context";
import { readEngineKeys } from "../../../../../server/engine-key";
import { agentLine, anonymousEngineLine, databaseLine, engineLine, healthReport, panelLine, routinesLine, telephonyLine, trunkLine, voiceLine, whatsappCallsLine, whatsappLine, type EngineKeys, type HealthCheck, type HealthId } from "../../../../../server/health";
import { organizationTrunks, voiceHealthSchema, voiceRequest, type VoiceHealth } from "../../../../../server/voice";
import { observe, type WhatsAppView } from "../../../../../server/whatsapp";
import { observeCalls, type WhatsAppCallsView } from "../../../../../server/whatsapp-calls";

/**
 * Pública: o instalador e o `healthcheck.sh` chamam sem sessão. Sem sessão, só as peças da
 * instalação, com estado e um motivo, nunca endereço, nome de linha ou conteúdo de configuração. É
 * também o motivo de usar `withSystem`: sem sessão não há organização para abrir `withOrg`. Com
 * sessão (a tela), entram as linhas que são da organização: o agente de atualização, o WhatsApp e a ligação pelo WhatsApp,
 * e o motor de voz passa a ser lido só da organização da sessão, com provedor, modelo e data.
 *
 * Devolve `checks` (na ordem de depuração), `worst`, e cada linha também pela chave do id: é por
 * ela que o `healthcheck.sh`, inclusive o de uma versão anterior durante a atualização, lê
 * `panel`, `trunk` e `engine`.
 */
export const GET = handlePublic({}, async ({ request, deps }) => {
  const now = deps.clock.now();
  const lines: Partial<Record<HealthId, HealthCheck>> = { panel: panelLine() };

  const token = readCookie(request, SESSION_COOKIE);
  let session: Session | null = null;
  let engineKeys: EngineKeys | null = null;
  try {
    // A sessão vem antes do motor: com ela, as chaves e os testes são só da organização dela; sem
    // ela, a soma da instalação, que a linha pública mostra sem detalhe.
    session = await findSession(deps, token);
    const organizationId = session?.organizationId;
    engineKeys = organizationId ? await withOrg(deps.db, organizationId, readEngineKeys) : await withSystem(deps.db, readEngineKeys);
  } catch (error) {
    // A falha do banco é a própria linha do banco: o resto da conferência segue sem ele.
    process.stderr.write(`[panel] health: the database did not answer: ${error instanceof Error ? error.message : String(error)}\n`);
  }
  const database = engineKeys !== null;
  lines.database = databaseLine(database);
  // A sessão achada com o banco caindo logo depois: as linhas da organização dizem por que faltam.
  if (!database) session = null;

  let voice: VoiceHealth | null = null;
  try {
    voice = await voiceRequest(deps, "GET", "/health", voiceHealthSchema);
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
  }
  lines.voice = voiceLine(voice);
  lines.telephony = telephonyLine(voice);
  lines.routines = routinesLine(database ? await queueHealth(deps.db, now) : null, now);

  // Sem sessão, a linha de telefonia soma a instalação inteira, como o `healthcheck.sh` espera.
  let trunks = voice;
  if (session) {
    const org = <T>(run: (q: OrgQuery) => Promise<T>): Promise<T> => withOrg(deps.db, session.organizationId, run);
    // Com sessão, só as linhas da organização dela: as de outra organização não entram na conta.
    if (voice) trunks = await org((q) => organizationTrunks(q, voice));
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
    let calls: WhatsAppCallsView | "down";
    try {
      calls = await observeCalls(deps, org, session.organizationId, { withQr: false });
    } catch (error) {
      // O processo de voz ou o WaCalls não responderam.
      if (!(error instanceof ApiError)) throw error;
      calls = "down";
    }
    // A prova de que o WhatsApp entrega a ligação a este aparelho: uma chamada dele desde a conexão.
    const since = calls !== "down" && calls.status === "connected" ? calls.connectedAt : null;
    const lastCall = since
      ? await org((q) => q.one<{ at: Date | null }>(`select max(started_at) as at from calls where channel = 'whatsapp' and started_at >= $1`, [since]))
      : null;
    lines.whatsapp_calls = whatsappCallsLine(calls, lastCall?.at ?? null);
  } else if (!database && token) {
    // Sem banco não se confere a sessão: para a tela, as linhas da organização dizem por que faltam.
    lines.agent = agentLine(null, now);
    lines.whatsapp = whatsappLine(null);
    lines.whatsapp_calls = whatsappCallsLine(null);
  }

  lines.trunk = trunkLine(trunks);
  const engine = engineLine(engineKeys);
  lines.engine = session ? engine : anonymousEngineLine(engine);
  const report = healthReport(lines);
  return { ...report, ...Object.fromEntries(report.checks.map((line) => [line.id, line])) };
});
