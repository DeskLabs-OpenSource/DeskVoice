"use client";

import { useCallback, useEffect, useState } from "react";

export class ApiFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

type Envelope<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

/** Chama a API do painel e devolve `data`; qualquer falha vira `ApiFailure` com o código da API. */
export async function api<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  let response: Response;
  let envelope: Envelope<T>;
  try {
    response = await fetch(`/api/v1${path}`, {
      method: options.method ?? (options.body === undefined ? "GET" : "POST"),
      headers: options.body === undefined ? undefined : { "content-type": "application/json" },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    envelope = (await response.json()) as Envelope<T>;
  } catch (error) {
    throw new ApiFailure("network", error instanceof Error ? error.message : String(error), 0);
  }
  if (envelope.ok) return envelope.data;
  // Sessão vencida no meio do uso: volta para a entrada em vez de mostrar erro em cada bloco.
  if (response.status === 401 && !path.startsWith("/auth/")) window.location.assign("/login");
  throw new ApiFailure(envelope.error.code, envelope.error.message, response.status);
}

export interface Loaded<T> {
  data: T | undefined;
  error: ApiFailure | undefined;
  reload(): void;
}

/** Carrega um recurso e o mantém na tela enquanto recarrega: atualização ao vivo não pisca. */
export function useApi<T>(path: string | null): Loaded<T> {
  const [state, setState] = useState<{ path: string | null; data?: T; error?: ApiFailure }>({ path });
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (path === null) return;
    let current = true;
    api<T>(path).then(
      (data) => current && setState({ path, data }),
      (error: ApiFailure) => current && setState((previous) => ({ path, data: previous.path === path ? previous.data : undefined, error })),
    );
    return () => {
      current = false;
    };
  }, [path, version]);
  const reload = useCallback(() => setVersion((value) => value + 1), []);
  return { data: state.path === path ? state.data : undefined, error: state.path === path ? state.error : undefined, reload };
}
