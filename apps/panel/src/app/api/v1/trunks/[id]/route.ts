import { encryptSecret } from "@deskvoice/core";
import { ApiError, handle, notFound } from "../../../../../server/context";
import { TRUNK_COLUMNS, trunkPatch } from "../../../../../server/shapes";
import { applyTrunks } from "../store";

export const PATCH = handle(
  {
    body: trunkPatch,
    configure: true,
    after: async (trunk: object | null, { deps, session }) => ({ ...trunk, ...(await applyTrunks(deps, session.organizationId)) }),
  },
  async ({ q, params, body, deps }) => {
    const current = await q.one<{ name: string; host: string; username: string | null; secretEnc: string | null; authMode: string; callerId: string | null }>(
      `select name, host, username, secret_enc as "secretEnc", auth_mode as "authMode", caller_id_e164 as "callerId" from trunks where id = $1`,
      [params.id],
    );
    if (!current) throw notFound();
    const { password, ...rest } = body;
    const merged = { ...current, ...rest };
    // A senha gravada só vale para o destino para o qual foi digitada. Sem isso, quem pode editar a
    // linha apontava o host para um servidor seu e recebia, no registro, a senha do provedor.
    const sameDestination = merged.host === current.host && merged.username === current.username && merged.authMode === current.authMode;
    let secretEnc = password ? encryptSecret(password, deps.secretKey) : current.secretEnc;
    if (!password && !sameDestination && current.secretEnc !== null) {
      // Autenticação por IP não usa senha: em vez de pedir uma, a antiga é apagada.
      if (merged.authMode !== "ip") throw new ApiError(400, "password_required", "When the provider address or the user changes, enter the password again.");
      secretEnc = null;
    }
    const next = { ...merged, secretEnc };
    // Linha alterada volta a "não verificada": o teste anterior valia para a configuração antiga.
    return q.one(
      `update trunks set name = $2, host = $3, username = $4, secret_enc = $5, auth_mode = $6, caller_id_e164 = $7, status = 'unverified'
        where id = $1 returning ${TRUNK_COLUMNS}`,
      [params.id, next.name, next.host, next.username, next.secretEnc, next.authMode, next.callerId],
    );
  },
);
