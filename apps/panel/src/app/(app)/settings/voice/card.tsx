"use client";

import type { ProcessingLocation } from "@deskvoice/voice-engine/types";
import { useState } from "react";
import { fill } from "../../../../i18n/locales";
import { useLocale } from "../../../../i18n/provider";
import type { VoiceDictionary } from "../../../../i18n/pt-BR/voice";
import { ApiFailure, api, useApi } from "../../../../ui/api";
import { useErrorText } from "../../../../ui/errors";
import { formatDateTime } from "../../../../ui/format";
import { Badge, Button, Notice, Skeleton, TextInput } from "../../../../ui/kit";
import { useCanConfigure } from "../../../../ui/me";
import { noticeOf, providerName } from "./notice";

type CheckResult = keyof VoiceDictionary["results"];

interface KeyCheck {
  result: CheckResult;
  checkedAt: string;
}

export interface SynthesizerView {
  id: string;
  label: string;
  provider: string;
  processingLocation: ProcessingLocation;
  keyUrl: string | null;
  configured: boolean;
  keyCheck: KeyCheck | null;
  consent: { name: string | null; at: string } | null;
}

interface Voice {
  id: string;
  name: string;
  languages: string[];
  previewUrl?: string;
}

interface VoiceList {
  configured: boolean;
  voices: Voice[];
  failure: { result: CheckResult; status: number | null } | null;
}

const CHECK_TONE: Record<CheckResult, "ok" | "warn" | "fail"> = {
  accepted: "ok",
  rejected: "fail",
  model_unavailable: "fail",
  no_credit: "fail",
  region_unavailable: "fail",
  rate_limited: "warn",
  unreachable: "warn",
  unexpected_response: "warn",
  not_needed: "ok",
};

/** O estado de um botão, com as falhas desta tela traduzidas pelo dicionário dela. */
function useVoiceAction(t: VoiceDictionary) {
  const errorText = useErrorText();
  const [state, setState] = useState({ busy: false, error: "" });
  const run = async (task: () => Promise<unknown>): Promise<boolean> => {
    setState({ busy: true, error: "" });
    try {
      await task();
      setState({ busy: false, error: "" });
      return true;
    } catch (failure) {
      const own = failure instanceof ApiFailure && Object.hasOwn(t.errors, failure.code) ? t.errors[failure.code as keyof VoiceDictionary["errors"]] : null;
      setState({ busy: false, error: own ?? errorText(failure) });
      return false;
    }
  };
  return { ...state, run };
}

/**
 * O aviso de para onde vai o texto: só o que as páginas do fornecedor dizem, cada frase com a página e
 * a data quando ela tem fonte. Fica à vista com ou sem chave salva.
 */
function WhereTheTextGoes({ voice, t }: { voice: SynthesizerView; t: VoiceDictionary }) {
  const locale = useLocale();
  return (
    <div className="grid gap-1 rounded-sm border border-line bg-surface px-4 py-3" data-testid="voice-notice">
      <p className="font-bold">{t.noticeTitle}</p>
      {noticeOf(t, voice, locale).map((line) => (
        <p key={line.text}>
          {line.text}
          {line.source ? (
            <>
              {" "}
              <a className="text-sm text-muted underline" href={line.source.url} target="_blank" rel="noreferrer">
                {line.source.text}
              </a>
            </>
          ) : null}
        </p>
      ))}
    </div>
  );
}

function CheckStatus({ check, t }: { check: KeyCheck | null; t: VoiceDictionary }) {
  const locale = useLocale();
  if (!check) return <p className="text-sm text-muted">{t.neverTested}</p>;
  return <Notice tone={CHECK_TONE[check.result]}>{fill(t.tested, { when: formatDateTime(check.checkedAt, locale), result: t.results[check.result] })}</Notice>;
}

