"use client";

import { useState } from "react";
import en from "../../../i18n/en/settings";
import es from "../../../i18n/es/settings";
import { fill } from "../../../i18n/locales";
import ptBR from "../../../i18n/pt-BR/settings";
import { useDict } from "../../../i18n/provider";
import { api } from "../../../ui/api";
import { ActionStatus, useAction } from "../../../ui/errors";
import { formatPhone } from "../../../ui/format";
import { Button, Field, Notice, Select } from "../../../ui/kit";
import { put } from "./setting-api";

type Port = "ok" | "refused" | "unreachable" | "unexpected";
interface Channel {
  id: string;
  provider: string;
  name: string | null;
  phone: string | null;
}
interface Check {
  mcp: Port;
  rest: Port;
  channels: Channel[];
}
/** O conector `deskcomm` gravado com o endereço do CRM, como a rota de configurações o devolve. */
export interface SavedCrm {
  url: string;
  crmUrl: string;
  channelSessionId?: string;
  channelLabel?: string;
}

/** O nome do canal como a tela mostra e grava: o nome do CRM, ou o provedor, e o número. */
export const channelLabelOf = (channel: Channel): string => [channel.name ?? channel.provider, channel.phone ? formatPhone(channel.phone) : null].filter(Boolean).join(" · ");

/**
 * O CRM do conector `deskcomm` (#330, fatia 2b): confere as duas portas com o token gravado e
 * escolhe o canal por onde a mensagem sai, pela lista do próprio CRM. A conferência só lê.
 */
export function DeskcommCrm({ saved, canConfigure, onSaved }: { saved: SavedCrm; canConfigure: boolean; onSaved(): void }) {
  const t = useDict(ptBR, en, es);
  const check = useAction();
  const save = useAction();
  const [result, setResult] = useState<Check | null>(null);
  const [channel, setChannel] = useState(saved.channelSessionId ?? "");

  const portText = (port: Port): string => t.crmPort[port];
  const portTone = (port: Port) => (port === "ok" ? "text-ok" : "text-fail");
  // O canal gravado pode não estar mais na lista: ele continua como opção, com o nome gravado.
  const listed = result?.rest === "ok" ? result.channels : [];
  const options = saved.channelSessionId && !listed.some((item) => item.id === saved.channelSessionId) ? [{ id: saved.channelSessionId, label: fill(t.crmChannelGone, { name: saved.channelLabel ?? saved.channelSessionId }) }, ...listed.map((item) => ({ id: item.id, label: channelLabelOf(item) }))] : listed.map((item) => ({ id: item.id, label: channelLabelOf(item) }));
  const chosen = listed.find((item) => item.id === channel);

  return (
    <div className="grid gap-3 border-t border-line pt-5">
      <h3 className="font-bold">{t.crmTitle}</h3>
      <p className="max-w-prose text-muted">{t.crmLead}</p>
      <p>{saved.channelSessionId ? fill(t.crmChannelSaved, { name: saved.channelLabel ?? saved.channelSessionId }) : t.crmChannelRule}</p>
      {canConfigure ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            busy={check.busy}
            onClick={() => {
              setResult(null);
              void check.run(async () => setResult(await api<Check>("/whatsapp/crm-check", { body: {} })));
            }}
          >
            {t.crmCheck}
          </Button>
        </div>
      ) : null}
      {check.error ? <Notice tone="fail">{check.error}</Notice> : null}
      {result ? (
        <div className="grid gap-1" role="status">
          <p className={portTone(result.mcp)}>{fill(t.crmPortMcp, { result: portText(result.mcp) })}</p>
          <p className={portTone(result.rest)}>{fill(t.crmPortRest, { result: portText(result.rest) })}</p>
        </div>
      ) : null}
      {result && result.mcp === "ok" && result.rest === "refused" ? <Notice tone="warn">{t.crmTokenMcpOnly}</Notice> : null}
      {result && result.rest === "ok" && canConfigure ? (
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            const label = chosen ? channelLabelOf(chosen) : channel === saved.channelSessionId ? saved.channelLabel : undefined;
            void save
              .run(() => put("whatsapp.connector", { type: "deskcomm", url: saved.url, crmUrl: saved.crmUrl, ...(channel && { channelSessionId: channel, ...(label && { channelLabel: label }) }) }))
              .then((ok) => {
                if (ok) onSaved();
              });
          }}
        >
          <Field label={t.crmChannel} hint={listed.length === 0 ? t.crmChannelNone : undefined}>
            <Select value={channel} onChange={(event) => setChannel(event.target.value)}>
              <option value="">{t.crmChannelAny}</option>
              {options.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" busy={save.busy}>
              {t.crmChannelSave}
            </Button>
            <ActionStatus action={save} />
          </div>
        </form>
      ) : null}
    </div>
  );
}
