"use client";

import { useEffect, useState } from "react";
import en from "../../../../i18n/en/settings";
import es from "../../../../i18n/es/settings";
import ptBR from "../../../../i18n/pt-BR/settings";
import { useDict } from "../../../../i18n/provider";
import { api, useApi } from "../../../../ui/api";
import { ActionStatus, useAction } from "../../../../ui/errors";
import { formatPhone } from "../../../../ui/format";
import { Button, Field, Panel, TextInput } from "../../../../ui/kit";
import type { Me } from "../../../../ui/types";

// O próprio contato e a própria senha qualquer papel edita: é para onde vão os avisos fora do painel.
export default function AccountSettings() {
  const t = useDict(ptBR, en, es);
  const me = useApi<Me>("/auth/me");
  const saveContact = useAction();
  const [contact, setContact] = useState({ name: "", phone: "", whatsapp: "" });
  const savePassword = useAction();
  const [password, setPassword] = useState({ current: "", next: "", repeat: "" });

  useEffect(() => {
    if (me.data) setContact({ name: me.data.name, phone: formatPhone(me.data.phone), whatsapp: formatPhone(me.data.whatsapp) });
  }, [me.data]);

  return (
    <>
      <Panel title={t.contactTitle} description={t.contactLead}>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void saveContact.run(() => api("/auth/me", { method: "PATCH", body: contact })).then(me.reload);
          }}
        >
          <div className="grid gap-4 md:grid-cols-3">
            <Field label={t.contactName}>
              <TextInput value={contact.name} onChange={(event) => setContact({ ...contact, name: event.target.value })} required maxLength={120} autoComplete="name" />
            </Field>
            <Field label={t.contactPhone}>
              <TextInput mono type="tel" value={contact.phone} onChange={(event) => setContact({ ...contact, phone: event.target.value })} autoComplete="tel" />
            </Field>
            <Field label={t.contactWhatsapp} hint={t.contactHint}>
              <TextInput mono type="tel" value={contact.whatsapp} onChange={(event) => setContact({ ...contact, whatsapp: event.target.value })} />
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" variant="primary" busy={saveContact.busy} disabled={!me.data}>
              {t.saveContact}
            </Button>
            <ActionStatus action={saveContact} />
          </div>
        </form>
      </Panel>

      <Panel title={t.passwordTitle} description={t.passwordLead}>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void savePassword.run(() => api("/auth/password", { body: { current: password.current, new: password.next } })).then((ok) => ok && setPassword({ current: "", next: "", repeat: "" }));
          }}
        >
          <div className="grid gap-4 md:grid-cols-3">
            <Field label={t.passwordCurrent}>
              <TextInput type="password" autoComplete="current-password" value={password.current} onChange={(event) => setPassword({ ...password, current: event.target.value })} required />
            </Field>
            <Field label={t.passwordNew} hint={t.passwordNewHint}>
              <TextInput type="password" autoComplete="new-password" minLength={10} value={password.next} onChange={(event) => setPassword({ ...password, next: event.target.value })} required />
            </Field>
            <Field label={t.passwordRepeat} error={password.repeat !== "" && password.repeat !== password.next ? t.passwordMismatch : undefined}>
              <TextInput type="password" autoComplete="new-password" minLength={10} value={password.repeat} onChange={(event) => setPassword({ ...password, repeat: event.target.value })} required />
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" busy={savePassword.busy} disabled={password.repeat !== password.next}>
              {t.savePassword}
            </Button>
            <ActionStatus action={savePassword} />
          </div>
        </form>
      </Panel>
    </>
  );
}
