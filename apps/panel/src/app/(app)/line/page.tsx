"use client";

import { CheckCircle, MinusCircle, PencilSimple, Plus, Pulse, Trash, Warning, XCircle } from "@phosphor-icons/react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import enCommon from "../../../i18n/en/common";
import en from "../../../i18n/en/line";
import esCommon from "../../../i18n/es/common";
import es from "../../../i18n/es/line";
import { fill } from "../../../i18n/locales";
import ptBRCommon from "../../../i18n/pt-BR/common";
import ptBR, { type LineDictionary } from "../../../i18n/pt-BR/line";
import { useDict, useLocale } from "../../../i18n/provider";
import { api, useApi } from "../../../ui/api";
import { ActionStatus, ReadOnlyNotice, useAction, useErrorText } from "../../../ui/errors";
import { formatDateTime, formatPhone } from "../../../ui/format";
import { Badge, Button, Field, Notice, PageHeader, Panel, Select, Skeleton, TextInput, type Tone } from "../../../ui/kit";
import { useCanConfigure } from "../../../ui/me";
import type { Agent, PhoneNumber, Setting, Trunk } from "../../../ui/types";

type StepStatus = "ok" | "warn" | "fail" | "skipped";
interface CheckResult {
  status: string;
  steps: Array<{ step: "apply" | "asterisk" | "trunk"; status: StepStatus; detail: string }>;
}

const STATUS_TONE: Record<string, Tone> = { ok: "ok", warn: "warn", fail: "fail" };
const STEP_ICON: Record<StepStatus, ReactNode> = {
  ok: <CheckCircle size={20} weight="duotone" className="text-ok" aria-hidden />,
  warn: <Warning size={20} weight="duotone" className="text-warn" aria-hidden />,
  fail: <XCircle size={20} weight="duotone" className="text-fail" aria-hidden />,
  skipped: <MinusCircle size={20} weight="duotone" className="text-muted" aria-hidden />,
};

const ICON_BUTTON = "grid size-9 cursor-pointer place-items-center rounded-xs text-muted hover:bg-sunken";

/** Um número da linha: troca quem atende, corrige o número digitado errado e remove, com confirmação. */
function NumberRow({ entry, trunkName, t, cancel, agentOptions, onChanged }: { entry: PhoneNumber; trunkName: string; t: LineDictionary; cancel: string; agentOptions: ReactNode; onChanged(): void }) {
  const canConfigure = useCanConfigure();
  const action = useAction();
  const [mode, setMode] = useState<"view" | "edit" | "remove">("view");
  const [number, setNumber] = useState("");
  const pretty = formatPhone(entry.e164);
  const run = (task: () => Promise<unknown>): void =>
    void action.run(task).then((ok) => {
      if (ok) setMode("view");
      onChanged();
    });

  return (
    <li className="grid gap-3 border-b border-line py-3 first:pt-0 last:border-b-0">
      <div className="grid items-center gap-x-4 gap-y-1.5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)_auto]">
        <span className="data text-[1.07rem]">{pretty}</span>
        <span className="text-muted">{trunkName}</span>
        <Select aria-label={t.answeredBy} disabled={!canConfigure} value={entry.agentId ?? ""} onChange={(event) => run(() => api(`/phone-numbers/${entry.id}`, { method: "PATCH", body: { agentId: event.target.value || null } }))}>
          {agentOptions}
        </Select>
        {canConfigure ? (
          <div className="flex gap-1">
            <button
              type="button"
              aria-label={fill(t.editNumber, { number: pretty })}
              className={`${ICON_BUTTON} hover:text-ink`}
              onClick={() => {
                setNumber(pretty);
                setMode(mode === "edit" ? "view" : "edit");
              }}
            >
              <PencilSimple size={18} weight="duotone" aria-hidden />
            </button>
            <button type="button" aria-label={fill(t.removeNumber, { number: pretty })} className={`${ICON_BUTTON} hover:text-fail`} onClick={() => setMode(mode === "remove" ? "view" : "remove")}>
              <Trash size={18} weight="duotone" aria-hidden />
            </button>
          </div>
        ) : null}
      </div>
      {mode === "edit" ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            run(() => api(`/phone-numbers/${entry.id}`, { method: "PATCH", body: { number } }));
          }}
        >
          <Field label={t.number} hint={t.numberHint}>
            <TextInput mono type="tel" value={number} onChange={(event) => setNumber(event.target.value)} required autoFocus />
          </Field>
          <Button type="submit" busy={action.busy} className="mb-[1.6rem]">
            {t.saveNumber}
          </Button>
          <Button variant="ghost" className="mb-[1.6rem]" onClick={() => setMode("view")}>
            {cancel}
          </Button>
        </form>
      ) : null}
      {mode === "remove" ? (
        <Notice tone="fail">
          <p>{fill(t.removeNumberConfirm, { number: pretty })}</p>
          <div className="mt-1 flex flex-wrap gap-2">
            <Button variant="danger" busy={action.busy} onClick={() => run(() => api(`/phone-numbers/${entry.id}`, { method: "DELETE" }))}>
              {fill(t.removeNumberYes, { number: pretty })}
            </Button>
            <Button variant="ghost" onClick={() => setMode("view")}>
              {cancel}
            </Button>
          </div>
        </Notice>
      ) : null}
      {action.error ? <Notice tone="fail">{action.error}</Notice> : null}
    </li>
  );
}

