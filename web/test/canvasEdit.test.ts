// Job 001g: the canvas studio's editing model. A selection resolves only to the element it named
// (never a different one after apply, restore, discard or removal); each view shows only its own
// selections; undo is local to unsaved edits, coalesces typing in one control, is bounded, and a
// new edit drops the redo branch. Pure; finite.

import { describe, expect, it } from "vitest";
import {
  type Content,
  changeKey,
  elementDomId,
  emptyHistory,
  firstForm,
  recordEdit,
  redoEdit,
  resolveSelection,
  type Selection,
  selectionFor,
  selectionLabel,
  UNDO_LIMIT,
  undoEdit,
} from "../src/canvasEdit.ts";
import { addScreen, removeBlocked } from "../src/pages/Prototype.tsx";
import type { Prototype } from "../src/productsApi.ts";

const proto = (): Prototype => ({
  schema: 1,
  screens: [
    {
      id: "screen_1",
      kind: "form",
      title: "Upload",
      fields: [
        { key: "field_1", label: "Invoice file", type: "file_name", options: [] },
        { key: "field_2", label: "Supplier", type: "text", options: [] },
      ],
      submit_label: "Read it",
    },
    { id: "screen_2", kind: "list", title: "Results", source: "screen_1", stages: [] },
    {
      id: "screen_3",
      kind: "model",
      title: "Extract",
      source: "screen_1",
      outputs: [{ key: "field_1", label: "Total", type: "number", options: [] }],
    },
  ],
});

describe("001g a selection names one element, or nothing", () => {
  it("each kind resolves only while its element exists with the right kind", () => {
    const p = proto();
    const ok: Selection[] = [
      { kind: "screen", screen: "screen_2" },
      { kind: "field", screen: "screen_1", key: "field_2" },
      { kind: "submit", screen: "screen_1" },
      { kind: "stages", screen: "screen_2" },
      { kind: "output", screen: "screen_3", key: "field_1" },
      { kind: "brief", section: "price" },
    ];
    for (const s of ok) expect(resolveSelection(s, p)).toEqual(s);
    const gone: Selection[] = [
      { kind: "screen", screen: "screen_9" },
      { kind: "field", screen: "screen_1", key: "field_9" },
      // Same key, wrong kind of screen: never redirected to the model's output.
      { kind: "field", screen: "screen_3", key: "field_1" },
      { kind: "submit", screen: "screen_2" },
      { kind: "stages", screen: "screen_1" },
      { kind: "output", screen: "screen_1", key: "field_1" },
    ];
    for (const s of gone) expect(resolveSelection(s, p)).toBeNull();
    expect(resolveSelection(null, p)).toBeNull();
  });

  it("after the field is removed (or a restore drops its screen) the selection is nothing", () => {
    const p = proto();
    const sel: Selection = { kind: "field", screen: "screen_1", key: "field_2" };
    const form = p.screens[0];
    if (form?.kind !== "form") throw new Error("fixture");
    const removed: Prototype = {
      ...p,
      screens: [{ ...form, fields: form.fields.slice(0, 1) }, ...p.screens.slice(1)],
    };
    expect(resolveSelection(sel, removed)).toBeNull();
    expect(resolveSelection(sel, { ...p, screens: p.screens.slice(1) })).toBeNull();
  });

  it("the preview shows prototype selections and the product name; the brief only its sections", () => {
    const field: Selection = { kind: "field", screen: "screen_1", key: "field_1" };
    const name: Selection = { kind: "brief", section: "name" };
    const audience: Selection = { kind: "brief", section: "audience" };
    expect(selectionFor("preview", field)).toEqual(field);
    expect(selectionFor("preview", name)).toEqual(name);
    expect(selectionFor("preview", audience)).toBeNull();
    expect(selectionFor("brief", audience)).toEqual(audience);
    expect(selectionFor("brief", field)).toBeNull();
  });

  it("every selectable element has a distinct, valid DOM id and a plain label", () => {
    const sels: Selection[] = [
      { kind: "screen", screen: "screen_1" },
      { kind: "field", screen: "screen_1", key: "field_1" },
      { kind: "output", screen: "screen_1", key: "field_1" },
      { kind: "submit", screen: "screen_1" },
      { kind: "brief", section: "name" },
    ];
    const ids = sels.map(elementDomId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^pick-[A-Za-z0-9_-]+$/);
    const p = proto();
    expect(selectionLabel({ kind: "field", screen: "screen_1", key: "field_1" }, p)).toBe(
      "Field: Invoice file on Upload",
    );
    expect(selectionLabel({ kind: "submit", screen: "screen_1" }, p)).toBe("Button on Upload");
    expect(selectionLabel({ kind: "brief", section: "promise" }, p)).toBe("Promised result");
    expect(firstForm(p)).toBe("screen_1");
  });
});

