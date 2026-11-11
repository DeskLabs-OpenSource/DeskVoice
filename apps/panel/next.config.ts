import path from "node:path";
import type { NextConfig } from "next";

const config: NextConfig = {
  output: "standalone",
  devIndicators: false,
  transpilePackages: ["@deskvoice/core", "@deskvoice/tools", "@deskvoice/voice-engine"],
  // A raiz é o monorepo: os pacotes `@deskvoice/*` e as pastas de motores e ferramentas ficam fora de apps/panel.
  turbopack: { root: path.resolve(import.meta.dirname, "../..") },
  outputFileTracingRoot: path.resolve(import.meta.dirname, "../.."),
};

export default config;
