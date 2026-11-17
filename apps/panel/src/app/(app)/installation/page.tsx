"use client";

import { Buildings, Check, Copy, Plus } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import en from "../../../i18n/en/installation";
import es from "../../../i18n/es/installation";
import { fill } from "../../../i18n/locales";
import ptBR, { type InstallationDictionary } from "../../../i18n/pt-BR/installation";
import { useDict, useLocale } from "../../../i18n/provider";
import { api, useApi } from "../../../ui/api";
import { ActionStatus } from "../../../ui/errors";
import { formatDateTime } from "../../../ui/format";
import { Badge, Button, EmptyState, Field, Notice, Panel, Skeleton, TextInput } from "../../../ui/kit";
import { useInstallationAction } from "./errors";

interface Organization {
  id: string;
  name: string;
  createdAt: string;
  suspendedAt: string | null;
  founding: boolean;
}
interface Person {
  accountId: string;
  email: string;
  name: string;
}
interface Overview {
  organizations: Organization[];
  creation: { explicit: boolean; granted: Person[]; losing: Person[] };
}
interface Created {
  organizationId: string;
  granted: Person[];
  kept: Person[];
  lost: Person[];
}

const names = (people: Person[]): string => people.map((person) => `${person.name || person.email} (${person.email})`).join(", ");

function People({ title, people, t, children }: { title: string; people: Person[]; t: InstallationDictionary["organizations"]; children?: (person: Person) => ReactNode }) {
  return (
    <div className="grid gap-1">
      <p className="font-bold">{title}</p>
      {people.length === 0 ? <p className="text-muted">{t.nobody}</p> : null}
      <ul className="grid gap-1">
        {people.map((person) => (
          <li key={person.accountId} className="flex flex-wrap items-center gap-x-3">
            <span>
              {person.name || person.email} <span className="data text-muted">{person.email}</span>
            </span>
            {children?.(person)}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Criar uma organização. Na segunda, a tela diz antes, com os nomes, quem recebe e quem perde a administração. */
function NewOrganization({ creation, t, onCreated }: { creation: Overview["creation"]; t: InstallationDictionary["organizations"]; onCreated(name: string, created: Created): void }) {
  const save = useInstallationAction();
  const [name, setName] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [keep, setKeep] = useState<string[]>([]);
  const create = (): void => {
    const body = { name: name.trim(), shown: { granted: creation.granted.map((p) => p.accountId), losing: creation.losing.map((p) => p.accountId) }, keep };
    void save
      .run(async () => {
        const created = await api<Created>("/installation/organizations", { body });
        onCreated(body.name, created);
      })
      .then((ok) => {
        if (!ok) return;
        setName("");
        setKeep([]);
        setConfirming(false);
      });
  };
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (!name.trim()) return;
    // Com a lista ainda implícita, criar muda quem administra: a tela mostra antes de confirmar.
    if (!creation.explicit) setConfirming(true);
    else create();
  };
  return (
    <Panel title={t.newTitle} description={t.newLead}>
      <form className="grid gap-3" onSubmit={submit}>
        <Field label={t.nameLabel}>
          <TextInput className="max-w-md" maxLength={120} value={name} onChange={(event) => setName(event.target.value)} disabled={confirming} />
        </Field>
        {confirming ? (
          <div className="grid gap-3 rounded-xs border border-warn p-3">
            <p className="font-bold">{t.creating}</p>
            <Notice tone="warn">{t.explicitLead}</Notice>
            <People title={t.grantedTitle} people={creation.granted} t={t} />
            <People title={t.losingTitle} people={creation.losing} t={t}>
              {(person) => (
                <label className="flex items-center gap-2 text-[0.93rem]">
                  <input
                    type="checkbox"
                    checked={keep.includes(person.accountId)}
                    onChange={(event) => setKeep(event.target.checked ? [...keep, person.accountId] : keep.filter((id) => id !== person.accountId))}
                  />
                  {fill(t.keep, { name: person.name || person.email })}
                </label>
              )}
            </People>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" busy={save.busy} onClick={create}>
                {t.confirm}
              </Button>
              <Button variant="ghost" onClick={() => setConfirming(false)}>
                {t.cancel}
              </Button>
            </div>
          </div>
        ) : (
          <div>
            <Button type="submit" variant="primary" icon={<Plus size={18} weight="bold" aria-hidden />} busy={save.busy}>
              {t.create}
            </Button>
          </div>
        )}
        <ActionStatus action={save} />
      </form>
    </Panel>
  );
}

/** O convite do primeiro dono: o link só existe nesta tela, como na tela Equipe. */
function OwnerInvite({ organization, t, onClose }: { organization: { id: string; name: string }; t: InstallationDictionary["organizations"]; onClose(): void }) {
  const send = useInstallationAction();
  const [draft, setDraft] = useState({ email: "", name: "" });
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  return (
    <Panel title={fill(t.inviteTitle, { name: organization.name })} description={t.inviteLead} tone="accent">
      {link ? (
        <div className="grid gap-3">
          <Field label={t.linkLabel} hint={t.linkHint}>
            <TextInput mono readOnly value={link} onFocus={(event) => event.target.select()} />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button icon={copied ? <Check size={18} weight="bold" aria-hidden /> : <Copy size={18} weight="duotone" aria-hidden />} onClick={() => void navigator.clipboard.writeText(link).then(() => setCopied(true))}>
              {copied ? t.copied : t.copy}
            </Button>
            <Button variant="ghost" onClick={onClose}>
              {t.close}
            </Button>
          </div>
        </div>
      ) : (
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void send.run(async () => setLink((await api<{ link: string }>(`/installation/organizations/${organization.id}/invite`, { body: draft })).link));
          }}
        >
          <Field label={t.inviteName}>
            <TextInput className="max-w-md" maxLength={120} required value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
          </Field>
          <Field label={t.inviteEmail}>
            <TextInput className="max-w-md" type="email" required value={draft.email} onChange={(event) => setDraft({ ...draft, email: event.target.value })} />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" busy={send.busy}>
              {t.inviteSend}
            </Button>
            <Button variant="ghost" onClick={onClose}>
              {t.cancel}
            </Button>
          </div>
          <ActionStatus action={send} />
        </form>
      )}
    </Panel>
  );
}

function Row({ organization, t, onChanged, onInvite }: { organization: Organization; t: InstallationDictionary["organizations"]; onChanged(): void; onInvite(): void }) {
  const locale = useLocale();
  const save = useInstallationAction();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(organization.name);
  return (
    <li className="grid gap-2 border-b border-line py-3 last:border-b-0">
      {editing ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void save.run(() => api(`/installation/organizations/${organization.id}`, { method: "PATCH", body: { name: name.trim() } })).then((ok) => {
              if (!ok) return;
              setEditing(false);
              onChanged();
            });
          }}
        >
          <Field label={t.renameLabel}>
            <TextInput className="max-w-md" maxLength={120} required value={name} onChange={(event) => setName(event.target.value)} />
          </Field>
          <Button type="submit" variant="primary" busy={save.busy}>
            {t.save}
          </Button>
          <Button variant="ghost" onClick={() => setEditing(false)}>
            {t.cancel}
          </Button>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="font-bold">{organization.name}</span>
          {organization.founding ? <Badge>{t.founding}</Badge> : null}
          {organization.suspendedAt ? <Badge tone="warn">{t.suspended}</Badge> : null}
          <span className="data text-[0.87rem] text-muted">{fill(t.created, { when: formatDateTime(organization.createdAt, locale) })}</span>
          <span className="ml-auto flex gap-2">
            <Button variant="ghost" onClick={() => setEditing(true)}>
              {t.rename}
            </Button>
            {organization.founding ? null : (
              <Button variant="ghost" onClick={onInvite}>
                {t.inviteOwner}
              </Button>
            )}
          </span>
        </div>
      )}
      <ActionStatus action={save} />
    </li>
  );
}

