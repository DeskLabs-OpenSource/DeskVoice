"use client";

import { useEffect, useState } from "react";
import commonEn from "../../../i18n/en/common";
import en from "../../../i18n/en/update";
import commonEs from "../../../i18n/es/common";
import es from "../../../i18n/es/update";
import { fill } from "../../../i18n/locales";
import commonPtBR from "../../../i18n/pt-BR/common";
import ptBR from "../../../i18n/pt-BR/update";
import { useDict, useLocale } from "../../../i18n/provider";
import { api, useApi } from "../../../ui/api";
import { useAction, useErrorText } from "../../../ui/errors";
import { formatDateTime } from "../../../ui/format";
import { Button, Field, Notice, Panel, Skeleton, TextInput, type Tone } from "../../../ui/kit";
import { useCanConfigure } from "../../../ui/me";

// Iguais em todo idioma: são comandos, não frases.
const INSTALL_AGENT = "sudo bash install/agent.sh --install";
const UPDATE_LOCAL = "git pull && bash install/install.sh --build";
const POLL_MS = 5000;

interface NoteItem {
  title: string;
  text: string;
}
interface Release {
  version: string;
  publishedAt: string | null;
  url: string;
  attention: NoteItem[];
  sections: Array<{ heading: string; items: NoteItem[] }>;
}
type Status = "requested" | "running" | "succeeded" | "nothing_to_do" | "rolled_back" | "failed" | "expired" | "superseded";
interface UpdateState {
  running: { version: string; updatable: boolean };
  agent: { lastSeenAt: string; version: string; targetVersion: string | null; responding: boolean; lastFailureAt: string | null; lastFailureDetail: string | null } | null;
  request: { status: Status; fromVersion: string; targetVersion: string; toVersion: string | null; detail: string | null; requestedAt: string; acceptedAt: string | null; finishedAt: string | null } | null;
  published: { ok: true; latest: string | null; newer: Release[] } | { ok: false };
  /** O que o SERVIDOR executaria: a versão que o agente anunciou, e as notas até ela. */
  offer: { target: string | null; notesReady: boolean; releases: Release[] };
}

const STATUS_TONE: Record<Status, Exclude<Tone, "accent">> = {
  requested: "neutral",
  running: "warn",
  succeeded: "ok",
  nothing_to_do: "neutral",
  rolled_back: "warn",
  failed: "fail",
  expired: "fail",
  superseded: "warn",
};

function Items({ items }: { items: NoteItem[] }) {
  return (
    <ul className="grid gap-2">
      {items.map((item, index) => (
        <li key={index} className="max-w-prose">
          {item.title ? <strong>{item.title}</strong> : null} {item.text}
        </li>
      ))}
    </ul>
  );
}

/**
 * Versão e atualização. A tela só mostra e pede: quem atualiza é o agente do servidor. A versão
 * em execução vem do processo do painel a cada consulta; nada aqui afirma "é a mais recente" a
 * partir de dado guardado.
 */
