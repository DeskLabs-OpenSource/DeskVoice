"use client";

import { useState } from "react";
import en from "../i18n/en/common";
import es from "../i18n/es/common";
import ptBR from "../i18n/pt-BR/common";
import { useDict } from "../i18n/provider";
import { ApiFailure } from "./api";
import { Notice } from "./kit";
import { useCanConfigure } from "./me";

// Códigos cuja mensagem da API traz o detalhe que a pessoa precisa (qual campo, quais números).
const WITH_DETAIL = new Set(["validation_error", "invalid_numbers"]);

/** Traduz uma falha da API para a frase da tela: o que aconteceu e o que fazer. */
export function useErrorText(): (error: unknown) => string {
  const t = useDict(ptBR, en, es).errors;
  return (error) => {
    if (!(error instanceof ApiFailure)) return t.fallback;
    const text = Object.hasOwn(t, error.code) ? t[error.code as keyof typeof t] : t.fallback;
    return WITH_DETAIL.has(error.code) ? `${text} ${error.message}` : text;
  };
}

export interface Action {
  busy: boolean;
  error: string;
  done: boolean;
  /** Roda a ação; devolve `true` se deu certo. O erro fica em `error`, já na frase da tela. */
  run(task: () => Promise<unknown>): Promise<boolean>;
}

/** Estado de um botão que salva: ocupado, erro e "salvo". */
export function useAction(): Action {
  const errorText = useErrorText();
  const [state, setState] = useState({ busy: false, error: "", done: false });
  const run = async (task: () => Promise<unknown>): Promise<boolean> => {
    setState({ busy: true, error: "", done: false });
    try {
      await task();
      setState({ busy: false, error: "", done: true });
      return true;
    } catch (failure) {
      setState({ busy: false, error: errorText(failure), done: false });
      return false;
    }
  };
  return { ...state, run };
}

/** O que aconteceu com a última ação: o erro, ou um "Salvo." sóbrio. */
export function ActionStatus({ action }: { action: Action }) {
  const t = useDict(ptBR, en, es);
  if (action.error) return <Notice tone="fail">{action.error}</Notice>;
  return action.done ? (
    <span role="status" className="text-ok">
      {t.actions.saved}
    </span>
  ) : null;
}

/** Aviso para o operador nas telas de configuração. */
export function ReadOnlyNotice() {
  const t = useDict(ptBR, en, es);
  return useCanConfigure() ? null : <Notice>{t.readOnly}</Notice>;
}
