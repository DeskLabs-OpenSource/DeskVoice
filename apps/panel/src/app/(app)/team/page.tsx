"use client";

import { Check, Copy, Trash, UserPlus, UsersThree, X } from "@phosphor-icons/react";
import { useState, type FormEvent } from "react";
import enCommon from "../../../i18n/en/common";
import en from "../../../i18n/en/team";
import esCommon from "../../../i18n/es/common";
import es from "../../../i18n/es/team";
import { fill } from "../../../i18n/locales";
import ptBRCommon from "../../../i18n/pt-BR/common";
import ptBR, { type TeamDictionary } from "../../../i18n/pt-BR/team";
import { useDict, useLocale } from "../../../i18n/provider";
import { api, useApi } from "../../../ui/api";
import { useAction, useErrorText } from "../../../ui/errors";
import { formatDateTime, formatPhone } from "../../../ui/format";
import { Badge, Button, EmptyState, Field, Notice, PageHeader, Panel, Select, Skeleton, TextInput } from "../../../ui/kit";
import { useMe } from "../../../ui/me";
import type { Role } from "../../../ui/types";

interface Person {
  id: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  phone: string | null;
  whatsapp: string | null;
  isYou: boolean;
}
interface PendingInvite {
  id: string;
  email: string;
  name: string;
  role: Role;
  expiresAt: string;
  createdByName: string | null;
}
interface Team {
  people: Person[];
  invites: PendingInvite[];
}

const ROLES: Role[] = ["owner", "admin", "operator"];
const ICON_BUTTON = "grid size-9 cursor-pointer place-items-center rounded-xs text-muted hover:bg-sunken hover:text-fail";

/** Uma pessoa da equipe. O que a tela oferece segue as mesmas regras da API, que confere de novo. */
function PersonRow({ person, t, cancel, mayManageOwners, onChanged }: { person: Person; t: TeamDictionary; cancel: string; mayManageOwners: boolean; onChanged(): void }) {
  const action = useAction();
  const [confirming, setConfirming] = useState(false);
  // Administrador não mexe em dono; ninguém troca o próprio papel.
  const manageable = mayManageOwners || person.role !== "owner";
  const run = (task: () => Promise<unknown>): void =>
    void action.run(task).then((ok) => {
      if (ok) setConfirming(false);
      onChanged();
    });

  return (
    <li className="grid gap-3 border-b border-line py-4 first:pt-0 last:border-b-0 last:pb-0">
      <div className="grid items-center gap-x-4 gap-y-2 md:grid-cols-[minmax(0,1.5fr)_minmax(0,0.9fr)_auto_auto]">
        <div className={`grid min-w-0 ${person.active ? "" : "text-muted"}`}>
          <span className="flex items-center gap-2">
            <span className="truncate font-bold">{person.name}</span>
            {person.isYou ? <Badge>{t.you}</Badge> : null}
          </span>
          <span className="truncate text-muted">{person.email}</span>
          {person.whatsapp || person.phone ? <span className="data truncate text-muted">{formatPhone(person.whatsapp ?? person.phone)}</span> : null}
        </div>
        <Select
          aria-label={fill(t.roleOf, { name: person.name })}
          value={person.role}
          disabled={!manageable || person.isYou || action.busy}
          onChange={(event) => run(() => api(`/team/users/${person.id}`, { method: "PATCH", body: { role: event.target.value } }))}
        >
          {ROLES.filter((role) => mayManageOwners || role !== "owner" || person.role === "owner").map((role) => (
            <option key={role} value={role}>
              {t.roles[role]}
            </option>
          ))}
        </Select>
        <Badge tone={person.active ? "ok" : "neutral"}>{person.active ? t.active : t.disabled}</Badge>
        {manageable ? (
          <div className="flex items-center gap-1">
            <Button busy={action.busy} title={person.active ? t.disableHint : undefined} onClick={() => run(() => api(`/team/users/${person.id}`, { method: "PATCH", body: { disabled: person.active } }))}>
              {person.active ? t.disable : t.enable}
            </Button>
            <button type="button" aria-label={fill(t.remove, { name: person.name })} className={ICON_BUTTON} onClick={() => setConfirming(!confirming)}>
              <Trash size={18} weight="duotone" aria-hidden />
            </button>
          </div>
        ) : (
          <span />
        )}
      </div>
      {confirming ? (
        <Notice tone="fail">
          <p>{fill(t.removeConfirm, { name: person.name, email: person.email })}</p>
          <div className="mt-1 flex flex-wrap gap-2">
            <Button variant="danger" busy={action.busy} onClick={() => run(() => api(`/team/users/${person.id}`, { method: "DELETE" }))}>
              {fill(t.removeYes, { name: person.name })}
            </Button>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              {cancel}
            </Button>
          </div>
        </Notice>
      ) : null}
      {action.error ? <Notice tone="fail">{action.error}</Notice> : null}
    </li>
  );
}

