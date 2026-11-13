"use client";

import { Plus, X } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import commonEn from "../../../../i18n/en/common";
import en from "../../../../i18n/en/settings";
import commonEs from "../../../../i18n/es/common";
import es from "../../../../i18n/es/settings";
import { fill } from "../../../../i18n/locales";
import commonPtBR from "../../../../i18n/pt-BR/common";
import ptBR from "../../../../i18n/pt-BR/settings";
import { useDict } from "../../../../i18n/provider";
import { useApi } from "../../../../ui/api";
import { ActionStatus, useAction } from "../../../../ui/errors";
import { Button, Field, Notice, Panel, TextInput } from "../../../../ui/kit";
import { useCanConfigure } from "../../../../ui/me";
import type { Setting } from "../../../../ui/types";
import { URL_PREFIX, put } from "../setting-api";

interface Hook {
  name: string;
  url: string;
  token?: string;
  tokenKept?: boolean;
}

export default function IntegrationsSettings() {
  const t = useDict(ptBR, en, es);
  const common = useDict(commonPtBR, commonEn, commonEs);
  const canConfigure = useCanConfigure();
  const webhooks = useApi<Setting<Array<{ name: string; url: string; token: { configured: boolean } }>>>("/settings/webhooks.allowed");
  const saveHooks = useAction();
  const [hooks, setHooks] = useState<Hook[]>([]);
  // A remoção espera confirmação: o botão só abre o pedido, nunca remove.
  const [removingHook, setRemovingHook] = useState<number | null>(null);

  useEffect(() => {
    if (webhooks.data) setHooks((webhooks.data.value ?? []).map((hook) => ({ name: hook.name, url: hook.url, tokenKept: hook.token.configured })));
  }, [webhooks.data]);

  const setHook = (index: number, patch: Partial<Hook>): void => setHooks(hooks.map((hook, position) => (position === index ? { ...hook, ...patch } : hook)));
  const dropHook = (index: number): void => {
    setHooks(hooks.filter((_, position) => position !== index));
    setRemovingHook(null);
  };

  return (
    <Panel title={t.webhooksTitle} description={t.webhooksLead}>
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          const value = hooks.map((hook) => ({ name: hook.name, url: hook.url, ...(hook.token && { token: hook.token }) }));
          void saveHooks.run(() => put("webhooks.allowed", value)).then(webhooks.reload);
        }}
      >
        {hooks.length === 0 ? <p className="text-muted">{t.hooksEmpty}</p> : null}
        <fieldset disabled={!canConfigure} className="grid gap-4">
          {hooks.map((hook, index) => (
            <div key={index} className="grid gap-3">
              <div className="grid items-end gap-3 md:grid-cols-[minmax(0,0.7fr)_minmax(0,1.5fr)_minmax(0,1fr)_auto]">
                <Field label={t.hookName}>
                  <TextInput value={hook.name} onChange={(event) => setHook(index, { name: event.target.value, tokenKept: false })} required maxLength={60} />
                </Field>
                <Field label={t.hookUrl}>
                  <TextInput mono type="url" placeholder={URL_PREFIX} value={hook.url} onChange={(event) => setHook(index, { url: event.target.value, tokenKept: false })} required />
                </Field>
                <Field label={t.hookToken}>
                  <TextInput mono type="password" autoComplete="off" placeholder={hook.tokenKept ? t.hookTokenKept : undefined} value={hook.token ?? ""} onChange={(event) => setHook(index, { token: event.target.value })} />
                </Field>
                <button
                  type="button"
                  aria-label={fill(t.removeHook, { name: hook.name })}
                  className="grid size-10 cursor-pointer place-items-center rounded-xs text-muted hover:bg-sunken hover:text-fail"
                  // Linha em branco não tem o que perder; o resto pede confirmação com o nome.
                  onClick={() => (hook.name === "" && hook.url === "" ? dropHook(index) : setRemovingHook(removingHook === index ? null : index))}
                >
                  <X size={16} weight="bold" aria-hidden />
                </button>
              </div>
              {removingHook === index ? (
                <Notice tone="fail">
                  <p>{fill(t.removeHookConfirm, { name: hook.name || hook.url })}</p>
                  <div className="mt-1 flex flex-wrap gap-2">
                    <Button variant="danger" onClick={() => dropHook(index)}>
                      {fill(t.removeHookYes, { name: hook.name || hook.url })}
                    </Button>
                    <Button variant="ghost" onClick={() => setRemovingHook(null)}>
                      {common.actions.cancel}
                    </Button>
                  </div>
                </Notice>
              ) : null}
            </div>
          ))}
        </fieldset>
        {canConfigure ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="ghost" icon={<Plus size={18} weight="bold" aria-hidden />} onClick={() => setHooks([...hooks, { name: "", url: "" }])}>
              {t.addHook}
            </Button>
            <Button type="submit" busy={saveHooks.busy}>
              {t.saveHooks}
            </Button>
            <ActionStatus action={saveHooks} />
          </div>
        ) : null}
      </form>
    </Panel>
  );
}
