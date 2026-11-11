import { withSystem } from "@deskvoice/core";
import { ApiError, handlePublic } from "../../../../../server/context";
import { voiceHealthSchema, voiceRequest } from "../../../../../server/voice";

type Check = { status: "ok" | "warn" | "fail"; detail: string };

/**
 * Pública: o instalador e o `healthcheck.sh` chamam sem sessão. Por isso só devolve estado e uma
 * frase por peça, nunca endereço, nome de linha ou conteúdo de configuração. É também o motivo
 * de usar `withSystem`: sem sessão não há organização para abrir `withOrg`.
 */
export const GET = handlePublic({}, async ({ deps }) => {
  let database: Check = { status: "ok", detail: "respondendo" };
  let engine: Check = { status: "warn", detail: "nenhum motor de voz configurado" };
  try {
    const row = await withSystem(deps.db, (q) => q.one<{ keys: number }>("select count(*)::int as keys from settings where secret and key like 'engine.%.api_key'"));
    if ((row?.keys ?? 0) > 0) engine = { status: "ok", detail: "chave de motor de voz cadastrada" };
  } catch {
    database = { status: "fail", detail: "o banco não respondeu" };
    engine = { status: "fail", detail: "não foi possível consultar a configuração" };
  }

  let asterisk: Check;
  let trunk: Check;
  try {
    const voice = await voiceRequest(deps, "GET", "/health", voiceHealthSchema);
    asterisk = { status: voice.asterisk.status, detail: voice.asterisk.status === "ok" ? "respondendo" : "com problema" };
    const down = voice.trunks.filter((line) => line.status !== "ok").length;
    if (voice.trunks.length === 0) trunk = { status: "warn", detail: "nenhuma linha cadastrada" };
    else if (down === 0) trunk = { status: "ok", detail: "linha conectada" };
    else trunk = { status: voice.trunks.some((line) => line.status === "fail") ? "fail" : "warn", detail: `${down} de ${voice.trunks.length} linha(s) com problema` };
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    asterisk = { status: "fail", detail: "o processo de voz não respondeu" };
    trunk = { status: "fail", detail: "sem resposta do processo de voz" };
  }

  return { panel: { status: "ok", detail: "respondendo" } satisfies Check, database, asterisk, trunk, engine };
});
