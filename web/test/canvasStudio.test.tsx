// Job 001g: the canvas studio's stage and context tools, rendered statically (no effects, no
// network). Edit mode makes supported parts selectable and can't submit or take sample data; Try
// it is the working prototype as before; the tools show only the selected element's editor, an
// outline when nothing is selected, and the save bar's undo only when there is something to undo.

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { type Content, elementDomId, type Selection } from "../src/canvasEdit.ts";
import { ContextTools, FIRST_ID, type SaveControls } from "../src/pages/CanvasTools.tsx";
import { emptySample, PrototypePreview } from "../src/pages/Prototype.tsx";
import type { Prototype } from "../src/productsApi.ts";

const proto: Prototype = {
  schema: 1,
  screens: [
    {
      id: "screen_1",
      kind: "form",
      title: "Upload",
      fields: [{ key: "field_1", label: "Invoice file", type: "file_name", options: [] }],
      submit_label: "Read it",
    },
    {
      id: "screen_2",
      kind: "model",
      title: "Extract",
      source: "screen_1",
      outputs: [{ key: "field_1", label: "Total", type: "number", options: [] }],
    },
  ],
};
const draft: Content = {
  brief: {
    name: "Invoice reader",
    audience: "Bookkeepers",
    problem: "",
    promise: "",
    features: [],
    price: { model: "undecided", amount_cents: null, note: "" },
  },
  prototype: proto,
};
const noop = () => {};
const save = (o: Partial<SaveControls> = {}): SaveControls => ({
  dirty: false,
  busy: false,
  note: "",
  setNote: noop,
  save: noop,
  discard: noop,
  canUndo: false,
  canRedo: false,
  undo: noop,
  redo: noop,
  ...o,
});

const preview = (edit?: { selection: Selection | null }, screen: string | null = null) =>
  renderToStaticMarkup(
    <PrototypePreview
      name="Invoice reader"
      prototype={proto}
      sample={{ ...emptySample(), screen }}
      setSample={noop}
      edit={edit ? { selection: edit.selection, onSelect: noop } : undefined}
    />,
  );

describe("001g Try it is the working prototype; Edit can't submit", () => {
  it("Try it: a real form with its submit button, nothing selectable", () => {
    const html = preview();
    expect(html).toContain("<form");
    expect(html).toContain('type="submit"');
    expect(html).not.toContain('class="pick');
  });

  it("Edit: no form, no input that takes sample data; each supported part is a labelled button", () => {
    const html = preview({ selection: null });
    expect(html).not.toContain("<form");
    expect(html).not.toContain('type="submit"');
    expect(html).not.toMatch(/<(input|select|textarea)\b/);
    for (const sel of [
      { kind: "brief", section: "name" },
      { kind: "screen", screen: "screen_1" },
      { kind: "field", screen: "screen_1", key: "field_1" },
      { kind: "submit", screen: "screen_1" },
    ] as Selection[])
      expect(html).toContain(`id="${elementDomId(sel)}"`);
    expect(html).toContain('aria-label="Edit field: Invoice file"');
    expect(html).toContain('aria-label="Edit button: Read it"');
    expect(html).toContain("Nothing here submits");
  });

  it("the selected part is pressed; others are not", () => {
    const sel: Selection = { kind: "submit", screen: "screen_1" };
    const html = preview({ selection: sel });
    expect(html).toMatch(new RegExp(`id="${elementDomId(sel)}"[^>]*aria-pressed="true"`));
    expect(html).toMatch(
      new RegExp(
        `id="${elementDomId({ kind: "field", screen: "screen_1", key: "field_1" })}"[^>]*aria-pressed="false"`,
      ),
    );
  });

  it("a model step says why its behaviour isn't editable; only its result fields are selectable", () => {
    const html = preview({ selection: null }, "screen_2");
    expect(html).toContain("comes from a build, not from this");
    expect(html).toContain(
      `id="${elementDomId({ kind: "output", screen: "screen_2", key: "field_1" })}"`,
    );
    expect(html).not.toContain("No model is connected to this prototype");
  });
});

describe("001g the context tools show the selection's editor only", () => {
  const tools = (
    view: "preview" | "brief",
    mode: "try" | "edit",
    selection: Selection | null,
    s = save(),
  ) =>
    renderToStaticMarkup(
      <ContextTools
        view={view}
        mode={mode}
        selection={selection}
        draft={draft}
        starter={false}
        onDraft={noop}
        onSelect={noop}
        save={s}
      />,
    );

  it("a field: its label control first (focus target), not the other screens' editors", () => {
    const html = tools("preview", "edit", { kind: "field", screen: "screen_1", key: "field_1" });
    expect(html).toMatch(new RegExp(`<input id="${FIRST_ID}"[^>]*value="Invoice file"`));
    expect(html).toContain("Field: Invoice file on Upload");
    expect(html).not.toContain('aria-label="Screen title"');
    expect(html).not.toContain("Total");
  });

  it("the button: only its text", () => {
    const html = tools("preview", "edit", { kind: "submit", screen: "screen_1" });
    expect(html).toContain("Button text");
    expect(html).toMatch(new RegExp(`id="${FIRST_ID}"[^>]*value="Read it"`));
    expect(html).not.toContain("Invoice file");
  });

  it("a brief section: that field only, with the id the header's Next step focuses", () => {
    const html = tools("brief", "edit", { kind: "brief", section: "audience" });
    expect(html).toContain('id="brief-audience"');
    expect(html).toContain("Bookkeepers");
    expect(html).not.toContain('id="brief-name"');
  });

  it("nothing selected: the screens outline with Add, or the brief's sections", () => {
    const p = tools("preview", "edit", null);
    expect(p).toContain("Upload");
    expect(p).toContain("Extract");
    expect(p).toContain("Model step");
    const b = tools("brief", "edit", null);
    expect(b).toContain("Pricing assumption");
    expect(b).toContain("Select a section of the brief");
  });

  it("Try it: a hint, no editor; the save bar is always there", () => {
    const html = tools("preview", "try", { kind: "submit", screen: "screen_1" });
    expect(html).toContain("trying the prototype: forms add sample entries");
    expect(html).not.toContain("Button text");
    expect(html).toContain("Save revision");
  });

  it("Undo and Redo are enabled only when there is something to undo or redo; Discard only when dirty", () => {
    const idle = tools("preview", "edit", null);
    expect(idle).toMatch(/<button[^>]*disabled=""[^>]*>.*?Undo/s);
    expect(idle).not.toContain("Discard changes");
    const busy = tools("preview", "edit", null, save({ dirty: true, canUndo: true }));
    expect(busy).toContain("Discard changes");
    expect(busy).not.toMatch(/<button[^>]*disabled=""[^>]*><svg[^>]*>.*?<\/svg> ?Undo/s);
  });
});
