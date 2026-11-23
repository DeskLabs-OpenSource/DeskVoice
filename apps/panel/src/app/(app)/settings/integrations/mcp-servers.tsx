"use client";

import { Plus } from "@phosphor-icons/react";
import { WEBHOOK_DEFAULT_TIMEOUT_SECONDS, WEBHOOK_MAX_TIMEOUT_SECONDS, WEBHOOK_MIN_TIMEOUT_SECONDS } from "@deskvoice/tools/webhook-timeout";
import { useState } from "react";
import { fill } from "../../../../i18n/locales";
import en from "../../../../i18n/en/mcp";
import es from "../../../../i18n/es/mcp";
import ptBR from "../../../../i18n/pt-BR/mcp";
import { useDict } from "../../../../i18n/provider";
import { ApiFailure, api, useApi } from "../../../../ui/api";
import { ActionStatus, useAction, useErrorText } from "../../../../ui/errors";
import { Badge, Button, Field, Notice, Panel, TextInput } from "../../../../ui/kit";
import type { McpLookup, McpServer, McpTool } from "../../../../ui/types";
import { URL_PREFIX } from "../setting-api";

const SLUG = /^[a-z0-9]{1,16}$/;
const DEFAULT_HEADER = "Authorization";

type Change = NonNullable<McpLookup["changes"]>[number]["change"];

/** O servidor sendo cadastrado ou editado, como está nos campos. */
interface Draft {
  /** `null`: servidor novo. */
  original: McpServer | null;
  slug: string;
  label: string;
  url: string;
  headerName: string;
  secret: string;
  timeoutSeconds: string;
  /** As ferramentas da última busca, com as marcas; `null` enquanto ninguém buscou. */
  tools: McpTool[] | null;
  changes: Record<string, Change>;
  gone: string[];
  omitted: number;
  incomplete: boolean;
}

const blank = (): Draft => ({
  original: null,
  slug: "",
  label: "",
  url: "",
  headerName: DEFAULT_HEADER,
  secret: "",
  timeoutSeconds: String(WEBHOOK_DEFAULT_TIMEOUT_SECONDS),
  tools: null,
  changes: {},
  gone: [],
  omitted: 0,
  incomplete: false,
});

const fromServer = (server: McpServer): Draft => ({
  ...blank(),
  original: server,
  slug: server.slug,
  label: server.label,
  url: server.url,
  headerName: server.headerName,
  timeoutSeconds: String(server.timeoutSeconds),
  tools: server.tools,
});

/** A descoberta e a busca de novo marcam o que veio; a tela nunca marca `supported: false`. */
const marked = (lookup: McpLookup): McpTool[] =>
  lookup.tools.map((tool) => ({
    ...tool,
    allowed: tool.supported && tool.allowed === true,
    writes: tool.writes ?? true,
    needsApproval: tool.needsApproval ?? false,
  }));

