"use client";

import { Check, Copy, LinkSimple } from "@phosphor-icons/react";
import { useState } from "react";
import enCommon from "../../../../i18n/en/common";
import en from "../../../../i18n/en/share";
import esCommon from "../../../../i18n/es/common";
import es from "../../../../i18n/es/share";
import { fill } from "../../../../i18n/locales";
import ptBRCommon from "../../../../i18n/pt-BR/common";
import ptBR from "../../../../i18n/pt-BR/share";
import { useDict, useLocale } from "../../../../i18n/provider";
import { api, useApi } from "../../../../ui/api";
import { useAction, useErrorText } from "../../../../ui/errors";
import { formatDateTime } from "../../../../ui/format";
import { Button, Field, Notice, TextInput } from "../../../../ui/kit";

interface ShareLinks {
  ttlHours: number;
  maxUses: number;
  links: Array<{ id: string; createdAt: string; createdByName: string | null; expiresAt: string; maxUses: number; uses: number }>;
}
interface Created {
  url: string;
  expiresAt: string;
  maxUses: number;
}

/**
 * O link para quem ligou baixar a gravação (registro 0019). Só aparece para dono e administrador,
 * e só com a gravação no disco. O endereço é mostrado uma vez, na criação: o banco guarda só o hash.
 */
export function ShareSection({ id }: { id: string }) {
  const t = useDict(ptBR, en, es);
  const cancel = useDict(ptBRCommon, enCommon, esCommon).actions.cancel;
  const locale = useLocale();
  const errorText = useErrorText();
  const state = useApi<ShareLinks>(`/calls/${id}/share`);
  const creator = useAction();
  const revoker = useAction();
  // O endereço só existe aqui, na memória desta tela: a API não o devolve de novo.
  const [created, setCreated] = useState<Created | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);

  if (state.error && !state.data) return <Notice tone="fail">{errorText(state.error)}</Notice>;
  if (!state.data) return null;
  const { links } = state.data;

  const create = (): void => {
    void creator.run(async () => {
      setCreated(await api<Created>(`/calls/${id}/share`, { body: {} }));
      setCopied(false);
      state.reload();
    });
  };
  const revoke = (): void => {
    void revoker.run(() => api(`/calls/${id}/share`, { method: "DELETE" })).then((done) => {
      if (!done) return;
      setConfirming(false);
      setCreated(null);
      state.reload();
    });
  };

  return (
    <div className="grid gap-3 pt-4">
      <div className="grid gap-1.5">
        <p className="font-bold">{t.title}</p>
        <p className="text-[0.85rem] text-muted">{fill(t.lead, { hours: state.data.ttlHours, uses: state.data.maxUses })}</p>
      </div>
      <Notice tone="warn">
        <p>{t.warning}</p>
        <p className="text-[0.85rem] text-muted">{t.addressHint}</p>
      </Notice>

      {created ? (
        <div className="grid gap-3 rounded-md border border-accent bg-surface p-4">
          <div className="grid gap-1">
            <p className="font-bold">{t.createdTitle}</p>
            <p className="text-[0.85rem] text-muted">{fill(t.createdBody, { until: formatDateTime(created.expiresAt, locale), uses: created.maxUses })}</p>
          </div>
          <div className="grid items-end gap-3 md:grid-cols-[minmax(0,1fr)_auto_auto]">
            <Field label={t.linkLabel}>
              <TextInput mono readOnly value={created.url} onFocus={(event) => event.target.select()} />
            </Field>
            <Button
              variant="primary"
              icon={copied ? <Check size={18} weight="bold" aria-hidden /> : <Copy size={18} weight="duotone" aria-hidden />}
              onClick={() => void navigator.clipboard.writeText(created.url).then(() => setCopied(true))}
            >
              {t.copy}
            </Button>
            <Button variant="ghost" onClick={() => setCreated(null)}>
              {t.done}
            </Button>
          </div>
          {copied ? (
            <p role="status" className="text-ok">
              {t.copied}
            </p>
          ) : null}
        </div>
      ) : (
        <div>
          <Button variant="secondary" busy={creator.busy} icon={<LinkSimple size={18} weight="duotone" aria-hidden />} onClick={create}>
            {t.create}
          </Button>
        </div>
      )}
      {creator.error ? <Notice tone="fail">{creator.error}</Notice> : null}

      <div className="grid gap-1.5">
        <p className="text-[0.85rem] font-bold">{t.liveTitle}</p>
        {links.length === 0 ? (
          <p className="text-[0.85rem] text-muted">{t.liveEmpty}</p>
        ) : (
          <ul className="grid gap-1 text-[0.85rem]">
            {links.map((link) => (
              <li key={link.id}>
                {fill(t.liveRow, {
                  created: formatDateTime(link.createdAt, locale),
                  who: link.createdByName ?? t.removedPerson,
                  until: formatDateTime(link.expiresAt, locale),
                  uses: link.uses,
                  max: link.maxUses,
                })}
              </li>
            ))}
          </ul>
        )}
      </div>

      {links.length > 0 && !confirming ? (
        <div>
          <Button variant="danger" onClick={() => setConfirming(true)}>
            {t.revoke}
          </Button>
        </div>
      ) : null}
      {confirming ? (
        <Notice tone="fail">
          <p>{links.length === 1 ? t.revokeConfirmOne : fill(t.revokeConfirmMany, { count: links.length })}</p>
          <div className="mt-1 flex flex-wrap gap-2">
            <Button variant="danger" busy={revoker.busy} onClick={revoke}>
              {t.revokeYes}
            </Button>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              {cancel}
            </Button>
          </div>
          {revoker.error ? <p className="text-fail">{revoker.error}</p> : null}
        </Notice>
      ) : null}
      {revoker.done && links.length === 0 ? (
        <p role="status" className="text-ok">
          {t.revoked}
        </p>
      ) : null}
    </div>
  );
}