export default function InstallationOrganizations() {
  const t = useDict(ptBR, en, es).organizations;
  const { data, reload } = useApi<Overview>("/installation/organizations");
  const [inviting, setInviting] = useState<{ id: string; name: string } | null>(null);
  const [created, setCreated] = useState<(Created & { name: string }) | null>(null);
  const router = useRouter();
  return (
    <>
      {created ? (
        <Notice tone="ok">
          <span className="grid gap-1">
            <span className="font-bold">{fill(t.createdTitle, { name: created.name })}</span>
            {created.granted.length + created.kept.length > 0 ? <span>{fill(t.createdKept, { names: names([...created.granted, ...created.kept]) })}</span> : null}
            {created.lost.length > 0 ? <span>{fill(t.createdLost, { names: names(created.lost) })}</span> : null}
          </span>
        </Notice>
      ) : null}
      {inviting ? <OwnerInvite organization={inviting} t={t} onClose={() => setInviting(null)} /> : null}
      <Panel title={t.title} description={t.lead}>
        {!data ? (
          <Skeleton />
        ) : data.organizations.length === 0 ? (
          <EmptyState icon={<Buildings size={28} weight="duotone" aria-hidden />} title={t.empty} />
        ) : (
          <ul className="grid">
            {data.organizations.map((organization) => (
              <Row key={organization.id} organization={organization} t={t} onChanged={reload} onInvite={() => setInviting({ id: organization.id, name: organization.name })} />
            ))}
          </ul>
        )}
      </Panel>
      {data ? (
        <NewOrganization
          creation={data.creation}
          t={t}
          onCreated={(name, result) => {
            setCreated({ ...result, name });
            setInviting({ id: result.organizationId, name });
            reload();
            // A lista de quem administra pode ter ficado explícita: a tela de atualizar muda de lugar, e
            // quem cria pode ter deixado de administrar. O servidor relê a sessão sem perder o convite aberto.
            if (!data.creation.explicit) router.refresh();
          }}
        />
      ) : null}
    </>
  );
}