/** Servidores de ferramentas (MCP), abaixo dos webhooks. Só quem administra a organização vê. */
export function McpServers() {
  const t = useDict(ptBR, en, es);
  const errorText = useErrorText();
  const servers = useApi<McpServer[]>("/mcp-servers");
  const look = useAction();
  const save = useAction();
  const remove = useAction();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [redirect, setRedirect] = useState<string | null>(null);
  const [inUse, setInUse] = useState<{ tools: string; agents: string } | null>(null);
  const [removing, setRemoving] = useState<McpServer | null>(null);
  const [typed, setTyped] = useState("");
  const [confirmTyped, setConfirmTyped] = useState("");

  const patch = (next: Partial<Draft>): void => setDraft((current) => (current ? { ...current, ...next } : current));
  const close = (): void => {
    setDraft(null);
    setRedirect(null);
    setInUse(null);
    setConfirmTyped("");
  };

  const lookUp = async (current: Draft): Promise<void> => {
    setRedirect(null);
    // O mesmo endereço, sem segredo novo: a busca de novo usa o segredo guardado e diz o que mudou.
    const again = current.original !== null && current.original.url === current.url && current.secret === "";
    await look.run(async () => {
      let lookup: McpLookup;
      try {
        lookup = again
          ? await api<McpLookup>(`/mcp-servers/${current.slug}/refresh`, {
              method: "POST",
            })
          : await api<McpLookup>("/mcp-servers/discover", {
              method: "POST",
              body: {
                url: current.url,
                ...(current.headerName !== "" && {
                  headerName: current.headerName,
                }),
                ...(current.secret !== "" && { secret: current.secret }),
                timeoutSeconds: Number(current.timeoutSeconds),
                ...(SLUG.test(current.slug) && { slug: current.slug }),
              },
            });
      } catch (error) {
        // O redirecionamento não é seguido: a tela mostra o endereço que o servidor pediu.
        if (error instanceof ApiFailure && error.code === "mcp_redirect") setRedirect(String(error.detail?.location ?? ""));
        throw error;
      }
      patch({
        tools: marked(lookup),
        changes: Object.fromEntries((lookup.changes ?? []).map((item) => [item.name, item.change])),
        gone: (lookup.changes ?? []).filter((item) => item.change === "gone").map((item) => item.name),
        omitted: lookup.omitted,
        incomplete: lookup.incomplete,
      });
    });
  };

  const send = async (current: Draft, confirm?: string): Promise<void> => {
    if (!current.tools) return;
    const body = {
      label: current.label,
      url: current.url,
      ...(current.headerName !== "" && { headerName: current.headerName }),
      ...(current.secret !== "" && { secret: current.secret }),
      timeoutSeconds: Number(current.timeoutSeconds),
      tools: current.tools.map((tool) => ({
        name: tool.name,
        fingerprint: tool.fingerprint,
        allowed: tool.supported && tool.allowed,
        writes: tool.writes,
        needsApproval: tool.needsApproval,
      })),
      ...(confirm !== undefined && { confirm }),
    };
    let refusal: ApiFailure | undefined;
    const ok = await save.run(async () => {
      try {
        await api(`/mcp-servers/${current.slug}`, { method: "PUT", body });
      } catch (error) {
        if (error instanceof ApiFailure) refusal = error;
        throw error;
      }
    });
    if (refusal?.code === "mcp_tools_in_use")
      setInUse({
        tools: String(refusal.detail?.tools ?? ""),
        agents: String(refusal.detail?.agents ?? ""),
      });
    if (refusal?.code === "mcp_redirect") setRedirect(String(refusal.detail?.location ?? ""));
    if (ok) {
      close();
      servers.reload();
    }
  };

  const setTool = (name: string, next: Partial<McpTool>): void =>
    setDraft((current) =>
      current?.tools
        ? {
            ...current,
            tools: current.tools.map((tool) => (tool.name === name ? { ...tool, ...next } : tool)),
          }
        : current,
    );

  const changeText = (change: Change | undefined): string | null => (change === "new" ? t.changeNew : change === "changed" ? t.changeChanged : null);

  return (
    <Panel title={t.title} description={t.lead}>
      <div className="grid gap-4" data-testid="mcp-servers">
        {servers.error ? <Notice tone="fail">{errorText(servers.error)}</Notice> : null}
        {servers.data?.length === 0 && draft === null ? <p className="text-muted">{t.empty}</p> : null}
        <ul className="grid gap-3">
          {servers.data?.map((server) => {
            const count = server.tools.filter((tool) => tool.allowed).length;
            return (
              <li key={server.slug} className="grid gap-2 rounded-sm border border-line px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{server.label}</span>
                  <span className="data text-[0.87rem] text-muted">{server.slug}</span>
                  <span className="data text-[0.87rem] text-muted break-all">{server.url}</span>
                </div>
                <p className="text-[0.87rem] text-muted">
                  {fill(t.marked, { count, total: server.tools.length })} ·{" "}
                  {fill(t.fetchedAt, {
                    when: new Date(server.fetchedAt).toLocaleString(),
                  })}
                </p>
                <p className="text-[0.87rem] text-muted">
                  {server.agents.length > 0
                    ? fill(t.usedBy, {
                        agents: server.agents.map((agent) => agent.name).join(", "),
                      })
                    : t.usedByNone}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="ghost"
                    onClick={() => {
                      close();
                      setRemoving(null);
                      setDraft(fromServer(server));
                    }}
                  >
                    {t.edit}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      close();
                      setTyped("");
                      setRemoving(removing?.slug === server.slug ? null : server);
                    }}
                  >
                    {t.remove}
                  </Button>
                </div>
                {removing?.slug === server.slug ? (
                  <Notice tone="fail">
                    <p className="font-medium">{fill(t.removeTitle, { label: server.label })}</p>
                    <p>
                      {fill(t.removeBody, {
                        label: server.label,
                        url: server.url,
                        count,
                      })}
                    </p>
                    <p>
                      {server.agents.length > 0
                        ? fill(t.removeAgents, {
                            agents: server.agents.map((agent) => agent.name).join(", "),
                          })
                        : t.removeNoAgents}
                    </p>
                    <Field label={fill(t.typeSlug, { slug: server.slug })}>
                      <TextInput mono autoComplete="off" value={typed} onChange={(event) => setTyped(event.target.value)} />
                    </Field>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <Button
                        variant="danger"
                        disabled={typed !== server.slug}
                        busy={remove.busy}
                        onClick={() =>
                          void remove
                            .run(() =>
                              api(`/mcp-servers/${server.slug}`, {
                                method: "DELETE",
                                body: { confirm: typed },
                              }),
                            )
                            .then((ok) => {
                              if (!ok) return;
                              setRemoving(null);
                              servers.reload();
                            })
                        }
                      >
                        {fill(t.removeYes, { label: server.label })}
                      </Button>
                      <Button variant="ghost" onClick={() => setRemoving(null)}>
                        {t.cancel}
                      </Button>
                      <ActionStatus action={remove} />
                    </div>
                  </Notice>
                ) : null}
              </li>
            );
          })}
        </ul>

        {draft === null ? (
          <div>
            <Button
              variant="ghost"
              icon={<Plus size={18} weight="bold" aria-hidden />}
              onClick={() => {
                setRemoving(null);
                setDraft(blank());
              }}
            >
              {t.add}
            </Button>
          </div>
        ) : (
          <form
            className="grid gap-4 rounded-sm border border-line px-4 py-4"
            onSubmit={(event) => {
              event.preventDefault();
              void send(draft);
            }}
          >
            <div className="grid gap-3 md:grid-cols-[minmax(0,0.6fr)_minmax(0,1fr)]">
              <Field label={t.slug} hint={t.slugHint}>
                <TextInput
                  mono
                  value={draft.slug}
                  disabled={draft.original !== null}
                  onChange={(event) => patch({ slug: event.target.value.toLowerCase() })}
                  required
                  maxLength={16}
                  pattern="[a-z0-9]{1,16}"
                />
              </Field>
              <Field label={t.label}>
                <TextInput value={draft.label} onChange={(event) => patch({ label: event.target.value })} required maxLength={60} />
              </Field>
            </div>
            <div className="grid gap-3 md:grid-cols-[minmax(0,1.5fr)_minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,0.5fr)]">
              <Field label={t.url}>
                {/* Endereço novo pede a busca de novo, e o segredo guardado não vai para ele. */}
                <TextInput
                  mono
                  type="url"
                  placeholder={URL_PREFIX}
                  value={draft.url}
                  onChange={(event) =>
                    patch({
                      url: event.target.value,
                      tools: null,
                      changes: {},
                      gone: [],
                    })
                  }
                  required
                />
              </Field>
              <Field label={t.headerName}>
                <TextInput mono value={draft.headerName} onChange={(event) => patch({ headerName: event.target.value })} maxLength={64} />
              </Field>
              <Field label={t.secret} hint={draft.original?.secret.configured ? t.secretHint : undefined}>
                <TextInput
                  mono
                  type="password"
                  autoComplete="off"
                  placeholder={draft.original?.secret.configured && draft.original.url === draft.url ? t.secretKept : undefined}
                  value={draft.secret}
                  onChange={(event) => patch({ secret: event.target.value })}
                />
              </Field>
              <Field label={t.timeout}>
                <TextInput
                  mono
                  type="number"
                  min={WEBHOOK_MIN_TIMEOUT_SECONDS}
                  max={WEBHOOK_MAX_TIMEOUT_SECONDS}
                  step={1}
                  value={draft.timeoutSeconds}
                  onChange={(event) => patch({ timeoutSeconds: event.target.value })}
                  required
                />
              </Field>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="secondary" busy={look.busy} disabled={draft.url === ""} onClick={() => void lookUp(draft)}>
                {draft.original !== null && draft.original.url === draft.url ? t.lookAgain : t.look}
              </Button>
              {redirect === null ? <ActionStatus action={look} /> : null}
            </div>
            {redirect !== null ? <Notice tone="fail">{fill(t.redirect, { location: redirect })}</Notice> : null}

            {draft.tools !== null ? (
              <fieldset className="grid gap-2">
                <legend className="mb-2 font-medium">{t.toolsTitle}</legend>
                {draft.tools.length === 0 ? <p className="text-muted">{t.toolsNone}</p> : null}
                <ul className="grid gap-1">
                  {draft.tools.map((tool) => {
                    const change = changeText(draft.changes[tool.name]);
                    return (
                      <li key={tool.name} className="grid gap-1 rounded-sm px-3 py-2.5 hover:bg-sunken" data-testid={`mcp-tool-${tool.name}`}>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="data font-medium">{tool.name}</span>
                          {change ? <Badge tone="warn">{change}</Badge> : null}
                        </div>
                        <span className="text-[0.87rem] text-muted">{tool.description}</span>
                        {tool.supported ? (
                          <div className="flex flex-wrap gap-4">
                            <label className="flex items-center gap-2 text-[0.93rem]">
                              <input
                                type="checkbox"
                                checked={tool.allowed}
                                onChange={(event) =>
                                  setTool(tool.name, {
                                    allowed: event.target.checked,
                                  })
                                }
                              />
                              {t.allowed}
                            </label>
                            <label className="flex items-center gap-2 text-[0.93rem]">
                              <input
                                type="checkbox"
                                checked={tool.writes}
                                onChange={(event) =>
                                  setTool(tool.name, {
                                    writes: event.target.checked,
                                  })
                                }
                              />
                              {t.writes}
                            </label>
                            <label className="flex items-center gap-2 text-[0.93rem]">
                              <input
                                type="checkbox"
                                checked={tool.needsApproval}
                                onChange={(event) =>
                                  setTool(tool.name, {
                                    needsApproval: event.target.checked,
                                  })
                                }
                              />
                              {t.needsApproval}
                            </label>
                          </div>
                        ) : (
                          <p className="text-[0.87rem] text-fail">{t.unsupported}</p>
                        )}
                        {tool.readOnlyHint === true ? <p className="text-[0.87rem] text-muted">{t.readOnlyHint}</p> : null}
                      </li>
                    );
                  })}
                </ul>
                {draft.gone.length > 0 ? (
                  <ul className="grid gap-1">
                    {draft.gone.map((name) => (
                      <li key={name} className="flex flex-wrap items-center gap-2 px-3 text-[0.87rem] text-muted">
                        <span className="data">{name}</span>
                        <Badge tone="fail">{t.changeGone}</Badge>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {draft.omitted > 0 ? <p className="text-[0.87rem] text-muted">{fill(t.omitted, { count: draft.omitted })}</p> : null}
                {draft.incomplete ? <p className="text-[0.87rem] text-muted">{t.incomplete}</p> : null}
              </fieldset>
            ) : null}

            {inUse ? (
              <Notice tone="fail">
                <p className="font-medium">{t.inUseTitle}</p>
                <p>{fill(t.inUseBody, inUse)}</p>
                <Field label={fill(t.typeSlug, { slug: draft.slug })}>
                  <TextInput mono autoComplete="off" value={confirmTyped} onChange={(event) => setConfirmTyped(event.target.value)} />
                </Field>
                <div className="mt-1 flex flex-wrap gap-2">
                  <Button variant="danger" disabled={confirmTyped !== draft.slug} busy={save.busy} onClick={() => void send(draft, confirmTyped)}>
                    {t.inUseYes}
                  </Button>
                  <Button variant="ghost" onClick={() => setInUse(null)}>
                    {t.cancel}
                  </Button>
                </div>
              </Notice>
            ) : null}

            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" busy={save.busy} disabled={draft.tools === null || !SLUG.test(draft.slug)}>
                {t.save}
              </Button>
              <Button variant="ghost" onClick={close}>
                {t.cancel}
              </Button>
              <ActionStatus action={save} />
            </div>
          </form>
        )}
      </div>
    </Panel>
  );
}
