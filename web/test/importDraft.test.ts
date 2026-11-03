// Job 004a1: import drafts and request ordering. These rules decide what the page shows when
// requests finish out of order, when an answer is lost, and when the founder keeps typing.

import { describe, expect, it } from "vitest";
import {
  cleared,
  type DepDraft,
  type DetailsDraft,
  depAfter,
  depAfterOwnSave,
  depShown,
  detailsAfter,
  detailsAfterOwnSave,
  detailsShown,
  editDep,
  editDetails,
  emptyManifest,
  fileChosen,
  fileRead,
  inspectFinished,
  pasted,
  reconcile,
  recoverInspect,
  rowStatus,
  select,
  snapshotLoaded,
  startInspect,
} from "../src/importDraft.ts";
import type { Category, ImportView, Report } from "../src/importsApi.ts";

const CATS: Category[] = [
  "source_ownership",
  "hosting",
  "database",
  "model_provider",
  "authentication",
  "payments",
  "domain",
  "customer_promises",
];

/** A server view: product details at `version`, per-item statements and versions, history sizes. */
function view(o: {
  version?: number;
  name?: string;
  deps?: Partial<Record<Category, { version: number; uses?: boolean; note?: string }>>;
  inspections?: number;
  epoch?: string;
}): ImportView {
  const n = o.inspections ?? 0;
  return {
    workspace: {
      id: "w1",
      name: o.name ?? "Ledgerline",
      description: "",
      product_kind: "saas",
      version: o.version ?? 1,
      private: true,
      created_at: "",
      updated_at: "",
      business: { id: "b1", name: "Ledgerline Labs", slug: "ledgerline-labs", published: false },
      owner_epoch: o.epoch ?? "mara:0",
    },
    scope: "",
    source: {
      latest: null,
      history: Array.from({ length: n }, (_, i) => ({
        number: n - i,
        inspector: "package-json",
        inspector_version: "1",
        input_digest: "",
        input_bytes: 0,
        dependency_count: 0,
        by: "Mara",
        created_at: "",
      })),
    },
    inventory: CATS.map((c) => {
      const d = o.deps?.[c];
      return {
        category: c,
        label: c,
        version: d?.version ?? 0,
        assertion:
          d && d.uses !== undefined
            ? { uses: d.uses, note: d.note ?? "", by: "Mara", at: "" }
            : null,
      };
    }),
    report: {
      live: {} as Report,
      history: Array.from({ length: n }, (_, i) => ({
        number: n - i,
        inspection_number: n - i,
        counts: { verified: 0, detected: 0, declared: 0, unknown: 8 },
        created_at: "",
      })),
    },
  };
}

const M = (content: string, file_name: string | null = "package.json") => ({ file_name, content });
let k = 0;
const mint = () => `inspect-${++k}`;

describe("004a1 answers that finish out of order", () => {
  const base = view({});
  it("two dependency saves finishing in reverse order: both successes stay shown", () => {
    // The server applied hosting first, then domain; the domain answer arrives first.
    const afterHosting = view({
      deps: { hosting: { version: 1, uses: true, note: "Vercel team" } },
    });
    const afterBoth = view({
      deps: {
        hosting: { version: 1, uses: true, note: "Vercel team" },
        domain: { version: 1, uses: false },
      },
    });
    expect(reconcile(base, afterBoth)).toBe("accept");
    expect(reconcile(afterBoth, afterHosting)).toBe("ignore"); // already contained
    // The server applied them the other way round; the hosting answer arrives first.
    const afterDomain = view({ deps: { domain: { version: 1, uses: false } } });
    expect(reconcile(base, afterBoth)).toBe("accept");
    expect(reconcile(afterBoth, afterDomain)).toBe("ignore");
    // An unrelated row's write starting later doesn't discard an earlier newer answer.
    expect(reconcile(afterHosting, afterBoth)).toBe("accept");
  });

  it("a details save and an inspection overlapping: the newest state wins whichever lands last", () => {
    const saved = view({ version: 2, name: "Ledgerline Pro" });
    const inspectedAfterSave = view({ version: 2, name: "Ledgerline Pro", inspections: 1 });
    const inspectedBeforeSave = view({ version: 1, inspections: 1 });
    const savedAfterInspect = view({ version: 2, name: "Ledgerline Pro", inspections: 1 });
    expect(reconcile(saved, inspectedAfterSave)).toBe("accept");
    expect(reconcile(inspectedAfterSave, saved)).toBe("ignore");
    expect(reconcile(savedAfterInspect, inspectedBeforeSave)).toBe("ignore");
    // A page load that started before a write and finishes after it is older: ignored.
    expect(reconcile(saved, base)).toBe("ignore");
  });

  it("states that contain neither each other ask for the server's view; a change of control resets", () => {
    const a = view({ version: 2 });
    const b = view({ deps: { hosting: { version: 1, uses: false } } });
    expect(reconcile(a, b)).toBe("reload");
    expect(reconcile(a, view({ version: 1, epoch: "ana:1" }))).toBe("reset");
    expect(reconcile(null, a)).toBe("accept");
  });
});

