import { enqueueTask, withOrg, type OrgQuery } from "@deskvoice/core";
import { loadWhatsAppConnector, sendWhatsApp } from "@deskvoice/tools/whatsapp";
import { WahaError, sendViaWaha, wahaEnsureSession, wahaGetQr, wahaGetSession, wahaLogoutSession, wahaSessionName, wahaStartSession, wahaStopSession, type WahaSession } from "@deskvoice/tools/waha";
import { z } from "zod";
import en from "../i18n/en/whatsapp";
import es from "../i18n/es/whatsapp";
import type { Locale } from "../i18n/locales";
import ptBR from "../i18n/pt-BR/whatsapp";
import { ApiError, type ServerDeps, type Session } from "./context";
import { AGENT_SILENT_MINUTES } from "./update";

/**
 * WhatsApp por QR Code. O painel é o único que fala com o WAHA em nome da tela: o navegador nunca
 * recebe o endereço nem a chave dele, só o estado e a imagem do QR Code.
 *
 * O serviço (o WAHA) só existe no servidor de quem pediu. O painel não toca no Docker: grava que a
 * organização quer o serviço, e o agente do kit (`install/agent.sh`) lê isso como um booleano, sobe
 * ou remove o contêiner e conta o estado na fala seguinte (`server/update.ts`).
 *
 * Nesta fatia o WAHA não avisa nada (sem webhook): o painel compara o que o WAHA diz agora com o
 * último estado gravado, a cada consulta da tela, e é nessa comparação que "conectou" e "caiu"
 * viram aviso. Queda com a tela fechada só aparece na próxima consulta.
 */
export const CONNECTOR_KEY = "whatsapp.connector";
// A mensagem de teste sai no idioma da tela de quem clicou.
const TEST_MESSAGE: Record<Locale, string> = { "pt-BR": ptBR.testMessage, en: en.testMessage, es: es.testMessage };

/**
 * O serviço no servidor: `absent` (não pedido), `preparing` (pedido; o agente ainda não o subiu),
 * `running`, `failed` (o agente tentou e não conseguiu) e `removing` (não é mais querido e ainda
 * está de pé).
 */
export type ServiceState = "absent" | "preparing" | "running" | "failed" | "removing";
export type ConnectionStatus = "disconnected" | "starting" | "qr" | "connected" | "failed";
/** Por que está em `failed`: o estado do WAHA, a sessão sumida, ou o QR Code que ninguém leu. */
export type Failure = "FAILED" | "STOPPED" | "missing" | "qr_expired";

export interface WhatsAppView {
  /** `false`: esta instalação não tem a chave do serviço (atualizada por um atualizador antigo, ou ambiente de desenvolvimento). */
  available: boolean;
  service: ServiceState;
  /** Só em `failed`: o código que o agente contou. */
  serviceReason: string | null;
  /** Aviso que acompanha o estado: `low_memory` (instalado com pouca memória) ou `image_kept` (removido; a imagem ficou no disco). */
  serviceWarning: string | null;
  /** Só com `serviceReason: "no_disk"`: quanto havia e quanto o serviço pede, em MB. */
  disk: { freeMb: number; neededMb: number } | null;
  /** O agente do servidor, que é quem instala e remove o serviço: falando, calado, ou nunca falou. */
  agent: "responding" | "silent" | "never";
  status: ConnectionStatus;
  failure: Failure | null;
  phone: string | null;
  connectedAt: Date | null;
  /** A imagem do QR Code, pronta para um `<img>`. Só em `qr`. */
  qr: string | null;
  /** Conector de outro tipo que está gravado: conectar um número o substitui. */
  replaces: { type: string; url: string } | null;
}

interface Row {
  status: ConnectionStatus;
  failure: Failure | null;
  phone: string | null;
  connectedAt: Date | null;
}
export interface Stored {
  row: Row | null;
  replaces: WhatsAppView["replaces"];
  service: ServiceState;
  serviceReason: string | null;
  serviceWarning: string | null;
  disk: WhatsAppView["disk"];
  agent: WhatsAppView["agent"];
}
type Org = <T>(fn: (q: OrgQuery) => Promise<T>) => Promise<T>;

