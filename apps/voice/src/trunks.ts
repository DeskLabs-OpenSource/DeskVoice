import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { decryptSecret, withSystem, type Clock, type Db } from "@deskvoice/core";
import { trunkEndpointName, type AriClient } from "./ari";
import { messageOf, type Logger } from "./log";

export const DEFAULT_TRUNKS_FILE = "/asterisk-generated/pjsip_trunks.conf";

export interface TrunkConfig {
  id: string;
  host: string;
  username: string | null;
  /** Já decifrada. */
  password: string | null;
  authMode: "register" | "ip";
  /** IP público da instalação, para o `from_domain`. */
  publicIp: string | null;
}

export type TrunkHealth = { id: string; status: "ok" | "warn" | "fail"; detail: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HOST = /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?(?::\d{1,5})?$/;
const USERNAME = /^[A-Za-z0-9._+@-]{1,80}$/;
const IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/;
// Caracteres de controle e separadores de linha: nenhum deles cabe numa linha do arquivo.
const LINE_BREAKERS = new Set([0x7f, 0x85, 0x2028, 0x2029]);
const hasControl = (text: string): boolean => [...text].some((char) => (char.codePointAt(0) ?? 0) < 0x20 || LINE_BREAKERS.has(char.codePointAt(0) ?? 0));

/**
 * O que vem do banco nunca pode mudar a forma do arquivo: um valor com quebra de linha criaria
 * uma seção nova no pjsip do Asterisk. Host e usuário só passam se forem feitos dos caracteres que
 * um host e um usuário SIP têm. A senha aceita símbolos, menos os que o formato não representa.
 * Devolve o motivo da recusa, ou `null`.
 */
export function trunkProblem(trunk: TrunkConfig): string | null {
  if (!UUID.test(trunk.id)) return "the line id is not a uuid";
  if (!HOST.test(trunk.host)) return "the host has characters that a server address cannot have";
  if (trunk.username !== null && !USERNAME.test(trunk.username)) return "the user has characters that a SIP user cannot have";
  if (trunk.password !== null) {
    if (trunk.password.length > 128 || hasControl(trunk.password)) return "the password has a line break or a control character, or is longer than 128 characters";
    // `password=>x` é lido pelo Asterisk como `password=x`, e as bordas em branco são cortadas:
    // essas senhas não chegariam inteiras ao provedor.
    if (trunk.password.startsWith(">") || trunk.password !== trunk.password.trim()) return "the password starts with '>' or has spaces at the edges, which the Asterisk file cannot represent";
  }
  if (trunk.authMode === "register" && (!trunk.username || !trunk.password)) return "a line that registers needs user and password";
  return null;
}

// No arquivo do Asterisk `;` começa comentário; `\;` é o ponto e vírgula literal.
const value = (text: string): string => text.replaceAll(";", "\\;");

/**
 * Seções PJSIP de um tronco. Portadas do `pjsip.conf.example` do DeskcommCRM (MIT, mesmo autor;
 * ver CREDITS.md), com as lições de lá: `from_domain` com o IP público (sem ele o cabeçalho From
 * leva o IP privado do contêiner e há provedor que derruba a ligação) e `ulaw`/`alaw`, que casam
 * com o AudioSocket sem transcodificar.
 */
function renderTrunk(trunk: TrunkConfig): string {
  const name = trunkEndpointName(trunk.id);
  const hostOnly = trunk.host.replace(/:\d+$/, "");
  const withAuth = trunk.username !== null && trunk.password !== null;
  const publicIp = trunk.publicIp !== null && IPV4.test(trunk.publicIp) ? trunk.publicIp : null;
  const lines = [
    `[${name}]`,
    "type=endpoint",
    "transport=transport-udp",
    "context=from-trunk",
    "disallow=all",
    "allow=ulaw",
    "allow=alaw",
    `aors=${name}`,
    ...(withAuth ? [`outbound_auth=${name}-auth`, `from_user=${value(trunk.username ?? "")}`] : []),
    ...(publicIp ? [`from_domain=${publicIp}`] : []),
    "direct_media=no",
    "rtp_symmetric=yes",
    "force_rport=yes",
    "rewrite_contact=yes",
    "",
    `[${name}]`,
    "type=aor",
    `contact=sip:${trunk.host}`,
    "qualify_frequency=30",
    "",
    `[${name}-identify]`,
    "type=identify",
    `endpoint=${name}`,
    `match=${hostOnly}`,
  ];
  if (withAuth) {
    lines.push("", `[${name}-auth]`, "type=auth", "auth_type=userpass", `username=${value(trunk.username ?? "")}`, `password=${value(trunk.password ?? "")}`);
  }
  if (trunk.authMode === "register") {
    lines.push(
      "",
      `[${name}-registration]`,
      "type=registration",
      "transport=transport-udp",
      `outbound_auth=${name}-auth`,
      `server_uri=sip:${trunk.host}`,
      `client_uri=sip:${value(trunk.username ?? "")}@${trunk.host}`,
      "retry_interval=60",
    );
  }
  return lines.join("\n");
}

/** O arquivo inteiro. Tronco com valor que não pode ser escrito fica de fora, com o motivo em `skipped`. */
export function renderTrunksConf(trunks: TrunkConfig[]): { conf: string; skipped: Array<{ id: string; reason: string }> } {
  const skipped: Array<{ id: string; reason: string }> = [];
  const sections: string[] = [];
  for (const trunk of [...trunks].sort((a, b) => a.id.localeCompare(b.id))) {
    const reason = trunkProblem(trunk);
    if (reason) skipped.push({ id: trunk.id, reason });
    else sections.push(renderTrunk(trunk));
  }
  const header = "; Gerado pelo DeskVoice a partir das linhas cadastradas no painel. Não edite: é reescrito a cada mudança.";
  return { conf: `${[header, ...sections].join("\n\n")}\n`, skipped };
}

/** Escrita atômica: o Asterisk nunca lê um arquivo pela metade. */
export async function writeFileAtomic(file: string, content: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, content, { mode: 0o640 });
    await rename(temporary, file);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

export interface TrunksDeps {
  db: Db;
  ari: AriClient;
  clock: Clock;
  secretKey: Buffer;
  /** Onde o Asterisk lê os troncos. */
  file: string;
  /** IP público da instalação (ambiente); a configuração `network.public_ip` da organização vem antes. */
  publicIp: string | null;
  log: Logger;
}

async function setStatus(deps: TrunksDeps, updates: TrunkHealth[]): Promise<void> {
  if (updates.length === 0) return;
  await withSystem(deps.db, async (q) => {
    for (const update of updates) {
      await q.exec(
        `update trunks set status = $2, last_error = $3, last_check_at = $4
          where id = $1 and (status is distinct from $2 or last_error is distinct from $3)`,
        [update.id, update.status, update.status === "ok" ? null : update.detail, deps.clock.now()],
      );
    }
  });
}

/**
 * Regrava o arquivo de troncos com as linhas de todas as organizações e pede ao Asterisk para
 * recarregar o PJSIP. Sem Asterisk no ar o arquivo fica escrito e o resultado diz que falta recarregar.
 */
export async function applyTrunks(deps: TrunksDeps): Promise<{ applied: boolean; detail: string; skipped: Array<{ id: string; reason: string }> }> {
  const rows = await withSystem(deps.db, (q) =>
    q.many<{ id: string; host: string; username: string | null; secret_enc: string | null; auth_mode: "register" | "ip"; public_ip: unknown }>(
      `select t.id, t.host, t.username, t.secret_enc, t.auth_mode,
              (select s.value from settings s where s.organization_id = t.organization_id and s.key = 'network.public_ip') as public_ip
         from trunks t order by t.id`,
    ),
  );
  const unreadable: Array<{ id: string; reason: string }> = [];
  const trunks: TrunkConfig[] = [];
  for (const row of rows) {
    try {
      trunks.push({
        id: row.id,
        host: row.host.trim(),
        username: row.username?.trim() || null,
        password: row.secret_enc ? decryptSecret(row.secret_enc, deps.secretKey) : null,
        authMode: row.auth_mode,
        publicIp: typeof row.public_ip === "string" ? row.public_ip : deps.publicIp,
      });
    } catch (error) {
      unreadable.push({ id: row.id, reason: `the saved password cannot be read (${messageOf(error)})` });
    }
  }
  const { conf, skipped: invalid } = renderTrunksConf(trunks);
  const skipped = [...unreadable, ...invalid];
  await writeFileAtomic(deps.file, conf);
  await setStatus(deps, skipped.map(({ id, reason }) => ({ id, status: "fail" as const, detail: `This line was left out of the telephony configuration: ${reason}.` })));
  for (const { id, reason } of skipped) deps.log("error", "trunk left out of the generated configuration", { trunkId: id, reason });

  try {
    await deps.ari.reloadModule("res_pjsip.so");
  } catch (error) {
    return { applied: false, detail: `The lines were written, but the telephony server did not reload them: ${messageOf(error)}`, skipped };
  }
  return { applied: true, detail: `${trunks.length - invalid.length} line(s) loaded by the telephony server.`, skipped };
}

/**
 * Situação de cada tronco, pelo que a ARI informa do endpoint (o Asterisk o marca `online` quando
 * o provedor responde à qualificação), gravada em `trunks`.
 *
 * ponytail: a ARI não expõe o estado do REGISTER. Um provedor que responde à qualificação e recusa
 * o registro aparece como `ok`. O conserto é ler o registro pela AMI, se isso enganar alguém.
 */
export async function checkTrunks(deps: TrunksDeps): Promise<TrunkHealth[]> {
  const ids = (await withSystem(deps.db, (q) => q.many<{ id: string }>("select id from trunks order by id"))).map((row) => row.id);
  let health: TrunkHealth[];
  try {
    const states = new Map((await deps.ari.listEndpoints("PJSIP")).map((endpoint) => [endpoint.resource, endpoint.state ?? "unknown"]));
    health = ids.map((id) => {
      const state = states.get(trunkEndpointName(id));
      if (state === "online") return { id, status: "ok", detail: "The provider answers." };
      if (state === "offline") return { id, status: "fail", detail: "The provider does not answer. Check the host, the user and the password, and whether the provider allows this server's IP." };
      if (state === undefined) return { id, status: "fail", detail: "The telephony server has not loaded this line. Save the line again to apply it." };
      return { id, status: "warn", detail: "The line is loaded, but the provider has not been checked yet. Try again in a minute." };
    });
  } catch (error) {
    health = ids.map((id) => ({ id, status: "fail", detail: `The telephony server (Asterisk) did not answer: ${messageOf(error)}` }));
  }
  await setStatus(deps, health);
  return health;
}