function TrunkForm({ trunk, t, cancel, numbersCount, onSaved }: { trunk: Trunk | null; t: LineDictionary; cancel: string; numbersCount: number; onSaved(): void }) {
  const locale = useLocale();
  const canConfigure = useCanConfigure();
  const save = useAction();
  const test = useAction();
  const remove = useAction();
  const [confirming, setConfirming] = useState(false);
  const [draft, setDraft] = useState({
    name: trunk?.name ?? "",
    host: trunk?.host ?? "",
    authMode: trunk?.authMode ?? "register",
    username: trunk?.username ?? "",
    password: "",
    callerId: formatPhone(trunk?.callerId),
  });
  const [applied, setApplied] = useState(true);
  const [result, setResult] = useState<CheckResult | null>(null);
  const set = (key: keyof typeof draft, value: string): void => setDraft((current) => ({ ...current, [key]: value }));
  // Destino mudou: a senha gravada não acompanha (a API recusa), então a tela já pede a nova.
  const moved = trunk !== null && trunk.secret.configured && (draft.host !== trunk.host || draft.username !== (trunk.username ?? ""));
  const status = result?.status ?? trunk?.status ?? "unverified";
  const statusLabel = Object.hasOwn(t.status, status) ? t.status[status as keyof typeof t.status] : t.status.unverified;

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    void save.run(async () => {
      const { password, ...rest } = draft;
      const saved = await api<Trunk>(trunk ? `/trunks/${trunk.id}` : "/trunks", { method: trunk ? "PATCH" : "POST", body: { ...rest, ...(password && { password }) } });
      setApplied(saved.applied !== false);
      setResult(null);
      set("password", "");
      onSaved();
    });
  };

  return (
    <Panel
      title={trunk?.name ?? t.newLine}
      description={trunk ? undefined : t.trunkLead}
      actions={trunk ? <Badge tone={STATUS_TONE[status] ?? "neutral"}>{statusLabel}</Badge> : null}
    >
      <form onSubmit={submit} className="grid gap-5">
        <fieldset disabled={!canConfigure} className="grid gap-4 md:grid-cols-2">
          <Field label={t.name} hint={t.nameHint}>
            <TextInput value={draft.name} onChange={(event) => set("name", event.target.value)} required maxLength={80} />
          </Field>
          <Field label={t.host} hint={t.hostHint}>
            <TextInput mono value={draft.host} onChange={(event) => set("host", event.target.value)} required />
          </Field>
          <Field label={t.authMode} hint={draft.authMode === "ip" ? t.authIpHint : undefined}>
            <Select value={draft.authMode} onChange={(event) => set("authMode", event.target.value)}>
              <option value="register">{t.authRegister}</option>
              <option value="ip">{t.authIp}</option>
            </Select>
          </Field>
          <Field label={t.callerId} hint={t.callerIdHint}>
            <TextInput mono type="tel" value={draft.callerId} onChange={(event) => set("callerId", event.target.value)} />
          </Field>
          {draft.authMode === "register" ? (
            <>
              <Field label={t.username}>
                <TextInput mono value={draft.username} onChange={(event) => set("username", event.target.value)} autoComplete="off" />
              </Field>
              <Field label={t.password} hint={moved ? t.passwordAgain : trunk?.secret.configured ? t.passwordKept : undefined}>
                <TextInput mono type="password" value={draft.password} onChange={(event) => set("password", event.target.value)} autoComplete="new-password" required={moved} />
              </Field>
            </>
          ) : null}
        </fieldset>

        {!applied ? <Notice tone="warn">{t.notApplied}</Notice> : null}
        {result ? (
          <ol className="grid gap-2 rounded-sm bg-sunken p-4">
            {result.steps.map((step) => (
              <li key={step.step} className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3">
                <span className="mt-0.5">{STEP_ICON[step.status]}</span>
                <span>
                  <span className="font-bold">{t.steps[step.step]}</span> <span className="text-muted">· {t.stepStatus[step.status]}</span>
                </span>
                {step.detail && step.status !== "ok" ? <span className="data col-start-2 text-[0.87rem] text-muted">{step.detail}</span> : null}
              </li>
            ))}
          </ol>
        ) : null}

        {canConfigure ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" variant="primary" busy={save.busy}>
              {t.saveLine}
            </Button>
            {trunk ? (
              <Button busy={test.busy} icon={<Pulse size={18} weight="duotone" aria-hidden />} onClick={() => void test.run(async () => setResult(await api<CheckResult>(`/trunks/${trunk.id}/check`, { method: "POST" }))).then(onSaved)}>
                {t.test}
              </Button>
            ) : null}
            <ActionStatus action={save} />
            {test.error ? <ActionStatus action={test} /> : null}
            {trunk?.lastCheckAt && !result ? <span className="text-[0.87rem] text-muted">{fill(t.lastCheck, { when: formatDateTime(trunk.lastCheckAt, locale) })}</span> : null}
            {trunk && !confirming ? (
              <Button variant="ghost" className="ml-auto" icon={<Trash size={18} weight="duotone" aria-hidden />} onClick={() => setConfirming(true)}>
                {t.removeLine}
              </Button>
            ) : null}
          </div>
        ) : null}
        {trunk && confirming ? (
          // Com números ligados a API recusa; a tela já diz quantos são em vez de oferecer o botão.
          <Notice tone={numbersCount > 0 ? "warn" : "fail"}>
            <p>{numbersCount > 0 ? fill(t.lineHasNumbers, { n: numbersCount }) : fill(t.removeLineConfirm, { name: trunk.name })}</p>
            <div className="mt-1 flex flex-wrap gap-2">
              {numbersCount === 0 ? (
                <Button variant="danger" busy={remove.busy} onClick={() => void remove.run(() => api(`/trunks/${trunk.id}`, { method: "DELETE" })).then((ok) => ok && onSaved())}>
                  {fill(t.removeLineYes, { name: trunk.name })}
                </Button>
              ) : null}
              <Button variant="ghost" onClick={() => setConfirming(false)}>
                {cancel}
              </Button>
            </div>
            {remove.error ? <p className="text-fail">{remove.error}</p> : null}
          </Notice>
        ) : null}
      </form>
    </Panel>
  );
}

