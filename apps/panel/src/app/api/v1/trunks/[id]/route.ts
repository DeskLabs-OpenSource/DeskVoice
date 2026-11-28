import { decryptSecret, encryptSecret, trunkEntersGroups } from "@deskvoice/core";
import { ApiError, handle, notFound } from "../../../../../server/context";
import { TRUNK_COLUMNS, trunkPatch } from "../../../../../server/shapes";
import { applyTrunks, requireIpModeForAddresses, requireNumericInbound, requireOverlapConfirmed } from "../store";

export const PATCH = handle(
  {
    support: false,
    body: trunkPatch,
    configure: true,
    after: async (trunk: object | null, { deps, session }) => ({ ...trunk, ...(await applyTrunks(deps, session.organizationId)) }),
  },
  async ({ q, params, body, deps, session }) => {
    const current = await q.one<{
      name: string;
      host: string;
      username: string | null;
      secretEnc: string | null;
      authMode: "register" | "ip";
      callerId: string | null;
      matchExtra: string[];
      outboundHost: string | null;
    }>(
      `select name, host, username, secret_enc as "secretEnc", auth_mode as "authMode", caller_id_e164 as "callerId",
              match_extra as "matchExtra", outbound_host as "outboundHost" from trunks where id = $1`,
      [params.id],
    );
    if (!current) throw notFound();
    const { password, confirmOverlap, ...rest } = body;
    const merged = { ...current, ...rest };
    requireIpModeForAddresses(merged.authMode, merged.outboundHost ?? null);
    requireNumericInbound(merged.authMode, merged.host, merged.matchExtra ?? []);
    // A senha gravada só vale para o destino para o qual foi digitada. Sem isso, quem pode editar a
    // linha apontava o host para um servidor seu e recebia, no registro, a senha do provedor.
    const sameDestination = merged.host === current.host && merged.username === current.username && merged.authMode === current.authMode;
    let secretEnc = password ? encryptSecret(password, deps.secretKey) : current.secretEnc;
    if (!password && !sameDestination && current.secretEnc !== null) {
      // Autenticação por IP não usa senha: em vez de pedir uma, a antiga é apagada.
      if (merged.authMode !== "ip") throw new ApiError(400, "password_required", "When the provider address or the user changes, enter the password again.");
      secretEnc = null;
    }
    // Por último, depois de toda recusa que não depende da faixa: a confirmação grava o evento de
    // que a gravação seguiu, e nada depois dela pode recusar a gravação.
    // Confere a edição que faz a linha passar a entrar no agrupamento (a senha que faltava, o
    // usuário, o destino de saída válido, qualquer campo que `trunkEntersGroups` olhe) e a que mexe
    // no que agrupa uma linha que já está nele: o endereço, os extras ou o modo. A linha que fica
    // de fora, ou sai, não tira outra do ar. Trocar o nome de uma linha que já está num grupo misto
    // não pergunta nada.
    const plain = (enc: string | null): string | null | undefined => {
      try {
        return enc === null ? null : decryptSecret(enc, deps.secretKey);
      } catch {
        return undefined; // Ilegível: o processo de voz deixa a linha de fora.
      }
    };
    const enters = (trunk: typeof merged, password: string | null | undefined): boolean =>
      password !== undefined && trunkEntersGroups({ ...trunk, matchExtra: trunk.matchExtra ?? [], outboundHost: trunk.outboundHost ?? null, password });
    const nextPassword = password ?? plain(secretEnc);
    const sameExtras = (merged.matchExtra ?? []).join("\n") === (current.matchExtra ?? []).join("\n");
    const sameGrouping = merged.host === current.host && merged.authMode === current.authMode && sameExtras;
    if (enters(merged, nextPassword) && (!sameGrouping || !enters(current, plain(current.secretEnc)))) {
      await requireOverlapConfirmed(
        deps,
        q.organizationId,
        session,
        { id: params.id, host: merged.host, authMode: merged.authMode, matchExtra: merged.matchExtra, username: merged.username, password: nextPassword ?? null, outboundHost: merged.outboundHost ?? null },
        confirmOverlap,
      );
    }
    const next = { ...merged, secretEnc };
    // Linha alterada volta a "não verificada": o teste anterior valia para a configuração antiga.
    // Trocar o `host` ou o modo zera o conjunto liberado e o que veio do nome (R14, contrato 7): o
    // conjunto do destino antigo não pode seguir liberado se o nome novo não resolver. Mudar só os
    // extras não zera nada: o processo de voz já os lê da linha atual. É a única escrita do painel
    // nessas colunas.
    return q.one(
      `update trunks set name = $2, host = $3, username = $4, secret_enc = $5, auth_mode = $6, caller_id_e164 = $7, match_extra = $8, outbound_host = $9, status = 'unverified',
              inbound_from_name = case when host is distinct from $3 or auth_mode is distinct from $6 then '{}' else inbound_from_name end,
              inbound_from_name_seen = case when host is distinct from $3 or auth_mode is distinct from $6 then '{}'::jsonb else inbound_from_name_seen end,
              inbound_allowed = case when host is distinct from $3 or auth_mode is distinct from $6 then '{}' else inbound_allowed end,
              inbound_resolved_at = case when host is distinct from $3 or auth_mode is distinct from $6 then null else inbound_resolved_at end
        where id = $1 returning ${TRUNK_COLUMNS}`,
      [params.id, next.name, next.host, next.username, next.secretEnc, next.authMode, next.callerId, next.matchExtra ?? [], next.outboundHost ?? null],
    );
  },
);

// Os números caem junto com a linha no banco (cascade), e número que some sem ninguém pedir é
// chamada que para de ser atendida. Por isso a linha só sai depois que os números dela saíram.
export const DELETE = handle(
  {
    configure: true,
    after: (_deleted, { deps, session }) => applyTrunks(deps, session.organizationId),
  },
  async ({ q, params }) => {
    const numbers = await q.one<{ total: number }>("select count(*)::int as total from phone_numbers where trunk_id = $1", [params.id]);
    const total = numbers?.total ?? 0;
    if (total > 0) throw new ApiError(409, "trunk_has_numbers", `This line still has ${total} number(s). Remove or move them before removing the line.`);
    if ((await q.exec("delete from trunks where id = $1", [params.id])) === 0) throw notFound();
    return null;
  },
);
