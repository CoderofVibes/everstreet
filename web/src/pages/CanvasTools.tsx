// Job 001g: the canvas studio's context tools. For the one element selected in Edit mode they show
// its editor only; with nothing selected, an outline (the screens, or the brief's sections). The
// footer holds the change note, Save revision, Discard changes, and Undo/Redo of unsaved edits.
// Everything edits the unsaved draft held by the studio; nothing here saves on its own.

import { type KeyboardEvent, type ReactNode, useEffect, useState } from "react";
import {
  BRIEF_SECTIONS,
  type BriefSection,
  type Content,
  elementDomId,
  type Selection,
  selectionLabel,
} from "../canvasEdit.ts";
import { Icon } from "../icons.tsx";
import { type Brief, PRICE_LABEL, type PriceModel } from "../productsApi.ts";
import { FieldRow, ScreenEditor, ScreenOutline } from "./Prototype.tsx";

/** The id of the tools region and of the first control of the selection's editor. */
export const TOOLS_ID = "ctx-tools";
export const FIRST_ID = "ctx-first";

/** Brief to-do ids the header's "Next" step focuses, per section (kept from the old editor). */
export const BRIEF_FIELD_ID: Record<BriefSection, string> = {
  name: "brief-name",
  audience: "brief-audience",
  problem: "brief-problem",
  promise: "brief-promise",
  features: "brief-feature-add",
  price: "brief-price",
};

function MoneyInput({
  cents,
  onChange,
  id,
}: {
  cents: number | null;
  onChange: (c: number | null) => void;
  id: string;
}) {
  const fromCents = cents === null ? "" : String(cents / 100);
  const [text, setText] = useState(fromCents);
  useEffect(() => {
    setText((t) => {
      const parsed = t.trim() === "" ? null : Math.round(Number(t) * 100);
      return parsed === cents ? t : fromCents;
    });
  }, [cents, fromCents]);
  return (
    <input
      id={id}
      className="input"
      inputMode="decimal"
      value={text}
      placeholder="0.00"
      aria-describedby={`${id}-hint`}
      onChange={(e) => {
        const v = e.target.value;
        setText(v);
        if (v.trim() === "") return onChange(null);
        const n = Number(v);
        if (Number.isFinite(n) && n >= 0) onChange(Math.round(n * 100));
      }}
    />
  );
}

/** One section of the brief, the same controls, ids and limits as the previous brief editor. */
export function BriefSectionEditor({
  section,
  brief,
  starter,
  onChange,
}: {
  section: BriefSection;
  brief: Brief;
  starter: boolean;
  onChange: (b: Brief) => void;
}) {
  const set = (patch: Partial<Brief>) => onChange({ ...brief, ...patch });
  const text = (key: "audience" | "problem" | "promise", label: string, placeholder: string) => (
    <div className="mini-field">
      <label className="mini-label" htmlFor={`brief-${key}`}>
        <span>{label}</span>
      </label>
      <textarea
        id={`brief-${key}`}
        className="input"
        maxLength={600}
        value={brief[key]}
        placeholder={placeholder}
        onChange={(e) => set({ [key]: e.target.value })}
      />
    </div>
  );
  if (section === "name")
    return (
      <div className="mini-field">
        <label className="mini-label" htmlFor="brief-name">
          <span>Product name</span>
        </label>
        <input
          id="brief-name"
          className="input"
          maxLength={80}
          value={brief.name}
          onChange={(e) => set({ name: e.target.value })}
        />
      </div>
    );
  if (section === "audience")
    return text("audience", "Who it's for", "The people who would use and pay for it");
  if (section === "problem") return text("problem", "Problem", "What goes wrong for them today");
  if (section === "promise")
    return text("promise", "Promised result", "What a customer can count on getting");
  if (section === "features")
    return (
      <div className="mini-field">
        <div className="mini-label">
          <span>Core features</span>
          {starter && <span className="starter-tag">Starter suggestions</span>}
        </div>
        <div className="list-edit">
          {brief.features.map((feature, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: features are edited in place; position is their identity
            <div className="item" key={i}>
              <input
                className="input"
                aria-label={`Feature ${i + 1}`}
                maxLength={140}
                value={feature}
                onChange={(e) =>
                  set({ features: brief.features.map((x, j) => (j === i ? e.target.value : x)) })
                }
              />
              <button
                type="button"
                className="btn btn-danger btn-icon"
                aria-label={`Remove feature ${i + 1}`}
                onClick={() => set({ features: brief.features.filter((_, j) => j !== i) })}
              >
                <Icon name="x" size="sm" />
              </button>
            </div>
          ))}
          <button
            id="brief-feature-add"
            type="button"
            className="btn btn-quiet btn-sm"
            style={{ justifySelf: "start" }}
            disabled={brief.features.length >= 8}
            onClick={() => set({ features: [...brief.features, ""] })}
          >
            <Icon name="plus" size="sm" /> Add feature
          </button>
        </div>
      </div>
    );
  const needsAmount = brief.price.model !== "free" && brief.price.model !== "undecided";
  return (
    <div className="mini-field">
      <span className="mini-label">Pricing assumption</span>
      <fieldset className="seg wrap">
        <legend className="sr-only">Pricing model</legend>
        {(Object.keys(PRICE_LABEL) as PriceModel[]).map((m, i) => (
          <button
            key={m}
            id={i === 0 ? "brief-price" : undefined}
            type="button"
            aria-pressed={brief.price.model === m}
            onClick={() => set({ price: { ...brief.price, model: m } })}
          >
            {PRICE_LABEL[m]}
          </button>
        ))}
      </fieldset>
      {needsAmount && (
        <div className="grid-2" style={{ gap: 8, marginTop: 6 }}>
          <MoneyInput
            id="brief-amount"
            cents={brief.price.amount_cents}
            onChange={(amount_cents) => set({ price: { ...brief.price, amount_cents } })}
          />
          <span
            id="brief-amount-hint"
            className="muted"
            style={{ fontSize: 12.5, alignSelf: "center" }}
          >
            US dollars{" "}
            {{ per_use: "per use", monthly: "per month", one_time: "once" }[
              brief.price.model as "per_use"
            ] ?? ""}
          </span>
        </div>
      )}
      <input
        className="input"
        aria-label="Pricing note"
        style={{ marginTop: 6 }}
        maxLength={600}
        value={brief.price.note}
        placeholder="Note, e.g. prepaid packs of 100"
        onChange={(e) => set({ price: { ...brief.price, note: e.target.value } })}
      />
      <p className="edit-why">An assumption to test, not a published price.</p>
    </div>
  );
}