const ROW = `status, failure, phone_e164 as phone, connected_at as "connectedAt"`;
const httpConnector = z.object({ type: z.enum(["deskcomm", "webhook"]), url: z.string() });

export async function readStored(q: OrgQuery, now: Date): Promise<Stored> {
  const row = await q.one<Row & { wanted: boolean }>(`select ${ROW}, service_wanted as wanted from whatsapp_sessions`);
  const setting = await q.one<{ value: unknown }>("select value from settings where key = $1", [CONNECTOR_KEY]);
  const other = httpConnector.safeParse(setting?.value);
  // O que o agente contou na última fala. A mesma linha vale para toda organização da instalação.
  const told = await q.one<{ lastSeenAt: Date; service: string | null; reason: string | null; warning: string | null; freeMb: number | null; neededMb: number | null }>(
    `select last_seen_at as "lastSeenAt", whatsapp_service as service, whatsapp_service_reason as reason, whatsapp_service_warning as warning,
            whatsapp_service_free_mb as "freeMb", whatsapp_service_needed_mb as "neededMb" from update_agent_status`,
  );
  const wanted = row?.wanted ?? false;
  const service: ServiceState = wanted ? (told?.service === "running" ? "running" : told?.service === "failed" ? "failed" : "preparing") : told?.service === "running" ? "removing" : "absent";
  return {
    row,
    replaces: other.success ? { type: other.data.type, url: other.data.url } : null,
    service,
    serviceReason: service === "failed" ? (told?.reason ?? null) : null,
    // Cada aviso só faz sentido no seu estado: pouca memória com o serviço de pé, imagem que ficou com ele fora.
    serviceWarning: (service === "running" && told?.warning === "low_memory") || (service === "absent" && told?.warning === "image_kept") ? told.warning : null,
    disk: service === "failed" && told?.reason === "no_disk" && told.freeMb !== null && told.neededMb !== null ? { freeMb: told.freeMb, neededMb: told.neededMb } : null,
    agent: !told ? "never" : now.getTime() - told.lastSeenAt.getTime() > AGENT_SILENT_MINUTES * 60_000 ? "silent" : "responding",
  };
}

const view = (stored: Stored, available: boolean, qr: string | null = null): WhatsAppView => ({
  available,
  service: stored.service,
  serviceReason: stored.serviceReason,
  serviceWarning: stored.serviceWarning,
  disk: stored.disk,
  agent: stored.agent,
  status: stored.row?.status ?? "disconnected",
  failure: stored.row?.failure ?? null,
  phone: stored.row?.phone ?? null,
  connectedAt: stored.row?.connectedAt ?? null,
  qr,
  replaces: stored.replaces,
});

/** Falha do WAHA na frase que a tela sabe dizer. O detalhe técnico fica na mensagem, para o log. */
async function waha<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (!(error instanceof WahaError)) throw error;
    if (error.code === "not_configured") throw new ApiError(409, "whatsapp_unavailable", error.message);
    if (error.code === "session_not_working") throw new ApiError(409, "whatsapp_not_connected", error.message);
    if (error.code === "number_not_on_whatsapp") throw new ApiError(400, "whatsapp_number_not_found", error.message);
    throw new ApiError(502, "whatsapp_service_down", error.message);
  }
}

async function notice(q: OrgQuery, now: Date, body: string): Promise<void> {
  const row = await q.one<{ id: string }>("insert into notifications (organization_id, channel, body, created_at) values ($1, 'panel', $2, $3) returning id", [q.organizationId, body, now]);
  if (row) await enqueueTask(q, { kind: "deliver_notification", payload: { notificationId: row.id }, runAt: now });
}

function fromWaha(session: WahaSession | null): Pick<Row, "status" | "failure"> {
  if (!session) return { status: "failed", failure: "missing" };
  if (session.status === "WORKING") return { status: "connected", failure: null };
  if (session.status === "SCAN_QR_CODE") return { status: "qr", failure: null };
  if (session.status === "STARTING") return { status: "starting", failure: null };
  return { status: "failed", failure: session.status };
}

