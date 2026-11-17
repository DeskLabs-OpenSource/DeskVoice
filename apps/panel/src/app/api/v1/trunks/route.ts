import { encryptSecret } from "@deskvoice/core";
import { handle } from "../../../../server/context";
import { TRUNK_COLUMNS, trunkCreate } from "../../../../server/shapes";
import { applyTrunks, requireIpModeForAddresses, requireNumericInbound } from "./store";

export const GET = handle({}, ({ q }) => q.many(`select ${TRUNK_COLUMNS} from trunks order by name`));

export const POST = handle(
  {
    body: trunkCreate,
    configure: true,
    after: async (trunk: object | null, { deps, session }) => ({ ...trunk, ...(await applyTrunks(deps, session.organizationId)) }),
  },
  ({ q, body, deps }) => {
    requireIpModeForAddresses(body.authMode, body.outboundHost ?? null);
    requireNumericInbound(body.authMode, body.host, body.matchExtra ?? []);
    return q.one(
      `insert into trunks (organization_id, name, host, username, secret_enc, auth_mode, caller_id_e164, match_extra, outbound_host)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning ${TRUNK_COLUMNS}`,
      [
        q.organizationId,
        body.name,
        body.host,
        body.username ?? null,
        body.password ? encryptSecret(body.password, deps.secretKey) : null,
        body.authMode,
        body.callerId ?? null,
        body.matchExtra ?? [],
        body.outboundHost ?? null,
      ],
    );
  },
);