export function UpdatePanel() {
  const t = useDict(ptBR, en, es);
  const common = useDict(commonPtBR, commonEn, commonEs);
  const locale = useLocale();
  const errorText = useErrorText();
  const canConfigure = useCanConfigure();
  const state = useApi<UpdateState>("/system/update");
  const ask = useAction();
  const [confirming, setConfirming] = useState(false);
  const [password, setPassword] = useState("");
  const { data, reload } = state;
  const open = data?.request?.status === "requested" || data?.request?.status === "running";
  // Com pedido aberto a tela acompanha sozinha, inclusive enquanto o painel está fora do ar.
  useEffect(() => {
    if (!open) return;
    const timer = setInterval(reload, POLL_MS);
    return () => clearInterval(timer);
  }, [open, reload]);

  if (!data) return <Panel title={t.title}>{state.error ? <Notice tone="fail">{errorText(state.error)}</Notice> : <Skeleton lines={2} />}</Panel>;

  const { running, agent, request, published, offer } = data;
  const when = (iso: string | null): string => (iso ? formatDateTime(iso, locale) : "");
  const latest = published.ok ? published.latest : null;
  // O alvo é o que o agente anunciou: é para ele que o servidor vai, e é ele que a confirmação nomeia.
  const target = offer.target;
  const statusText = (): string => {
    if (!request) return "";
    const text = request.status === "expired" ? (request.acceptedAt ? t.status.expiredRun : t.status.expiredPickup) : t.status[request.status];
    return fill(text, { when: when(request.finishedAt ?? request.acceptedAt ?? request.requestedAt), from: request.fromVersion, to: request.toVersion ?? request.targetVersion });
  };

  return (
    <Panel title={t.title} description={t.lead}>
      <div className="grid gap-4">
        <dl className="grid gap-4 md:grid-cols-2">
          <div className="grid gap-1">
            <dt className="text-[0.87rem] font-bold">{t.running}</dt>
            <dd className="data text-[1.2rem]">{running.version}</dd>
          </div>
          <div className="grid gap-1">
            <dt className="text-[0.87rem] font-bold">{t.published}</dt>
            <dd className={published.ok && latest ? "data text-[1.2rem]" : "text-muted"}>{published.ok ? (latest ?? t.publishedNone) : t.publishedUnknown}</dd>
          </div>
        </dl>

        {!running.updatable ? (
          <Notice>
            <p>{fill(t.unsupported, { version: running.version })}</p>
            <code className="data">{UPDATE_LOCAL}</code>
          </Notice>
        ) : null}

        {running.updatable && !agent ? (
          <Notice tone="warn">
            <p>{t.agentNever}</p>
            <code className="data">{INSTALL_AGENT}</code>
          </Notice>
        ) : null}
        {running.updatable && agent && !agent.responding ? <Notice tone="warn">{fill(t.agentSilent, { when: when(agent.lastSeenAt) })}</Notice> : null}
        {agent?.responding ? <p className="text-muted">{fill(t.agentOk, { when: when(agent.lastSeenAt) })}</p> : null}
        {agent?.responding && agent.version !== running.version && !open ? <p className="text-muted">{fill(t.agentMismatch, { agent: agent.version, running: running.version })}</p> : null}
        {agent?.lastFailureAt && agent.lastFailureDetail ? <p className="text-muted">{fill(t.agentFailure, { when: when(agent.lastFailureAt), detail: agent.lastFailureDetail ?? "" })}</p> : null}

        {request ? (
          <Notice tone={STATUS_TONE[request.status]}>
            <p>{statusText()}</p>
            {request.detail ? (
              <details>
                <summary className="cursor-pointer font-bold">{t.detail}</summary>
                <pre className="data mt-2 max-h-80 overflow-auto whitespace-pre-wrap text-[0.87rem]">{request.detail}</pre>
              </details>
            ) : null}
          </Notice>
        ) : null}

        {running.updatable && agent?.responding && !target && !open ? <p className="text-muted">{t.upToDate}</p> : null}
        {running.updatable && target && !offer.notesReady ? <Notice tone="warn">{fill(t.notesMissing, { to: target })}</Notice> : null}

        {offer.releases.length > 0 && target ? (
          <div className="grid gap-4 border-t border-line pt-4">
            <h3 className="font-bold">{fill(t.notesTitle, { from: running.version, to: target })}</h3>
            {offer.releases.map((release) => (
              <article key={release.version} className="grid gap-3">
                <h4 className="font-bold">
                  <a className="underline" href={release.url} target="_blank" rel="noreferrer">
                    {fill(t.releaseOf, { version: release.version })}
                  </a>
                </h4>
                {release.attention.length > 0 ? (
                  <Notice tone="warn">
                    <strong>{t.attention}</strong>
                    <Items items={release.attention} />
                  </Notice>
                ) : null}
                {release.sections.map((section, index) => (
                  <div key={index} className="grid gap-2">
                    {section.heading ? <h5 className="text-[0.87rem] font-bold text-muted">{section.heading}</h5> : null}
                    <Items items={section.items} />
                  </div>
                ))}
              </article>
            ))}
          </div>
        ) : null}

        {canConfigure && running.updatable && target && offer.notesReady && !open && !confirming ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" onClick={() => setConfirming(true)}>
              {fill(t.start, { to: target })}
            </Button>
          </div>
        ) : null}
        {canConfigure && running.updatable && target && offer.notesReady && !open && confirming ? (
          <Notice tone="fail">
            <p>{fill(t.confirm, { from: running.version, to: target })}</p>
            <form
              className="mt-1 grid gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                void ask.run(() => api("/system/update", { body: { password, target } })).then((ok) => {
                  setPassword("");
                  if (ok) setConfirming(false);
                  reload();
                });
              }}
            >
              <div className="max-w-xs">
                <Field label={t.password} hint={t.passwordHint}>
                  <TextInput type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
                </Field>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" variant="danger" busy={ask.busy}>
                  {fill(t.confirmYes, { from: running.version, to: target })}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setConfirming(false);
                    setPassword("");
                  }}
                >
                  {common.actions.cancel}
                </Button>
              </div>
              {ask.error ? <Notice tone="fail">{ask.error}</Notice> : null}
            </form>
          </Notice>
        ) : null}
      </div>
    </Panel>
  );
}