function InviteRow({ invite, t, cancel, onChanged }: { invite: PendingInvite; t: TeamDictionary; cancel: string; onChanged(): void }) {
  const locale = useLocale();
  const action = useAction();
  const [confirming, setConfirming] = useState(false);
  return (
    <li className="grid gap-3 border-b border-line py-3 first:pt-0 last:border-b-0 last:pb-0">
      <div className="grid items-center gap-x-4 gap-y-1 md:grid-cols-[minmax(0,1.5fr)_minmax(0,0.9fr)_minmax(0,1fr)_auto]">
        <div className="grid min-w-0">
          <span className="truncate font-bold">{invite.name}</span>
          <span className="truncate text-muted">{invite.email}</span>
        </div>
        <span>{t.roles[invite.role]}</span>
        <span className="grid text-[0.87rem] text-muted">
          <span>{fill(t.validUntil, { when: formatDateTime(invite.expiresAt, locale) })}</span>
          {invite.createdByName ? <span>{fill(t.invitedBy, { name: invite.createdByName })}</span> : null}
        </span>
        <button type="button" aria-label={fill(t.revoke, { name: invite.name })} className={ICON_BUTTON} onClick={() => setConfirming(!confirming)}>
          <X size={18} weight="bold" aria-hidden />
        </button>
      </div>
      {confirming ? (
        <Notice tone="fail">
          <p>{fill(t.revokeConfirm, { name: invite.name, email: invite.email })}</p>
          <div className="mt-1 flex flex-wrap gap-2">
            <Button variant="danger" busy={action.busy} onClick={() => void action.run(() => api(`/team/invites/${invite.id}`, { method: "DELETE" })).then(onChanged)}>
              {t.revokeYes}
            </Button>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              {cancel}
            </Button>
          </div>
          {action.error ? <p className="text-fail">{action.error}</p> : null}
        </Notice>
      ) : null}
    </li>
  );
}

export default function TeamPage() {
  const t = useDict(ptBR, en, es);
  const cancel = useDict(ptBRCommon, enCommon, esCommon).actions.cancel;
  const errorText = useErrorText();
  const me = useMe();
  const team = useApi<Team>("/team");
  const create = useAction();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<{ email: string; name: string; role: Role }>({ email: "", name: "", role: "operator" });
  // O link só existe aqui, na memória desta tela: a API não o devolve de novo.
  const [created, setCreated] = useState<{ name: string; link: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const mayManageOwners = me?.role === "owner";

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    void create.run(async () => {
      const invite = await api<{ link: string }>("/team/invites", { body: draft });
      setCreated({ name: draft.name, link: invite.link });
      setCopied(false);
      setOpen(false);
      setDraft({ email: "", name: "", role: "operator" });
      team.reload();
    });
  };

  if (team.error && !team.data) return <Notice tone="fail">{team.error.code === "forbidden" ? t.forbidden : errorText(team.error)}</Notice>;

  return (
    <>
      <PageHeader
        title={t.title}
        lead={t.lead}
        actions={
          <Button variant="primary" icon={<UserPlus size={18} weight="duotone" aria-hidden />} onClick={() => setOpen(true)}>
            {t.invite}
          </Button>
        }
      />

      {created ? (
        <section className="grid gap-4 rounded-md border border-accent bg-surface p-5">
          <div className="grid max-w-[70ch] gap-1">
            <h2 className="text-[1.07rem] font-bold">{fill(t.linkTitle, { name: created.name })}</h2>
            <p className="text-muted">{t.linkBody}</p>
          </div>
          <div className="grid items-end gap-3 md:grid-cols-[minmax(0,1fr)_auto_auto]">
            <Field label={t.linkLabel}>
              <TextInput mono readOnly value={created.link} onFocus={(event) => event.target.select()} />
            </Field>
            <Button
              variant="primary"
              icon={copied ? <Check size={18} weight="bold" aria-hidden /> : <Copy size={18} weight="duotone" aria-hidden />}
              onClick={() => void navigator.clipboard.writeText(created.link).then(() => setCopied(true))}
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
        </section>
      ) : null}

      {open ? (
        <Panel title={t.inviteTitle}>
          <form onSubmit={submit} className="grid gap-4">
            <div className="grid gap-4 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,0.8fr)]">
              <Field label={t.email}>
                <TextInput type="email" value={draft.email} onChange={(event) => setDraft({ ...draft, email: event.target.value })} required autoFocus />
              </Field>
              <Field label={t.name}>
                <TextInput value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} required maxLength={120} />
              </Field>
              <Field label={t.role}>
                <Select value={draft.role} onChange={(event) => setDraft({ ...draft, role: event.target.value as Role })}>
                  {ROLES.filter((role) => mayManageOwners || role !== "owner").map((role) => (
                    <option key={role} value={role}>
                      {t.roles[role]}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <p className="max-w-[70ch] text-[0.87rem] text-muted">{t.roleHelp[draft.role]}</p>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" variant="primary" busy={create.busy}>
                {t.createInvite}
              </Button>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                {cancel}
              </Button>
            </div>
            {create.error ? <Notice tone="fail">{create.error}</Notice> : null}
          </form>
        </Panel>
      ) : null}

      {!team.data ? <Skeleton /> : null}

      {team.data && team.data.people.length === 1 && team.data.invites.length === 0 && !created && !open ? (
        <EmptyState icon={<UsersThree size={32} weight="duotone" aria-hidden />} title={t.aloneTitle}>
          <p>{t.aloneBody}</p>
          <ul className="grid gap-1">
            {ROLES.map((role) => (
              <li key={role}>{t.roleHelp[role]}</li>
            ))}
          </ul>
        </EmptyState>
      ) : null}

      {team.data ? (
        <Panel title={t.peopleTitle}>
          <ul className="grid">
            {team.data.people.map((person) => (
              <PersonRow key={person.id} person={person} t={t} cancel={cancel} mayManageOwners={mayManageOwners} onChanged={team.reload} />
            ))}
          </ul>
        </Panel>
      ) : null}

      {team.data && team.data.invites.length > 0 ? (
        <Panel title={t.pendingTitle}>
          <ul className="grid">
            {team.data.invites.map((invite) => (
              <InviteRow key={invite.id} invite={invite} t={t} cancel={cancel} onChanged={team.reload} />
            ))}
          </ul>
        </Panel>
      ) : null}
    </>
  );
}
