// O editor do teste do agente (fatia 7c): um formulário, e não JSON cru. Cada turno tem a fala de
// quem liga e o que se espera: as ferramentas, com os campos conferidos e a resposta escrita, e os
// trechos de fala. O estado mora na página; aqui só se desenha e se avisa a mudança.
import { fill } from "../../../../../i18n/locales";
import type { AgentTestsDictionary } from "../../../../../i18n/pt-BR/agent-tests";
import { Button, Field, Notice, Panel, Select, Switch, TextArea, TextInput } from "../../../../../ui/kit";
import { ARG_KINDS, MAX_TURNS, blankArg, blankTool, blankTurn, type ArgDraft, type ArgKind, type DraftProblem, type TestDraft, type ToolDraft, type TurnDraft } from "./form";

/** A frase de um problema do formulário, com o turno e a ferramenta contados a partir de 1. */
export function problemText(problem: DraftProblem, t: AgentTestsDictionary): string {
  const text = t.editor.problems[problem.problem];
  return fill(text, { turn: "turn" in problem ? problem.turn + 1 : "", tool: "tool" in problem ? problem.tool + 1 : "" });
}

const needsValue = (kind: ArgKind): boolean => kind === "equalsText" || kind === "equalsNumber" || kind === "contains";

export function TestEditor({
  draft,
  onChange,
  t,
  tools,
  isNew,
  problems,
  saving,
  error,
  onSave,
  onCancel,
}: {
  draft: TestDraft;
  onChange(next: TestDraft): void;
  t: AgentTestsDictionary;
  /** As ferramentas que o teste pode citar (`toolChoices`). */
  tools: readonly string[];
  isNew: boolean;
  /** Os problemas mostrados (depois da primeira tentativa de salvar). */
  problems: readonly DraftProblem[];
  saving: boolean;
  /** A recusa da rota, já na frase da tela. */
  error: string;
  onSave(): void;
  onCancel(): void;
}) {
  const e = t.editor;
  const setTurn = (index: number, next: TurnDraft): void => onChange({ ...draft, turns: draft.turns.map((turn, i) => (i === index ? next : turn)) });
  const setTool = (turnIndex: number, toolIndex: number, next: ToolDraft): void => {
    const turn = draft.turns[turnIndex];
    if (turn) setTurn(turnIndex, { ...turn, tools: turn.tools.map((tool, i) => (i === toolIndex ? next : tool)) });
  };
  const setArg = (turnIndex: number, toolIndex: number, argIndex: number, next: ArgDraft): void => {
    const tool = draft.turns[turnIndex]?.tools[toolIndex];
    if (tool) setTool(turnIndex, toolIndex, { ...tool, args: tool.args.map((arg, i) => (i === argIndex ? next : arg)) });
  };

  return (
    <Panel title={isNew ? e.newTitle : e.editTitle}>
      <form
        className="grid gap-6"
        onSubmit={(event) => {
          event.preventDefault();
          onSave();
        }}
      >
        <div className="max-w-xl">
          <Field label={e.name}>
            <TextInput value={draft.name} onChange={(event) => onChange({ ...draft, name: event.target.value })} placeholder={e.namePlaceholder} maxLength={120} required />
          </Field>
        </div>

        {draft.turns.map((turn, turnIndex) => (
          <fieldset key={turnIndex} className="grid gap-4 rounded-md border border-line p-4">
            <legend className="px-1 font-bold">{fill(e.turn, { n: turnIndex + 1 })}</legend>
            <Field label={e.user}>
              <TextArea value={turn.user} onChange={(event) => setTurn(turnIndex, { ...turn, user: event.target.value })} rows={2} maxLength={1000} required />
            </Field>

            <div className="grid gap-3">
              <span className="text-[0.87rem] font-bold">{e.tools}</span>
              {turn.tools.length === 0 ? <span className="text-[0.87rem] text-muted">{e.noTools}</span> : null}
              {turn.tools.map((tool, toolIndex) => (
                <div key={toolIndex} className="grid gap-3 rounded-sm bg-sunken p-3">
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="min-w-56">
                      <Field label={e.tool}>
                        <Select value={tool.tool} onChange={(event) => setTool(turnIndex, toolIndex, { ...tool, tool: event.target.value })} required>
                          <option value="">{e.chooseTool}</option>
                          {tools.map((name) => (
                            <option key={name} value={name}>
                              {name}
                            </option>
                          ))}
                        </Select>
                      </Field>
                    </div>
                    <Button type="button" variant="ghost" onClick={() => setTurn(turnIndex, { ...turn, tools: turn.tools.filter((_, i) => i !== toolIndex) })}>
                      {e.removeTool}
                    </Button>
                  </div>

                  <div className="grid gap-2">
                    <span className="text-[0.87rem] font-bold">{e.args}</span>
                    <span className="text-[0.87rem] text-muted">{e.argsHint}</span>
                    {tool.args.map((arg, argIndex) => (
                      <div key={argIndex} className="flex flex-wrap items-end gap-3">
                        <Field label={e.field}>
                          <TextInput mono value={arg.field} onChange={(event) => setArg(turnIndex, toolIndex, argIndex, { ...arg, field: event.target.value })} placeholder={e.fieldPlaceholder} />
                        </Field>
                        <Field label={e.kind}>
                          <Select value={arg.kind} onChange={(event) => setArg(turnIndex, toolIndex, argIndex, { ...arg, kind: event.target.value as ArgKind })}>
                            {ARG_KINDS.map((kind) => (
                              <option key={kind} value={kind}>
                                {e.kinds[kind]}
                              </option>
                            ))}
                          </Select>
                        </Field>
                        {needsValue(arg.kind) ? (
                          <Field label={e.value}>
                            <TextInput
                              value={arg.value}
                              inputMode={arg.kind === "equalsNumber" ? "decimal" : undefined}
                              onChange={(event) => setArg(turnIndex, toolIndex, argIndex, { ...arg, value: event.target.value })}
                            />
                          </Field>
                        ) : null}
                        <Button type="button" variant="ghost" onClick={() => setTool(turnIndex, toolIndex, { ...tool, args: tool.args.filter((_, i) => i !== argIndex) })}>
                          {e.removeArg}
                        </Button>
                      </div>
                    ))}
                    <Button type="button" variant="ghost" className="justify-self-start" onClick={() => setTool(turnIndex, toolIndex, { ...tool, args: [...tool.args, blankArg()] })}>
                      {e.addArg}
                    </Button>
                  </div>

                  <Field label={e.answer} hint={tool.keptResult !== undefined && tool.answer.trim() === "" ? e.answerKept : e.answerHint}>
                    <TextInput value={tool.answer} onChange={(event) => setTool(turnIndex, toolIndex, { ...tool, answer: event.target.value })} placeholder={e.answerPlaceholder} />
                  </Field>
                </div>
              ))}
              <Button type="button" className="justify-self-start" onClick={() => setTurn(turnIndex, { ...turn, tools: [...turn.tools, blankTool()] })}>
                {e.addTool}
              </Button>
            </div>

            <Switch checked={turn.onlyThese} onChange={(next) => setTurn(turnIndex, { ...turn, onlyThese: next })} label={e.onlyThese} />

            {tools.length > 0 ? (
              <div className="grid gap-2">
                <span className="text-[0.87rem] font-bold">{e.forbid}</span>
                <div className="flex flex-wrap gap-x-5 gap-y-2">
                  {tools.map((name) => (
                    <label key={name} className="inline-flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={turn.forbid.includes(name)}
                        onChange={(event) => setTurn(turnIndex, { ...turn, forbid: event.target.checked ? [...turn.forbid, name] : turn.forbid.filter((item) => item !== name) })}
                      />
                      <span className="data">{name}</span>
                    </label>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="grid gap-4 md:grid-cols-2">
              <Field label={e.says} hint={e.linesHint}>
                <TextArea value={turn.says} onChange={(event) => setTurn(turnIndex, { ...turn, says: event.target.value })} rows={2} />
              </Field>
              <Field label={e.saysNot} hint={e.linesHint}>
                <TextArea value={turn.saysNot} onChange={(event) => setTurn(turnIndex, { ...turn, saysNot: event.target.value })} rows={2} />
              </Field>
            </div>

            {draft.turns.length > 1 ? (
              <Button type="button" variant="ghost" className="justify-self-start" onClick={() => onChange({ ...draft, turns: draft.turns.filter((_, i) => i !== turnIndex) })}>
                {e.removeTurn}
              </Button>
            ) : null}
          </fieldset>
        ))}

        {draft.turns.length < MAX_TURNS ? (
          <Button type="button" className="justify-self-start" onClick={() => onChange({ ...draft, turns: [...draft.turns, blankTurn()] })}>
            {e.addTurn}
          </Button>
        ) : null}

        {problems.length > 0 ? (
          <Notice tone="fail">
            <ul className="grid gap-1">
              {problems.map((problem, index) => (
                <li key={index}>{problemText(problem, t)}</li>
              ))}
            </ul>
          </Notice>
        ) : null}
        {error ? <Notice tone="fail">{error}</Notice> : null}

        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" variant="primary" busy={saving}>
            {saving ? e.saving : e.save}
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>
            {t.cancel}
          </Button>
        </div>
      </form>
    </Panel>
  );
}
