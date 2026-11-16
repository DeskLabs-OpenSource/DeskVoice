// Endereço de provedor repetido entre organizações: a decisão e o custo assumido.
//
// O Asterisk reconhece a chamada recebida de um tronco em modo `ip` só pelo endereço de origem, e
// não há como provar de quem é o endereço de uma operadora. Então, quando linhas de organizações
// DIFERENTES usam endereços que se sobrepõem, ninguém recebe `identify` por endereço: as linhas em
// modo `ip` ficam de fora (com erro no painel) e as em modo `register` seguem, reconhecidas pelo
// `line` do registro. Na ambiguidade, recusar a ligação é melhor do que entregá-la à organização
// errada. O custo: uma organização pode tirar do ar a linha em modo `ip` de outra cadastrando o
// mesmo endereço. Ele é aceito porque criar uma segunda organização na instalação exige acesso à
// VPS (comando `create-owner`): quem pode provocar o conflito é quem administra o servidor.
// Não existe precedência por antiguidade nem estado guardado ao lado do arquivo.
import { randomUUID } from "node:crypto";
import { promises as dns } from "node:dns";
import { chmod, chown, mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { decryptSecret, withSystem, type Clock, type Db } from "@deskvoice/core";
import { trunkEndpointName, type AriClient } from "./ari";
import { messageOf, type Logger } from "./log";
import { realSchedule, type Schedule } from "./transport";
import { hostsOverlap, isBlockTooWide, parseTrunkHost, type TrunkHost } from "./trunk-host";

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
  /** De quem é a linha: endereço repetido só é tolerado dentro da mesma organização. */
  organizationId: string;
  /**
   * Mais endereços de onde as ligações chegam, além do `host`: a operadora que entrega por vários
   * blocos, um por região. Vazio na linha que sempre teve um endereço só. Na linha por IP eles
   * entram no `identify`; na linha por registro só liberam a entrada (ela é reconhecida pelo `line`
   * do registro), para a operadora que registra por um servidor e entrega por outro.
   */
  matchExtra?: string[];
  /**
   * Destino das ligações de saída, quando difere do `host` (modo `ip`). Nome ou IP: é saída, não
   * entra no `identify`.
   */
  outboundHost?: string | null;
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
  if (trunk.authMode === "ip" && host.kind === "name") return NAME_IN_IP_MODE_REASON;
  if (trunk.authMode === "ip" && isBlockTooWide(host)) return BLOCK_TOO_WIDE_REASON;
  const extras = trunk.matchExtra ?? [];
  if (trunk.authMode !== "ip" && trunk.outboundHost != null) return OUTBOUND_ONLY_IN_IP_MODE_REASON;
  for (const [index, extra] of extras.entries()) {
    const parsed = parseTrunkHost(extra);
    if (!parsed) return extraAddressReason(index + 1);
    if (parsed.kind === "name") return extraNameReason(index + 1);
    if (isBlockTooWide(parsed)) return extraTooWideReason(index + 1);
  }
  if (trunk.outboundHost != null) {
    const outbound = parseTrunkHost(trunk.outboundHost);
    if (!outbound) return "the outbound address is not a server name, an IP address or an address block";
    if (outbound.uri === null) return OUTBOUND_BLOCK_REASON;
  }
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
function renderTrunk(trunk: TrunkConfig, inbound: Inbound, identify: boolean): string {
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
    // Bloco de endereços não é destino: a linha só recebe. Um `outbound_host` dá destino à linha
    // que recebe por bloco (a Twilio recebe por /30 e atende pelo nome da conta).
    ...(inbound.destination === null ? [] : [`contact=sip:${inbound.destination.uri}`]),
    "qualify_frequency=30",
  ];
  // O `identify` casa a chamada recebida pelo endereço de origem. Só sai com endereço numérico
  // (nome resolve para endereços que mudam) e só para a linha que é dona dele: com o endereço
  // repetido, o Asterisk entregaria a chamada de uma organização ao tronco de outra. Uma linha
  // pode ter vários blocos: cada um vira uma linha `match=` do mesmo `identify`.
  if (identify && inbound.matches.length > 0) {
    lines.push("", `[${name}-identify]`, "type=identify", `endpoint=${name}`);
    for (const match of inbound.matches) lines.push(`match=${match}`);
  }
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
      `server_uri=sip:${inbound.host.uri}`,
      `client_uri=sip:${value(trunk.username ?? "")}@${inbound.host.uri}`,
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
export const BLOCK_TOO_WIDE_REASON =
  "a line recognized by IP accepts an address block of at most /16 (IPv4) or /32 (IPv6); enter the smaller blocks the provider publishes, or its IP";
export const OUTBOUND_BLOCK_REASON = "the outbound address must be one server (a name or an IP), not an address block";
export const OUTBOUND_ONLY_IN_IP_MODE_REASON =
  "an outbound address belongs to a line recognized by IP; with registration the calls go out to the server the line registers with";
/** A posição diz qual item recusar sem repetir a lista inteira. */
export const extraAddressReason = (position: number): string => `the extra inbound address ${position} is not an IP address or an address block`;
export const extraNameReason = (position: number): string =>
  `the extra inbound address ${position} is a name; inbound addresses must be numeric (an IP or an address block), and a provider name goes in the outbound address`;
export const extraTooWideReason = (position: number): string => `the extra inbound address ${position} is a block wider than /16 (IPv4) or /32 (IPv6); enter the smaller blocks the provider publishes`;

interface Inbound {
  /** O `host` da linha, como foi lido: manda no registro e no destino padrão. */
  host: TrunkHost;
  /** Blocos canônicos e sem repetição: cada um vira uma linha `match=` do `identify`. */
  matches: string[];
  /** Os mesmos endereços como faixas, para a comparação de sobreposição. */
  hosts: TrunkHost[];
  /** Destino da ligação de saída; `null` quando a linha só recebe. */
  destination: TrunkHost | null;
}

/**
 * De onde as ligações entram e para onde as de saída vão: o `host`, os `match_extra` e o
 * `outbound_host`. Só endereço numérico entra no `identify`; o nome de uma linha por registro fica
 * de fora dele, e `trunkProblem` já recusou nome e bloco largo demais na linha por IP. Os
 * `match_extra` da linha por registro não entram aqui: ela é reconhecida pelo `line` do registro,
 * e o extra dela só libera a entrada (`allowedAddresses`). Também não entram na regra de endereço
 * compartilhado, que é sobre o `identify`.
 */
function readInbound(trunk: TrunkConfig, host: TrunkHost): Inbound {
  const matches: string[] = [];
  const hosts: TrunkHost[] = [];
  for (const value of [trunk.host, ...(trunk.authMode === "ip" ? (trunk.matchExtra ?? []) : [])]) {
    const parsed = parseTrunkHost(value);
    if (parsed?.kind !== "address") continue;
    hosts.push(parsed);
    if (!matches.includes(parsed.match)) matches.push(parsed.match);
  }
  const destination = parseTrunkHost(trunk.outboundHost ?? trunk.host);
  return { host, matches, hosts, destination: destination !== null && destination.uri !== null ? destination : null };
}

const overlap = (a: Inbound, b: Inbound): boolean => a.hosts.some((mine) => b.hosts.some((theirs) => hostsOverlap(mine, theirs)));

/**
 * O arquivo inteiro. Tronco que não pode ser escrito fica de fora, com o motivo em `skipped`.
 *
 * As linhas válidas de endereço numérico são agrupadas por sobreposição de endereço (ver o
 * comentário no topo do arquivo), item por item: uma linha com vários blocos pertence a todos os
 * grupos que algum deles toca.
 *   - grupo de uma organização só: o `identify` vai para uma linha, a de menor `id`; as outras em
 *     modo `ip` ficam de fora (é configuração repetida da própria organização);
 *   - grupo com mais de uma organização: nenhum `identify`, e nenhuma linha em modo `ip`.
 * Em qualquer grupo, linha em modo `register` sai normalmente, reconhecida pelo `line` do registro.
 * Linha inválida por outro motivo não entra em grupo nenhum.
 */
export function renderTrunksConf(trunks: TrunkConfig[]): { conf: string; skipped: Array<{ id: string; reason: string }>; emitted: string[] } {
  const skipped: Array<{ id: string; reason: string }> = [];
  const valid: Array<{ trunk: TrunkConfig; inbound: Inbound; group: number }> = [];
  for (const trunk of [...trunks].sort((a, b) => a.id.localeCompare(b.id))) {
    const host = parseTrunkHost(trunk.host);
    const reason = trunkProblem(trunk);
    if (reason !== null || !host) skipped.push({ id: trunk.id, reason: reason ?? "the host cannot be read" });
    else valid.push({ trunk, inbound: readInbound(trunk, host), group: valid.length });
  }

  // Sobreposição não é transitiva (um bloco liga dois endereços que não se tocam): os grupos são
  // os componentes conexos. ponytail: O(n²), sobra para as dezenas de linhas de uma instalação.
  for (let merged = true; merged; ) {
    merged = false;
    for (const a of valid) {
      for (const b of valid) {
        if (a.group !== b.group && overlap(a.inbound, b.inbound)) {
          const from = Math.max(a.group, b.group);
          const to = Math.min(a.group, b.group);
          for (const entry of valid) if (entry.group === from) entry.group = to;
          merged = true;
        }
      }
    }
  }

  const sections: string[] = [];
  const emitted: string[] = [];
  for (const entry of valid) {
    const group = valid.filter((other) => other.group === entry.group);
    const oneOrganization = group.every((other) => other.trunk.organizationId === entry.trunk.organizationId);
    // `valid` está em ordem de id: o primeiro do grupo é o de menor id.
    const identify = oneOrganization && group[0] === entry;
    if (!identify && entry.trunk.authMode === "ip") skipped.push({ id: entry.trunk.id, reason: SHARED_HOST_REASON });
    else {
      sections.push(renderTrunk(entry.trunk, entry.inbound, identify));
      emitted.push(entry.trunk.id);
    }
  }
  skipped.sort((a, b) => a.id.localeCompare(b.id));
  const header = "; Gerado pelo DeskVoice a partir das linhas cadastradas no painel. Não edite: é reescrito a cada mudança.";
  return { conf: `${[header, ...sections].join(NL + NL)}${NL}`, skipped, emitted };
}

/**
 * Os endereços de onde a central aceita a ligação de uma linha (R14). É a fonte única: a tela mostra
 * o que esta função devolve (gravado em `trunks.inbound_allowed`), e o filtro da central vai liberar
 * a mesma lista. Canônicos (a forma de `parseTrunkHost`), sem repetição, só IP ou bloco, e nunca um
 * bloco mais largo que o piso de `isBlockTooWide`.
 *   - `host` numérico (linha por IP, ou registro com IP): ele mesmo;
 *   - `host` nome (registro): `resolved`, os endereços que o nome resolve, em ordem fixa;
 *   - mais os `match_extra`, nos dois modos.
 * A linha deixada de fora do arquivo não passa por aqui: o conjunto dela é vazio.
 */
export function allowedAddresses(trunk: Pick<TrunkConfig, "host" | "matchExtra">, resolved: readonly string[] = []): string[] {
  const host = parseTrunkHost(trunk.host);
  const fromHost = host?.kind === "address" ? [trunk.host] : [...resolved].map((value) => parseTrunkHost(value)).flatMap((parsed) => (parsed?.kind === "address" ? [parsed.match] : [])).sort();
  return canonicalAddresses([...fromHost, ...(trunk.matchExtra ?? [])]);
}

function canonicalAddresses(values: readonly string[]): string[] {
  const out: string[] = [];
  for (const value of values) {
    const parsed = parseTrunkHost(value);
    if (parsed?.kind !== "address" || isBlockTooWide(parsed) || out.includes(parsed.match)) continue;
    out.push(parsed.match);
  }
  return out;
}

/** Os endereços (IP) que um nome resolve. Injetado, para o teste não ir à rede. */
export type ResolveName = (name: string) => Promise<string[]>;

/** Prazo de cada nome: estourou, conta como falha, e vale o último conjunto conhecido. */
export const RESOLVE_TIMEOUT_MS = 3000;

const NO_RECORD = new Set(["ENODATA", "ENOTFOUND", "NODATA", "NOTFOUND"]);

/**
 * A resolução de verdade: A e AAAA do nome, e os alvos do SRV `_sip._udp.<nome>` (A e AAAA de cada
 * um), que é por onde a operadora diz que entrega SIP por UDP. Tipo de registro que não existe não é
 * erro; qualquer outro erro é, para não encolher o conjunto com uma resposta pela metade. Nome que
 * não resolve para endereço nenhum também é erro.
 */
export async function resolveSipName(name: string): Promise<string[]> {
  const lookup = async (query: () => Promise<string[]>): Promise<string[]> => {
    try {
      return await query();
    } catch (error) {
      if (NO_RECORD.has((error as { code?: string }).code ?? "")) return [];
      throw error;
    }
  };
  const addressesOf = async (target: string): Promise<string[]> => (await Promise.all([lookup(() => dns.resolve4(target)), lookup(() => dns.resolve6(target))])).flat();
  const srv = await lookup(async () => (await dns.resolveSrv(`_sip._udp.${name}`)).map((record) => record.name).filter((target) => target !== "" && target !== "."));
  const found = (await Promise.all([addressesOf(name), ...srv.map(addressesOf)])).flat();
  if (found.length === 0) throw new Error("the name resolves to no address");
  return found;
}

/** Começo do motivo gravado quando o nome não resolveu: a conferência de saúde o mantém. */
const UNRESOLVED = "The provider name could not be resolved";

interface Allowed {
  addresses: string[];
  /** Por que o conjunto não pôde ser atualizado (a linha fica `warn`); `undefined` quando pôde. */
  problem?: string;
}

function withDeadline<T>(promise: Promise<T>, ms: number, schedule: Schedule): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const cancel = schedule(() => reject(new Error(`no answer in ${ms / 1000} s`)), ms);
    promise.then(
      (value) => (cancel(), resolve(value)),
      (error: unknown) => (cancel(), reject(error instanceof Error ? error : new Error(String(error)))),
    );
  });
}