export default function LinePage() {
  const t = useDict(ptBR, en, es);
  const cancel = useDict(ptBRCommon, enCommon, esCommon).actions.cancel;
  const errorText = useErrorText();
  const canConfigure = useCanConfigure();
  const trunks = useApi<Trunk[]>("/trunks");
  const numbers = useApi<PhoneNumber[]>("/phone-numbers");
  const agents = useApi<Agent[]>("/agents");
  const publicIp = useApi<Setting<string>>("/settings/network.public_ip");
  const [adding, setAdding] = useState(false);
  const [ip, setIp] = useState("");
  const [newNumber, setNewNumber] = useState({ number: "", trunkId: "", agentId: "" });
  const saveIp = useAction();
  const addNumber = useAction();
  useEffect(() => setIp(publicIp.data?.value ?? ""), [publicIp.data]);

  const list = trunks.data ?? [];
  const trunkId = newNumber.trunkId || list[0]?.id || "";
  const agentOptions = (
    <>
      <option value="">{t.nobody}</option>
      {agents.data?.map((agent) => (
        <option key={agent.id} value={agent.id}>
          {agent.name}
        </option>
      ))}
    </>
  );

  return (
    <>
      <PageHeader title={t.title} lead={t.lead} />
      <ReadOnlyNotice />
      {trunks.error && !trunks.data ? <Notice tone="fail">{errorText(trunks.error)}</Notice> : null}
      {!trunks.data && !trunks.error ? <Skeleton /> : null}

      {list.map((trunk) => (
        <TrunkForm key={trunk.id} trunk={trunk} t={t} cancel={cancel} numbersCount={numbers.data?.filter((entry) => entry.trunkId === trunk.id).length ?? 0} onSaved={trunks.reload} />
      ))}
      {trunks.data && (list.length === 0 || adding) ? (
        <TrunkForm
          key={`new-${list.length}`}
          trunk={null}
          t={t}
          cancel={cancel}
          numbersCount={0}
          onSaved={() => {
            setAdding(false);
            trunks.reload();
          }}
        />
      ) : null}
      {list.length > 0 && !adding && canConfigure ? (
        <Button variant="ghost" className="justify-self-start" icon={<Plus size={18} weight="bold" aria-hidden />} onClick={() => setAdding(true)}>
          {t.addLine}
        </Button>
      ) : null}

      <Panel title={t.numbersTitle} description={t.numbersLead}>
        <div className="grid gap-4">
          {numbers.data?.length === 0 ? <p className="text-muted">{list.length === 0 ? t.needLine : t.numbersEmpty}</p> : null}
          {numbers.data?.length ? (
            <ul className="grid">
              {numbers.data.map((entry) => (
                <NumberRow key={entry.id} entry={entry} trunkName={list.find((trunk) => trunk.id === entry.trunkId)?.name ?? ""} t={t} cancel={cancel} agentOptions={agentOptions} onChanged={numbers.reload} />
              ))}
            </ul>
          ) : null}

          {canConfigure && list.length > 0 ? (
            <form
              className="grid items-end gap-4 border-t border-line pt-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)_auto]"
              onSubmit={(event) => {
                event.preventDefault();
                void addNumber
                  .run(() => api("/phone-numbers", { body: { number: newNumber.number, trunkId, agentId: newNumber.agentId || null } }))
                  .then((ok) => {
                    if (ok) setNewNumber({ number: "", trunkId: "", agentId: "" });
                    numbers.reload();
                  });
              }}
            >
              <Field label={t.number}>
                <TextInput mono type="tel" placeholder="(31) 3222-1100" value={newNumber.number} onChange={(event) => setNewNumber({ ...newNumber, number: event.target.value })} required />
              </Field>
              <Field label={t.onLine}>
                <Select value={trunkId} onChange={(event) => setNewNumber({ ...newNumber, trunkId: event.target.value })}>
                  {list.map((trunk) => (
                    <option key={trunk.id} value={trunk.id}>
                      {trunk.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t.answeredBy}>
                <Select value={newNumber.agentId} onChange={(event) => setNewNumber({ ...newNumber, agentId: event.target.value })}>
                  {agentOptions}
                </Select>
              </Field>
              <Button type="submit" busy={addNumber.busy}>
                {t.addNumber}
              </Button>
            </form>
          ) : null}
          {addNumber.error ? <Notice tone="fail">{addNumber.error}</Notice> : null}
        </div>
      </Panel>

      <Panel title={t.helpTitle} description={t.helpBody}>
        <div className="grid gap-5">
          <ul className="grid max-w-[72ch] list-disc gap-2 pl-5 marker:text-line-strong">
            <li>{t.helpUdp}</li>
            <li>{t.helpIp}</li>
          </ul>
          <form
            className="grid max-w-md items-end gap-3 sm:grid-cols-[minmax(0,1fr)_auto]"
            onSubmit={(event) => {
              event.preventDefault();
              void saveIp.run(() => api("/settings/network.public_ip", { method: "PUT", body: { value: ip.trim() || null } }));
            }}
          >
            <Field label={t.publicIp}>
              <TextInput mono value={ip} onChange={(event) => setIp(event.target.value)} disabled={!canConfigure} placeholder="203.0.113.10" />
            </Field>
            {canConfigure ? (
              <Button type="submit" busy={saveIp.busy}>
                {t.saveIp}
              </Button>
            ) : null}
          </form>
          <p className="-mt-3 text-[0.87rem] text-muted">{t.publicIpHint}</p>
          <ActionStatus action={saveIp} />
        </div>
      </Panel>
    </>
  );
}
