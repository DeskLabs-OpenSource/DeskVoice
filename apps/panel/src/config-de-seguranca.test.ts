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
    expect(grupos.length).toBeGreaterThan(0);
    // Um `source` mais estreito deixaria rotas sem cabeçalho sem ninguém notar.
    expect(grupos.map((grupo) => grupo.source)).toEqual(["/:path*"]);

    const porNome = new Map(grupos.flatMap((grupo) => grupo.headers).map((h) => [h.key.toLowerCase(), h.value]));

    expect(porNome.get("x-frame-options")).toBe("DENY");
    const csp = porNome.get("content-security-policy") ?? "";
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    // A CSP é curta de propósito: restringir script-src sem nonce quebraria o bootstrap do Next.
    expect(csp).not.toContain("script-src");

    expect(porNome.get("x-content-type-options")).toBe("nosniff");
    expect(porNome.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(porNome.get("strict-transport-security")).toMatch(/^max-age=\d{8,}/);
    expect(porNome.get("permissions-policy")).toContain("camera=()");
  });
});
