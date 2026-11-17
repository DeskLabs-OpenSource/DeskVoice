import type { SpeechSynthesizer } from "@deskvoice/voice-engine/types";
import { ApiError, handle } from "../../../../../../server/context";
import { offeredSynthesizer, removeSynthesizerKey, saveSynthesizerKey, storedSynthesizerKey, synthesizerKeyInput, testSynthesizerKey } from "../../../../../../server/synthesizers";

interface Saved {
  synthesizer: SpeechSynthesizer;
  /** A chave em vigor, cifrada: é testada depois da gravação e nunca vai na resposta. */
  stored: string;
}

/**
 * Grava a chave da voz, com a confirmação nomeando o fornecedor (desenho R5, seção 9.1), e a testa em
 * seguida, fora da transação. Sem a confirmação, 422 e nada é gravado. O teste nunca impede a
 * gravação; `check: null` diz que o limite de testes o adiou.
 */
export const PUT = handle(
  {
    body: synthesizerKeyInput,
    configure: true,
    after: async ({ synthesizer, stored }: Saved, { deps, session, org }) => ({ configured: true, check: await testSynthesizerKey(deps, org, session.organizationId, synthesizer, stored) }),
  },
  async ({ q, params, body, deps, session }): Promise<Saved> => {
    const synthesizer = await offeredSynthesizer(params.synthesizer ?? "");
    return { synthesizer, stored: await saveSynthesizerKey(q, deps, session, synthesizer, body) };
  },
);

/** Testa de novo a chave salva. Não pede confirmação e não grava recibo: a chave é a mesma. */
export const POST = handle(
  {
    configure: true,
    after: async ({ synthesizer, stored }: Saved, { deps, session, org }) => ({ configured: true, check: await testSynthesizerKey(deps, org, session.organizationId, synthesizer, stored) }),
  },
  async ({ q, params }): Promise<Saved> => {
    const synthesizer = await offeredSynthesizer(params.synthesizer ?? "");
    const stored = await storedSynthesizerKey(q, synthesizer);
    if (!stored) throw new ApiError(409, "synthesizer_key_missing", `${synthesizer.label} has no key saved.`);
    return { synthesizer, stored };
  },
);

/** Remove a chave, o último teste e a confirmação. O recibo da confirmação fica no Registro. */
export const DELETE = handle({ configure: true }, async ({ q, params }) => {
  await removeSynthesizerKey(q, await offeredSynthesizer(params.synthesizer ?? ""));
  return { configured: false };
});
