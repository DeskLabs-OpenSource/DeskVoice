import path from "node:path";
import type { NextConfig } from "next";

const config: NextConfig = {
  output: "standalone",
  devIndicators: false,
  transpilePackages: ["@deskvoice/core", "@deskvoice/tools", "@deskvoice/voice-engine"],
  // A raiz é o monorepo: os pacotes `@deskvoice/*` e as pastas de motores e ferramentas ficam fora de apps/panel.
  turbopack: { root: path.resolve(import.meta.dirname, "../..") },
  outputFileTracingRoot: path.resolve(import.meta.dirname, "../.."),
  // A construção confere os tipos só do que vai para a imagem. Os testes ficam com `pnpm typecheck`,
  // que lê o tsconfig.json inteiro: há teste do painel que sobe a API interna da voz, e a imagem do
  // painel não leva apps/voice.
  typescript: { tsconfigPath: "tsconfig.build.json" },
  // Cabeçalhos de segurança da origem. O Cloudflare na frente cuida de parte disso, mas o painel
  // também é alcançado por 127.0.0.1:3080 e por qualquer proxy que a instalação coloque adiante —
  // e quem responde pelo iframe e pelo MIME é o Next, não o CDN.
  //
  // A CSP é deliberadamente curta: `frame-ancestors` fecha o clickjacking, `base-uri` impede que
  // uma tag injetada mude a base dos links relativos, e `form-action` impede que um formulário forje
  // o POST de login para fora. Não restringimos `script-src`/`style-src` porque o Next injeta
  // scripts inline de bootstrap e o painel abre WebSocket: uma política sem nonce quebraria a tela, e
  // política que quebra acaba desligada. O que fecha o resto é `nosniff` e a política de referência.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Ninguém embute o painel: os botões de transferir, apagar e atualizar ficam a um clique.
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'" },
          // O painel serve só os tipos que gera: um upload que adivinhe HTML não vira página.
          { key: "X-Content-Type-Options", value: "nosniff" },
          // O caminho da tela pode carregar id de chamada; não vai inteiro para fora do domínio.
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
          // O painel não usa câmera, microfone nem localização — e quem abrir não deve poder pedir.
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default config;
