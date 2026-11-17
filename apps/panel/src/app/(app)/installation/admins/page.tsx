"use client";

import { UserPlus } from "@phosphor-icons/react";
import { useState } from "react";
import en from "../../../../i18n/en/installation";
import es from "../../../../i18n/es/installation";
import { fill } from "../../../../i18n/locales";
import ptBR from "../../../../i18n/pt-BR/installation";
import { useDict, useLocale } from "../../../../i18n/provider";
import { api, useApi } from "../../../../ui/api";
import { ActionStatus } from "../../../../ui/errors";
import { formatDateTime } from "../../../../ui/format";
import { Badge, Button, Field, Notice, Panel, Skeleton, TextInput } from "../../../../ui/kit";
import { useMe } from "../../../../ui/me";
import { useInstallationAction } from "../errors";

interface Admin {
  accountId: string;
  email: string;
  name: string;
  since: string | null;
}

export default function InstallationAdmins() {
  const t = useDict(ptBR, en, es).admins;
  const locale = useLocale();
  const me = useMe();
  const { data, reload } = useApi<{ explicit: boolean; admins: Admin[] }>("/installation/admins");
  const remove = useInstallationAction();
  const add = useInstallationAction();
  const [confirming, setConfirming] = useState<Admin | null>(null);
  const [email, setEmail] = useState("");
  return (
    <>
      <Panel title={t.title} description={t.lead}>
        {!data ? (
          <Skeleton />
        ) : (
          <div className="grid gap-3">
            {data.explicit ? null : <Notice>{t.implicit}</Notice>}
            <ul className="grid">
              {data.admins.map((admin) => (
                <li key={admin.accountId} className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line py-3 last:border-b-0">
                  <span className="font-bold">{admin.name || admin.email}</span>
                  <span className="data text-muted">{admin.email}</span>
                  {admin.email === me?.email ? <Badge>{t.you}</Badge> : null}
                  <span className="text-[0.87rem] text-muted">{admin.since ? fill(t.since, { when: formatDateTime(admin.since, locale) }) : t.byRole}</span>
                  {/* Quem administra só pela regra da fundadora não tem marca para tirar. */}
                  {admin.since ? (
                    <span className="ml-auto">
                      <Button variant="ghost" onClick={() => setConfirming(admin)}>
                        {t.remove}
                      </Button>
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
            {confirming ? (
              <div className="grid gap-2 rounded-xs border border-warn p-3">
                <p>{fill(t.removeConfirm, { email: confirming.email })}</p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="danger"
                    busy={remove.busy}
                    onClick={() =>
                      void remove.run(() => api(`/installation/admins/${confirming.accountId}`, { method: "DELETE" })).then((ok) => {
                        setConfirming(null);
                        if (ok) reload();
                      })
                    }
                  >
                    {t.removeYes}
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirming(null)}>
                    {t.cancel}
                  </Button>
                </div>
              </div>
            ) : null}
            <ActionStatus action={remove} />
          </div>
        )}
      </Panel>
      <Panel title={t.addTitle} description={t.addLead}>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void add.run(() => api("/installation/admins", { body: { email: email.trim() } })).then((ok) => {
              if (!ok) return;
              setEmail("");
              reload();
            });
          }}
        >
          <Field label={t.email}>
            <TextInput className="max-w-md" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
          </Field>
          <Button type="submit" variant="primary" icon={<UserPlus size={18} weight="duotone" aria-hidden />} busy={add.busy}>
            {t.add}
          </Button>
        </form>
        <ActionStatus action={add} />
      </Panel>
    </>
  );
}
