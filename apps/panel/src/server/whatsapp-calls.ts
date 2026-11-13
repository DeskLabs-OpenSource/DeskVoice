import type { OrgQuery } from "@deskvoice/core";
import { encode } from "uqr";
import { z } from "zod";
import { ApiError, type ServerDeps, type Session } from "./context";
import { readServiceView, type ServiceView } from "./update";
import { voiceRequest } from "./voice";
import { notice, type ConnectionStatus, type Org } from "./whatsapp";

/**
 * Ligação pelo WhatsApp (WaCalls): instalar o serviço, conectar o número por QR Code, escolher o
 * agente que atende, desconectar e remover. Quem atende as ligações é o processo de voz.
 *
 * O painel nunca fala com o WaCalls: pede ao processo de voz, que é o único com o token dele
 * (`apps/voice/src/whatsapp-calls.ts`). O navegador recebe só o estado e a imagem do QR Code.
 *
 * O resto é o molde do WhatsApp por QR Code (`server/whatsapp.ts`): o painel grava que a
 * organização quer o serviço, o agente do kit o sobe ou remove, e a cada consulta da tela o painel
 * compara o que o WaCalls diz com o último estado gravado; é nessa comparação que "conectou" e
 * "caiu" viram aviso.
 */
export type CallsFailure = "logged_out" | "qr_expired" | "missing";

export interface WhatsAppCallsView extends ServiceView {
  /** `false`: o processo de voz não tem o token do WaCalls (atualizado por um atualizador antigo, ou desenvolvimento). */
  available: boolean;
  status: ConnectionStatus;
  failure: CallsFailure | null;
  phone: string | null;
  connectedAt: Date | null;
  /** O agente que atende as ligações. Nulo: ninguém atende, e elas seguem tocando no celular. */
  agentId: string | null;
  /** A imagem do QR Code, pronta para um `<img>`. Só em `qr`. */
  qr: string | null;
  /** O número conectado para mensagens (WhatsApp por QR Code), para a tela dizer quando é o mesmo aparelho. */
  messagesPhone: string | null;
}

interface Row {
  status: ConnectionStatus;
  failure: CallsFailure | null;
  phone: string | null;
  connectedAt: Date | null;
  agentId: string | null;
}
export interface CallsStored extends ServiceView {
  row: Row | null;
  messagesPhone: string | null;
}

const ROW = `status, failure, phone_e164 as phone, connected_at as "connectedAt", agent_id as "agentId"`;

/** O nome da sessão no WaCalls; o processo de voz usa o mesmo (`wacallsSessionName`). */
const sessionName = (organizationId: string): string => `deskvoice_${organizationId}`;

const voiceState = z.object({
  session: z
    .object({
      id: z.string(),
      status: z.enum(["starting", "qr", "connected", "logged_out"]),
      qr: z.string().nullable(),
      phone: z.string().nullable(),
    })
    .nullable(),
});
type VoiceState = z.infer<typeof voiceState>;

export async function readCallsStored(q: OrgQuery, now: Date): Promise<CallsStored> {
  const row = await q.one<Row & { wanted: boolean }>(`select ${ROW}, service_wanted as wanted from whatsapp_call_sessions`);
  const messages = await q.one<{ phone: string | null }>("select phone_e164 as phone from whatsapp_sessions where status = 'connected'");
  return { row, messagesPhone: messages?.phone ?? null, ...(await readServiceView(q, "whatsapp_calls", row?.wanted ?? false, now)) };
}

const view = (stored: CallsStored, available: boolean, qr: string | null = null): WhatsAppCallsView => ({
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
  agentId: stored.row?.agentId ?? null,
  qr,
  messagesPhone: stored.messagesPhone,
});

/** Pede ao processo de voz. A recusa dele vira a frase que a tela sabe dizer; o detalhe fica na mensagem. */
async function ask(deps: ServerDeps, action: "state" | "connect" | "disconnect", organizationId: string): Promise<VoiceState> {
  try {
    return await voiceRequest(deps, "POST", `/whatsapp-calls/${action}`, voiceState, { organizationId });
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    if (error.code === "wacalls_not_configured") throw new ApiError(409, "whatsapp_calls_unavailable", error.message);
    throw new ApiError(502, "whatsapp_calls_service_down", error.message);
  }
}

/**
 * O QR Code em SVG, como imagem `data:`. Sem cor escrita: os módulos saem na cor padrão do SVG, e o
 * fundo é o do quadro da tela (`bg-qr-surface`), claro nos dois temas.
 */
