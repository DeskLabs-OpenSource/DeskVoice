// A regra de endereço repetido entre linhas (R8, fatia 10), num lugar só. O processo de voz a usa
// para montar o arquivo do Asterisk (`renderTrunksConf`), e o painel a usa para avisar, ANTES de
// salvar, que uma linha vai tirar do ar a linha por IP de outra organização. Se as duas regras
// fossem escritas duas vezes, o aviso e o arquivo divergiriam um dia sem ninguém ver.
import { recordInstallationEvent } from "./installation";
import { decryptSecret } from "./secrets";
import type { Db } from "./types";
import { withSystem } from "./with-org";
import { hostsOverlap, isBlockTooWide, parseTrunkHost, type TrunkHost } from "./trunk-host";

/** O que a regra precisa de uma linha: de quem é, como é reconhecida e de onde as ligações entram. */
export interface AddressedTrunk {
  id: string;
  organizationId: string;
  host: string;
  authMode: "register" | "ip";
  matchExtra?: readonly string[];
}

/** Onde a linha cai depois do agrupamento por endereço. */
export interface AddressPlace {
  /** A linha recebe o `identify` do grupo dela. */
  identify: boolean;
  /** O grupo dela tem linhas de mais de uma organização. */
  mixedOrganizations: boolean;
}

/**
 * Os endereços que entram no `identify`: o `host` e, na linha por IP, os `match_extra`. Só endereço
 * numérico; o nome de uma linha por registro fica de fora. Os extras da linha por registro só
 * liberam a entrada e não entram na regra de endereço repetido, que é sobre o `identify`.
 */
function identifyHosts(trunk: AddressedTrunk): TrunkHost[] {
  const hosts: TrunkHost[] = [];
  for (const value of [trunk.host, ...(trunk.authMode === "ip" ? (trunk.matchExtra ?? []) : [])]) {
    const parsed = parseTrunkHost(value);
    if (parsed?.kind === "address") hosts.push(parsed);
  }
  return hosts;
}

/**
 * Agrupa as linhas por sobreposição de endereço, item por item: uma linha com vários blocos
 * pertence a todos os grupos que algum deles toca. Quem chama passa só linhas que podem ser
 * escritas (o processo de voz já tirou as inválidas com `trunkProblem`).
 *   - grupo de uma organização só: o `identify` vai para uma linha, a de menor `id`;
 *   - grupo com mais de uma organização: nenhum `identify`.
 * A linha por IP sem `identify` fica de fora do arquivo; a linha por registro sai sempre,
 * reconhecida pelo `line` do registro (ver o comentário no topo de `apps/voice/src/trunks.ts`).
 */
export function addressPlaces(trunks: readonly AddressedTrunk[]): Map<string, AddressPlace> {
  const entries = [...trunks].sort((a, b) => a.id.localeCompare(b.id)).map((trunk, group) => ({ trunk, hosts: identifyHosts(trunk), group }));
  const overlap = (a: TrunkHost[], b: TrunkHost[]): boolean => a.some((mine) => b.some((theirs) => hostsOverlap(mine, theirs)));
  // Sobreposição não é transitiva (um bloco liga dois endereços que não se tocam): os grupos são
  // os componentes conexos. ponytail: O(n²), sobra para as dezenas de linhas de uma instalação.
  for (let merged = true; merged; ) {
    merged = false;
    for (const a of entries) {
      for (const b of entries) {
        if (a.group !== b.group && overlap(a.hosts, b.hosts)) {
          const from = Math.max(a.group, b.group);
          const to = Math.min(a.group, b.group);
          for (const entry of entries) if (entry.group === from) entry.group = to;
          merged = true;
        }
      }
    }
  }
  const places = new Map<string, AddressPlace>();
  for (const entry of entries) {
    const group = entries.filter((other) => other.group === entry.group);
    const mixedOrganizations = group.some((other) => other.trunk.organizationId !== entry.trunk.organizationId);
    // `entries` está em ordem de id: o primeiro do grupo é o de menor id.
    places.set(entry.trunk.id, { identify: !mixedOrganizations && group[0] === entry, mixedOrganizations });
  }
  return places;
}

