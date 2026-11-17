/**
 * O que a bancada usa de fora, sem dependência nova no `package.json` da raiz.
 *
 * `zod` e `ws` são dependências de `packages/voice-engine`, que os motores já usam. A bancada os
 * pega de lá, em vez de acrescentá-los à raiz: a versão é a mesma dos motores, e o lockfile não
 * muda. Os tipos do `ws` vêm do `@types/ws` que a raiz já tem.
 */
import { createRequire } from "node:module";
import type * as Ws from "ws";

export { z } from "../../packages/voice-engine/node_modules/zod";

const doMotor = createRequire(new URL("../../packages/voice-engine/package.json", import.meta.url));

/** O módulo `ws` do `voice-engine`: `ws.WebSocket` (cliente) e `ws.WebSocketServer` (só nos testes). */
export const ws = doMotor("ws") as typeof Ws;
export type WebSocket = Ws.WebSocket;
export type RawData = Ws.RawData;
