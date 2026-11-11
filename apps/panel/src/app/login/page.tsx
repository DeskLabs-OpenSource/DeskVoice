"use client";

import { Waveform } from "@phosphor-icons/react";
import { useState, type FormEvent } from "react";
import en from "../../i18n/en/login";
import es from "../../i18n/es/login";
import ptBR from "../../i18n/pt-BR/login";
import { useDict } from "../../i18n/provider";
import { api } from "../../ui/api";
import { useErrorText } from "../../ui/errors";
import { Button, Field, TextInput } from "../../ui/kit";
import { LocaleSelect } from "../../ui/shell";

export default function LoginPage() {
  const t = useDict(ptBR, en, es);
  const errorText = useErrorText();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      await api("/auth/login", { body: { email: form.get("email"), password: form.get("password") } });
      window.location.assign("/calls");
    } catch (failure) {
      setError(errorText(failure));
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto grid min-h-dvh max-w-[1040px] content-center gap-12 px-5 py-10 md:grid-cols-[minmax(0,380px)_minmax(0,1fr)] md:gap-20">
      <div className="rise grid content-center gap-8">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-[1.2rem] font-bold tracking-[-0.01em]">
            <Waveform size={28} weight="duotone" className="text-accent" aria-hidden />
            DeskVoice
          </span>
          <LocaleSelect />
        </div>
        <div className="grid gap-1">
          <h1 className="text-[1.75rem] leading-tight font-bold tracking-[-0.01em]">{t.title}</h1>
          <p className="text-muted">{t.lead}</p>
        </div>
        <form onSubmit={(event) => void submit(event)} className="grid gap-4">
          <Field label={t.email}>
            <TextInput name="email" type="email" autoComplete="username" required autoFocus />
          </Field>
          <Field label={t.password} error={error}>
            <TextInput name="password" type="password" autoComplete="current-password" required />
          </Field>
          <Button type="submit" variant="primary" busy={busy} className="mt-2">
            {t.submit}
          </Button>
        </form>
        <p className="text-[0.87rem] text-muted">{t.forgot}</p>
      </div>

      {/* O fio da linha do tempo, que é a assinatura do produto, contando o que ele faz. */}
      <ol className="thread hidden content-center md:grid" data-live="true" data-layout="left">
        {t.story.map((line, index) => {
          const last = index === t.story.length - 1;
          return (
            <li key={line} className="grid grid-cols-[var(--node)_minmax(0,1fr)] items-center gap-4">
              <span className="thread-node" data-tone={last ? "accent" : index % 2 === 0 ? "speech" : "speech-agent"}>
                {last ? <span className="live-dot" /> : null}
              </span>
              <span className={`text-[1.33rem] leading-snug ${last ? "font-bold" : "text-muted"}`}>{line}</span>
            </li>
          );
        })}
      </ol>
    </main>
  );
}