describe("004a1 the manifest being prepared", () => {
  it("a slow file read can't replace a later paste, clear or file", () => {
    let d = fileChosen(emptyManifest());
    const first = d.rev;
    d = pasted(d, '{"name":"pasted"}', false);
    d = fileRead(d, first, { manifest: M('{"name":"late file"}') });
    expect(d.value).toEqual(M('{"name":"pasted"}', null));
    d = fileChosen(d);
    const second = d.rev;
    d = cleared(d);
    d = fileRead(d, second, { manifest: M("{}") });
    expect([d.value, d.reading]).toEqual([null, false]);
    d = fileChosen(d);
    const third = d.rev;
    d = fileChosen(d);
    const fourth = d.rev;
    d = fileRead(d, fourth, { manifest: M('{"name":"newest"}') });
    d = fileRead(d, third, { manifest: M('{"name":"older"}') });
    expect(d.value?.content).toBe('{"name":"newest"}');
    // A read error only counts for its own selection.
    const e = fileRead(fileChosen(d), fourth, { error: "unreadable" });
    expect(e.error).toBeNull();
  });

  it("an inspection clears only the draft it sent; typed-ahead text stays", () => {
    let d = pasted(emptyManifest(), '{"name":"v1"}', false);
    const a = startInspect(d, null, mint);
    if (!a) throw new Error("not started");
    expect(startInspect(d, a, mint)).toBeNull(); // a second click while sending sends nothing
    d = pasted(d, '{"name":"v2, typed while sending"}', false);
    const done = inspectFinished(d, a, { ok: true });
    expect(done.attempt).toBeNull();
    expect(done.draft.value?.content).toBe('{"name":"v2, typed while sending"}');
    // Unchanged since sending: the draft is cleared.
    const d2 = pasted(emptyManifest(), "{}", false);
    const a2 = startInspect(d2, null, mint);
    if (!a2) throw new Error("not started");
    expect(inspectFinished(d2, a2, { ok: true }).draft.value).toBeNull();
    // Nothing to send, still reading, or too large.
    expect(startInspect(emptyManifest(), null, mint)).toBeNull();
    expect(startInspect(fileChosen(emptyManifest()), null, mint)).toBeNull();
    expect(startInspect(pasted(emptyManifest(), "x", true), null, mint)).toBeNull();
  });

  it("a lost answer is recovered with the same key and file, even after the draft changed", () => {
    let d = pasted(emptyManifest(), '{"name":"sent"}', false);
    const a = startInspect(d, null, mint);
    if (!a) throw new Error("not started");
    const lost = inspectFinished(d, a, { ok: false, status: 0, message: "Failed to fetch" });
    expect(lost.attempt).toMatchObject({ state: "unknown", key: a.key });
    d = pasted(lost.draft, '{"name":"something new"}', false);
    const again = recoverInspect(lost.attempt);
    expect(again).toMatchObject({
      key: a.key,
      manifest: M('{"name":"sent"}', null),
      state: "sending",
    });
    // Inspecting the same file again reuses the key (the server answers from its record).
    const same = startInspect(pasted(d, '{"name":"sent"}', false), lost.attempt, mint);
    expect(same?.key).toBe(a.key);
    // A different file is a new request with a new key.
    expect(startInspect(d, lost.attempt, mint)?.key).not.toBe(a.key);
    // A refusal (nothing saved) keeps the draft and isn't recoverable.
    const refused = inspectFinished(d, a, { ok: false, status: 400, message: "Not JSON" });
    expect([refused.attempt?.state, refused.draft.value?.content]).toEqual([
      "refused",
      '{"name":"something new"}',
    ]);
    expect(recoverInspect(refused.attempt)).toBeNull();
    // A server error is unknown too, not a refusal.
    expect(inspectFinished(d, a, { ok: false, status: 502, message: "" }).attempt?.state).toBe(
      "unknown",
    );
  });
});

