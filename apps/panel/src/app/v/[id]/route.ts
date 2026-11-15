import { confirmCallerVerification, recordOrgEvent, withOrg, type Db } from "@deskvoice/core";
import { callerVerificationById } from "@deskvoice/core";
import { serverDeps } from "../../../server/context";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A página do titular: digitar o código que chegou no número de origem.
 *
 * É pública porque o titular não tem conta. O id é um UUID v4 (128 bits) e o código tem três
 * tentativas — o que se gasta para adivinhar não compensa. A resposta é uniforme: id inválido e id de
 * outra organização respondem igual, para a página não servir de oráculo do acervo.
 */
const page = (status: number, body: string): Response =>
  new Response(
    `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="robots" content="noindex"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Acesso à gravação</title><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;line-height:1.5">${body}</body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer", "x-robots-tag": "noindex" } },
  );

const form = (id: string, message = ""): string =>
  `<h1>Acesso à gravação</h1>${message ? `<p><strong>${message}</strong></p>` : ""}<p>Digite o código de 6 dígitos que enviamos ao número que fez a ligação.</p><form method="post" action="/v/${id}"><input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required style="font-size:1.5rem;letter-spacing:.3rem;padding:.5rem;width:10rem"><button type="submit" style="font-size:1rem;padding:.6rem 1rem;margin-left:.5rem">Entrar</button></form>`;

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;
  if (!UUID.test(id)) return page(404, "<h1>Código inválido ou expirado</h1>");
  const verification = await callerVerificationById(serverDeps().db, id);
  if (!verification) return page(404, "<h1>Código inválido ou expirado</h1>");
  return page(200, form(id));
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;
  if (!UUID.test(id)) return page(404, "<h1>Código inválido ou expirado</h1>");

  const body = await request.text();
  const code = (/code=(\d{6})/.exec(body)?.[1] ?? "").trim();
  const deps = serverDeps();
  const verification = await callerVerificationById(deps.db, id);
  if (!verification) return page(404, "<h1>Código inválido ou expirado</h1>");
  if (!/^\d{6}$/.test(code)) return page(400, form(id, "Informe os 6 dígitos."));

  const now = new Date();
  const result = await withOrg(deps.db, verification.organizationId, async (q) => {
    const outcome = await confirmCallerVerification(q, { id, code, now });
    await recordOrgEvent(q, outcome === "ok" ? "caller_verification_confirmed" : "caller_verification_failed", { callId: verification.callId, verificationId: id, outcome }, now);
    return outcome;
  });

  if (result !== "ok") {
    const message =
      result === "blocked"
        ? "Muitas tentativas. Peça um código novo a quem atendeu."
        : result === "expired"
          ? "O código expirou. Peça um novo."
          : "Código incorreto.";
    return page(403, form(id, message));
  }
  // 303: o navegador troca para GET, e o áudio não é baixado duas vezes por um reenvio de formulário.
  return new Response(null, { status: 303, headers: { location: `/v/${id}/audio`, "cache-control": "no-store" } });
}

/** Sem uso aqui, mas mantém o `Db` importado explícito para o próximo passo (expiração em lote). */
export type _Db = Db;
