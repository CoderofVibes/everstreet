// The schema-rendered prototype and its editor. The preview renders only plain data as text:
// forms collect sample entries, lists and boards show and move them, and a model step shows the
// result shape it would return, saying plainly that no model is connected. Sample entries live
// in this browser tab only; nothing is sent anywhere.
//
// Job 001g: in Edit mode the same preview renders each supported element as a selectable button
// and nothing submits (no form, no sample input); the context tools edit what is selected. The
// per-screen and per-field editors below are those tools.

import { type ReactNode, useEffect, useRef, useState } from "react";
import { elementDomId, type Selection, selectionKey } from "../canvasEdit.ts";
import { Icon, type IconName } from "../icons.tsx";
import type { FieldType, ProtoField, Prototype, Screen } from "../productsApi.ts";

/** Job 001g: Edit mode's selection, passed to the preview. */
export interface PreviewEdit {
  selection: Selection | null;
  onSelect: (s: Selection) => void;
}

/** A selectable element in Edit mode: a real button, its role in its name. */
function Pick({
  sel,
  edit,
  label,
  className = "",
  children,
}: {
  sel: Selection;
  edit: PreviewEdit;
  label: string;
  className?: string;
  children: ReactNode;
}) {
  const on = edit.selection !== null && selectionKey(edit.selection) === selectionKey(sel);
  return (
    <button
      type="button"
      id={elementDomId(sel)}
      className={`pick${on ? " picked" : ""}${className ? ` ${className}` : ""}`}
      aria-pressed={on}
      aria-label={label}
      onClick={() => edit.onSelect(sel)}
    >
      {children}
    </button>
  );
}

// ---------- preview ----------

export interface SampleRecord {
  id: string;
  values: Record<string, string>;
  stage: number;
}

export interface SampleState {
  screen: string | null;
  records: Record<string, SampleRecord[]>;
  counter: number;
}

export const emptySample = (): SampleState => ({ screen: null, records: {}, counter: 0 });

const KIND_ICON: Record<Screen["kind"], IconName> = {
  form: "doc",
  list: "layers",
  model: "spark",
};

