"use client";

import { Waveform } from "@phosphor-icons/react";
import Link from "next/link";
import { use, useEffect, useState, type FormEvent } from "react";
import en from "../../../i18n/en/invite";
import enTeam from "../../../i18n/en/team";
import es from "../../../i18n/es/invite";
import esTeam from "../../../i18n/es/team";
import { fill } from "../../../i18n/locales";
import ptBR from "../../../i18n/pt-BR/invite";
import ptBRTeam from "../../../i18n/pt-BR/team";
import { useDict } from "../../../i18n/provider";
import { ApiFailure, api } from "../../../ui/api";
import { useErrorText } from "../../../ui/errors";
import { Button, Field, Notice, Skeleton, TextInput } from "../../../ui/kit";
import { LocaleSelect } from "../../../ui/shell";
import type { Role } from "../../../ui/types";

interface Invite {
  organizationName: string;
  email: string;
  name: string;
  role: Role;
}

/** Pública: quem chega aqui ainda não tem conta. Mesmo visual da tela de entrada. */
export default function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const t = useDict(ptBR, en, es);
  const roles = useDict(ptBRTeam, enTeam, esTeam).roles;
  const errorText = useErrorText();
  const [invite, setInvite] = useState<Invite | null>(null);
  const [problem, setProblem] = useState<ApiFailure | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api<Invite>(`/invites/${encodeURIComponent(token)}`).then(
      (found) => {
        setInvite(found);
        setName(found.name);
      },
      (failure: ApiFailure) => setProblem(failure),
    );
  }, [token]);

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (form.get("password") !== form.get("repeat")) return setError(t.mismatch);
    setBusy(true);
    setError("");
    try {
      await api(`/invites/${encodeURIComponent(token)}/accept`, { body: { name, password: form.get("password") } });
      window.location.assign("/calls");
    } catch (failure) {
      // O convite deixou de valer no meio do caminho: a tela vira a explicação única.
      if (failure instanceof ApiFailure && failure.code === "invite_invalid") setProblem(failure);
      else setError(errorText(failure));
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto grid min-h-dvh max-w-[440px] content-center gap-8 px-5 py-10">
      <div className="rise grid gap-8">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-[1.2rem] font-bold tracking-[-0.01em]">
            <Waveform size={28} weight="duotone" className="text-accent" aria-hidden />
            DeskVoice
          </span>
          <LocaleSelect />
        </div>

        {!invite && !problem ? <Skeleton lines={4} /> : null}

        {problem ? (
          problem.code === "invite_invalid" ? (
            <div className="grid gap-3">
              <h1 className="text-[1.75rem] leading-tight font-bold tracking-[-0.01em]">{t.invalidTitle}</h1>
              <p className="text-muted">{t.invalidBody}</p>
            </div>
          ) : (
            <Notice tone="fail">{errorText(problem)}</Notice>
          )
        ) : null}

        {invite && !problem ? (
          <>
            <div className="grid gap-1">
              <h1 className="text-[1.75rem] leading-tight font-bold tracking-[-0.01em]">{t.title}</h1>
              <p className="text-muted">{fill(t.lead, { organization: invite.organizationName })}</p>
            </div>
            <dl className="grid gap-3 border-y border-line py-4">
              {[
                [t.company, invite.organizationName],
                [t.email, invite.email],
                [t.role, roles[invite.role]],
              ].map(([label, value]) => (
                <div key={label} className="grid grid-cols-[6rem_minmax(0,1fr)] gap-3">
                  <dt className="text-[0.87rem] font-bold text-muted">{label}</dt>
                  <dd className="truncate">{value}</dd>
                </div>
              ))}
            </dl>
            <form onSubmit={(event) => void submit(event)} className="grid gap-4">
              <Field label={t.name}>
                <TextInput value={name} onChange={(event) => setName(event.target.value)} required maxLength={120} autoComplete="name" />
              </Field>
              <Field label={t.password} hint={t.passwordHint}>
                <TextInput name="password" type="password" minLength={10} required autoComplete="new-password" />
              </Field>
              <Field label={t.repeat} error={error}>
                <TextInput name="repeat" type="password" minLength={10} required autoComplete="new-password" />
              </Field>
              <Button type="submit" variant="primary" busy={busy} className="mt-2">
                {t.submit}
              </Button>
            </form>
          </>
        ) : null}

        <Link href="/login" className="justify-self-start text-[0.87rem] text-muted underline underline-offset-4 hover:text-ink">
          {t.signIn}
        </Link>
      </div>
    </main>
  );
}