/** As linhas por IP que ficam de fora do arquivo POR SOBREPOSIÇÃO ENTRE ORGANIZAÇÕES. */
export function ipTrunksOutByOverlap(trunks: readonly AddressedTrunk[]): Set<string> {
  const places = addressPlaces(trunks);
  return new Set(trunks.filter((trunk) => trunk.authMode === "ip" && places.get(trunk.id)?.mixedOrganizations).map((trunk) => trunk.id));
}

/** A linha como o processo de voz a lê do banco (`planTrunks`), com a senha já decifrada. */
export interface GroupedTrunk extends AddressedTrunk {
  username: string | null;
  password: string | null;
  outboundHost?: string | null;
}

// As mesmas regras de `trunkProblem` (`apps/voice/src/trunks.ts`); o teste
// `trunks-overlap-agrees.test.ts` confere, caso a caso, que as duas respostas não divergem.
const SIP_USERNAME = /^[A-Za-z0-9._+@-]{1,80}$/;
const LINE_BREAKERS = new Set([0x7f, 0x85, 0x2028, 0x2029]);
const hasControl = (text: string): boolean => [...text].some((char) => (char.codePointAt(0) ?? 0) < 0x20 || LINE_BREAKERS.has(char.codePointAt(0) ?? 0));

/**
 * Se a linha entra no agrupamento por endereço: é a pergunta "`trunkProblem` aceita a linha?" do
 * processo de voz, menos o id. A linha que ele recusa fica fora do arquivo e não toca grupo nenhum.
 * O aviso do painel precisa da mesma resposta nos dois sentidos: contar uma linha que o arquivo
 * deixa de fora esconde a linha que outra gravação tiraria do ar, e não contar uma que ele escreve
 * deixa passar a gravação que a tira.
 */
export function trunkEntersGroups(given: Omit<GroupedTrunk, "id" | "organizationId">): boolean {
  const trunk = normalized(given);
  const host = parseTrunkHost(trunk.host);
  if (!host) return false;
  if (trunk.username !== null && !SIP_USERNAME.test(trunk.username)) return false;
  if (trunk.password !== null && (trunk.password.length > 128 || hasControl(trunk.password) || trunk.password.startsWith(">") || trunk.password !== trunk.password.trim())) {
    return false;
  }
  if (trunk.authMode === "register" && (!trunk.username || !trunk.password || host.uri === null)) return false;
  if (trunk.authMode === "ip" && (host.kind === "name" || isBlockTooWide(host))) return false;
  if (trunk.authMode !== "ip" && trunk.outboundHost != null) return false;
  for (const extra of trunk.matchExtra ?? []) {
    const parsed = parseTrunkHost(extra);
    if (!parsed || parsed.kind === "name" || isBlockTooWide(parsed)) return false;
  }
  if (trunk.outboundHost != null && parseTrunkHost(trunk.outboundHost)?.uri == null) return false;
  return true;
}

/** O mesmo corte que o processo de voz faz ao ler a linha (`planTrunks`). */
function normalized<T extends Omit<GroupedTrunk, "organizationId" | "id">>(trunk: T): T {
  return {
    ...trunk,
    host: trunk.host.trim(),
    username: trunk.username?.trim() || null,
    matchExtra: (trunk.matchExtra ?? []).map((extra) => extra.trim()).filter((extra) => extra !== ""),
    outboundHost: trunk.outboundHost?.trim() || null,
  };
}

/** A linha como ficaria gravada: endereço, modo e credencial, com a senha em claro. */
export type TrunkCandidate = Omit<GroupedTrunk, "id" | "organizationId"> & { id?: string };

// Uma linha nova ainda não tem id; este nunca é um uuid, então não colide com nenhuma gravada.
const NEW_TRUNK = "candidate";

