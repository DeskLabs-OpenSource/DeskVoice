import { recordOrgEvent, type OrgQuery } from "@deskvoice/core";
import { transcriberConsentSetting, transcriberKeySettingOf, type PieceConsent } from "@deskvoice/voice-engine/pipeline-choice";
// Pelo caminho dos tipos: o índice do pacote carrega a descoberta por pasta, que não existe no pacote do Next.
import type { StreamingTranscriber } from "@deskvoice/voice-engine/types";
import { z } from "zod";
import { ApiError, type ServerDeps, type Session } from "./context";
import { consentView } from "./synthesizers";

/**
 * As peças de transcrição da pasta. `loadTranscribers()` lê a pasta em tempo de execução, e no pacote
 * do Next ela não existe (o mesmo motivo de `pieces.ts`, `brains.ts` e `synthesizers.ts`): a descoberta
 * é a mesma, por pasta, resolvida pelo empacotador. Um teste confere que as duas acham as mesmas peças.
 */
const transcriberModules = import.meta.glob<{ default: StreamingTranscriber }>([
  "../../../../packages/voice-engine/src/transcribers/*.ts",
  "!../../../../packages/voice-engine/src/transcribers/*.test.ts",
]);

let transcribers: Promise<StreamingTranscriber[]> | undefined;

export function listTranscribers(): Promise<StreamingTranscriber[]> {
  return (transcribers ??= Promise.all(Object.values(transcriberModules).map(async (load) => (await load()).default)));
}

/** As transcrições que a tela oferece: as de verdade. A simulada não tem chave nem fornecedor, e serve aos testes. */
export async function listOfferedTranscribers(): Promise<StreamingTranscriber[]> {
  return (await listTranscribers()).filter((piece) => piece.keyless !== true).toSorted((a, b) => a.label.localeCompare(b.label));
}

export async function offeredTranscriber(id: string): Promise<StreamingTranscriber> {
  const transcriber = (await listOfferedTranscribers()).find((candidate) => candidate.id === id);
  if (!transcriber) throw new ApiError(404, "not_found", "Not found.");
  return transcriber;
}

export interface TranscriberView {
  id: string;
  label: string;
  provider: string;
  processingLocation: StreamingTranscriber["processingLocation"];
  /** A organização tem a chave que a peça usa (a do motor OpenAI Realtime, na da OpenAI). Nunca o valor. */
  keyConfigured: boolean;
  /** Quem confirmou o envio do áudio e quando (seção 9.1). `name` nulo: a pessoa saiu da equipe. */
  consent: { name: string | null; at: string } | null;
}

export async function readTranscribers(q: OrgQuery): Promise<TranscriberView[]> {
  const views: TranscriberView[] = [];
  for (const transcriber of await listOfferedTranscribers()) {
    // Da chave, só se existe: o valor de segredo nunca sai do banco por aqui.
    const key = await q.one<{ found: boolean }>("select true as found from settings where key = $1", [transcriberKeySettingOf(transcriber)]);
    const consent = await q.one<{ value: unknown }>("select value from settings where key = $1", [transcriberConsentSetting(transcriber.id)]);
    views.push({
      id: transcriber.id,
      label: transcriber.label,
      provider: transcriber.provider,
      processingLocation: transcriber.processingLocation,
      keyConfigured: key !== null,
      consent: await consentView(q, consent?.value),
    });
  }
  return views;
}

export const transcriberConsentInput = z.object({
  /** O fornecedor que a pessoa leu na confirmação ("O áudio da pessoa na ligação vai para a OpenAI"). */
  confirmedProvider: z.string().trim().min(1).max(80).optional(),
});

/**
 * Grava a confirmação da transcrição de fora do servidor (seção 9.1, fatia 6). Ela pede
 * `confirmedProvider` igual ao fornecedor da peça: sem ele, 422, e nada é gravado. A confirmação e o
 * recibo `transcriber_provider_confirmed` saem juntos, na forma da voz da 1b. A peça que já está
 * confirmada não grava outro recibo.
 */
export async function confirmTranscriber(q: OrgQuery, deps: ServerDeps, session: Session, transcriber: StreamingTranscriber, body: z.output<typeof transcriberConsentInput>): Promise<void> {
  if (body.confirmedProvider !== transcriber.provider) {
    throw new ApiError(
      422,
      body.confirmedProvider === undefined ? "provider_confirmation_required" : "provider_confirmation_invalid",
      `${transcriber.label} receives the caller's audio, outside this server. Confirm it with confirmedProvider: "${transcriber.provider}".`,
    );
  }
  const current = await q.one<{ value: unknown }>("select value from settings where key = $1", [transcriberConsentSetting(transcriber.id)]);
  if (await consentView(q, current?.value)) return;
  const now = deps.clock.now();
  await q.exec(
    `insert into settings (organization_id, key, value, secret, updated_at) values ($1, $2, $3, false, $4)
     on conflict (organization_id, key) do update set value = excluded.value, secret = excluded.secret, updated_at = excluded.updated_at`,
    [q.organizationId, transcriberConsentSetting(transcriber.id), JSON.stringify({ userId: session.userId, confirmedAt: now.toISOString() } satisfies PieceConsent), now],
  );
  // O recibo, só de acréscimo, com o nome do momento (sem e-mail), como o da voz.
  await recordOrgEvent(q, "transcriber_provider_confirmed", { transcriberId: transcriber.id, provider: transcriber.provider, confirmedByName: session.name }, now, session.userId);
}

/** Apaga a confirmação. O recibo fica no Registro da privacidade. `false` quando não havia. */
export async function removeTranscriberConsent(q: OrgQuery, transcriber: StreamingTranscriber): Promise<boolean> {
  return (await q.many<{ key: string }>("delete from settings where key = $1 returning key", [transcriberConsentSetting(transcriber.id)])).length > 0;
}
