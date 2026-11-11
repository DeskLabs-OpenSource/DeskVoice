import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { decryptSecret, withSystem, type Clock, type Db } from "@deskvoice/core";
import { trunkEndpointName, type AriClient } from "./ari";
import { messageOf, type Logger } from "./log";
import { hostsOverlap, parseTrunkHost, type TrunkHost } from "./trunk-host";

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
  /**
   * Desde quando esta linha usa este endereço. Entre linhas com o mesmo endereço, a mais antiga
   * fica com ele; `id` desempata.
   */
  since: Date;
}

export type TrunkHealth = { id: string; status: "ok" | "warn" | "fail"; detail: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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
  const host = parseTrunkHost(trunk.host);
  if (!host) return "the host is not a server name, an IP address or an address block";
  if (trunk.username !== null && !USERNAME.test(trunk.username)) return "the user has characters that a SIP user cannot have";
  if (trunk.password !== null) {
    if (trunk.password.length > 128 || hasControl(trunk.password)) return "the password has a line break or a control character, or is longer than 128 characters";
    // `password=>x` é lido pelo Asterisk como `password=x`, e as bordas em branco são cortadas:
    // essas senhas não chegariam inteiras ao provedor.
    if (trunk.password.startsWith(">") || trunk.password !== trunk.password.trim()) return "the password starts with '>' or has spaces at the edges, which the Asterisk file cannot represent";
  }
  if (trunk.authMode === "register" && (!trunk.username || !trunk.password)) return "a line that registers needs user and password";
  if (trunk.authMode === "register" && host.uri === null) return "a line that registers needs the address of one server, not an address block";
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
function renderTrunk(trunk: TrunkConfig, host: TrunkHost, identify: boolean): string {
  const name = trunkEndpointName(trunk.id);
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
    // Bloco de endereços não é destino: a linha só recebe.
    ...(host.uri === null ? [] : [`contact=sip:${host.uri}`]),
    "qualify_frequency=30",
  ];
  // O `identify` casa a chamada recebida pelo endereço de origem. Só sai para endereço numérico
  // (nome resolve para endereços que mudam) e só para a linha que é dona dele: com o endereço
  // repetido, o Asterisk entregaria a chamada de uma organização ao tronco de outra.
  if (identify && host.kind === "address") lines.push("", `[${name}-identify]`, "type=identify", `endpoint=${name}`, `match=${host.match}`);
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
      `server_uri=sip:${host.uri}`,
      `client_uri=sip:${value(trunk.username ?? "")}@${host.uri}`,
      // O Asterisk põe um parâmetro `line` único no Contact do registro e casa a chamada recebida
      // com este endpoint por ele: é o que separa duas contas na mesma operadora.
      "line=yes",
      `endpoint=${name}`,
      "retry_interval=60",
    );
  }
  return lines.join("\n");
}

// Não diz de quem é a outra linha, nem qual é o endereço: pode ser de outra organização.
export const SHARED_HOST_REASON =
  "this provider address is already used by another line of this installation, and a line recognized only by its address cannot share it; change this line to registration (user and password) to fix it";
export const NAME_IN_IP_MODE_REASON =
  "a line recognized by IP needs the numeric address of the provider (an IP or an address block), not a name; with a name, change this line to registration (user and password)";

/**
 * O arquivo inteiro. Tronco que não pode ser escrito fica de fora, com o motivo em `skipped`.
 *
 * Endereço disputado fica com a linha que o usa há mais tempo, e nada muda para ela quando outra
 * aparece: ninguém derruba a linha de ninguém cadastrando o mesmo endereço. A linha mais nova em
 * modo `ip` só teria o endereço para ser reconhecida, então fica de fora (falha fechada); em modo
 * `register` ela sai sem `identify` e é reconhecida pelo `line` do registro. Linha inválida por
 * outro motivo não reivindica endereço.
 */