/**
 * O conjunto de cada linha emitida, resolvendo os nomes (um pedido por nome, com prazo). O prazo
 * corre no relógio de verdade, e não no `schedule` das dependências, que nos testes adianta tudo. Resolução
 * que falha MANTÉM o conjunto anterior da linha (`previous`, o que está gravado), somado aos extras
 * de agora: falha de DNS nunca encolhe a lista, e muito menos a esvazia.
 */
export async function computeAllowed(deps: Pick<TrunksDeps, "resolve">, trunks: readonly TrunkConfig[], previous: ReadonlyMap<string, readonly string[]>): Promise<Map<string, Allowed>> {
  const pending = new Map<string, Promise<string[]>>();
  const resolveOnce = (name: string): Promise<string[]> => {
    let found = pending.get(name);
    if (!found) pending.set(name, (found = withDeadline(Promise.resolve().then(() => deps.resolve(name)), RESOLVE_TIMEOUT_MS, realSchedule)));
    return found;
  };
  const entries = await Promise.all(
    trunks.map(async (trunk): Promise<[string, Allowed]> => {
      const host = parseTrunkHost(trunk.host);
      if (host?.kind !== "name") return [trunk.id, { addresses: allowedAddresses(trunk) }];
      // O nome sem a porta: `sip.operadora.example:5080` resolve como `sip.operadora.example`.
      const name = host.uri.split(":")[0] ?? host.uri;
      try {
        const resolved = await resolveOnce(name);
        // Resposta sem nenhum endereço que sirva é falha, e não "o conjunto ficou vazio".
        if (canonicalAddresses(resolved).length === 0) throw new Error("the name resolves to no address");
        return [trunk.id, { addresses: allowedAddresses(trunk, resolved) }];
      } catch (error) {
        const kept = canonicalAddresses([...(previous.get(trunk.id) ?? []), ...allowedAddresses(trunk)]);
        return [trunk.id, { addresses: kept, problem: `${UNRESOLVED} (${name}: ${messageOf(error)}). The line keeps the addresses it had; check the name with the provider.` }];
      }
    }),
  );
  return new Map(entries);
}

