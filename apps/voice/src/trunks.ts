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
import { addressPlaces, decryptSecret, inboundFilterOn, withSystem, type Clock, type Db } from "@deskvoice/core";
import { trunkEndpointName, type AriClient } from "./ari";
import { messageOf, type Logger } from "./log";
import { realSchedule, type Schedule } from "./transport";
import { isBlockTooWide, parseTrunkHost, type TrunkHost } from "./trunk-host";

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
  /**
   * A coluna `trunks.inbound_filter` (R14 contrato 11), crua. Só vale para a linha por registro:
   * com `false`, o endpoint dela sai sem `deny` e sem `permit`, mesmo com o conjunto cheio, até
   * alguém conferir a lista e ligar na tela. Ausente vale `true`. Nunca leia direto: o filtro
   * efetivo é `inboundFilterOn` (a linha por IP filtra sempre).
   */
  inboundFilter?: boolean;
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
function renderTrunk(trunk: TrunkConfig, inbound: Inbound, identify: boolean, permit: readonly string[]): string {
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
    // O filtro de entrada da linha (R14): recusa tudo e libera só os endereços DESTA linha. Por
    // endpoint, nunca numa lista global (`type=acl`): com a lista global, o endereço da operadora
    // de uma organização entraria na linha de outra. Conjunto vazio sai sem filtro (contrato 8).
    ...(permit.length > 0 ? ["deny=0.0.0.0/0.0.0.0", "deny=::/0", ...permit.map((address) => `permit=${address}`)] : []),
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
  for (const value of [trunk.host, ...(trunk.authMode === "ip" ? (trunk.matchExtra ?? []) : [])]) {
    const parsed = parseTrunkHost(value);
    if (parsed?.kind !== "address") continue;
    if (!matches.includes(parsed.match)) matches.push(parsed.match);
  }
  const destination = parseTrunkHost(trunk.outboundHost ?? trunk.host);
  return { host, matches, destination: destination !== null && destination.uri !== null ? destination : null };
}

/**
 * O arquivo inteiro. Tronco que não pode ser escrito fica de fora, com o motivo em `skipped`.
 * `allowed` é o conjunto liberado de cada linha, calculado por `computeAllowed` na mesma aplicação:
 * vira o `deny` e os `permit` do endpoint. Linha sem conjunto (vazio ou ausente) ou com o filtro
 * efetivo desligado (`inboundFilterOn`: só a linha por registro com `inboundFilter: false`) sai
 * sem filtro.
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
export function renderTrunksConf(
  trunks: TrunkConfig[],
  allowed: ReadonlyMap<string, readonly string[]> = new Map(),
): { conf: string; skipped: Array<{ id: string; reason: string }>; emitted: string[] } {
  const skipped: Array<{ id: string; reason: string }> = [];
  const valid: Array<{ trunk: TrunkConfig; inbound: Inbound }> = [];
  for (const trunk of [...trunks].sort((a, b) => a.id.localeCompare(b.id))) {
    const host = parseTrunkHost(trunk.host);
    const reason = trunkProblem(trunk);
    if (reason !== null || !host) skipped.push({ id: trunk.id, reason: reason ?? "the host cannot be read" });
    else valid.push({ trunk, inbound: readInbound(trunk, host) });
  }

  // A regra do grupo mora em `packages/core` (`addressPlaces`): o painel usa a mesma para avisar,
  // antes de salvar, que a linha vai tirar do ar a linha por IP de outra organização.
  const places = addressPlaces(valid.map((entry) => entry.trunk));
  const sections: string[] = [];
  const emitted: string[] = [];
  for (const entry of valid) {
    const identify = places.get(entry.trunk.id)?.identify ?? false;
    if (!identify && entry.trunk.authMode === "ip") skipped.push({ id: entry.trunk.id, reason: SHARED_HOST_REASON });
    else {
      // O `permit` passa de novo pela regra do contrato 2: só IP ou bloco, nunca bloco largo demais.
      // Com o filtro efetivo desligado (contrato 11), nada de `permit`: o endpoint sai sem filtro.
      const permit = inboundFilterOn(entry.trunk) ? canonicalAddresses(allowed.get(entry.trunk.id) ?? []) : [];
      sections.push(renderTrunk(entry.trunk, entry.inbound, identify, permit));
      emitted.push(entry.trunk.id);
    }
  }
  skipped.sort((a, b) => a.id.localeCompare(b.id));
  const header = "; Gerado pelo DeskVoice a partir das linhas cadastradas no painel. Não edite: é reescrito a cada mudança.";
  return { conf: `${[header, ...sections].join(NL + NL)}${NL}`, skipped, emitted };
}

/**
 * Os endereços de onde a central aceita a ligação de uma linha (R14), montados a partir das partes.
 * Canônicos (a forma de `parseTrunkHost`), sem repetição, só IP ou bloco, e nunca um bloco mais
 * largo que o piso de `isBlockTooWide`.
 *   - `host` numérico (linha por IP, ou registro com IP): ele mesmo;
 *   - `host` nome (registro): `fromName`, o que veio do nome, em ordem fixa;
 *   - mais os `match_extra` ATUAIS, nos dois modos.
 * A linha deixada de fora do arquivo não passa por aqui: o conjunto dela é vazio. O filtro e a tela
 * não chamam esta função direto: os dois leem o resultado de `computeAllowed` (contrato 6).
 */