export function renderTrunksConf(trunks: TrunkConfig[]): { conf: string; skipped: Array<{ id: string; reason: string }> } {
  const skipped: Array<{ id: string; reason: string }> = [];
  const sections = new Map<string, string>();
  const claimed: TrunkHost[] = [];
  const oldestFirst = [...trunks].sort((a, b) => a.since.getTime() - b.since.getTime() || a.id.localeCompare(b.id));
  for (const trunk of oldestFirst) {
    const host = parseTrunkHost(trunk.host);
    const reason = trunkProblem(trunk) ?? (trunk.authMode === "ip" && host?.kind === "name" ? NAME_IN_IP_MODE_REASON : null);
    if (reason || !host) {
      skipped.push({ id: trunk.id, reason: reason ?? "the host cannot be read" });
      continue;
    }
    const taken = claimed.some((other) => hostsOverlap(other, host));
    if (taken && trunk.authMode === "ip") {
      skipped.push({ id: trunk.id, reason: SHARED_HOST_REASON });
      continue;
    }
    if (!taken && host.kind === "address") claimed.push(host);
    sections.set(trunk.id, renderTrunk(trunk, host, !taken));
  }
  // O arquivo sai em ordem de id, estável: a antiguidade só decide quem fica com o endereço.
  const ordered = [...sections.keys()].sort().map((id) => sections.get(id) ?? "");
  skipped.sort((a, b) => a.id.localeCompare(b.id));
  const header = "; Gerado pelo DeskVoice a partir das linhas cadastradas no painel. Não edite: é reescrito a cada mudança.";
  return { conf: `${[header, ...ordered].join("\n\n")}\n`, skipped };
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

const LEFT_OUT = "This line was left out of the telephony configuration";

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
 * Desde quando cada linha usa o endereço que tem hoje. `trunks` não guarda a data de criação, e
 * ela nem bastaria: uma linha antiga que TROCA de host para o endereço de outra não pode passar
 * na frente. Por isso a antiguidade é do par (linha, endereço), anotada num arquivo ao lado do
 * de troncos na primeira vez que o par é visto.
 *
 * ponytail: se o volume do Asterisk for apagado, as datas recomeçam e a disputa cai no desempate
 * por id. O lugar definitivo disso é uma coluna em `trunks`, gravada quando o host muda.
 */
async function claimDates(deps: TrunksDeps, rows: Array<{ id: string; host: string }>): Promise<Map<string, Date>> {
  const file = `${deps.file}.claims.json`;
  let known: Record<string, unknown> = {};
  try {
    known = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
  } catch (error) {
    // Primeira execução (arquivo ausente) ou arquivo ilegível: todas as linhas contam a partir de agora.
    deps.log("info", "trunk claim dates start from now", { reason: messageOf(error) });
  }
  const now = deps.clock.now();
  const next: Record<string, string> = {};
  const since = new Map<string, Date>();
  for (const row of rows) {
    const host = parseTrunkHost(row.host);
    const key = `${row.id} ${host?.kind === "address" ? host.match : (host?.uri ?? "")}`;
    const seen = typeof known[key] === "string" ? new Date(known[key]) : now;
    const date = Number.isNaN(seen.getTime()) ? now : seen;
    next[key] = date.toISOString();
    since.set(row.id, date);
  }
  await writeFileAtomic(file, JSON.stringify(next));
  return since;
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
  const since = await claimDates(deps, rows);
  for (const row of rows) {
    try {
      trunks.push({
        since: since.get(row.id) ?? deps.clock.now(),
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
  await setStatus(deps, skipped.map(({ id, reason }) => ({ id, status: "fail" as const, detail: `${LEFT_OUT}: ${reason}.` })));
  for (const { id, reason } of skipped) deps.log("error", "trunk left out of the generated configuration", { trunkId: id, reason });

  try {
    await deps.ari.reloadModule("res_pjsip.so");
  } catch (error) {
    return { applied: false, detail: `The lines were written, but the telephony server did not reload them: ${messageOf(error)}`, skipped };
  }
  return { applied: true, detail: `${trunks.length - invalid.length} line(s) written and reloaded by the telephony server.`, skipped };
}

/**
 * Situação de cada tronco, pelo que a ARI informa do endpoint (o Asterisk o marca `online` quando
 * o provedor responde à qualificação), gravada em `trunks`.
 *
 * ponytail: a ARI não expõe o estado do REGISTER. Um provedor que responde à qualificação e recusa
 * o registro aparece como `ok`. O conserto é ler o registro pela AMI, se isso enganar alguém.
 */
export async function checkTrunks(deps: TrunksDeps): Promise<TrunkHealth[]> {
  const rows = await withSystem(deps.db, (q) => q.many<{ id: string; last_error: string | null }>("select id, last_error from trunks order by id"));
  const ids = rows.map((row) => row.id);
  // Linha deixada de fora do arquivo continua mostrando o motivo, e não "não carregada".
  const leftOut = new Map(rows.flatMap((row) => (row.last_error?.startsWith(LEFT_OUT) ? [[row.id, row.last_error] as const] : [])));
  let health: TrunkHealth[];
  try {
    const states = new Map((await deps.ari.listEndpoints("PJSIP")).map((endpoint) => [endpoint.resource, endpoint.state ?? "unknown"]));
    health = ids.map((id) => {
      const state = states.get(trunkEndpointName(id));
      if (state === "online") return { id, status: "ok", detail: "The provider answers." };
      if (state === "offline") return { id, status: "fail", detail: "The provider does not answer. Check the host, the user and the password, and whether the provider allows this server's IP." };
      if (state === undefined) return { id, status: "fail", detail: leftOut.get(id) ?? "The telephony server has not loaded this line. Save the line again to apply it." };
      return { id, status: "warn", detail: "The line is loaded, but the provider has not been checked yet. Try again in a minute." };
    });
  } catch (error) {
    health = ids.map((id) => ({ id, status: "fail", detail: `The telephony server (Asterisk) did not answer: ${messageOf(error)}` }));
  }
  await setStatus(deps, health);
  return health;
}
