import { listen } from "@deskvoice/core";
import { failure, requireSession, serverDeps } from "../../../../../server/context";
import { createEventHub, type EventHub } from "../../../../../server/event-hub";

export const dynamic = "force-dynamic";

const HEARTBEAT_MS = 25_000;
const store = globalThis as { __deskvoiceEventHub?: EventHub };

export async function GET(request: Request): Promise<Response> {
  try {
    const deps = serverDeps();
    const session = await requireSession(request, deps);
    const hub = (store.__deskvoiceEventHub ??= createEventHub((onPayload, onError) => listen(deps.db, "call_events", onPayload, onError)));

    const encoder = new TextEncoder();
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    let finished = false;
    const send = (text: string): void => {
      if (!finished) controller?.enqueue(encoder.encode(text));
    };
    const unsubscribe = await hub.subscribe({
      organizationId: session.organizationId,
      onEvent: (event) => send(`data: ${JSON.stringify(event)}\n\n`),
      // A escuta do banco caiu: fecha o fluxo, e o navegador reconecta sozinho.
      onClose: () => void finish(true),
    });
    // Proxy costuma cortar conexão parada; o batimento também faz o servidor notar o cliente que sumiu.
    const heartbeat = setInterval(() => send(": beat\n\n"), HEARTBEAT_MS);
    const finish = async (closeStream: boolean): Promise<void> => {
      if (finished) return;
      finished = true;
      clearInterval(heartbeat);
      await unsubscribe();
      if (closeStream) controller?.close();
    };
    request.signal.addEventListener("abort", () => void finish(false), { once: true });

    const stream = new ReadableStream<Uint8Array>({
      start(streamController) {
        controller = streamController;
        send(": connected\n\n");
      },
      cancel: () => finish(false),
    });
    return new Response(stream, {
      headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", "x-accel-buffering": "no" },
    });
  } catch (error) {
    return failure(error);
  }
}
