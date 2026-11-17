"use client";

import en from "../../../i18n/en/installation";
import es from "../../../i18n/es/installation";
import ptBR from "../../../i18n/pt-BR/installation";
import { useDict } from "../../../i18n/provider";
import { ApiFailure } from "../../../ui/api";
import { useState } from "react";
import { useErrorText, type Action } from "../../../ui/errors";

/** A frase de uma falha da área: as recusas próprias dela vêm do dicionário dela, as outras do comum. */
export function useInstallationErrorText(): (error: unknown) => string {
  const t = useDict(ptBR, en, es).errors;
  const common = useErrorText();
  return (error) => (error instanceof ApiFailure && Object.hasOwn(t, error.code) ? t[error.code as keyof typeof t] : common(error));
}

/** `useAction` com as frases da área. */
export function useInstallationAction(): Action {
  const errorText = useInstallationErrorText();
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
