import { handle } from "../../../../../../server/context";
import { confirmTranscriber, offeredTranscriber, removeTranscriberConsent, transcriberConsentInput } from "../../../../../../server/transcribers";

/**
 * Confirma que o áudio de quem ligou vai para o fornecedor da transcrição (seção 9.1, fatia 6), com
 * `confirmedProvider`. Sem ele, 422 e nada é gravado. A peça não tem chave própria para gravar (a da
 * OpenAI usa a do motor), e por isso a confirmação tem esta rota.
 */
export const PUT = handle({ support: false, body: transcriberConsentInput, configure: true }, async ({ q, params, body, deps, session }) => {
  await confirmTranscriber(q, deps, session, await offeredTranscriber(params.transcriber ?? ""), body);
  return { confirmed: true };
});

/** Apaga a confirmação: o pipeline com esta transcrição deixa de abrir. O recibo fica no Registro. */
export const DELETE = handle({ configure: true }, async ({ q, params }) => {
  await removeTranscriberConsent(q, await offeredTranscriber(params.transcriber ?? ""));
  return { confirmed: false };
});
