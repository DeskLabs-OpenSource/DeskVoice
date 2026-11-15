import { access } from "node:fs/promises";
import { findLiveShare, recordingPath } from "@deskvoice/core";
import type { Metadata } from "next";
import { serverDeps } from "../../../server/context";
import { ShareView } from "./share-view";

// O endereço carrega o token: nada de índice de busca, nem de mandá-lo adiante como referência.
export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };

/**
 * A página pública do link de quem ligou. Abrir não gasta download: só o botão de baixar gasta.
 * Link inválido, vencido, revogado, esgotado, de chamada apagada ou sem o áudio no disco mostram a
 * mesma página de "não vale mais".
 */
export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const deps = serverDeps();
  const share = await findLiveShare(deps.db, token, deps.clock.now());
  const present =
    share !== null &&
    (await access(recordingPath(deps.recordingsDir, share.organizationId, share.callId)).then(
      () => true,
      () => false,
    ));
  return (
    <ShareView
      share={
        share && present
          ? {
              startedAt: share.startedAt.toISOString(),
              endedAt: share.endedAt?.toISOString() ?? null,
              expiresAt: share.expiresAt.toISOString(),
              left: share.maxUses - share.uses,
              download: `/s/${encodeURIComponent(token)}/audio`,
            }
          : null
      }
    />
  );
}