export interface FileOwner {
  uid: number;
  gid: number;
}

/**
 * Escrita atômica: o Asterisk nunca lê um arquivo pela metade.
 *
 * Com `owner`, o arquivo é entregue a esse usuário e fica 0640. É o caso do arquivo de troncos:
 * o processo de voz roda como root e o Asterisk como outro usuário, e um arquivo `root 0640` é
 * ignorado em silêncio pelo `#tryinclude` (o recarregamento responde sucesso e nenhuma linha
 * carrega). Se não der para trocar o dono (processo sem privilégio, como em desenvolvimento), o
 * arquivo fica 0644: legível por todos é melhor que ilegível por quem precisa. Devolve o modo final.
 */
export async function writeFileAtomic(file: string, content: string, owner?: FileOwner): Promise<{ mode: number; chownError?: string }> {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, content, { mode: 0o640 });
    let result: { mode: number; chownError?: string } = { mode: 0o640 };
    if (owner) {
      try {
        await chown(temporary, owner.uid, owner.gid);
      } catch (error) {
        await chmod(temporary, 0o644);
        result = { mode: 0o644, chownError: messageOf(error) };
      }
    }
    await rename(temporary, file);
    return result;
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

const NL = String.fromCharCode(10);
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
  /** Usuário do Asterisk dentro do contêiner dele: o dono do arquivo de troncos. */
  owner?: FileOwner;
  schedule?: Schedule;
  /** Resolve o nome no `host` da linha por registro (`resolveSipName` em produção). */
  resolve: ResolveName;
  log: Logger;
}

