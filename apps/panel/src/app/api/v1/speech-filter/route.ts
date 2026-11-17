import { handle } from "../../../../server/context";
import { readSpeechFilter, saveSpeechFilter, speechFilterInput } from "./store";

/** O filtro da fala: o modelo ligado, quem confirmou o envio e quando, e a chave de cada modelo (só se existe). Todo papel lê. */
export const GET = handle({}, ({ q }) => readSpeechFilter(q));

/** Liga, troca ou desliga o filtro. Só dono e administrador. */
export const PUT = handle({ body: speechFilterInput, configure: true }, ({ q, body, session, deps }) => saveSpeechFilter(q, session, deps.clock.now(), body));
