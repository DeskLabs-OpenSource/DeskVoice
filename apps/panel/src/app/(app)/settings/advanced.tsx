"use client";

import { useEffect, useRef, type ReactNode } from "react";
import en from "../../../i18n/en/settings";
import es from "../../../i18n/es/settings";
import ptBR from "../../../i18n/pt-BR/settings";
import { useDict } from "../../../i18n/provider";

/** A âncora que abre o bloco: o aviso do agente que pede "Confiar no número" aponta para ela. */
export const ADVANCED_ANCHOR = "avancado";

/**
 * "Avançado": um `<details>` nativo, fechado ao abrir a tela, com os itens técnicos. Abre sozinho na
 * montagem quando o endereço traz `#avancado`; o `open` não fica preso ao estado, e a pessoa fecha.
 */
export function Advanced({ children }: { children: ReactNode }) {
  const t = useDict(ptBR, en, es);
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const details = ref.current;
    if (!details || window.location.hash !== `#${ADVANCED_ANCHOR}`) return;
    details.open = true;
    details.scrollIntoView({ block: "start" });
  }, []);
  return (
    <details ref={ref} id={ADVANCED_ANCHOR}>
      <summary className="cursor-pointer font-bold">{t.advanced}</summary>
      <div className="mt-4 grid gap-5">{children}</div>
    </details>
  );
}
