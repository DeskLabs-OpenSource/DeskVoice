"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";

export interface LiveSignal {
  callId: string;
  eventId: string;
}
type Listener = (signal: LiveSignal) => void;

const LiveContext = createContext<Set<Listener> | null>(null);

/** Uma conexão de SSE por aba, repartida entre os blocos da tela que querem saber de eventos. */
export function LiveProvider({ children }: { children: ReactNode }) {
  const [listeners] = useState(() => new Set<Listener>());
  useEffect(() => {
    const source = new EventSource("/api/v1/events/stream");
    source.onmessage = (message) => {
      const signal = JSON.parse(String(message.data)) as LiveSignal;
      for (const listener of listeners) listener(signal);
    };
    return () => source.close();
  }, [listeners]);
  return <LiveContext.Provider value={listeners}>{children}</LiveContext.Provider>;
}

/** Chama `onSignal` a cada evento de chamada da organização. */
export function useLive(onSignal: Listener): void {
  const listeners = useContext(LiveContext);
  const latest = useRef(onSignal);
  useEffect(() => {
    latest.current = onSignal;
  });
  useEffect(() => {
    if (!listeners) return;
    const listener: Listener = (signal) => latest.current(signal);
    listeners.add(listener);
    return () => void listeners.delete(listener);
  }, [listeners]);
}

/** Relógio da tela, para contagem regressiva e duração de chamada em curso. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
