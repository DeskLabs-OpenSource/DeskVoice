import { modifyRouteRegex } from "next/dist/lib/redirect-status";
import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match";
import { describe, expect, it } from "vitest";
import config from "../next.config";

/**
 * Os cabeçalhos vivem na configuração do Next, que só é exercitada num servidor de verdade: um erro
 * aqui não aparece em teste de componente nem em typecheck, e chegaria em produção com o painel
 * aceitando ser embutido. Este teste lê a mesma função que o Next lê no boot.
 */
describe("cabeçalhos de segurança do painel", () => {
  it("protege toda resposta contra iframe, MIME adivinhado e formulário forjado", async () => {
    const grupos = (await config.headers?.()) ?? [];
    // Um `source` mais estreito deixaria rotas sem cabeçalho sem ninguém notar.
    const todas = grupos.find((grupo) => grupo.source === "/:path*");
    const porNome = new Map((todas?.headers ?? []).map((h) => [h.key.toLowerCase(), h.value]));

    expect(porNome.get("x-frame-options")).toBe("DENY");
    const csp = porNome.get("content-security-policy") ?? "";
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    // A CSP é curta de propósito: restringir script-src sem nonce quebraria o bootstrap do Next.
    expect(csp).not.toContain("script-src");

    expect(porNome.get("x-content-type-options")).toBe("nosniff");
    // Sem includeSubDomains: o painel não decide pelos outros subdomínios de quem instala.
    expect(porNome.get("strict-transport-security")).toMatch(/^max-age=\d{8,}$/);

    // "Falar com o agente" pede o microfone na própria origem: `microphone=()` desligaria a tela.
    const permissoes = (porNome.get("permissions-policy") ?? "").split(",").map((item) => item.trim());
    expect(permissoes).toContain("microphone=(self)");
    expect(permissoes).toContain("camera=()");
    expect(permissoes).toContain("geolocation=()");
  });

  it("manda a política de referência em toda tela, menos no link público, que declara no-referrer", async () => {
    const grupos = (await config.headers?.()) ?? [];
    const comReferencia = grupos.filter((grupo) => grupo.headers.some((h) => h.key.toLowerCase() === "referrer-policy"));
    expect(comReferencia.flatMap((grupo) => grupo.headers.map((h) => [h.key, h.value]))).toEqual([["Referrer-Policy", "strict-origin-when-cross-origin"]]);

    // O mesmo casamento que o Next monta para um `source` de cabeçalho (server/lib/router-utils/filesystem.js).
    const casa = getPathMatch(comReferencia[0]?.source ?? "", { strict: true, removeUnnamedParams: true, regexModifier: (regex) => modifyRouteRegex(regex) });
    for (const caminho of ["/", "/calls", "/calls/talk", "/settings", "/sobre", "/api/v1/calls"]) expect(casa(caminho), caminho).not.toBe(false);
    for (const caminho of ["/s/abc", "/s/abc/audio"]) expect(casa(caminho), caminho).toBe(false);
  });
});