/** As vozes da conta, pt-BR primeiro (a rota ordena), com o idioma e a amostra hospedada pelo fornecedor. */
function Voices({ voice, t, version }: { voice: SynthesizerView; t: VoiceDictionary; version: string }) {
  const errorText = useErrorText();
  const list = useApi<VoiceList>(`/synthesizers/${voice.id}/voices?v=${encodeURIComponent(version)}`);
  if (list.error && !list.data) {
    const own = list.error instanceof ApiFailure && Object.hasOwn(t.errors, list.error.code) ? t.errors[list.error.code as keyof VoiceDictionary["errors"]] : null;
    return <Notice tone="fail">{own ?? errorText(list.error)}</Notice>;
  }
  if (!list.data) return <Skeleton lines={3} />;
  const { voices, failure } = list.data;
  if (failure) {
    const status = failure.status !== null ? ` ${fill(t.status, { status: failure.status })}` : "";
    return <Notice tone={CHECK_TONE[failure.result]}>{fill(t.voicesFailed, { result: `${t.results[failure.result]}${status}` })}</Notice>;
  }
  return (
    <div className="grid gap-2">
      <h3 className="text-[0.87rem] font-bold">{t.voicesTitle}</h3>
      <p className="text-sm text-muted">{voices.length === 0 ? t.voicesNone : `${fill(t.voicesCount, { count: voices.length })} ${fill(t.sampleHint, { provider: providerName(t, voice.provider) })}`}</p>
      {voices.length > 0 ? (
        <ul className="grid max-h-[28rem] overflow-y-auto">
          {voices.map((each) => (
            <li key={each.id} className="grid gap-1 border-b border-line py-2 last:border-b-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-bold">{each.name}</span>
                {each.languages.length === 0 ? <span className="text-sm text-muted">{t.voicesLanguagesNone}</span> : each.languages.map((language) => <Badge key={language}>{language}</Badge>)}
              </div>
              {/* `preload="none"`: nada é pedido ao fornecedor até a pessoa tocar. A amostra é dele e não gasta crédito. */}
              {each.previewUrl ? <audio controls preload="none" src={each.previewUrl} aria-label={fill(t.sampleOf, { voice: each.name })} className="h-8 max-w-xs" /> : <span className="text-sm text-muted">{t.noSample}</span>}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Uma voz: o aviso, a chave (só se existe; nunca o valor), a confirmação, o último teste e as vozes. */
export function SynthesizerCard({ voice, t, onChanged }: { voice: SynthesizerView; t: VoiceDictionary; onChanged(): void }) {
  const locale = useLocale();
  const canConfigure = useCanConfigure();
  const save = useVoiceAction(t);
  const retest = useVoiceAction(t);
  const [key, setKey] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [postponed, setPostponed] = useState(false);
  const [showVoices, setShowVoices] = useState(false);
  const [version, setVersion] = useState(0);
  const provider = providerName(t, voice.provider);
  const changed = (): void => {
    setVersion((value) => value + 1);
    onChanged();
  };
  const saveKey = (): void => {
    setPostponed(false);
    void save
      .run(async () => {
        const answer = await api<{ check: KeyCheck | null }>(`/synthesizers/${voice.id}/key`, {
          method: "PUT",
          body: { apiKey: key, ...(confirmed && { confirmedProvider: voice.provider }) },
        });
        setPostponed(answer.check === null);
      })
      .then((ok) => {
        // O campo nunca é preenchido de volta: depois de salvar, ele fica vazio, e a confirmação também.
        if (ok) {
          setKey("");
          setConfirmed(false);
        }
        changed();
      });
  };
  const testAgain = (): void => {
    setPostponed(false);
    void retest
      .run(async () => {
        const answer = await api<{ check: KeyCheck | null }>(`/synthesizers/${voice.id}/key`, { method: "POST" });
        setPostponed(answer.check === null);
      })
      .then(changed);
  };
  const removeKey = (): void => {
    void save.run(() => api(`/synthesizers/${voice.id}/key`, { method: "DELETE" })).then((ok) => {
      if (ok) {
        setRemoving(false);
        setPostponed(false);
        setShowVoices(false);
      }
      changed();
    });
  };
  return (
    <li className="grid gap-3 border-b border-line py-4 first:pt-0 last:border-b-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-bold">{voice.label}</span>
        <Badge tone={voice.configured ? "ok" : "warn"}>{voice.configured ? t.keySaved : t.keyMissing}</Badge>
        {voice.keyUrl ? (
          <a className="text-sm underline" href={voice.keyUrl} target="_blank" rel="noreferrer">
            {t.keyLink}
          </a>
        ) : null}
      </div>
      <WhereTheTextGoes voice={voice} t={t} />
      {canConfigure ? (
        <form
          className="grid gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            saveKey();
          }}
        >
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-1" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
            <span>{fill(t.confirm, { provider })}</span>
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <TextInput
              mono
              type="password"
              autoComplete="off"
              className="max-w-md"
              aria-label={fill(t.keyOf, { voice: voice.label })}
              placeholder={voice.configured ? t.keyNew : undefined}
              value={key}
              onChange={(event) => setKey(event.target.value)}
              required
            />
            <Button type="submit" busy={save.busy}>
              {t.keySave}
            </Button>
            {voice.configured ? (
              <Button variant="secondary" busy={retest.busy} onClick={testAgain}>
                {t.retest}
              </Button>
            ) : null}
            {voice.configured && !removing ? (
              <Button variant="ghost" onClick={() => setRemoving(true)}>
                {t.remove}
              </Button>
            ) : null}
          </div>
        </form>
      ) : null}
      {save.error ? <Notice tone="fail">{save.error}</Notice> : null}
      {retest.error ? <Notice tone="fail">{retest.error}</Notice> : null}
      {postponed ? <Notice tone="warn">{t.savedNotTested}</Notice> : null}
      {voice.configured && voice.consent ? (
        <p className="text-sm text-muted">{fill(t.confirmedBy, { who: voice.consent.name ?? t.removedPerson, when: formatDateTime(voice.consent.at, locale) })}</p>
      ) : null}
      {voice.configured ? <CheckStatus check={voice.keyCheck} t={t} /> : null}
      {canConfigure && voice.configured && removing ? (
        <Notice tone="fail">
          <p>{fill(t.removeConfirm, { provider })}</p>
          <div className="mt-1 flex flex-wrap gap-2">
            <Button variant="danger" busy={save.busy} onClick={removeKey}>
              {fill(t.removeYes, { provider })}
            </Button>
            <Button variant="ghost" onClick={() => setRemoving(false)}>
              {t.cancel}
            </Button>
          </div>
        </Notice>
      ) : null}
      {voice.configured ? (
        <div className="grid gap-2">
          <div>
            <Button variant="ghost" onClick={() => setShowVoices((value) => !value)} aria-expanded={showVoices}>
              {showVoices ? t.voicesHide : t.voicesShow}
            </Button>
          </div>
          {showVoices ? <Voices voice={voice} t={t} version={`${version}:${voice.keyCheck?.checkedAt ?? ""}`} /> : null}
        </div>
      ) : null}
    </li>
  );
}
