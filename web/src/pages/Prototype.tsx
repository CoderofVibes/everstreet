// The schema-rendered prototype and its editor. The preview renders only plain data as text:
// forms collect sample entries, lists and boards show and move them, and a model step shows the
// result shape it would return, saying plainly that no model is connected. Sample entries live
// in this browser tab only; nothing is sent anywhere.

import { useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "../icons.tsx";
import type { FieldType, ProtoField, Prototype, Screen } from "../productsApi.ts";

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

export function PrototypePreview({
  name,
  prototype,
  sample,
  setSample,
}: {
  name: string;
  prototype: Prototype;
  sample: SampleState;
  setSample: (s: SampleState) => void;
}) {
  const screens = prototype.screens;
  const current = screens.find((s) => s.id === sample.screen) ?? screens[0];
  if (!current) return <p className="muted">This prototype has no screens yet.</p>;
  const form = (id: string) =>
    screens.find((s): s is Extract<Screen, { kind: "form" }> => s.kind === "form" && s.id === id);
  const open = (id: string) => setSample({ ...sample, screen: id });
  return (
    <div className="proto">
      <div className="proto-bar">
        <span className="dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        <span>{name}</span>
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
              onClick={() => open(s.id)}
            >
              <Icon name={KIND_ICON[s.kind]} size="sm" /> {s.title}
            </button>
          ))}
        </nav>
        <div className="proto-main">
          <h2>{current.title}</h2>
          {current.kind === "form" && (
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
          {current.kind === "list" && (
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
          {current.kind === "model" && (
            <ModelScreen
              screen={current}
              source={form(current.source)}
              records={sample.records[current.source] ?? []}
            />
          )}
          <p className="proto-note">
            Sample entries stay in this browser tab; they are not saved or sent anywhere.
          </p>
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

function FieldsEditor({
  fields,
  onChange,
  noun,
}: {
  fields: ProtoField[];
  onChange: (f: ProtoField[]) => void;
  noun: string;
}) {
  const set = (i: number, patch: Partial<ProtoField>) =>
    onChange(fields.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  return (
    <>
      {fields.map((f, i) => (
        <div className="field-edit" key={f.key}>
          <input
            className="input"
            aria-label={`${noun} ${i + 1} label`}
            value={f.label}
            maxLength={80}
            onChange={(e) => set(i, { label: e.target.value })}
          />
          <select
            className="input"
            aria-label={`${noun} ${i + 1} type`}
            value={f.type}
            onChange={(e) => {
              const type = e.target.value as FieldType;
              set(i, {
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
                onChange={(options) => set(i, { options })}
              />
            </div>
          )}
        </div>
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

export function PrototypeEditor({
  prototype,
  onChange,
}: {
  prototype: Prototype;
  onChange: (p: Prototype) => void;
}) {
  const screens = prototype.screens;
  const forms = screens.filter((s) => s.kind === "form");
  const setScreen = (i: number, next: Screen) =>
    onChange({ ...prototype, screens: screens.map((s, j) => (j === i ? next : s)) });
  const ids = screens.map((s) => s.id);
  const add = (kind: Screen["kind"]) => {
    const id = freeKey("screen", ids);
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
    onChange({ ...prototype, screens: [...screens, next] });
  };

  return (
    <div>
      {screens.map((s, i) => {
        const readBy = screens.filter((o) => o.kind !== "form" && o.source === s.id);
        const lastForm = s.kind === "form" && forms.length === 1;
        return (
          <section
            className="screen-edit"
            key={s.id}
            aria-label={`${KIND_LABEL[s.kind]}: ${s.title}`}
          >
            <div className="se-head">
              <span className="pill" title={KIND_LABEL[s.kind]}>
                <Icon name={KIND_ICON[s.kind]} size="sm" /> {KIND_LABEL[s.kind]}
              </span>
              <input
                className="input"
                aria-label="Screen title"
                value={s.title}
                maxLength={80}
                onChange={(e) => setScreen(i, { ...s, title: e.target.value })}
              />
              <button
                type="button"
                className="btn btn-danger btn-icon"
                aria-label={`Remove screen ${s.title}`}
                title={
                  readBy.length
                    ? `${readBy.map((r) => r.title).join(", ")} read from this form`
                    : lastForm
                      ? "The prototype needs a form"
                      : "Remove screen"
                }
                disabled={screens.length === 1 || readBy.length > 0 || lastForm}
                onClick={() =>
                  onChange({ ...prototype, screens: screens.filter((_, j) => j !== i) })
                }
              >
                <Icon name="x" size="sm" />
              </button>
            </div>
            {s.kind === "form" && (
              <>
                <FieldsEditor
                  noun="Field"
                  fields={s.fields}
                  onChange={(fields) => setScreen(i, { ...s, fields })}
                />
                <label className="mini-field" style={{ marginTop: 8, marginBottom: 0 }}>
                  <span className="mini-label">Button text</span>
                  <input
                    className="input"
                    value={s.submit_label}
                    maxLength={80}
                    onChange={(e) => setScreen(i, { ...s, submit_label: e.target.value })}
                  />
                </label>
              </>
            )}
            {s.kind !== "form" && (
              <label className="mini-field">
                <span className="mini-label">Reads entries from</span>
                <select
                  className="input"
                  value={s.source}
                  onChange={(e) => setScreen(i, { ...s, source: e.target.value })}
                >
                  {forms.map((fm) => (
                    <option key={fm.id} value={fm.id}>
                      {fm.title}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {s.kind === "list" && (
              <div className="mini-field" style={{ marginBottom: 0 }}>
                <span className="mini-label">Stages (optional; makes it a board)</span>
                <CommaInput
                  label="Stages, separated by commas"
                  value={s.stages}
                  placeholder="e.g. To do, In progress, Done"
                  onChange={(stages) => setScreen(i, { ...s, stages })}
                />
              </div>
            )}
            {s.kind === "model" && (
              <>
                <span className="mini-label" style={{ display: "block", marginBottom: 6 }}>
                  Result fields it should return
                </span>
                <FieldsEditor
                  noun="Output"
                  fields={s.outputs}
                  onChange={(outputs) => setScreen(i, { ...s, outputs })}
                />
              </>
            )}
          </section>
        );
      })}
      <div className="row" style={{ gap: 6 }}>
        <span className="muted" style={{ fontSize: 13 }}>
          Add:
        </span>
        {(["form", "list", "model"] as const).map((k) => (
          <button
            key={k}
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={screens.length >= 6 || (k !== "form" && forms.length === 0)}
            onClick={() => add(k)}
          >
            <Icon name={KIND_ICON[k]} size="sm" /> {KIND_LABEL[k]}
          </button>
        ))}
      </div>
    </div>
  );
}