// Depois de recarregar, o Asterisk leva um instante para listar os endpoints novos.
const LOAD_CHECKS = 5;
const LOAD_CHECK_INTERVAL_MS = 400;
const NOT_LOADED =
  "The telephony server (Asterisk) reloaded but does not list this line. Probable cause: it cannot read the generated lines file (owner or permissions), or the file has a syntax error. Check the Asterisk log";

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

interface TrunksPlan {
  conf: string;
  skipped: Array<{ id: string; reason: string }>;
  emitted: string[];
  /** O conjunto liberado de CADA linha do banco: a emitida tem o calculado, a de fora tem vazio. */
  allowed: Map<string, Allowed>;
  /** O que está gravado hoje, para gravar só o que mudou. */
  stored: Map<string, { allowed: string[]; lastError: string | null }>;
}

/** Lê as linhas do banco, monta o arquivo e calcula o conjunto liberado de cada uma. Não grava nada. */
async function planTrunks(deps: TrunksDeps): Promise<TrunksPlan> {
  const rows = await withSystem(deps.db, (q) =>
    q.many<{
      id: string;
      organization_id: string;
      host: string;
      username: string | null;
      secret_enc: string | null;
      auth_mode: "register" | "ip";
      match_extra: string[] | null;
      outbound_host: string | null;
      inbound_allowed: string[] | null;
      last_error: string | null;
      public_ip: unknown;
    }>(
      `select t.id, t.organization_id, t.host, t.username, t.secret_enc, t.auth_mode, t.match_extra, t.outbound_host, t.inbound_allowed, t.last_error,
              (select s.value from settings s where s.organization_id = t.organization_id and s.key = 'network.public_ip') as public_ip
         from trunks t order by t.id`,
    ),
  );
  const unreadable: Array<{ id: string; reason: string }> = [];
  const trunks: TrunkConfig[] = [];
  for (const row of rows) {
    try {
      trunks.push({
        organizationId: row.organization_id,
        id: row.id,
        host: row.host.trim(),
        username: row.username?.trim() || null,
        password: row.secret_enc ? decryptSecret(row.secret_enc, deps.secretKey) : null,
        authMode: row.auth_mode,
        matchExtra: (row.match_extra ?? []).map((extra) => extra.trim()).filter((extra) => extra !== ""),
        outboundHost: row.outbound_host?.trim() || null,
        publicIp: typeof row.public_ip === "string" ? row.public_ip : deps.publicIp,
      });
    } catch (error) {
      unreadable.push({ id: row.id, reason: `the saved password cannot be read (${messageOf(error)})` });
    }
  }
  const { conf, skipped: invalid, emitted } = renderTrunksConf(trunks);
  const stored = new Map(rows.map((row) => [row.id, { allowed: row.inbound_allowed ?? [], lastError: row.last_error }]));
  const emittedSet = new Set(emitted);
  const computed = await computeAllowed(
    deps,
    trunks.filter((trunk) => emittedSet.has(trunk.id)),
    new Map([...stored].map(([id, entry]) => [id, entry.allowed])),
  );
  const allowed = new Map(rows.map((row) => [row.id, computed.get(row.id) ?? { addresses: [] }]));
  return { conf, skipped: [...unreadable, ...invalid], emitted, allowed, stored };
}