/** The editor for one selection (null when nothing is selected). */
function SelectionEditor({
  sel,
  draft,
  starter,
  onDraft,
  onSelect,
}: {
  sel: Selection;
  draft: Content;
  starter: boolean;
  onDraft: (c: Content) => void;
  onSelect: (s: Selection | null) => void;
}) {
  const p = draft.prototype;
  const setProto = (prototype: typeof p) => onDraft({ ...draft, prototype });
  if (sel.kind === "brief")
    return (
      <BriefSectionEditor
        section={sel.section}
        brief={draft.brief}
        starter={starter}
        onChange={(brief) => onDraft({ ...draft, brief })}
      />
    );
  if (sel.kind === "screen")
    return (
      <ScreenEditor
        prototype={p}
        screenId={sel.screen}
        firstId={FIRST_ID}
        onChange={setProto}
        onRemoved={() => onSelect(null)}
      />
    );
  if (sel.kind === "submit" || sel.kind === "stages")
    return (
      <ScreenEditor
        prototype={p}
        screenId={sel.screen}
        part={sel.kind}
        firstId={FIRST_ID}
        onChange={setProto}
      />
    );
  const i = p.screens.findIndex((s) => s.id === sel.screen);
  const s = p.screens[i];
  if (!s || s.kind === "list") return null;
  const fields = s.kind === "form" ? s.fields : s.outputs;
  const index = fields.findIndex((f) => f.key === sel.key);
  return (
    <FieldRow
      noun={s.kind === "form" ? "Field" : "Output"}
      index={index}
      fields={fields}
      firstId={FIRST_ID}
      onChange={(next) => {
        const screen = s.kind === "form" ? { ...s, fields: next } : { ...s, outputs: next };
        setProto({ ...p, screens: p.screens.map((x, j) => (j === i ? screen : x)) });
        // A removed field: back to its screen, never to a different field.
        if (!next.some((f) => f.key === sel.key)) onSelect({ kind: "screen", screen: s.id });
      }}
    />
  );
}

/**
 * Job 001g1: move focus to an element and make sure it can be seen. `nearest` scrolls only as far
 * as needed and honours the studio's scroll margins, so it lands clear of the sticky site header.
 */
export function reveal(el: HTMLElement | null) {
  if (!el) return;
  el.focus({ preventScroll: true });
  el.scrollIntoView({ block: "nearest" });
}

export interface SaveControls {
  dirty: boolean;
  busy: boolean;
  note: string;
  setNote: (n: string) => void;
  save: () => void;
  discard: () => void;
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
}

