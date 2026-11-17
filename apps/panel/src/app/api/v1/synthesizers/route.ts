import { handle } from "../../../../server/context";
import { readSynthesizers } from "../../../../server/synthesizers";

/** As vozes que pedem chave, com o estado da chave e da confirmação de cada uma. Da chave, só se existe. */
export const GET = handle({ configure: true }, async ({ q }) => readSynthesizers(q));