export function allowedAddresses(trunk: Pick<TrunkConfig, "host" | "matchExtra">, fromName: readonly string[] = []): string[] {
  const host = parseTrunkHost(trunk.host);
  const fromHost = host?.kind === "address" ? [trunk.host] : [...fromName].map((value) => parseTrunkHost(value)).flatMap((parsed) => (parsed?.kind === "address" ? [parsed.match] : [])).sort();
  return canonicalAddresses([...fromHost, ...(trunk.matchExtra ?? [])]);
}

/** Quantos endereços vindos do nome uma linha aceita (contrato 9). Com os 16 extras e o `host`, 33. */
export const MAX_FROM_NAME = 16;

/**
 * O que um nome resolveu, como entra no conjunto: canônico, sem repetição, em ordem fixa (a mesma
 * resposta dá sempre a mesma escolha) e no máximo `MAX_FROM_NAME`. `over` diz se sobrou endereço.
 */
export function nameAddresses(resolved: readonly string[]): { addresses: string[]; over: boolean } {
  const all = canonicalAddresses(resolved).sort();
  return { addresses: all.slice(0, MAX_FROM_NAME), over: all.length > MAX_FROM_NAME };
}

/**
 * Por quanto tempo um endereço que o nome devolveu continua liberado depois da última resposta que o
 * trouxe. Há DNS que devolve só uma parte dos endereços a cada consulta (rodízio): com só a última
 * resposta, o `permit` oscilaria e recusaria a ligação vinda de um endereço válido da vez anterior.
 */
export const NAME_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Endereço vindo do nome → quando uma resposta do nome o trouxe pela última vez (ISO 8601). */
export type SeenAt = Record<string, string>;

/**
 * A parte do nome depois de uma resposta que deu certo: a resposta de agora mais o que alguma
 * resposta trouxe nas últimas `NAME_WINDOW_MS` (a união da janela), dentro do teto. Com mais do que
 * `MAX_FROM_NAME`, ficam primeiro os da resposta de agora (em ordem canônica), depois os vistos mais
 * recentemente; `over` diz se sobrou endereço. Endereço guardado sem hora conhecida não conta como
 * visto na janela; hora no futuro (o relógio voltou) conta, para o filtro não encolher por isso. A lista sai em ordem canônica, e `seen` só tem os endereços que ficaram.
 */
