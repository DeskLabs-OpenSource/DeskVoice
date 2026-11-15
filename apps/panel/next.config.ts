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
  // Cabeçalhos de segurança da origem. Nem toda instalação tem um proxy que os acrescente (sem
  // domínio, o painel sai só por HTTP em 127.0.0.1:3080), e quem responde pelo iframe e pelo MIME é
  // o Next, não o que estiver na frente dele.
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
          // Sem `includeSubDomains`: o painel pode estar no domínio principal da empresa, e não sabe o
          // que mais mora embaixo dele. Por HTTP e em endereço IP o navegador ignora este cabeçalho
          // (RFC 6797, seção 8.1), então a instalação sem domínio, aberta por túnel, não muda.
          { key: "Strict-Transport-Security", value: "max-age=31536000" },
          // O microfone fica só para o próprio painel: "Falar com o agente" (audio/call.ts) depende dele.
          // Câmera e localização o painel não usa, e nenhuma página embutida pode pedir.
          { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=()" },
        ],
      },
      {
        // O caminho da tela pode carregar id de chamada; não vai inteiro para fora do domínio. O link
        // público (/s/...) fica de fora porque declara `no-referrer` por conta própria, e o cabeçalho
        // daqui venceria o da rota.
        source: "/:path((?!s/).*)",
        headers: [{ key: "Referrer-Policy", value: "strict-origin-when-cross-origin" }],
      },
    ];
  },
};

export default config;