/**
 * Se gravar a linha `candidate` da organização tiraria do ar uma linha por IP, de qualquer
 * organização, que hoje está no ar. Atravessa organizações (seção 3.9 do desenho do R8) só para
 * responder sim ou não: nunca devolve id, nome, endereço ou organização de outra linha.
 * Com uma organização só na instalação, a resposta é sempre não.
 *
 * O "antes" e o "depois" passam pela mesma regra do arquivo (`trunkEntersGroups`), com as senhas
 * decifradas: a linha gravada que ainda não entra no agrupamento (sem senha, por exemplo) não está
 * no "antes", e a edição que a faz entrar (gravar a senha) é a que tira a outra do ar.
 */
export async function trunkOverlapWarning(db: Db, secretKey: Buffer, organizationId: string, candidate: TrunkCandidate): Promise<{ stops: boolean }> {
  const rows = await withSystem(db, (q) =>
    q.many<{
      id: string;
      organization_id: string;
      host: string;
      auth_mode: "register" | "ip";
      match_extra: string[] | null;
      username: string | null;
      secret_enc: string | null;
      outbound_host: string | null;
    }>(
      // A linha da organização em exclusão o processo de voz já deixou de fora do arquivo.
      `select t.id, t.organization_id, t.host, t.auth_mode, t.match_extra, t.username, t.secret_enc, t.outbound_host
         from trunks t
        where not exists (select from organizations o where o.id = t.organization_id and o.deleting_at is not null)
        order by t.id`,
    ),
  );
  const before: GroupedTrunk[] = [];
  for (const row of rows) {
    let password: string | null;
    try {
      password = row.secret_enc ? decryptSecret(row.secret_enc, secretKey) : null;
    } catch {
      // Senha que não decifra: o processo de voz deixa a linha de fora do arquivo.
      continue;
    }
    const trunk = normalized({
      id: row.id,
      organizationId: row.organization_id,
      host: row.host,
      authMode: row.auth_mode,
      matchExtra: row.match_extra ?? [],
      username: row.username,
      password,
      outboundHost: row.outbound_host,
    });
    if (trunkEntersGroups(trunk)) before.push(trunk);
  }
  const proposed: GroupedTrunk = normalized({ ...candidate, id: candidate.id ?? NEW_TRUNK, organizationId });
  // A linha que não entra no agrupamento só sai do "antes": tirar uma linha nunca tira outra do ar.
  const after = [...before.filter((trunk) => trunk.id !== proposed.id), ...(trunkEntersGroups(proposed) ? [proposed] : [])];
  const outBefore = ipTrunksOutByOverlap(before);
  const outAfter = ipTrunksOutByOverlap(after);
  return { stops: [...outAfter].some((id) => !outBefore.has(id)) };
}

/**
 * Grava na auditoria da instalação a conferência de faixa que achou linha a tirar do ar: a recusa
 * (`trunk_overlap_refused`, a tela pediu confirmação) ou a confirmação (`trunk_overlap_confirmed`,
 * a gravação seguiu mesmo assim). Grava também a organização que passou do número de conferências
 * do dia (`trunk_overlap_many_checks`), uma vez por dia, com qualquer resposta. Roda numa
 * transação própria (`withSystem`), fora da transação da linha: o evento fica gravado mesmo com a
 * resposta 409 e nada salvo. Leva só a organização e a conta de quem tentou; o `payload` é vazio.
 */
export async function recordTrunkOverlap(
  db: Db,
  at: Date,
  kind: "trunk_overlap_refused" | "trunk_overlap_confirmed" | "trunk_overlap_many_checks",
  organizationId: string,
  userId: string,
): Promise<void> {
  await withSystem(db, async (q) => {
    const person = await q.one<{ accountId: string }>(`select account_id as "accountId" from users where id = $1 and organization_id = $2 and kind = 'member'`, [
      userId,
      organizationId,
    ]);
    await recordInstallationEvent(q, at, kind, { actorAccountId: person?.accountId ?? null, organizationId, payload: {} });
  });
}