describe("004a1 product details and dependency statements", () => {
  const v1 = view({ version: 1 });

  it("drafts are separate from what is saved and vanish when they equal it", () => {
    const shown = detailsShown(v1, null);
    expect(shown).toMatchObject({ name: "Ledgerline", base: 1 });
    const d = editDetails(v1, { ...shown, name: "Ledgerline draft" });
    expect(d?.name).toBe("Ledgerline draft");
    expect(editDetails(v1, { ...shown, name: "  Ledgerline " })).toBeNull();
  });

  it("text typed while a save was in flight survives it, rebased so it can be saved next", () => {
    const submitted: DetailsDraft = { ...detailsShown(v1, null), name: "Ledgerline Pro" };
    const typing: DetailsDraft = { ...submitted, name: "Ledgerline Pro 2" };
    const v2 = view({ version: 2, name: "Ledgerline Pro" });
    const after = detailsAfterOwnSave(v2, submitted, typing);
    expect(after).toMatchObject({ name: "Ledgerline Pro 2", base: 2 });
    expect(detailsAfterOwnSave(v2, submitted, submitted)).toBeNull();
  });

  it("a lost answer then a refused retry: if the server holds the text it was saved, not a conflict", () => {
    const d: DetailsDraft = { ...detailsShown(v1, null), name: "Ledgerline Pro" };
    const serverNow = view({ version: 2, name: "Ledgerline Pro" });
    expect(detailsAfter(serverNow, d)).toBeNull();
    expect(
      rowStatus({ ok: false, status: 409, message: "stale" }, detailsAfter(serverNow, d) === null),
    ).toEqual({
      state: "saved",
    });
    // Someone else's different save: a real conflict; the draft stays.
    const other = view({ version: 2, name: "Someone else's name" });
    expect(detailsAfter(other, d)).toBe(d);
    expect(rowStatus({ ok: false, status: 409, message: "stale" }, false)).toMatchObject({
      state: "conflict",
    });
    expect(rowStatus({ ok: false, status: 0, message: "" }, false)).toMatchObject({
      state: "unknown",
    });
  });

  it("each dependency row keeps its own draft and base; one row's save doesn't touch another", () => {
    const hosting: DepDraft = {
      ...depShown(v1, "hosting", undefined),
      uses: "yes",
      note: "Vercel team",
    };
    const domain: DepDraft = { ...depShown(v1, "domain", undefined), uses: "no", note: "" };
    expect(editDep(v1, "hosting", hosting)).toBe(hosting);
    expect(editDep(v1, "hosting", { ...hosting, uses: "unsaid" })).toBeNull();
    // Hosting saved (v1); domain's draft is untouched by it.
    const afterHosting = view({
      deps: { hosting: { version: 1, uses: true, note: "Vercel team" } },
    });
    expect(depAfterOwnSave(afterHosting, "hosting", hosting, hosting)).toBeNull();
    expect(depAfter(afterHosting, "domain", domain)).toBe(domain);
    expect(depShown(afterHosting, "domain", domain)).toBe(domain);
    // Typed ahead while hosting was saving: kept and rebased onto version 1.
    const typed = { ...hosting, note: "Vercel team, owned by Ledgerline Labs" };
    expect(depAfterOwnSave(afterHosting, "hosting", hosting, typed)).toMatchObject({
      note: typed.note,
      base: 1,
    });
    // Trailing spaces don't count as unsaved (the server trims).
    expect(depAfter(afterHosting, "hosting", { ...hosting, note: "Vercel team  " })).toBeNull();
  });
});

describe("004a1 which saved report is shown", () => {
  const report = { headline: "r" } as Report;
  it("a newly selected report shows loading, never the previous one; late answers are ignored", () => {
    let s = select(1);
    s = snapshotLoaded(s, 1, { created_at: "t1", report });
    expect(s).toMatchObject({ selected: 1, state: "loaded" });
    s = select(2);
    expect(s).toEqual({ selected: 2, state: "loading" });
    s = snapshotLoaded(s, 1, { created_at: "t1", report }); // report 1 answering late
    expect(s).toEqual({ selected: 2, state: "loading" });
    s = snapshotLoaded(s, 2, { error: "No such report" });
    expect(s).toEqual({ selected: 2, state: "error", message: "No such report" });
    expect(select(null)).toEqual({ selected: null });
    expect(snapshotLoaded(select(null), 2, { created_at: "t", report })).toEqual({
      selected: null,
    });
  });
});
