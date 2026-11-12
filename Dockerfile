# Um Dockerfile, três alvos: panel, voice, routines.
# Os workers rodam TypeScript direto com tsx; o painel é compilado pelo Next.

FROM node:22.23.5-alpine@sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a AS base
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/
COPY packages/voice-engine/package.json packages/voice-engine/
COPY packages/tools/package.json packages/tools/
COPY apps/voice/package.json apps/voice/
COPY apps/routines/package.json apps/routines/
COPY apps/panel/package.json apps/panel/
RUN pnpm install --frozen-lockfile
COPY tsconfig.json ./
COPY packages ./packages
COPY db ./db

FROM base AS routines
COPY apps/routines ./apps/routines
# A versão por último: declarada antes, invalidaria o cache da instalação a cada release.
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION NODE_ENV=production
CMD ["pnpm", "--filter", "@deskvoice/routines", "start"]

FROM base AS voice
COPY apps/voice ./apps/voice
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION NODE_ENV=production
EXPOSE 9092 8090
CMD ["pnpm", "--filter", "@deskvoice/voice", "start"]

FROM base AS panel-build
COPY apps/panel ./apps/panel
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @deskvoice/panel build

FROM node:22.23.5-alpine@sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a AS panel
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=panel-build /app/apps/panel/.next/standalone ./
COPY --from=panel-build /app/apps/panel/.next/static ./apps/panel/.next/static
COPY --from=panel-build /app/apps/panel/public ./apps/panel/public
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION
EXPOSE 3000
CMD ["node", "apps/panel/server.js"]