const sameList = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((value, index) => value === b[index]);

/**
 * Grava o conjunto de cada linha, só onde mudou (`is distinct from`, como `setStatus`), com a hora.
 * A linha cujo nome não resolveu fica `warn` com o motivo; quando volta a resolver, o aviso sai.
 */
async function recordAllowed(deps: TrunksDeps, plan: TrunksPlan): Promise<void> {
  const now = deps.clock.now();
  await withSystem(deps.db, async (q) => {
    for (const [id, { addresses }] of plan.allowed) {
      if (sameList(plan.stored.get(id)?.allowed ?? [], addresses)) continue;
      await q.exec("update trunks set inbound_allowed = $2, inbound_resolved_at = $3 where id = $1 and inbound_allowed is distinct from $2", [id, addresses, now]);
    }
  });
  const problems = [...plan.allowed].flatMap(([id, entry]) => (entry.problem === undefined ? [] : [{ id, status: "warn" as const, detail: entry.problem }]));
  await setStatus(deps, problems);
  for (const { id, detail } of problems) deps.log("error", "could not resolve the provider name of a line; kept its last known addresses", { trunkId: id, detail });
  const recovered = [...plan.allowed].filter(([id, entry]) => entry.problem === undefined && plan.stored.get(id)?.lastError?.startsWith(UNRESOLVED));
  if (recovered.length === 0) return;
  await withSystem(deps.db, async (q) => {
    for (const [id] of recovered) {
      await q.exec("update trunks set status = 'unverified', last_error = null where id = $1 and status = 'warn' and last_error like $2", [id, `${UNRESOLVED}%`]);
    }
  });
}

