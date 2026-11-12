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
};

export default config;
