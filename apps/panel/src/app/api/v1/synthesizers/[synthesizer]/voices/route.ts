import { decryptSecret } from "@deskvoice/core";
import type { SpeechSynthesizer } from "@deskvoice/voice-engine/types";
import { ApiError, handle } from "../../../../../../server/context";
import { offeredSynthesizer, sortVoices, storedSynthesizerKey, synthesizerVoicesLimiter } from "../../../../../../server/synthesizers";

interface Stored {
  synthesizer: SpeechSynthesizer;
  stored: string | null;
}

/**
 * As vozes que a conta já tem, lidas do fornecedor com a chave salva, pt-BR primeiro. Nada é guardado:
 * nem a lista, nem áudio. A amostra é o endereço que o fornecedor hospeda (`previewUrl`), que a tela
 * toca direto de lá, sem gastar crédito. A falha volta no vocabulário fechado, nunca o texto do fornecedor.
 */
export const GET = handle(
  {
    configure: true,
    after: async ({ synthesizer, stored }: Stored, { deps, session }) => {
      if (!stored) return { configured: false, voices: [], failure: null };
      if (!synthesizerVoicesLimiter.take(`${session.organizationId}:${synthesizer.id}`, deps.clock.now())) {
        throw new ApiError(429, "too_many_voice_reads", "Too many reads of this voice list. Wait a few minutes and try again.");
      }
      const result = await synthesizer.listVoices(decryptSecret(stored, deps.secretKey), { fetch: deps.fetch });
      if (!result.ok) return { configured: true, voices: [], failure: { result: result.failure, status: result.status } };
      return { configured: true, voices: sortVoices(result.voices), failure: null };
    },
  },
  async ({ q, params }): Promise<Stored> => {
    const synthesizer = await offeredSynthesizer(params.synthesizer ?? "");
    return { synthesizer, stored: await storedSynthesizerKey(q, synthesizer) };
  },
);