/**
 * Grava o que o WAHA disse e avisa quando o estado mudou. A linha é travada: duas consultas ao
 * mesmo tempo não geram dois avisos da mesma mudança.
 */
async function record(q: OrgQuery, now: Date, session: WahaSession | null): Promise<Row | null> {
  const before = await q.one<Row>(`select ${ROW} from whatsapp_sessions for update`);
  // Desconectado de propósito enquanto esta consulta estava no WAHA: vale o que a pessoa fez.
  if (!before || before.status === "disconnected") return before;
  const next = fromWaha(session);
  if (next.status === before.status) return before;
  const waiting = before.status === "qr" || before.status === "starting";
  const failure = next.status === "failed" && waiting && next.failure === "FAILED" ? "qr_expired" : next.failure;
  const phone = session?.phone ?? before.phone;
  const after = await q.one<Row>(
    `update whatsapp_sessions set status = $1, failure = $2, phone_e164 = $3, connected_at = case when $1 = 'connected' then $4 else connected_at end, updated_at = $4 returning ${ROW}`,
    [next.status, failure, phone, now],
  );
  if (next.status === "connected") {
    await notice(q, now, `WhatsApp conectado${phone ? `: ${phone}` : ""}. Os avisos e as mensagens do agente passam a sair por este número.`);
  } else if (next.status === "failed" && before.status === "connected") {
    await notice(q, now, `O WhatsApp${phone ? ` ${phone}` : ""} desconectou. Os avisos e as mensagens por WhatsApp não saem até alguém conectar de novo, em Configurações.`);
  } else if (next.status === "failed") {
    await notice(q, now, "A conexão do WhatsApp não foi concluída: o QR Code não foi lido a tempo ou a conexão falhou. Tente de novo em Configurações.");
  }
  return after;
}

/**
 * O estado para a tela. Com uma conexão em curso, pergunta ao WAHA e grava o que mudou: é essa
 * gravação que gera o aviso "o WhatsApp caiu" mesmo com Configurações fechada.
 *
 * `withQr: false` é a leitura da saúde, que roda em toda aba aberta a cada minuto: ela não busca a
 * imagem do QR Code, que só a tela de Configurações mostra.
 */
export async function observe(deps: ServerDeps, org: Org, organizationId: string, options: { withQr?: boolean } = {}): Promise<WhatsAppView> {
  const withQr = options.withQr ?? true;
  const stored = await org((q) => readStored(q, deps.clock.now()));
  if (!deps.waha.apiKey) return view(stored, false);
  // Sem o serviço de pé não há WAHA, e sem pedido nenhum não existe sessão nele: não há o que perguntar.
  if (stored.service !== "running" || !stored.row) return view(stored, true);
  const name = wahaSessionName(organizationId);
  const session = await waha(() => wahaGetSession(deps.waha, name));
  if (stored.row.status === "disconnected") {
    // O banco diz "desconectado", mas quem sabe é o WAHA. O pareamento mora num volume que
    // sobrevive à remoção do serviço: reinstalado, o WAHA pode retomar uma sessão antiga, e um
    // número ficaria conectado sem a tela dizer. Vale o que a pessoa pediu (desconectar): a sessão
    // que sobrou é desfeita, e a tela continua dizendo a verdade.
    if (session && session.status !== "STOPPED") {
      await waha(async () => {
        await wahaLogoutSession(deps.waha, name);
        await wahaStopSession(deps.waha, name);
      });
    }
    return view(stored, true);
  }
  const row = await org((q) => record(q, deps.clock.now(), session));
  let qr: string | null = null;
  if (withQr && row?.status === "qr") {
    try {
      qr = `data:image/png;base64,${await wahaGetQr(deps.waha, name)}`;
    } catch (error) {
      // Entre um código e o seguinte, ou no instante em que a leitura termina, o WAHA recusa o
      // pedido: a tela fica um ciclo sem imagem e a próxima consulta traz o estado novo.
      if (!(error instanceof WahaError && error.code === "rejected")) throw error;
    }
  }
  return view({ ...stored, row }, true, qr);
}