export function nameWindow(resolved: readonly string[], previous: readonly string[], previousSeen: Readonly<SeenAt>, now: Date): { addresses: string[]; seen: SeenAt; over: boolean } {
  const current = nameAddresses(resolved);
  const nowIso = now.toISOString();
  const since = now.getTime() - NAME_WINDOW_MS;
  const older = canonicalAddresses(previous)
    .filter((address) => !current.addresses.includes(address))
    .flatMap((address) => {
      const at = Date.parse(previousSeen[address] ?? "");
      return Number.isFinite(at) && at >= since ? [{ address, at }] : [];
    })
    .sort((a, b) => b.at - a.at || (a.address < b.address ? -1 : 1));
  const room = MAX_FROM_NAME - current.addresses.length;
  const kept = older.slice(0, Math.max(room, 0));
  const seen: SeenAt = {};
  for (const address of current.addresses) seen[address] = nowIso;
  for (const { address } of kept) seen[address] = previousSeen[address] as string;
  return { addresses: [...current.addresses, ...kept.map(({ address }) => address)].sort(), seen, over: current.over || older.length > kept.length };
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
/** Começo do motivo da linha ativa sem conjunto: o filtro dela fica desligado (contrato 8). */
export const EMPTY_ALLOWED = "The telephony server does not know yet which addresses this line receives calls from";
/** Começo do motivo do nome que resolve mais endereços do que o teto (contrato 9). */
export const TOO_MANY_FROM_NAME = `The provider name resolves to more than ${MAX_FROM_NAME} addresses`;
/** Os avisos do conjunto liberado: a conferência de saúde os mantém, e saem quando o motivo some. */
const ALLOWED_WARNINGS = [UNRESOLVED, EMPTY_ALLOWED, TOO_MANY_FROM_NAME];
const isAllowedWarning = (text: string | null | undefined): boolean => ALLOWED_WARNINGS.some((start) => text?.startsWith(start) === true);

interface Allowed {
  addresses: string[];
  /**
   * O que veio do nome, guardado à parte (`trunks.inbound_from_name`): só essa parte usa a regra do
   * último conjunto (contrato 7), e é a união das respostas do nome numa janela (`nameWindow`).
   * Vazio quando o `host` é numérico.
   */
  fromName: string[];
  /** Quando cada endereço de `fromName` veio numa resposta do nome (`trunks.inbound_from_name_seen`). */
  seen: SeenAt;
  /** Por que o conjunto não pôde ser atualizado, ou ficou vazio, ou passou do teto (a linha fica `warn`). */
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
 * corre no relógio de verdade, e não no `schedule` das dependências, que nos testes adianta tudo.
 *
 * O conjunto é sempre o `host` numérico e os `match_extra` ATUAIS da linha, mais o que veio do nome
 * (contrato 7). Resolução que dá certo junta a resposta de agora com o que o nome trouxe nas últimas
 * 24 horas (`nameWindow`, `previousSeen` diz quando). Resolução que falha mantém só a parte do nome
 * (`previousFromName`, o `inbound_from_name` gravado), sem vencer nada: falha de DNS nunca encolhe
 * essa parte, e um extra removido sai do conjunto mesmo com o DNS fora.
 *
 * Linha com nome no `host` que nunca resolveu (sem nada vindo do nome) fica SEM filtro, mesmo com
 * extras: o filtro só com os extras recusaria a entrega pelo servidor do registro. O conjunto dela
 * é vazio e ela fica `warn` (contrato 8); o mesmo com nome acima do teto (contrato 9).
 */
export async function computeAllowed(
  deps: Pick<TrunksDeps, "resolve">,
  trunks: readonly TrunkConfig[],
  previousFromName: ReadonlyMap<string, readonly string[]>,
  { previousSeen = new Map(), now = new Date() }: { previousSeen?: ReadonlyMap<string, Readonly<SeenAt>>; now?: Date } = {},
): Promise<Map<string, Allowed>> {
  const pending = new Map<string, Promise<string[]>>();
  const resolveOnce = (name: string): Promise<string[]> => {
    let found = pending.get(name);
    if (!found) pending.set(name, (found = withDeadline(Promise.resolve().then(() => deps.resolve(name)), RESOLVE_TIMEOUT_MS, realSchedule)));
    return found;
  };
  const entries = await Promise.all(
    trunks.map(async (trunk): Promise<[string, Allowed]> => {
      const host = parseTrunkHost(trunk.host);
      if (host?.kind !== "name") return [trunk.id, { addresses: allowedAddresses(trunk), fromName: [], seen: {} }];
      // O nome sem a porta: `sip.operadora.example:5080` resolve como `sip.operadora.example`.
      const name = host.uri.split(":")[0] ?? host.uri;
      const previous = previousFromName.get(trunk.id) ?? [];
      const seenBefore = previousSeen.get(trunk.id) ?? {};
      let fromName: { addresses: string[]; seen: SeenAt; over: boolean };
      let problem: string | undefined;
      try {
        const resolved = await resolveOnce(name);
        // Resposta sem nenhum endereço que sirva é falha, e não "o conjunto ficou vazio".
        if (nameAddresses(resolved).addresses.length === 0) throw new Error("the name resolves to no address");
        fromName = nameWindow(resolved, previous, seenBefore, now);
        if (fromName.over) {
          problem = `${TOO_MANY_FROM_NAME} (${name}); only the first ${MAX_FROM_NAME} are accepted. Add to Extra addresses the ones the provider uses to deliver calls.`;
        }
      } catch (error) {
        const kept = nameAddresses(previous);
        fromName = { ...kept, seen: Object.fromEntries(kept.addresses.flatMap((address) => (seenBefore[address] === undefined ? [] : [[address, seenBefore[address]]]))) };
        problem = `${UNRESOLVED} (${name}: ${messageOf(error)}). The line keeps the addresses it had; check the name with the provider.`;
      }
      // Sem nada vindo do nome, sem filtro: os extras sozinhos não ligam o filtro (contrato 8).
      const addresses = fromName.addresses.length === 0 ? [] : allowedAddresses(trunk, fromName.addresses);
      if (addresses.length === 0) {
        problem = `${EMPTY_ALLOWED}; its filter stays off until the name ${name} resolves.${problem === undefined ? "" : ` ${problem}`}`;
      }
      return [trunk.id, { addresses, fromName: fromName.addresses, seen: fromName.seen, ...(problem === undefined ? {} : { problem }) }];
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
// A tela reconhece a linha deixada de fora por este começo (`apps/panel/src/ui/trunk-status.ts`).
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
  /**
   * O que está gravado hoje, para gravar só o que mudou. `host` e `authMode` como lidos: a gravação
   * só vale se a linha não mudou de destino no meio (o painel zera as colunas nessa hora).
   */
  stored: Map<string, { allowed: string[]; fromName: string[]; seen: SeenAt; lastError: string | null; host: string; authMode: string }>;
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
      inbound_from_name: string[] | null;
      inbound_from_name_seen: SeenAt | null;
      inbound_filter: boolean;
      last_error: string | null;
      public_ip: unknown;
    }>(
      `select t.id, t.organization_id, t.host, t.username, t.secret_enc, t.auth_mode, t.match_extra, t.outbound_host, t.inbound_allowed, t.inbound_from_name, t.inbound_from_name_seen, t.inbound_filter, t.last_error,
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
        // O plano já leva o filtro efetivo (contrato 11), e não a coluna crua.
        inboundFilter: inboundFilterOn({ authMode: row.auth_mode, inboundFilter: row.inbound_filter }),
      });
    } catch (error) {
      unreadable.push({ id: row.id, reason: `the saved password cannot be read (${messageOf(error)})` });
    }
  }
  // Quem sai no arquivo não depende do conjunto: a primeira passada só diz quais linhas são emitidas.
  const { skipped: invalid, emitted } = renderTrunksConf(trunks);
  const stored = new Map(
    rows.map((row) => [row.id, { allowed: row.inbound_allowed ?? [], fromName: row.inbound_from_name ?? [], seen: row.inbound_from_name_seen ?? {}, lastError: row.last_error, host: row.host, authMode: row.auth_mode }]),
  );
  const emittedSet = new Set(emitted);
  const computed = await computeAllowed(
    deps,
    trunks.filter((trunk) => emittedSet.has(trunk.id)),
    new Map([...stored].map(([id, entry]) => [id, entry.fromName])),
    { previousSeen: new Map([...stored].map(([id, entry]) => [id, entry.seen])), now: deps.clock.now() },
  );
  const allowed = new Map(rows.map((row) => [row.id, computed.get(row.id) ?? { addresses: [], fromName: row.inbound_from_name ?? [], seen: row.inbound_from_name_seen ?? {} }]));
  // O filtro sai do conjunto calculado AGORA (contratos 6 e 8), o mesmo que a tela vai mostrar.
  const { conf } = renderTrunksConf(trunks, new Map([...computed].map(([id, entry]) => [id, entry.addresses])));
  return { conf, skipped: [...unreadable, ...invalid], emitted, allowed, stored };
}

const sameList = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((value, index) => value === b[index]);
const sameSeen = (a: Readonly<SeenAt>, b: Readonly<SeenAt>): boolean =>
  Object.keys(a).length === Object.keys(b).length && Object.entries(a).every(([address, at]) => Date.parse(b[address] ?? "") === Date.parse(at));

/**
 * Grava o conjunto de cada linha, só onde mudou (`is distinct from`, como `setStatus`), com a hora, e
 * à parte o que veio do nome, com a hora em que cada endereço dele veio. Só grava se a linha ainda tem o `host` e o modo que foram lidos: se o
 * painel trocou o destino no meio (e zerou as colunas), o conjunto do destino antigo não volta.
 * A linha com aviso do conjunto fica `warn` com o motivo; quando o motivo some, o aviso sai.
 */
async function recordAllowed(deps: TrunksDeps, plan: TrunksPlan): Promise<void> {
  const now = deps.clock.now();
  await withSystem(deps.db, async (q) => {
    for (const [id, { addresses, fromName, seen }] of plan.allowed) {
      const stored = plan.stored.get(id);
      if (!stored) continue;
      if (!sameList(stored.allowed, addresses)) {
        await q.exec(
          "update trunks set inbound_allowed = $2, inbound_resolved_at = $3 where id = $1 and host = $4 and auth_mode = $5 and inbound_allowed is distinct from $2",
          [id, addresses, now, stored.host, stored.authMode],
        );
      }
      // A hora de cada endereço muda a cada resposta do nome: grava a parte do nome junto com ela.
      if (!sameList(stored.fromName, fromName) || !sameSeen(stored.seen, seen)) {
        await q.exec(
          "update trunks set inbound_from_name = $2, inbound_from_name_seen = $3::jsonb where id = $1 and host = $4 and auth_mode = $5",
          [id, fromName, JSON.stringify(seen), stored.host, stored.authMode],
        );
      }
    }
  });
  const problems = [...plan.allowed].flatMap(([id, entry]) => (entry.problem === undefined ? [] : [{ id, status: "warn" as const, detail: entry.problem }]));
  await setStatus(deps, problems);
  for (const { id, detail } of problems) deps.log("error", "the allowed addresses of a line need attention", { trunkId: id, detail });
  const recovered = [...plan.allowed].filter(([id, entry]) => entry.problem === undefined && isAllowedWarning(plan.stored.get(id)?.lastError));
  if (recovered.length === 0) return;
  await withSystem(deps.db, async (q) => {
    for (const [id] of recovered) {
      await q.exec("update trunks set status = 'unverified', last_error = null where id = $1 and status = 'warn' and last_error = $2", [id, plan.stored.get(id)?.lastError]);
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
  // O aviso do conjunto (nome que não resolveu, conjunto vazio, nome acima do teto) não derruba a
  // linha, mas pede atenção.
  const unresolved = new Map(rows.flatMap((row) => (isAllowedWarning(row.last_error) ? [[row.id, row.last_error] as const] : [])));
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
