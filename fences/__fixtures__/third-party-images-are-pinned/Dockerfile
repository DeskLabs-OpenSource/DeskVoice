FROM node:22-alpine AS base
RUN echo base

FROM base AS build
RUN echo build

FROM node:22.23.5-alpine AS runtime
COPY --from=build /app /app

FROM --platform=$BUILDPLATFORM node:22.23.5-alpine@sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a AS pinned

FROM scratch
