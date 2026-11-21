"use client";

import { IVR_ATTEMPTS, IVR_DIGITS, IVR_LABEL_MAX, IVR_MAX_PROMPT_MS, IVR_NAME_MAX, IVR_TIMEOUT_MS, personExitOf } from "@deskvoice/core/ivr";
import { DotsNine, PencilSimple, Plus, Trash, UploadSimple } from "@phosphor-icons/react";
import { useState, type FormEvent, type ReactNode } from "react";
import enCommon from "../../../i18n/en/common";
import en from "../../../i18n/en/ivr";
import esCommon from "../../../i18n/es/common";
import es from "../../../i18n/es/ivr";
import { fill } from "../../../i18n/locales";
import ptBRCommon from "../../../i18n/pt-BR/common";
import ptBR, { type IvrDictionary } from "../../../i18n/pt-BR/ivr";
import { useDict } from "../../../i18n/provider";
import { convertAnnouncement, uploadAnnouncement } from "../../../ui/announcement-audio";
import { api, useApi } from "../../../ui/api";
import { useAction } from "../../../ui/errors";
import { formatPhone } from "../../../ui/format";
import { Badge, Button, Field, Notice, Panel, Select, TextInput } from "../../../ui/kit";
import { useCanConfigure } from "../../../ui/me";
import { proposedLanguage, type OrganizationLanguage } from "../../../ui/proposed-language";
import type { Agent, IvrMenu, IvrOption, Me, PhoneNumber } from "../../../ui/types";

/**
 * O menu por teclas (URA, #223) na tela Linha telefônica: a lista, o editor, o anúncio e o "Atende"
 * de cada número. Fica num arquivo próprio para não disputar o `page.tsx` com outras frentes.
 */

const ICON_BUTTON = "grid size-9 cursor-pointer place-items-center rounded-xs text-muted hover:bg-sunken";
const LANGUAGES = ["pt-BR", "en", "es"] as const;

const seconds = (ms: number): string => String(Math.round(ms / 1000));

/** O que a tela guarda enquanto o operador edita: o número da pessoa como ele digitou. */
interface DraftOption {
  key: number;
  digit: string;
  label: string;
  action: IvrOption["action"];
  agentId: string;
  transferTo: string;
}

const toDraft = (option: IvrOption, key: number): DraftOption => ({
  key,
  digit: option.digit,
  label: option.label,
  action: option.action,
  agentId: option.agentId ?? "",
  transferTo: formatPhone(option.transferTo),
});