export function ContextTools({
  view,
  mode,
  selection,
  draft,
  starter,
  onDraft,
  onSelect,
  save,
}: {
  view: "preview" | "brief";
  mode: "try" | "edit";
  /** Already resolved for this view (canvasEdit selectionFor + resolveSelection). */
  selection: Selection | null;
  draft: Content;
  starter: boolean;
  onDraft: (c: Content) => void;
  onSelect: (s: Selection | null) => void;
  save: SaveControls;
}) {
  // Escape in the tools returns focus to the selected element in the stage; the selection stays.
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Escape" || !selection) return;
    const el = document.getElementById(elementDomId(selection));
    if (!el) return;
    e.preventDefault();
    reveal(el);
  };
  let body: ReactNode;
  if (mode === "try")
    body = (
      <p className="tools-hint">
        {view === "preview"
          ? "You're trying the prototype: forms add sample entries in this tab only."
          : "You're reading the brief."}{" "}
        Switch to <strong>Edit</strong> to select a part and change it.
      </p>
    );
  else if (selection)
    body = (
      <SelectionEditor
        sel={selection}
        draft={draft}
        starter={starter}
        onDraft={onDraft}
        onSelect={onSelect}
      />
    );
  else if (view === "preview")
    body = (
      <>
        <p className="tools-hint">Select a part of the preview to change it, or choose a screen.</p>
        <ScreenOutline
          prototype={draft.prototype}
          onSelect={(screen) => onSelect({ kind: "screen", screen })}
          onChange={(prototype, added) => {
            onDraft({ ...draft, prototype });
            onSelect({ kind: "screen", screen: added });
          }}
        />
      </>
    );
  else
    body = (
      <>
        <p className="tools-hint">Select a section of the brief to change it.</p>
        <ul className="outline-list">
          {BRIEF_SECTIONS.map((b) => (
            <li key={b.id}>
              <button
                type="button"
                className="outline-item"
                onClick={() => onSelect({ kind: "brief", section: b.id })}
              >
                <span>{b.label}</span>
              </button>
            </li>
          ))}
        </ul>
      </>
    );
  return (
    // Escape inside the tools returns focus to the selected element in the stage.
    <section
      className="ctx-tools"
      id={TOOLS_ID}
      tabIndex={-1}
      aria-label="Context tools"
      onKeyDown={onKeyDown}
    >
      <div className="ctx-head">
        <span className="ctx-kicker">{mode === "edit" ? "Editing" : "Trying"}</span>
        <h2 className="ctx-title">
          {mode === "edit" && selection
            ? selectionLabel(selection, draft.prototype)
            : view === "preview"
              ? "Screens"
              : "Brief"}
        </h2>
        {mode === "edit" && selection && (
          <button
            type="button"
            className="btn btn-quiet btn-sm"
            onClick={() => {
              // Back to the element in the stage, so focus isn't lost with this button.
              const back = elementDomId(selection);
              onSelect(null);
              window.setTimeout(() => reveal(document.getElementById(back)), 0);
            }}
          >
            Done
          </button>
        )}
      </div>
      <div className="ctx-body">{body}</div>
      <SaveBar s={save} />
    </section>
  );
}

/** The change note, Save revision, Discard changes, and Undo/Redo of unsaved edits. */
export function SaveBar({ s }: { s: SaveControls }) {
  return (
    <div className="ps-savebar">
      <div className="row" style={{ gap: 6 }}>
        <button
          type="button"
          className="btn btn-quiet btn-sm"
          disabled={!s.canUndo}
          onClick={s.undo}
        >
          <Icon name="history" size="sm" /> Undo
        </button>
        <button
          type="button"
          className="btn btn-quiet btn-sm"
          disabled={!s.canRedo}
          onClick={s.redo}
        >
          Redo
        </button>
        <span className="spacer" />
        <span className="muted" style={{ fontSize: 12 }}>
          Unsaved edits only
        </span>
      </div>
      <input
        className="input"
        aria-label="What changed (optional)"
        placeholder="What changed? (optional)"
        maxLength={200}
        value={s.note}
        disabled={!s.dirty}
        onChange={(e) => s.setNote(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") s.save();
        }}
      />
      <div className="row" style={{ gap: 8 }}>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!s.dirty || s.busy}
          onClick={s.save}
        >
          {s.busy ? "Saving…" : "Save revision"}
        </button>
        {s.dirty && (
          <button type="button" className="btn btn-quiet btn-sm" onClick={s.discard}>
            Discard changes
          </button>
        )}
        <span className="spacer" />
        <span className="muted" style={{ fontSize: 12 }}>
          <kbd>Ctrl</kbd> + <kbd>S</kbd>
        </span>
      </div>
    </div>
  );
}