/**
 * Inicia a conexão: a sessão passa a existir no WAHA e o conector da organização passa a ser o
 * número conectado. Sessão que falhou recomeça do zero (parar, sair, iniciar), porque o
 * pareamento antigo pode ter sido revogado pelo WhatsApp e nunca mais pediria o QR Code.
 */
export async function connect(deps: ServerDeps, org: Org, session: Session, stored: Stored, replace: boolean): Promise<WhatsAppView> {
  if (stored.service !== "running") throw new ApiError(409, "whatsapp_service_absent", "The WhatsApp service is not running on this server: install it first.");
  if (stored.replaces && !replace) throw new ApiError(409, "connector_replace_required", "Another WhatsApp connector is configured: confirm replacing it.");
  const name = wahaSessionName(session.organizationId);
  await waha(async () => {
    const current = await wahaGetSession(deps.waha, name);
    if (current?.status === "FAILED") {
      await wahaStopSession(deps.waha, name);
      await wahaLogoutSession(deps.waha, name);
    }
    await wahaEnsureSession(deps.waha, name);
    await wahaStartSession(deps.waha, name);
  });
  const now = deps.clock.now();
  await org(async (q) => {
    await q.exec(
      `insert into whatsapp_sessions (organization_id, session_name, status, service_wanted, updated_at) values ($1, $2, 'starting', true, $3)
       on conflict (organization_id) do update set status = 'starting', failure = null, updated_at = excluded.updated_at`,
      [q.organizationId, name, now],
    );
    await q.exec(
      `insert into settings (organization_id, key, value, secret, updated_at) values ($1, $2, $3, false, $4)
       on conflict (organization_id, key) do update set value = excluded.value, secret = excluded.secret, updated_at = excluded.updated_at`,
      [q.organizationId, CONNECTOR_KEY, JSON.stringify({ type: "waha" }), now],
    );
  });
  return observe(deps, org, session.organizationId);
}

/** Desfaz o pareamento (o aparelho some de "Dispositivos conectados"), para a sessão e tira o conector. */
export async function disconnect(deps: ServerDeps, org: Org, session: Session): Promise<WhatsAppView> {
  const name = wahaSessionName(session.organizationId);
  await waha(async () => {
    // Nesta ordem: sair com a sessão ainda conectada é o que desvincula o aparelho no WhatsApp.
    await wahaLogoutSession(deps.waha, name);
    await wahaStopSession(deps.waha, name);
  });
  const now = deps.clock.now();
  return org(async (q) => {
    const before = await q.one<Row>(`select ${ROW} from whatsapp_sessions for update`);
    await q.exec("update whatsapp_sessions set status = 'disconnected', failure = null, phone_e164 = null, connected_at = null, updated_at = $1", [now]);
    await q.exec("delete from settings where key = $1 and value->>'type' = 'waha'", [CONNECTOR_KEY]);
    if (before && before.status !== "disconnected") {
      await notice(q, now, `WhatsApp${before.phone ? ` ${before.phone}` : ""} desconectado por ${session.name}. Os avisos e as mensagens por WhatsApp não saem até um número ser conectado de novo.`);
    }
    return view(await readStored(q, now), true);
  });
}

/**
 * O pedido de instalar ou remover, como a rota o executa. Antes de remover, tenta desfazer o
 * pareamento que ainda exista no WAHA (uma conexão caída deixa o aparelho em "Dispositivos
 * conectados" no telefone, e o pareamento no volume, que fica). É melhor esforço: com o WAHA fora
 * do ar a remoção segue, e a tela pede para conferir o telefone.
 */