/**
 * O relógio de 5 minutos: resolve de novo os nomes e, se o conjunto de alguma linha mudou, aplica
 * as linhas de novo (o arquivo é a fonte do filtro). Sem mudança, só grava o aviso de nome que não
 * resolveu (ou tira o aviso, se voltou a resolver). Devolve se aplicou.
 */
export async function refreshAllowed(deps: TrunksDeps): Promise<boolean> {
  const plan = await planTrunks(deps);
  const changed = [...plan.allowed].some(([id, entry]) => !sameList(plan.stored.get(id)?.allowed ?? [], entry.addresses));
  if (changed) {
    const result = await applyTrunks(deps);
    deps.log(result.applied ? "info" : "error", "the addresses of a line changed; trunks applied again", { applied: result.applied, detail: result.detail });
    return true;
  }
  await recordAllowed(deps, plan);
  return false;
}

/** De quanto em quanto tempo o processo de voz resolve de novo os nomes das linhas. */
export const REFRESH_ALLOWED_MS = 5 * 60_000;

/**
 * Regrava o arquivo de troncos com as linhas de todas as organizações e pede ao Asterisk para
 * recarregar o PJSIP. Sem Asterisk no ar o arquivo fica escrito e o resultado diz que falta recarregar.
 */
export async function applyTrunks(deps: TrunksDeps): Promise<{ applied: boolean; detail: string; skipped: Array<{ id: string; reason: string }> }> {
  const plan = await planTrunks(deps);
  const written = await writeFileAtomic(deps.file, plan.conf, deps.owner);
  if (written.chownError !== undefined) {
    deps.log("error", "could not hand the lines file to the Asterisk user; left it readable by everyone (0644) instead", { file: deps.file, owner: deps.owner, error: written.chownError });
  }
  const { skipped, emitted } = plan;
  await setStatus(deps, skipped.map(({ id, reason }) => ({ id, status: "fail" as const, detail: `${LEFT_OUT}: ${reason}.` })));
  for (const { id, reason } of skipped) deps.log("error", "trunk left out of the generated configuration", { trunkId: id, reason });
  await recordAllowed(deps, plan);

  try {
    await deps.ari.reloadModule("res_pjsip.so");
  } catch (error) {
    return { applied: false, detail: `The lines were written, but the telephony server did not reload them: ${messageOf(error)}`, skipped };
  }

  // "Recarregado" só vale quando o Asterisk lista de fato cada linha escrita: o recarregamento
  // responde sucesso mesmo quando ele não conseguiu ler o arquivo.
  let missing = emitted;
  for (let attempt = 0; attempt < LOAD_CHECKS && missing.length > 0; attempt++) {
    if (attempt > 0) await new Promise<void>((resolve) => void (deps.schedule ?? realSchedule)(resolve, LOAD_CHECK_INTERVAL_MS));
    try {
      const loaded = new Set((await deps.ari.listEndpoints("PJSIP")).map((endpoint) => endpoint.resource));
      missing = emitted.filter((id) => !loaded.has(trunkEndpointName(id)));
    } catch (error) {
      return { applied: false, detail: `The lines were written, but the telephony server could not be asked whether it loaded them: ${messageOf(error)}`, skipped };
    }
  }
  if (missing.length > 0) {
    await setStatus(deps, missing.map((id) => ({ id, status: "fail" as const, detail: `${NOT_LOADED}.` })));
    deps.log("error", "asterisk reloaded but does not list the written lines", { missing: missing.length, written: emitted.length, file: deps.file });
    return { applied: false, detail: `${NOT_LOADED} (${missing.length} of ${emitted.length} line(s) missing).`.replace("this line", "the written lines"), skipped };
  }
  return { applied: true, detail: `${emitted.length} line(s) written, reloaded and listed by the telephony server.`, skipped };
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
  // O nome que não resolveu não derruba a linha (ela segue com o último conjunto), mas pede atenção.
  const unresolved = new Map(rows.flatMap((row) => (row.last_error?.startsWith(UNRESOLVED) ? [[row.id, row.last_error] as const] : [])));
  let health: TrunkHealth[];
  try {
    const states = new Map((await deps.ari.listEndpoints("PJSIP")).map((endpoint) => [endpoint.resource, endpoint.state ?? "unknown"]));
    health = ids.map((id) => {
      const state = states.get(trunkEndpointName(id));
      if (state === "online") return unresolved.has(id) ? { id, status: "warn", detail: unresolved.get(id) ?? "" } : { id, status: "ok", detail: "The provider answers." };
      if (state === "offline") return { id, status: "fail", detail: "The provider does not answer. Check the host, the user and the password, and whether the provider allows this server's IP." };
      if (state === undefined) return { id, status: "fail", detail: leftOut.get(id) ?? `${NOT_LOADED}.` };
      return { id, status: "warn", detail: "The line is loaded, but the provider has not been checked yet. Try again in a minute." };
    });
  } catch (error) {
    health = ids.map((id) => ({ id, status: "fail", detail: `The telephony server (Asterisk) did not answer: ${messageOf(error)}` }));
  }
  await setStatus(deps, health);
  return health;
}