describe("001g undo of unsaved edits", () => {
  const content = (name: string, p = proto()): Content =>
    ({
      brief: {
        name,
        audience: "",
        problem: "",
        promise: "",
        features: [],
        price: { model: "undecided", amount_cents: null, note: "" },
      },
      prototype: p,
    }) as Content;

  it("typing in one control is one step; another control or a structural change is another", () => {
    expect(changeKey(content("A"), content("Ab"))).toBe("/brief/name");
    expect(changeKey(content("A"), content("A"))).toBeNull();
    const p = proto();
    const fewer: Prototype = { ...p, screens: p.screens.slice(0, 2) };
    expect(changeKey(content("A", p), content("A", fewer))).toBeNull();

    let h = emptyHistory<Content>();
    const steps = [content("I"), content("In"), content("Inv"), content("Invo")];
    for (let i = 1; i < steps.length; i++) h = recordEdit(h, steps[i - 1], steps[i]);
    expect(h.past.length).toBe(1); // three keystrokes, one step
    const r = undoEdit(h, steps[3] as Content);
    expect(r?.value.brief.name).toBe("I");
    // A structural edit is its own step, even right after typing.
    h = recordEdit(h, steps[3] as Content, content("Invo", fewer));
    expect(h.past.length).toBe(2);
  });

  it("undo then redo returns exactly; a new edit drops the redo branch; nothing to undo is null", () => {
    let h = emptyHistory<Content>();
    expect(undoEdit(h, content("x"))).toBeNull();
    expect(redoEdit(h, content("x"))).toBeNull();
    const a = content("a");
    const b = content("a", { ...proto(), screens: proto().screens.slice(0, 2) });
    h = recordEdit(h, a, b);
    const u = undoEdit(h, b);
    expect(u?.value).toEqual(a);
    const r = u && redoEdit(u.history, a);
    expect(r?.value).toEqual(b);
    // After an undo, typing again starts a new step and drops what could be redone.
    const again = u && recordEdit(u.history, a, content("ab"));
    expect(again?.future).toEqual([]);
    expect(again?.past).toEqual([a]);
  });

  it("history is bounded", () => {
    let h = emptyHistory<number[]>();
    for (let i = 0; i < UNDO_LIMIT + 20; i++) h = recordEdit(h, [i], [i, i]);
    expect(h.past.length).toBe(UNDO_LIMIT);
    expect(h.past[0]).toEqual([20]);
  });
});

describe("001g screens: the same limits as before", () => {
  it("adding stops at six screens and needs a form for lists and model steps", () => {
    let p = proto();
    const added = addScreen(p, "list");
    expect(added?.id).toBe("screen_4");
    expect(added?.prototype.screens).toHaveLength(4);
    for (let i = 0; i < 3; i++) p = addScreen(p, "form")?.prototype ?? p;
    expect(p.screens).toHaveLength(6);
    expect(addScreen(p, "form")).toBeNull();
    const noForm: Prototype = { schema: 1, screens: [] };
    expect(addScreen(noForm, "model")).toBeNull();
    expect(addScreen(noForm, "form")?.id).toBe("screen_1");
  });

  it("a form other screens read from, or the last form, can't be removed, and says why", () => {
    const p = proto();
    expect(removeBlocked(p, "screen_1")).toBe("Results, Extract read from this form");
    expect(removeBlocked(p, "screen_2")).toBeNull();
    const formOnly: Prototype = { schema: 1, screens: p.screens.slice(0, 1) };
    expect(removeBlocked(formOnly, "screen_1")).toBe("The prototype needs a screen");
    const twoForms: Prototype = {
      schema: 1,
      screens: [
        p.screens[0] as Prototype["screens"][number],
        { ...(p.screens[0] as Prototype["screens"][number]), id: "screen_9" },
      ],
    };
    expect(removeBlocked(twoForms, "screen_9")).toBeNull();
  });
});