export async function changeService(deps: ServerDeps, org: Org, session: Session, wanted: boolean): Promise<WhatsAppView> {
  if (!wanted) {
    const stored = await org((q) => readStored(q, deps.clock.now()));
    assertRemovable(stored.row);
    if (stored.service === "running" && stored.row && deps.waha.apiKey) {
      const name = wahaSessionName(session.organizationId);
      try {
        await wahaLogoutSession(deps.waha, name);
        await wahaStopSession(deps.waha, name);
      } catch (error) {
        if (!(error instanceof WahaError)) throw error;
        process.stderr.write(`[panel] could not log the WhatsApp session out before removing the service: ${error.message}\n`);
      }
    }
  }
  await org((q) => setServiceWanted(q, session, wanted, deps.clock.now()));
  return observe(deps, org, session.organizationId);
}

function assertRemovable(row: Row | null): void {
  if (row && (row.status === "connected" || row.status === "qr" || row.status === "starting")) {
    throw new ApiError(409, "whatsapp_connected", "A WhatsApp number is connected or connecting: disconnect it before removing the service.");
  }
}

/**
 * Pede ou dispensa o serviço de WhatsApp neste servidor. Aqui só se grava a vontade: quem baixa a
 * imagem, sobe e remove o contêiner é o agente, na passada seguinte. Remover só vale sem número
 * conectado, e leva junto o conector `waha` que uma conexão caída tenha deixado.
 */
async function setServiceWanted(q: OrgQuery, session: Session, wanted: boolean, now: Date): Promise<void> {
  const row = await q.one<Row>(`select ${ROW} from whatsapp_sessions for update`);
  if (!wanted) assertRemovable(row);
  await q.exec(
    `insert into whatsapp_sessions (organization_id, session_name, service_wanted, updated_at) values ($1, $2, $3, $4)
     on conflict (organization_id) do update set service_wanted = excluded.service_wanted, updated_at = excluded.updated_at,
       status = case when excluded.service_wanted then whatsapp_sessions.status else 'disconnected' end,
       failure = case when excluded.service_wanted then whatsapp_sessions.failure end,
       phone_e164 = case when excluded.service_wanted then whatsapp_sessions.phone_e164 end,
       connected_at = case when excluded.service_wanted then whatsapp_sessions.connected_at end`,
    [q.organizationId, wahaSessionName(session.organizationId), wanted, now],
  );
  if (!wanted) await q.exec("delete from settings where key = $1 and value->>'type' = 'waha'", [CONNECTOR_KEY]);
  await notice(
    q,
    now,
    wanted
      ? `${session.name} pediu a instalação do serviço de WhatsApp neste servidor. O servidor baixa e sobe o serviço em alguns minutos.`
      : `${session.name} pediu a remoção do serviço de WhatsApp deste servidor. O número fica desconectado, e a memória e o disco são liberados em instantes.`,
  );
}

/**
 * Mensagem de teste para o WhatsApp de quem está logado. Sai pelo conector configurado — o mesmo
 * caminho do envio de aviso — e cai no número conectado por QR
 * Code quando é ele o conector.
 */
export async function sendTest(deps: ServerDeps, session: Session, to: string | null, locale: Locale): Promise<{ to: string; addressVerified: boolean }> {
  if (!to) throw new ApiError(400, "whatsapp_contact_required", "Save your own WhatsApp number in My contact first.");
  const text = TEST_MESSAGE[locale];
  const connector = await withOrg(deps.db, session.organizationId, (q) => loadWhatsAppConnector(q, deps.secretKey));
  if (connector !== null && connector.type !== "waha") {
    try {
      const { addressVerified } = await sendWhatsApp(connector, { to, text }, { fetch: deps.fetch, lookup: deps.lookup });
      return { to, addressVerified };
    } catch (error) {
      // Recusa do destino é frase da tela; o detalhe técnico vai junto e fica no log.
      throw new ApiError(502, "whatsapp_connector_refused", error instanceof Error ? error.message : String(error));
    }
  }
  const { addressVerified } = await waha(() => sendViaWaha(deps.waha, wahaSessionName(session.organizationId), { to, text }));
  return { to, addressVerified };
}