export function qrImage(text: string): string {
  const { size, data } = encode(text, { border: 1 });
  const path = data.flatMap((line, y) => line.flatMap((dark, x) => (dark ? [`M${x} ${y}h1v1h-1z`] : []))).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><path d="${path}"/></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function fromVoice(state: VoiceState, before: Row): Pick<Row, "status" | "failure"> {
  const session = state.session;
  if (!session) return { status: "failed", failure: "missing" };
  if (session.status === "connected") return { status: "connected", failure: null };
  if (session.status === "qr") return { status: "qr", failure: null };
  if (session.status === "starting") return { status: "starting", failure: null };
  // `logged_out` antes de conectar é o código que venceu; depois, o aparelho que foi desvinculado.
  return { status: "failed", failure: before.status === "qr" || before.status === "starting" ? "qr_expired" : "logged_out" };
}

/** Grava o que o WaCalls disse e avisa quando o estado mudou. A linha é travada: duas consultas juntas não geram dois avisos. */
async function record(q: OrgQuery, now: Date, state: VoiceState): Promise<Row | null> {
  const before = await q.one<Row>(`select ${ROW} from whatsapp_call_sessions for update`);
  // Desconectado de propósito enquanto esta consulta estava no WaCalls: vale o que a pessoa fez.
  if (!before || before.status === "disconnected") return before;
  const next = fromVoice(state, before);
  if (next.status === before.status) return before;
  const phone = state.session?.phone ?? before.phone;
  const after = await q.one<Row>(
    `update whatsapp_call_sessions set status = $1, failure = $2, phone_e164 = $3, wacalls_session_id = coalesce($5, wacalls_session_id),
       connected_at = case when $1 = 'connected' then $4 else connected_at end, updated_at = $4 returning ${ROW}`,
    [next.status, next.failure, phone, now, state.session?.id ?? null],
  );
  const number = phone ? ` ${phone}` : "";
  if (next.status === "connected") {
    await notice(
      q,
      now,
      before.agentId
        ? `Ligação pelo WhatsApp: número${number} conectado. O agente escolhido atende as ligações pelo WhatsApp a partir de agora.`
        : `Ligação pelo WhatsApp: número${number} conectado. Escolha em Configurações o agente que atende; até lá, as ligações continuam tocando no celular.`,
    );
  } else if (next.status === "failed" && before.status === "connected") {
    await notice(
      q,
      now,
      `O número${number} desconectou da ligação pelo WhatsApp. Conecte de novo em Configurações → WhatsApp. O WhatsApp desconecta os aparelhos vinculados quando o celular principal fica mais de 14 dias sem uso.`,
    );
  } else if (next.status === "failed") {
    await notice(q, now, "A conexão da ligação pelo WhatsApp não foi concluída: o QR Code não foi lido a tempo. Tente de novo em Configurações → WhatsApp.");
  }
  return after;
}

/**
 * O estado para a tela. Com uma conexão em curso, pergunta ao processo de voz e grava o que mudou.
 * `withQr: false` é a leitura da saúde, que roda em toda aba aberta a cada minuto: sem a imagem.
 */
export async function observeCalls(deps: ServerDeps, org: Org, organizationId: string, options: { withQr?: boolean } = {}): Promise<WhatsAppCallsView> {
  const withQr = options.withQr ?? true;
  const stored = await org((q) => readCallsStored(q, deps.clock.now()));
  // Sem o serviço de pé não há WaCalls, e sem pedido nenhum não existe sessão nele.
  if (stored.service !== "running" || !stored.row) return view(stored, true);
  let state: VoiceState;
  try {
    state = await ask(deps, "state", organizationId);
  } catch (error) {
    if (error instanceof ApiError && error.code === "whatsapp_calls_unavailable") return view(stored, false);
    throw error;
  }
  if (stored.row.status === "disconnected") {
    // O banco diz "desconectado", mas o pareamento mora num volume que sobrevive à remoção do
    // serviço: reinstalado, o WaCalls pode voltar com o número de antes. Vale o que a pessoa pediu.
    if (state.session) await ask(deps, "disconnect", organizationId);
    return view(stored, true);
  }
  const row = await org((q) => record(q, deps.clock.now(), state));
  const qr = withQr && row?.status === "qr" && state.session?.qr ? qrImage(state.session.qr) : null;
  return view({ ...stored, row }, true, qr);
}

/** Pede ao WaCalls, pelo processo de voz, uma sessão nova: o QR Code chega em seguida. */
export async function connectCalls(deps: ServerDeps, org: Org, session: Session, stored: CallsStored): Promise<WhatsAppCallsView> {
  if (stored.service !== "running") throw new ApiError(409, "whatsapp_calls_service_absent", "The WhatsApp calls service is not running on this server: install it first.");
  const state = await ask(deps, "connect", session.organizationId);
  const now = deps.clock.now();
  await org((q) =>
    q.exec(
      `insert into whatsapp_call_sessions (organization_id, session_name, status, service_wanted, wacalls_session_id, updated_at) values ($1, $2, 'starting', true, $3, $4)
       on conflict (organization_id) do update set status = 'starting', failure = null, wacalls_session_id = excluded.wacalls_session_id, updated_at = excluded.updated_at`,
      [q.organizationId, sessionName(session.organizationId), state.session?.id ?? null, now],
    ),
  );
  return observeCalls(deps, org, session.organizationId);
}

/** Desvincula o aparelho (ele some de "Aparelhos conectados") e apaga a sessão no WaCalls. */
export async function disconnectCalls(deps: ServerDeps, org: Org, session: Session): Promise<WhatsAppCallsView> {
  await ask(deps, "disconnect", session.organizationId);
  const now = deps.clock.now();
  return org(async (q) => {
    const before = await q.one<Row>(`select ${ROW} from whatsapp_call_sessions for update`);
    await q.exec("update whatsapp_call_sessions set status = 'disconnected', failure = null, phone_e164 = null, connected_at = null, wacalls_session_id = null, updated_at = $1", [now]);
    if (before && before.status !== "disconnected") {
      await notice(q, now, `Ligação pelo WhatsApp: número${before.phone ? ` ${before.phone}` : ""} desconectado por ${session.name}.`);
    }
    return view(await readCallsStored(q, now), true);
  });
}

/**
 * Escolhe o agente que atende as ligações pelo WhatsApp, ou nenhum. Vale da ligação seguinte em
 * diante; a que está em curso segue com quem a atendeu. Agente de outra organização é barrado pela
 * chave estrangeira composta com a organização, que vira 404.
 */
export async function chooseCallsAgent(q: OrgQuery, session: Session, agentId: string | null, now: Date): Promise<void> {
  await q.exec(
    `insert into whatsapp_call_sessions (organization_id, session_name, agent_id, updated_at) values ($1, $2, $3, $4)
     on conflict (organization_id) do update set agent_id = excluded.agent_id, updated_at = excluded.updated_at`,
    [q.organizationId, sessionName(session.organizationId), agentId, now],
  );
}

function assertRemovable(row: Row | null): void {
  if (row && (row.status === "connected" || row.status === "qr" || row.status === "starting")) {
    throw new ApiError(409, "whatsapp_calls_connected", "A number is connected or connecting for WhatsApp calls: disconnect it before removing the service.");
  }
}

/**
 * Pede ou dispensa o serviço. Aqui só se grava a vontade: quem baixa, sobe e remove é o agente.
 * Remover só vale sem número conectado. Antes, tenta desfazer a sessão que ainda exista no WaCalls
 * (uma conexão caída deixa o pareamento no volume, que fica): melhor esforço, com o serviço fora do
 * ar a remoção segue.
 */
export async function changeCallsService(deps: ServerDeps, org: Org, session: Session, wanted: boolean): Promise<WhatsAppCallsView> {
  const now = deps.clock.now();
  if (!wanted) {
    const stored = await org((q) => readCallsStored(q, now));
    assertRemovable(stored.row);
    if (stored.service === "running" && stored.row) {
      try {
        await ask(deps, "disconnect", session.organizationId);
      } catch (error) {
        if (!(error instanceof ApiError)) throw error;
        process.stderr.write(`[panel] could not undo the WhatsApp calls session before removing the service: ${error.message}\n`);
      }
    }
  }
  await org(async (q) => {
    const row = await q.one<Row>(`select ${ROW} from whatsapp_call_sessions for update`);
    if (!wanted) assertRemovable(row);
    await q.exec(
      `insert into whatsapp_call_sessions (organization_id, session_name, service_wanted, updated_at) values ($1, $2, $3, $4)
       on conflict (organization_id) do update set service_wanted = excluded.service_wanted, updated_at = excluded.updated_at,
         status = case when excluded.service_wanted then whatsapp_call_sessions.status else 'disconnected' end,
         failure = case when excluded.service_wanted then whatsapp_call_sessions.failure end,
         phone_e164 = case when excluded.service_wanted then whatsapp_call_sessions.phone_e164 end,
         connected_at = case when excluded.service_wanted then whatsapp_call_sessions.connected_at end,
         wacalls_session_id = case when excluded.service_wanted then whatsapp_call_sessions.wacalls_session_id end`,
      [q.organizationId, sessionName(session.organizationId), wanted, now],
    );
    await notice(
      q,
      now,
      wanted
        ? `${session.name} pediu a instalação do serviço de ligação pelo WhatsApp neste servidor. O servidor baixa e sobe o serviço em alguns minutos.`
        : `${session.name} pediu a remoção do serviço de ligação pelo WhatsApp deste servidor. A memória e o disco são liberados em instantes.`,
    );
  });
  return observeCalls(deps, org, session.organizationId);
}