function FieldInput({
  field,
  value,
  onChange,
  id,
}: {
  field: ProtoField;
  value: string;
  onChange: (v: string) => void;
  id: string;
}) {
  if (field.type === "long_text")
    return (
      <textarea
        id={id}
        className="input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  if (field.type === "choice")
    return (
      <select id={id} className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose…</option>
        {field.options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  return (
    <input
      id={id}
      className="input"
      type={field.type === "number" ? "number" : "text"}
      value={value}
      placeholder={
        field.type === "file_name" ? "File name only; uploads aren't in the prototype" : ""
      }
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function FormScreen({
  screen,
  readers,
  onSubmit,
  onOpen,
}: {
  screen: Extract<Screen, { kind: "form" }>;
  readers: Screen[];
  onSubmit: (values: Record<string, string>) => void;
  onOpen: (id: string) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [added, setAdded] = useState(false);
  const filled = Object.values(values).some((v) => v.trim());
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!filled) return;
        onSubmit(values);
        setValues({});
        setAdded(true);
      }}
    >
      {screen.fields.map((field) => (
        <div className="field" key={field.key}>
          <label htmlFor={`proto-${screen.id}-${field.key}`} style={{ fontWeight: 600 }}>
            {field.label}
          </label>
          <FieldInput
            id={`proto-${screen.id}-${field.key}`}
            field={field}
            value={values[field.key] ?? ""}
            onChange={(v) => {
              setValues({ ...values, [field.key]: v });
              setAdded(false);
            }}
          />
        </div>
      ))}
      <div className="row">
        <button type="submit" className="btn btn-dark" disabled={!filled}>
          {screen.submit_label}
        </button>
        {added && (
          <span aria-live="polite" className="muted" style={{ fontSize: 13.5 }}>
            Added as a sample entry.{" "}
            {readers.map((r) => (
              <button
                key={r.id}
                type="button"
                className="btn btn-quiet btn-sm"
                onClick={() => onOpen(r.id)}
              >
                Open {r.title}
              </button>
            ))}
          </span>
        )}
      </div>
    </form>
  );
}

function summary(record: SampleRecord, fields: ProtoField[]) {
  const shown = fields
    .map((f) => record.values[f.key])
    .filter((v): v is string => Boolean(v?.trim()));
  return shown.slice(0, 2).join(" · ") || "Untitled entry";
}

function ListScreen({
  screen,
  source,
  records,
  onMove,
  onOpen,
}: {
  screen: Extract<Screen, { kind: "list" }>;
  source: Extract<Screen, { kind: "form" }> | undefined;
  records: SampleRecord[];
  onMove: (id: string, stage: number) => void;
  onOpen: (id: string) => void;
}) {
  const fields = source?.fields ?? [];
  if (records.length === 0)
    return (
      <div className="card empty" style={{ padding: 28 }}>
        <p style={{ margin: "0 0 10px" }}>No entries yet.</p>
        {source && (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => onOpen(source.id)}
          >
            Add one on {source.title}
          </button>
        )}
      </div>
    );
  if (screen.stages.length > 0)
    return (
      <div className="board">
        {screen.stages.map((stage, s) => {
          const here = records.filter((r) => Math.min(r.stage, screen.stages.length - 1) === s);
          return (
            <section className="board-col" key={stage} aria-label={stage}>
              <h3>
                <span>{stage}</span>
                <span>{here.length}</span>
              </h3>
              {here.map((r) => (
                <div className="board-card" key={r.id}>
                  {summary(r, fields)}
                  <div className="actions">
                    {s > 0 && (
                      <button
                        type="button"
                        className="btn btn-secondary btn-icon"
                        aria-label={`Move to ${screen.stages[s - 1]}`}
                        onClick={() => onMove(r.id, s - 1)}
                      >
                        <Icon name="arrowLeft" size="sm" />
                      </button>
                    )}
                    {s < screen.stages.length - 1 && (
                      <button
                        type="button"
                        className="btn btn-secondary btn-icon"
                        aria-label={`Move to ${screen.stages[s + 1]}`}
                        onClick={() => onMove(r.id, s + 1)}
                      >
                        <Icon name="arrowRight" size="sm" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </section>
          );
        })}
      </div>
    );
  return (
    <table className="table">
      <thead>
        <tr>
          {fields.map((f) => (
            <th key={f.key}>{f.label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {records.map((r) => (
          <tr key={r.id}>
            {fields.map((f) => (
              <td key={f.key}>{r.values[f.key] || <span className="muted">—</span>}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ModelScreen({
  screen,
  source,
  records,
}: {
  screen: Extract<Screen, { kind: "model" }>;
  source: Extract<Screen, { kind: "form" }> | undefined;
  records: SampleRecord[];
}) {
  const latest = records[records.length - 1];
  return (
    <>
      <div className="model-step">
        <strong style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Icon name="plug" /> No model is connected to this prototype
        </strong>
        <p style={{ margin: "6px 0 0", fontSize: 14 }}>
          This step would read {latest ? "the latest" : "an"} entry from {source?.title ?? "a form"}{" "}
          and return the fields below. Nothing is generated here; the values stay empty until a real
          build runs.
        </p>
      </div>
      {latest && source && (
        <p className="proto-note">
          Input it would receive: <strong>{summary(latest, source.fields)}</strong>
        </p>
      )}
      <table className="shape-table">
        <caption className="sr-only">Result shape</caption>
        <tbody>
          {screen.outputs.map((o) => (
            <tr key={o.key}>
              <th scope="row">{o.label}</th>
              <td>{o.type.replace("_", " ")} · not generated</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

/** Job 001g: one screen as Edit mode shows it: its parts selectable, nothing that submits. */
function EditScreen({
  screen,
  screens,
  edit,
}: {
  screen: Screen;
  screens: Screen[];
  edit: PreviewEdit;
}) {
  const sourceTitle = (id: string) => screens.find((s) => s.id === id)?.title ?? "no form";
  if (screen.kind === "form")
    return (
      <div className="edit-screen">
        {screen.fields.map((f) => (
          <Pick
            key={f.key}
            sel={{ kind: "field", screen: screen.id, key: f.key }}
            edit={edit}
            label={`Edit field: ${f.label || "unlabelled"}`}
            className="pick-field"
          >
            <span className="pick-label">{f.label || "Unlabelled field"}</span>
            <span className="pick-input" aria-hidden="true">
              {TYPE_LABEL[f.type]}
              {f.type === "choice" && f.options.length > 0 ? `: ${f.options.join(", ")}` : ""}
            </span>
          </Pick>
        ))}
        <Pick
          sel={{ kind: "submit", screen: screen.id }}
          edit={edit}
          label={`Edit button: ${screen.submit_label || "unlabelled"}`}
          className="pick-submit"
        >
          {screen.submit_label || "Unlabelled button"}
        </Pick>
      </div>
    );
  if (screen.kind === "list") {
    const source = screens.find((s) => s.id === screen.source);
    const columns =
      screen.stages.length > 0
        ? screen.stages
        : source?.kind === "form"
          ? source.fields.map((f) => f.label)
          : [];
    return (
      <div className="edit-screen">
        <Pick
          sel={{ kind: "stages", screen: screen.id }}
          edit={edit}
          label={`Edit ${screen.stages.length ? "stages" : "columns"} of ${screen.title || "this list"}`}
          className="pick-stages"
        >
          <span className="pick-label">
            {screen.stages.length ? "Board stages" : "Columns"} · reads from{" "}
            {sourceTitle(screen.source)}
          </span>
          <span className="pick-columns" aria-hidden="true">
            {columns.length ? columns.map((c) => <span key={c}>{c}</span>) : <span>None yet</span>}
          </span>
        </Pick>
        <p className="edit-why">Sample entries aren't part of the design; they appear in Try it.</p>
      </div>
    );
  }
  return (
    <div className="edit-screen">
      <p className="edit-why">
        <Icon name="plug" size="sm" /> What a model returns comes from a build, not from this
        prototype, so it can't be edited here. Its result fields can.
      </p>
      {screen.outputs.map((o) => (
        <Pick
          key={o.key}
          sel={{ kind: "output", screen: screen.id, key: o.key }}
          edit={edit}
          label={`Edit result field: ${o.label || "unlabelled"}`}
          className="pick-field"
        >
          <span className="pick-label">{o.label || "Unlabelled result"}</span>
          <span className="pick-input" aria-hidden="true">
            {TYPE_LABEL[o.type]} · not generated
          </span>
        </Pick>
      ))}
    </div>
  );
}

export function PrototypePreview({
  name,
  prototype,
  sample,
  setSample,
  edit,
}: {
  name: string;
  prototype: Prototype;
  sample: SampleState;
  setSample: (s: SampleState) => void;
  /** Job 001g: Edit mode (selectable parts, nothing submits); absent means Try it. */
  edit?: PreviewEdit;
}) {
  const screens = prototype.screens;
  const current = screens.find((s) => s.id === sample.screen) ?? screens[0];
  if (!current) return <p className="muted">This prototype has no screens yet.</p>;
  const form = (id: string) =>
    screens.find((s): s is Extract<Screen, { kind: "form" }> => s.kind === "form" && s.id === id);
  const open = (id: string) => setSample({ ...sample, screen: id });
  const nameSel: Selection = { kind: "brief", section: "name" };
  return (
    <div className={`proto${edit ? " editing" : ""}`}>
      <div className="proto-bar">
        <span className="dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        {edit ? (
          <Pick
            sel={nameSel}
            edit={edit}
            label={`Edit product name: ${name}`}
            className="pick-inline"
          >
            {name}
          </Pick>
        ) : (
          <span>{name}</span>
        )}
        <span className="proto-label">
          <Icon name="flask" size="sm" /> Prototype · not a working product
        </span>
      </div>
      <div className="proto-app">
        <nav className="proto-nav" aria-label="Prototype screens">
          <div className="brand">{name}</div>
          {screens.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-current={s.id === current.id ? "page" : undefined}
              onClick={() => {
                open(s.id);
                edit?.onSelect({ kind: "screen", screen: s.id });
              }}
            >
              <Icon name={KIND_ICON[s.kind]} size="sm" /> {s.title}
            </button>
          ))}
        </nav>
        <div className="proto-main">
          {edit ? (
            <>
              <h2>
                <Pick
                  sel={{ kind: "screen", screen: current.id }}
                  edit={edit}
                  label={`Edit screen: ${current.title || "untitled"}`}
                  className="pick-inline"
                >
                  {current.title || "Untitled screen"}
                </Pick>
              </h2>
              <EditScreen screen={current} screens={screens} edit={edit} />
              <p className="proto-note">
                Edit mode: select a part to change it. Nothing here submits; your sample entries
                come back in Try it.
              </p>
            </>
          ) : (
            <h2>{current.title}</h2>
          )}
          {!edit && current.kind === "form" && (
            <FormScreen
              key={current.id}
              screen={current}
              readers={screens.filter((s) => s.kind !== "form" && s.source === current.id)}
              onOpen={open}
              onSubmit={(values) => {
                const id = `r${sample.counter + 1}`;
                setSample({
                  ...sample,
                  counter: sample.counter + 1,
                  records: {
                    ...sample.records,
                    [current.id]: [...(sample.records[current.id] ?? []), { id, values, stage: 0 }],
                  },
                });
              }}
            />
          )}
          {!edit && current.kind === "list" && (
            <ListScreen
              screen={current}
              source={form(current.source)}
              records={sample.records[current.source] ?? []}
              onOpen={open}
              onMove={(id, stage) =>
                setSample({
                  ...sample,
                  records: {
                    ...sample.records,
                    [current.source]: (sample.records[current.source] ?? []).map((r) =>
                      r.id === id ? { ...r, stage } : r,
                    ),
                  },
                })
              }
            />
          )}
          {!edit && current.kind === "model" && (
            <ModelScreen
              screen={current}
              source={form(current.source)}
              records={sample.records[current.source] ?? []}
            />
          )}
          {!edit && (
            <p className="proto-note">
              Sample entries stay in this browser tab; they are not saved or sent anywhere.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- editor ----------

const TYPE_LABEL: Record<FieldType, string> = {
  text: "Short text",
  long_text: "Long text",
  number: "Number",
  choice: "Choice",
  file_name: "File name",
};

const KIND_LABEL: Record<Screen["kind"], string> = {
  form: "Form",
  list: "List",
  model: "Model step",
};

function freeKey(prefix: string, taken: string[]) {
  let n = 1;
  while (taken.includes(`${prefix}_${n}`)) n++;
  return `${prefix}_${n}`;
}

/** A comma-separated list that only commits on blur, so typing commas and spaces works. */
function CommaInput({
  value,
  onChange,
  label,
  placeholder,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  label: string;
  placeholder?: string;
}) {
  const joined = value.join(", ");
  const [text, setText] = useState(joined);
  const last = useRef(joined);
  useEffect(() => {
    if (joined !== last.current) {
      last.current = joined;
      setText(joined);
    }
  }, [joined]);
  return (
    <input
      className="input"
      aria-label={label}
      value={text}
      placeholder={placeholder}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const next = text
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        last.current = next.join(", ");
        setText(last.current);
        onChange(next);
      }}
    />
  );
}

/**
 * One field (or model output): label, type, choice options, remove. The last one can't be removed.
 * Job 001g: also the context tools for a single selected field.
 */
export function FieldRow({
  noun,
  index: i,
  fields,
  onChange,
  firstId,
}: {
  noun: string;
  index: number;
  fields: ProtoField[];
  onChange: (f: ProtoField[]) => void;
  /** Job 001g: the id of the first control, so selecting the field can move focus to it. */
  firstId?: string;
}) {
  const f = fields[i];
  if (!f) return null;
  const set = (patch: Partial<ProtoField>) =>
    onChange(fields.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <div className="field-edit">
      <input
        id={firstId}
        className="input"
        aria-label={`${noun} ${i + 1} label`}
        value={f.label}
        maxLength={80}
        onChange={(e) => set({ label: e.target.value })}
      />
      <select
        className="input"
        aria-label={`${noun} ${i + 1} type`}
        value={f.type}
        onChange={(e) => {
          const type = e.target.value as FieldType;
          set({
            type,
            options: type === "choice" ? (f.options.length ? f.options : ["Option A"]) : [],
          });
        }}
      >
        {(Object.keys(TYPE_LABEL) as FieldType[]).map((t) => (
          <option key={t} value={t}>
            {TYPE_LABEL[t]}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="btn btn-danger btn-icon"
        aria-label={`Remove ${f.label || `${noun} ${i + 1}`}`}
        title={fields.length === 1 ? `The last ${noun.toLowerCase()} can't be removed` : undefined}
        disabled={fields.length === 1}
        onClick={() => onChange(fields.filter((_, j) => j !== i))}
      >
        <Icon name="x" size="sm" />
      </button>
      {f.type === "choice" && (
        <div className="options">
          <CommaInput
            label={`${f.label} options, separated by commas`}
            value={f.options}
            placeholder="Options, separated by commas"
            onChange={(options) => set({ options })}
          />
        </div>
      )}
    </div>
  );
}

function FieldsEditor({
  fields,
  onChange,
  noun,
}: {
  fields: ProtoField[];
  onChange: (f: ProtoField[]) => void;
  noun: string;
}) {
  return (
    <>
      {fields.map((f, i) => (
        <FieldRow key={f.key} noun={noun} index={i} fields={fields} onChange={onChange} />
      ))}
      <button
        type="button"
        className="btn btn-quiet btn-sm"
        disabled={fields.length >= 12}
        onClick={() =>
          onChange([
            ...fields,
            {
              key: freeKey(
                "field",
                fields.map((f) => f.key),
              ),
              label: `New ${noun.toLowerCase()}`,
              type: "text",
              options: [],
            },
          ])
        }
      >
        <Icon name="plus" size="sm" /> Add {noun.toLowerCase()}
      </button>
    </>
  );
}

/** Job 001g: a new screen of this kind, appended; the same defaults as before. Null at 6 screens. */
export function addScreen(
  prototype: Prototype,
  kind: Screen["kind"],
): { prototype: Prototype; id: string } | null {
  const screens = prototype.screens;
  const forms = screens.filter((s) => s.kind === "form");
  if (screens.length >= 6 || (kind !== "form" && forms.length === 0)) return null;
  const id = freeKey(
    "screen",
    screens.map((s) => s.id),
  );
  const source = forms[0]?.id ?? "";
  const next: Screen =
    kind === "form"
      ? {
          id,
          kind,
          title: "New form",
          fields: [{ key: "field_1", label: "New field", type: "text", options: [] }],
          submit_label: "Submit",
        }
      : kind === "list"
        ? { id, kind, title: "New list", source, stages: [] }
        : {
            id,
            kind,
            title: "New model step",
            source,
            outputs: [{ key: "field_1", label: "Result", type: "text", options: [] }],
          };
  return { prototype: { ...prototype, screens: [...screens, next] }, id };
}

/** Why a screen can't be removed (another screen reads it, or it is the last form), or null. */
export function removeBlocked(prototype: Prototype, id: string): string | null {
  const screens = prototype.screens;
  const s = screens.find((x) => x.id === id);
  if (!s) return null;
  if (screens.length === 1) return "The prototype needs a screen";
  const readBy = screens.filter((o) => o.kind !== "form" && o.source === id);
  if (readBy.length) return `${readBy.map((r) => r.title).join(", ")} read from this form`;
  if (s.kind === "form" && screens.filter((x) => x.kind === "form").length === 1)
    return "The prototype needs a form";
  return null;
}

/**
 * Job 001g: the context tools for one screen. `part` narrows them to what was selected: the whole
 * screen, its button, or a list's source and stages. Same controls, labels and limits as the
 * previous all-screens editor.
 */
export function ScreenEditor({
  prototype,
  screenId,
  onChange,
  onRemoved,
  part = "all",
  firstId,
}: {
  prototype: Prototype;
  screenId: string;
  onChange: (p: Prototype) => void;
  onRemoved?: () => void;
  part?: "all" | "submit" | "stages";
  firstId?: string;
}) {
  const screens = prototype.screens;
  const i = screens.findIndex((s) => s.id === screenId);
  const s = screens[i];
  if (!s) return null;
  const forms = screens.filter((x) => x.kind === "form");
  const setScreen = (next: Screen) =>
    onChange({ ...prototype, screens: screens.map((x, j) => (j === i ? next : x)) });
  const blocked = removeBlocked(prototype, s.id);
  const all = part === "all";
  const buttonText = s.kind === "form" && (all || part === "submit") && (
    <label className="mini-field" style={{ marginTop: all ? 8 : 0, marginBottom: 0 }}>
      <span className="mini-label">Button text</span>
      <input
        id={all ? undefined : firstId}
        className="input"
        value={s.submit_label}
        maxLength={80}
        onChange={(e) => setScreen({ ...s, submit_label: e.target.value })}
      />
    </label>
  );
  const source = s.kind !== "form" && (all || part === "stages") && (
    <label className="mini-field">
      <span className="mini-label">Reads entries from</span>
      <select
        id={all ? undefined : firstId}
        className="input"
        value={s.source}
        onChange={(e) => setScreen({ ...s, source: e.target.value })}
      >
        {forms.map((fm) => (
          <option key={fm.id} value={fm.id}>
            {fm.title}
          </option>
        ))}
      </select>
    </label>
  );
  const stages = s.kind === "list" && (all || part === "stages") && (
    <div className="mini-field" style={{ marginBottom: 0 }}>
      <span className="mini-label">Stages (optional; makes it a board)</span>
      <CommaInput
        label="Stages, separated by commas"
        value={s.stages}
        placeholder="e.g. To do, In progress, Done"
        onChange={(next) => setScreen({ ...s, stages: next })}
      />
    </div>
  );
  if (!all)
    return (
      <div className="screen-edit">
        {buttonText}
        {source}
        {stages}
      </div>
    );
  return (
    <section className="screen-edit" aria-label={`${KIND_LABEL[s.kind]}: ${s.title}`}>
      <div className="se-head">
        <span className="pill" title={KIND_LABEL[s.kind]}>
          <Icon name={KIND_ICON[s.kind]} size="sm" /> {KIND_LABEL[s.kind]}
        </span>
        <input
          id={firstId}
          className="input"
          aria-label="Screen title"
          value={s.title}
          maxLength={80}
          onChange={(e) => setScreen({ ...s, title: e.target.value })}
        />
        <button
          type="button"
          className="btn btn-danger btn-icon"
          aria-label={`Remove screen ${s.title}`}
          title={blocked ?? "Remove screen"}
          disabled={blocked !== null}
          onClick={() => {
            onChange({ ...prototype, screens: screens.filter((_, j) => j !== i) });
            onRemoved?.();
          }}
        >
          <Icon name="x" size="sm" />
        </button>
      </div>
      {blocked && <p className="edit-why">Can't remove: {blocked.toLowerCase()}.</p>}
      {s.kind === "form" && (
        <FieldsEditor
          noun="Field"
          fields={s.fields}
          onChange={(fields) => setScreen({ ...s, fields })}
        />
      )}
      {buttonText}
      {source}
      {stages}
      {s.kind === "model" && (
        <>
          <span className="mini-label" style={{ display: "block", marginBottom: 6 }}>
            Result fields it should return
          </span>
          <FieldsEditor
            noun="Output"
            fields={s.outputs}
            onChange={(outputs) => setScreen({ ...s, outputs })}
          />
        </>
      )}
    </section>
  );
}

/** Job 001g: the screens as an outline (each selectable), and adding one. */
export function ScreenOutline({
  prototype,
  onSelect,
  onChange,
}: {
  prototype: Prototype;
  onSelect: (screenId: string) => void;
  onChange: (p: Prototype, added: string) => void;
}) {
  const screens = prototype.screens;
  return (
    <div className="outline">
      <ul className="outline-list">
        {screens.map((s) => (
          <li key={s.id}>
            <button type="button" className="outline-item" onClick={() => onSelect(s.id)}>
              <Icon name={KIND_ICON[s.kind]} size="sm" />
              <span>{s.title || "Untitled screen"}</span>
              <span className="muted">{KIND_LABEL[s.kind]}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="row" style={{ gap: 6 }}>
        <span className="muted" style={{ fontSize: 13 }}>
          Add:
        </span>
        {(["form", "list", "model"] as const).map((k) => {
          const next = addScreen(prototype, k);
          return (
            <button
              key={k}
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={next === null}
              title={
                next
                  ? undefined
                  : screens.length >= 6
                    ? "A prototype has at most 6 screens"
                    : "Add a form first"
              }
              onClick={() => next && onChange(next.prototype, next.id)}
            >
              <Icon name={KIND_ICON[k]} size="sm" /> {KIND_LABEL[k]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
