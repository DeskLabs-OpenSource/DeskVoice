import { handle } from "../../../../server/context";
import { readTranscribers } from "../../../../server/transcribers";

/** As transcrições de verdade, com o estado da chave que usam e da confirmação da 9.1. Da chave, só se existe. */
export const GET = handle({ configure: true }, async ({ q }) => readTranscribers(q));