function MenuEditor({
  menu,
  agents,
  t,
  cancel,
  onSaved,
  onCancel,
  newLanguage = "pt-BR",
}: {
  menu: IvrMenu | null;
  agents: Agent[];
  t: IvrDictionary;
  cancel: string;
  onSaved(): void;
  onCancel(): void;
  /** O idioma que o menu novo propõe: o da organização (R8, fatia 8a). O menu que já existe fica com o dele. */
  newLanguage?: OrganizationLanguage;
}) {
  const canConfigure = useCanConfigure();
  const save = useAction();
  const [draft, setDraft] = useState({
    name: menu?.name ?? "",
    language: menu?.language ?? newLanguage,
    timeout: seconds(menu?.timeoutMs ?? IVR_TIMEOUT_MS.default),
    attempts: String(menu?.maxAttempts ?? IVR_ATTEMPTS.default),
    onNoChoice: menu?.onNoChoice ?? "person",
  });
  const [options, setOptions] = useState<DraftOption[]>(() =>
    menu ? menu.options.map(toDraft) : [{ key: 0, digit: "1", label: "", action: "transfer", agentId: "", transferTo: "" }],
  );
  const [nextKey, setNextKey] = useState(options.length + 1);
  const set = (key: keyof typeof draft, value: string): void => setDraft((current) => ({ ...current, [key]: value }));
  const setOption = (key: number, change: Partial<DraftOption>): void => setOptions((current) => current.map((option) => (option.key === key ? { ...option, ...change } : option)));
  const used = new Set(options.map((option) => option.digit));
  const repeated = used.size !== options.length;
  const noPerson = !personExitOf(options);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (noPerson || repeated) return;
    void save
      .run(async () => {
        const settings = {
          name: draft.name,
          language: draft.language,
          timeoutMs: Number(draft.timeout) * 1000,
          maxAttempts: Number(draft.attempts),
          onNoChoice: draft.onNoChoice,
        };
        const keys = options.map((option) => ({
          digit: option.digit,
          label: option.label,
          action: option.action,
          agentId: option.action === "agent" ? option.agentId || null : null,
          transferTo: option.action === "transfer" ? option.transferTo : null,
        }));
        if (!menu) return api("/ivr-menus", { body: { ...settings, options: keys } });
        await api(`/ivr-menus/${menu.id}`, { method: "PATCH", body: settings });
        return api(`/ivr-menus/${menu.id}/options`, { method: "PUT", body: keys });
      })
      .then((ok) => ok && onSaved());
  };

  return (
    <form onSubmit={submit} className="grid gap-5 rounded-sm border border-line p-4">
      <fieldset disabled={!canConfigure} className="grid gap-4 md:grid-cols-2">
        <Field label={t.name} hint={t.nameHint}>
          <TextInput value={draft.name} onChange={(event) => set("name", event.target.value)} required maxLength={IVR_NAME_MAX} />
        </Field>
        <Field label={t.language} hint={t.languageHint}>
          <Select value={draft.language} onChange={(event) => set("language", event.target.value)}>
            {LANGUAGES.map((language) => (
              <option key={language} value={language}>
                {t.languages[language]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t.timeout} hint={t.timeoutHint}>
          <TextInput
            type="number"
            min={IVR_TIMEOUT_MS.min / 1000}
            max={IVR_TIMEOUT_MS.max / 1000}
            value={draft.timeout}
            onChange={(event) => set("timeout", event.target.value)}
            required
          />
        </Field>
        <Field label={t.attempts} hint={t.attemptsHint}>
          <TextInput type="number" min={IVR_ATTEMPTS.min} max={IVR_ATTEMPTS.max} value={draft.attempts} onChange={(event) => set("attempts", event.target.value)} required />
        </Field>
        <Field label={t.onNoChoice}>
          <Select value={draft.onNoChoice} onChange={(event) => set("onNoChoice", event.target.value)}>
            <option value="person">{t.onNoChoicePerson}</option>
            <option value="hangup">{t.onNoChoiceHangup}</option>
          </Select>
        </Field>
      </fieldset>

      <fieldset disabled={!canConfigure} className="grid gap-3">
        <legend className="mb-1 font-bold">{t.keys}</legend>
        <p className="-mt-1 text-[0.87rem] text-muted">{t.keysHint}</p>
        {options.map((option) => (
          <div key={option.key} className="grid items-end gap-3 md:grid-cols-[5rem_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
            <Field label={t.key}>
              <Select value={option.digit} onChange={(event) => setOption(option.key, { digit: event.target.value })}>
                {[...IVR_DIGITS].map((digit) => (
                  <option key={digit} value={digit} disabled={digit !== option.digit && used.has(digit)}>
                    {digit}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t.label}>
              <TextInput value={option.label} placeholder={t.labelPlaceholder} onChange={(event) => setOption(option.key, { label: event.target.value })} required maxLength={IVR_LABEL_MAX} />
            </Field>
            <Field label={t.action}>
              <Select value={option.action} onChange={(event) => setOption(option.key, { action: event.target.value as IvrOption["action"] })}>
                <option value="transfer">{t.actions.transfer}</option>
                <option value="agent">{t.actions.agent}</option>
                <option value="hangup">{t.actions.hangup}</option>
              </Select>
            </Field>
            {option.action === "agent" ? (
              <Field label={t.agent}>
                <Select value={option.agentId} onChange={(event) => setOption(option.key, { agentId: event.target.value })} required>
                  <option value="">{t.chooseAgent}</option>
                  {agents.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : option.action === "transfer" ? (
              <Field label={t.transferTo}>
                <TextInput mono type="tel" placeholder="(31) 3222-1100" value={option.transferTo} onChange={(event) => setOption(option.key, { transferTo: event.target.value })} required />
              </Field>
            ) : (
              <span />
            )}
            <button
              type="button"
              aria-label={fill(t.removeKey, { key: option.digit })}
              className={`${ICON_BUTTON} mb-0.5 hover:text-fail`}
              onClick={() => setOptions((current) => current.filter((candidate) => candidate.key !== option.key))}
            >
              <Trash size={18} weight="duotone" aria-hidden />
            </button>
          </div>
        ))}
        {options.length < IVR_DIGITS.length ? (
          <Button
            variant="ghost"
            className="justify-self-start"
            icon={<Plus size={18} weight="bold" aria-hidden />}
            onClick={() => {
              const digit = [...IVR_DIGITS].find((candidate) => !used.has(candidate)) ?? "1";
              setOptions((current) => [...current, { key: nextKey, digit, label: "", action: "transfer", agentId: "", transferTo: "" }]);
              setNextKey(nextKey + 1);
            }}
          >
            {t.addKey}
          </Button>
        ) : null}
        {noPerson ? <Notice tone="warn">{t.needPerson}</Notice> : null}
        {repeated ? <Notice tone="warn">{t.repeatedKey}</Notice> : null}
      </fieldset>

      {canConfigure ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="primary" busy={save.busy} disabled={noPerson || repeated}>
            {t.save}
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            {cancel}
          </Button>
        </div>
      ) : null}
      {save.error ? <Notice tone="fail">{save.error}</Notice> : null}
    </form>
  );
}

/** O anúncio: o arquivo do operador, convertido no navegador; o "Ouvir" toca o que o servidor guardou. */
function Announcement({ menu, t, onSaved }: { menu: IvrMenu; t: IvrDictionary; onSaved(): void }) {
  const canConfigure = useCanConfigure();
  const upload = useAction();
  const [problem, setProblem] = useState("");
  const [converting, setConverting] = useState(false);

  const choose = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    setProblem("");
    setConverting(true);
    const converted = await convertAnnouncement(file).catch(() => null);
    setConverting(false);
    if (!converted) return setProblem(t.unreadable);
    if (converted.ms > IVR_MAX_PROMPT_MS) return setProblem(fill(t.tooLong, { seconds: seconds(converted.ms) }));
    if (await upload.run(() => uploadAnnouncement(menu.id, converted.wav))) onSaved();
  };

  return (
    <div className="grid gap-2 rounded-sm bg-sunken p-4">
      <p className="font-bold">{t.announcement}</p>
      {menu.promptAudioMs ? (
        <>
          <p className="text-[0.87rem] text-muted">{fill(t.announcementLength, { seconds: seconds(menu.promptAudioMs) })}</p>
          <audio controls preload="none" aria-label={t.listen} src={`/api/v1/ivr-menus/${menu.id}/audio?v=${encodeURIComponent(menu.updatedAt)}`} className="w-full max-w-md" />
        </>
      ) : (
        <Notice tone="warn">{t.announcementMissing}</Notice>
      )}
      <p className="text-[0.87rem] text-muted">{t.announcementHint}</p>
      {canConfigure ? (
        <label className="inline-flex cursor-pointer items-center gap-2 justify-self-start font-bold text-ink underline-offset-4 hover:underline">
          <UploadSimple size={18} weight="duotone" aria-hidden />
          <span>{converting ? t.converting : menu.promptAudioMs ? t.replace : t.upload}</span>
          <input
            type="file"
            accept="audio/wav,audio/x-wav,audio/mpeg,audio/mp4,audio/x-m4a,.wav,.mp3,.m4a"
            className="sr-only"
            disabled={converting || upload.busy}
            onChange={(event) => {
              void choose(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
        </label>
      ) : null}
      {problem ? <Notice tone="fail">{problem}</Notice> : null}
      {upload.error ? <Notice tone="fail">{upload.error}</Notice> : null}
    </div>
  );
}

function MenuRow({ menu, agents, numbers, t, cancel, onChanged }: { menu: IvrMenu; agents: Agent[]; numbers: PhoneNumber[]; t: IvrDictionary; cancel: string; onChanged(): void }) {
  const canConfigure = useCanConfigure();
  const remove = useAction();
  const [mode, setMode] = useState<"view" | "edit" | "remove">("view");
  const using = numbers.filter((number) => number.mode === "ivr" && number.ivrMenuId === menu.id).map((number) => formatPhone(number.e164));

  return (
    <li className="grid gap-3 border-b border-line py-3 first:pt-0 last:border-b-0">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <span className="font-bold">{menu.name}</span>
        <span className="text-[0.87rem] text-muted">{fill(t.summary, { keys: menu.options.length, seconds: seconds(menu.timeoutMs), attempts: menu.maxAttempts })}</span>
        {menu.promptAudioMs ? <Badge tone="ok">{fill(t.announcementLength, { seconds: seconds(menu.promptAudioMs) })}</Badge> : <Badge tone="warn">{t.menuNotReady}</Badge>}
        {canConfigure ? (
          <div className="ml-auto flex gap-1">
            <button type="button" aria-label={fill(t.edit, { name: menu.name })} className={`${ICON_BUTTON} hover:text-ink`} onClick={() => setMode(mode === "edit" ? "view" : "edit")}>
              <PencilSimple size={18} weight="duotone" aria-hidden />
            </button>
            <button type="button" aria-label={t.remove} className={`${ICON_BUTTON} hover:text-fail`} onClick={() => setMode(mode === "remove" ? "view" : "remove")}>
              <Trash size={18} weight="duotone" aria-hidden />
            </button>
          </div>
        ) : null}
      </div>
      <ul className="grid gap-0.5 text-[0.87rem]">
        {menu.options.map((option) => (
          <li key={option.digit}>
            <span className="data font-bold">{option.digit}</span> · {option.label} · <span className="text-muted">{t.actions[option.action]}</span>
            {option.action === "agent" ? <span className="text-muted"> · {agents.find((agent) => agent.id === option.agentId)?.name ?? ""}</span> : null}
            {option.action === "transfer" ? <span className="data text-muted"> · {formatPhone(option.transferTo)}</span> : null}
          </li>
        ))}
      </ul>
      {mode === "edit" ? (
        <MenuEditor
          menu={menu}
          agents={agents}
          t={t}
          cancel={cancel}
          onCancel={() => setMode("view")}
          onSaved={() => {
            setMode("view");
            onChanged();
          }}
        />
      ) : null}
      <Announcement menu={menu} t={t} onSaved={onChanged} />
      {mode === "remove" ? (
        <Notice tone={using.length > 0 ? "warn" : "fail"}>
          <p>{using.length > 0 ? fill(t.inUse, { numbers: using.join(", ") }) : fill(t.removeConfirm, { name: menu.name })}</p>
          <div className="mt-1 flex flex-wrap gap-2">
            {using.length === 0 ? (
              <Button variant="danger" busy={remove.busy} onClick={() => void remove.run(() => api(`/ivr-menus/${menu.id}`, { method: "DELETE" })).then((ok) => ok && onChanged())}>
                {fill(t.removeYes, { name: menu.name })}
              </Button>
            ) : null}
            <Button variant="ghost" onClick={() => setMode("view")}>
              {cancel}
            </Button>
          </div>
          {remove.error ? <p className="text-fail">{remove.error}</p> : null}
        </Notice>
      ) : null}
    </li>
  );
}

/** A seção dos menus por teclas, abaixo dos números. */
export function IvrMenusPanel({ menus, agents, numbers, onChanged }: { menus: IvrMenu[] | undefined; agents: Agent[]; numbers: PhoneNumber[]; onChanged(): void }) {
  const t = useDict(ptBR, en, es);
  const cancel = useDict(ptBRCommon, enCommon, esCommon).actions.cancel;
  const canConfigure = useCanConfigure();
  const [adding, setAdding] = useState(false);
  // O menu novo propõe o idioma da organização (`organizations.language`); sem ele, pt-BR. O editor
  // espera `/auth/me` (ou a falha dele, e então pt-BR) para não propor um idioma e trocar depois.
  const me = useApi<Me>("/auth/me");
  const meLoaded = me.data !== undefined || me.error !== undefined;

  return (
    <Panel title={t.title} description={t.lead}>
      <div className="grid gap-4">
        {menus?.length === 0 && !adding ? <p className="text-muted">{t.empty}</p> : null}
        {menus?.length ? (
          <ul className="grid">
            {menus.map((menu) => (
              <MenuRow key={menu.id} menu={menu} agents={agents} numbers={numbers} t={t} cancel={cancel} onChanged={onChanged} />
            ))}
          </ul>
        ) : null}
        {adding && meLoaded ? (
          <>
            <p className="font-bold">{t.newMenu}</p>
            <MenuEditor
              menu={null}
              newLanguage={proposedLanguage(me.data?.organizationLanguage)}
              agents={agents}
              t={t}
              cancel={cancel}
              onCancel={() => setAdding(false)}
              onSaved={() => {
                setAdding(false);
                onChanged();
              }}
            />
            <p className="text-[0.87rem] text-muted">{t.announcementSaveFirst}</p>
          </>
        ) : null}
        {canConfigure && !adding ? (
          <Button variant="ghost" className="justify-self-start" icon={<DotsNine size={18} weight="duotone" aria-hidden />} onClick={() => setAdding(true)}>
            {t.add}
          </Button>
        ) : null}
      </div>
    </Panel>
  );
}

/**
 * O "Atende" de um número: a IA (o agente do número, como sempre) ou um menu por teclas. O menu sem
 * anúncio aparece marcado; a API recusa, e a frase da recusa diz o que fazer.
 */
export function NumberAnswer({
  entry,
  menus,
  agentSelect,
  onChange,
}: {
  entry: PhoneNumber;
  menus: IvrMenu[];
  agentSelect: ReactNode;
  onChange(body: { mode: "ai" | "ivr"; ivrMenuId?: string }): void;
}) {
  const t = useDict(ptBR, en, es);
  const canConfigure = useCanConfigure();
  const [choosing, setChoosing] = useState(false);
  const mode = entry.mode === "ivr" || choosing ? "ivr" : "ai";
  return (
    <div className="grid gap-1.5">
      <Select
        aria-label={t.answers}
        disabled={!canConfigure}
        value={mode}
        onChange={(event) => {
          if (event.target.value === "ai") {
            setChoosing(false);
            if (entry.mode === "ivr") onChange({ mode: "ai" });
          } else setChoosing(true);
        }}
      >
        <option value="ai">{t.answersAi}</option>
        <option value="ivr">{t.answersIvr}</option>
      </Select>
      {mode === "ai" ? (
        agentSelect
      ) : (
        <Select
          aria-label={t.answersIvr}
          disabled={!canConfigure}
          value={entry.mode === "ivr" ? (entry.ivrMenuId ?? "") : ""}
          onChange={(event) => {
            if (!event.target.value) return;
            setChoosing(false);
            onChange({ mode: "ivr", ivrMenuId: event.target.value });
          }}
        >
          <option value="">{t.chooseMenu}</option>
          {menus.map((menu) => (
            <option key={menu.id} value={menu.id}>
              {menu.promptAudioMs ? menu.name : `${menu.name} ${t.menuNotReady}`}
            </option>
          ))}
        </Select>
      )}
    </div>
  );
}
