// Job 004a2: the import workspace's request lifecycle, exercised through the controller the page
// uses, with a scripted API whose answers the test releases in any order. Each scenario follows
// the actual calls: what was requested, what came back, and what the page would then show.

import { describe, expect, it } from "vitest";
import { ApiError } from "../src/api.ts";
import type { Category, ImportView, Manifest, Report } from "../src/importsApi.ts";
import { ACCESS_ENDED, type ImportsPort, WorkspaceController } from "../src/importWorkspace.ts";

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

interface Pending {
  kind: string;
  args: unknown[];
  ok: (v: unknown) => void;
  fail: (e: unknown) => void;
}

/** An API whose every call waits until the test answers it. */
class Script implements ImportsPort {
  pending: Pending[] = [];
  private call(kind: string, args: unknown[]) {
    return new Promise<never>((ok, fail) => {
      this.pending.push({ kind, args, ok: ok as (v: unknown) => void, fail });
    });
  }
  get = (...a: unknown[]) => this.call("get", a);
  update = (...a: unknown[]) => this.call("update", a);
  declare = (...a: unknown[]) => this.call("declare", a);
  inspect = (...a: unknown[]) => this.call("inspect", a);
  report = (...a: unknown[]) => this.call("report", a);
  /** The oldest unanswered call of this kind. */
  take(kind: string): Pending {
    const i = this.pending.findIndex((p) => p.kind === kind);
    if (i < 0) throw new Error(`no ${kind} call waiting (have ${this.pending.map((p) => p.kind)})`);
    return this.pending.splice(i, 1)[0] as Pending;
  }
  count(kind: string) {
    return this.pending.filter((p) => p.kind === kind).length;
  }
}

const gone = () => new ApiError(404, "No such import");
const settle = () => new Promise((r) => setTimeout(r, 0));

let keys = 0;
async function opened(epoch = "mara:0") {
  const api = new Script();
  const c = new WorkspaceController("w1", api, () => `inspect-${++keys}`);
  const loading = c.load();
  api.take("get").ok(view({ epoch }));
  await loading;
  return { api, c };
}

/** Puts something private everywhere: details, a dependency, a manifest and a report choice. */
function draftEverything(c: WorkspaceController) {
  const v = c.getState().view as ImportView;
  c.editDetails({
    name: "Ledgerline draft",
    description: "",
    product_kind: "saas",
    base: v.workspace.version,
  });
  c.editDep("source_ownership", {
    uses: "yes",
    note: "Mara owns the source organization",
    base: 0,
  });
  c.paste('{"name":"typed"}', false);
}

function expectNothingPrivate(c: WorkspaceController) {
  const s = c.getState();
  expect(s.status).toBe("unavailable");
  expect(s.message).toBe(ACCESS_ENDED);
  expect(s.view).toBeNull();
  expect(s.drafts).toEqual({ details: null, detailsStatus: null, deps: {}, depStatus: {} });
  expect(s.manifest.value).toBeNull();
  expect(s.attempt).toBeNull();
  expect(s.snapshot).toEqual({ selected: null });
}

describe("004a2 access ending while a request is in flight", () => {
  it("inspection 404, then the workspace read 404: everything private is cleared", async () => {
    const { api, c } = await opened();
    draftEverything(c);
    const inspecting = c.inspect(false);
    api.take("inspect").fail(new ApiError(404, "No such business"));
    await settle();
    api.take("get").fail(gone()); // the guarded read: access really ended
    await inspecting;
    expectNothingPrivate(c);
    // Actions do nothing now: no request goes out.
    await c.inspect(false);
    await c.saveDetails();
    expect(api.pending).toEqual([]);
  });

  it("details save 404 and dependency save 404 clear the page the same way", async () => {
    for (const which of ["details", "dep"] as const) {
      const { api, c } = await opened();
      draftEverything(c);
      const saving = which === "details" ? c.saveDetails() : c.saveDep("source_ownership");
      api
        .take(which === "details" ? "update" : "declare")
        .fail(new ApiError(404, "No such import"));
      await settle();
      api.take("get").fail(gone());
      await saving;
      expectNothingPrivate(c);
    }
  });

  it("a missing saved report is not an access loss; an ended access while reading one is", async () => {
    const { api, c } = await opened();
    draftEverything(c);
    let reading = c.chooseReport(7);
    expect(c.getState().snapshot).toEqual({ selected: 7, state: "loading" });
    api.take("report").fail(new ApiError(404, "No such report"));
    await settle();
    api.take("get").ok(view({})); // the workspace is still ours
    await reading;
    expect(c.getState().snapshot).toEqual({
      selected: 7,
      state: "error",
      message: "Report 7 doesn't exist.",
    });
    expect(c.getState().view).not.toBeNull();
    expect(c.getState().drafts.details?.name).toBe("Ledgerline draft"); // nothing lost
    reading = c.chooseReport(1);
    api.take("report").fail(new ApiError(404, "No such import"));
    await settle();
    api.take("get").fail(gone());
    await reading;
    expectNothingPrivate(c);
  });

  it("an old success arriving after access ended restores nothing", async () => {
    const { api, c } = await opened();
    draftEverything(c);
    const saving = c.saveDetails(); // will succeed, but answers late
    const inspecting = c.inspect(false);
    api.take("inspect").fail(new ApiError(404, "No such business"));
    await settle();
    api.take("get").fail(gone());
    await inspecting;
    expectNothingPrivate(c);
    api.take("update").ok(view({ version: 2, name: "Ledgerline draft" }));
    await saving;
    expectNothingPrivate(c);
    // A late file read and a late saved report are dropped as well.
    const { api: api2, c: c2 } = await opened();
    let finishRead: (m: { manifest: Manifest }) => void = () => {};
    c2.chooseFile(() => new Promise((r) => (finishRead = r)));
    const reading = c2.chooseReport(1);
    const loading = c2.load();
    api2.take("get").fail(gone());
    await loading;
    expectNothingPrivate(c2);
    finishRead({ manifest: { file_name: "package.json", content: "{}" } });
    api2
      .take("report")
      .ok({ number: 1, inspection_number: 1, created_at: "t", report: {} as Report });
    await reading;
    await settle();
    expectNothingPrivate(c2);
  });
});

describe("004a2 control epochs", () => {
  it("an older generation never replaces a newer one, whichever read finishes last", async () => {
    const { api, c } = await opened("mara:0");
    const first = c.load(); // started first, answers with the old epoch
    const second = c.load(); // answers with the new epoch
    const [a, b] = [api.take("get"), api.take("get")];
    b.ok(view({ epoch: "noah:1", name: "Noah's name" }));
    await second;
    a.ok(view({ epoch: "mara:0" }));
    await first;
    expect(c.getState().view?.workspace.owner_epoch).toBe("noah:1");
    expect(c.getState().view?.workspace.name).toBe("Noah's name");
  });

  it("a read started after the change that answers with an older epoch (a stale replica) is ignored", async () => {
    const { api, c } = await opened("mara:0");
    const moving = c.load();
    api.take("get").ok(view({ epoch: "noah:1", name: "Noah's name" }));
    await moving;
    const stale = c.load(); // started under the new scope
    api.take("get").ok(view({ epoch: "mara:0", version: 9, name: "Old owner's data" }));
    await stale;
    expect(c.getState().view?.workspace.owner_epoch).toBe("noah:1");
    expect(c.getState().view?.workspace.name).toBe("Noah's name");
  });

  it("away and back (same person, new generation) drops every draft and retires what was in flight", async () => {
    const { api, c } = await opened("mara:0");
    draftEverything(c);
    const saving = c.saveDetails(); // in flight under generation 0
    const reloading = c.load();
    api.take("get").ok(view({ epoch: "mara:2" }));
    await reloading;
    const s = c.getState();
    expect(s.view?.workspace.owner_epoch).toBe("mara:2");
    expect(s.drafts).toEqual({ details: null, detailsStatus: null, deps: {}, depStatus: {} });
    expect(s.manifest.value).toBeNull();
    // New typing under the new epoch; then the old save answers: it touches nothing.
    c.editDetails({
      name: "Typed after the change",
      description: "",
      product_kind: "saas",
      base: 1,
    });
    api.take("update").ok(view({ epoch: "mara:0", version: 2, name: "Ledgerline draft" }));
    await saving;
    expect(c.getState().drafts.details?.name).toBe("Typed after the change");
    expect(c.getState().view?.workspace.owner_epoch).toBe("mara:2");
  });

  it("a write answer naming another epoch is never shown; it asks for an authoritative read", async () => {
    const { api, c } = await opened("mara:0");
    draftEverything(c);
    const saving = c.saveDetails();
    api.take("update").ok(view({ epoch: "noah:1", version: 2, name: "Ledgerline draft" }));
    await saving;
    expect(c.getState().view?.workspace.owner_epoch).toBe("mara:0");
    expect(api.count("get")).toBe(1);
    api.take("get").fail(gone());
    await settle();
    expectNothingPrivate(c);
  });
});

describe("004a2 while access stays valid, 004a1's behavior holds", () => {
  it("typed-ahead drafts survive, and a lost inspection is recovered with the same key and file", async () => {
    const { api, c } = await opened();
    c.paste('{"name":"first"}', false);
    const first = c.inspect(false);
    const sent = api.take("inspect");
    c.paste('{"name":"typed while waiting"}', false);
    sent.fail(new TypeError("Failed to fetch"));
    await first;
    const s = c.getState();
    expect(s.attempt?.state).toBe("unknown");
    expect(s.manifest.value?.content).toBe('{"name":"typed while waiting"}');
    const again = c.inspect(true);
    const resent = api.take("inspect");
    expect(resent.args[1]).toEqual({
      idempotency_key:
        sent.args[1] && (sent.args[1] as { idempotency_key: string }).idempotency_key,
      file_name: null,
      content: '{"name":"first"}',
    });
    resent.ok(view({ inspections: 1 }));
    await again;
    expect(c.getState().attempt).toBeNull();
    expect(c.getState().manifest.value?.content).toBe('{"name":"typed while waiting"}');
    expect(c.getState().view?.source.history).toHaveLength(1);
  });

  it("two dependency saves answering in reverse order both stay shown", async () => {
    const { api, c } = await opened();
    c.editDep("hosting", { uses: "yes", note: "Vercel team", base: 0 });
    c.editDep("domain", { uses: "no", note: "", base: 0 });
    const h = c.saveDep("hosting");
    const d = c.saveDep("domain");
    const [hc, dc] = [api.take("declare"), api.take("declare")];
    const both = view({
      deps: {
        hosting: { version: 1, uses: true, note: "Vercel team" },
        domain: { version: 1, uses: false },
      },
    });
    dc.ok(both);
    await d;
    hc.ok(view({ deps: { hosting: { version: 1, uses: true, note: "Vercel team" } } }));
    await h;
    const s = c.getState();
    expect(s.view).toBe(both);
    expect(s.drafts.deps).toEqual({});
    expect(s.drafts.depStatus).toEqual({ hosting: { state: "saved" }, domain: { state: "saved" } });
  });

  it("a 404 that isn't an access loss (still visible) leaves drafts and shows a refusal", async () => {
    const { api, c } = await opened();
    c.editDep("hosting", { uses: "yes", note: "Vercel team", base: 0 });
    const saving = c.saveDep("hosting");
    api.take("declare").fail(new ApiError(404, "No such item"));
    await settle();
    api.take("get").ok(view({}));
    await saving;
    const s = c.getState();
    expect(s.status).toBe("ready");
    expect(s.drafts.deps.hosting?.note).toBe("Vercel team");
    expect(s.drafts.depStatus.hosting).toEqual({ state: "refused", message: "No such item" });
  });

  it("leaving the page retires everything in flight (004a2)", async () => {
    const { api, c } = await opened();
    draftEverything(c);
    const saving = c.saveDetails();
    c.dispose();
    api.take("update").ok(view({ version: 2, name: "Ledgerline draft" }));
    await saving;
    expect(c.getState().drafts.detailsStatus).toEqual({ state: "saving" });
    expect(c.getState().view?.workspace.version).toBe(1);
  });
});

// ---------- 004a3: the access recheck itself fails ----------

const outage = () => new ApiError(503, "Service unavailable");
const offline = () => new TypeError("Failed to fetch");

type Action = "details" | "dep" | "inspect" | "report";
const SENDS: Record<Action, string> = {
  details: "update",
  dep: "declare",
  inspect: "inspect",
  report: "report",
};

/** Starts one action with everything drafted, refuses it with 404 and fails its recheck. */
async function refusedThenUnchecked(action: Action, recheck: () => unknown) {
  const { api, c } = await opened();
  draftEverything(c);
  const run =
    action === "details"
      ? c.saveDetails()
      : action === "dep"
        ? c.saveDep("source_ownership")
        : action === "inspect"
          ? c.inspect(false)
          : c.chooseReport(1);
  const sent = api.take(SENDS[action]);
  sent.fail(new ApiError(404, "No such import"));
  await settle();
  api.take("get").fail(recheck());
  await run;
  return { api, c, sent };
}

/** Nothing shows as still in progress once every request has settled. */
function expectSettled(c: WorkspaceController) {
  const s = c.getState();
  expect(s.drafts.detailsStatus?.state).not.toBe("saving");
  for (const st of Object.values(s.drafts.depStatus)) expect(st?.state).not.toBe("saving");
  expect(s.attempt?.state).not.toBe("sending");
  expect(s.snapshot).not.toMatchObject({ state: "loading" });
}

/** The page keeps its view and input, says access is unconfirmed, and claims neither outcome. */
function expectUnconfirmed(c: WorkspaceController) {
  const s = c.getState();
  expect(s.status).toBe("ready");
  expect(s.access).toBe("unconfirmed");
  expect(s.message).not.toBe(ACCESS_ENDED);
  expect(s.view).not.toBeNull();
  expect(s.drafts.details?.name).toBe("Ledgerline draft");
  expect(s.drafts.deps.source_ownership?.note).toBe("Mara owns the source organization");
  expect(s.manifest.value?.content).toBe('{"name":"typed"}');
  expect(s.drafts.detailsStatus?.state).not.toBe("saved");
  expect(s.drafts.depStatus.source_ownership?.state ?? null).not.toBe("saved");
}

describe("004a3 a refused action whose access recheck can't finish", () => {
  for (const action of ["details", "dep", "inspect", "report"] as const)
    for (const [label, recheck] of [
      ["503", outage],
      ["network failure", offline],
    ] as const)
      it(`${action}: 404, then the recheck fails (${label}): settled, input kept, access unconfirmed`, async () => {
        const { api, c } = await refusedThenUnchecked(action, recheck);
        expectSettled(c);
        expectUnconfirmed(c);
        const s = c.getState();
        if (action === "details")
          expect(s.drafts.detailsStatus).toMatchObject({ state: "refused" });
        if (action === "dep")
          expect(s.drafts.depStatus.source_ownership).toMatchObject({ state: "refused" });
        if (action === "inspect") expect(s.attempt?.state).toBe("unknown");
        if (action === "report") expect(s.snapshot).toMatchObject({ selected: 1, state: "error" });
        // Nothing can race the unresolved check: no write, inspection or report goes out.
        await c.saveDetails();
        await c.saveDep("source_ownership");
        await c.inspect(false);
        await c.inspect(true);
        await c.chooseReport(2);
        expect(api.pending).toEqual([]);
      });

  it("an explicit check that succeeds restores actions; the inspection is resent with its original key", async () => {
    const { api, c, sent } = await refusedThenUnchecked("inspect", outage);
    const checking = c.checkAccess();
    expect(c.getState().access).toBe("checking");
    await c.checkAccess(); // a second click while checking sends nothing more
    expect(api.count("get")).toBe(1);
    api.take("get").ok(view({}));
    await checking;
    expect(c.getState().access).toBe("current");
    expect(c.getState().drafts.details?.name).toBe("Ledgerline draft");
    const again = c.inspect(true);
    const resent = api.take("inspect");
    expect((resent.args[1] as { idempotency_key: string }).idempotency_key).toBe(
      (sent.args[1] as { idempotency_key: string }).idempotency_key,
    );
    resent.ok(view({ inspections: 1 }));
    await again;
    expect(c.getState().attempt).toBeNull();
    const saving = c.saveDetails();
    expect(api.count("update")).toBe(1);
    api.take("update").ok(view({ version: 2, name: "Ledgerline draft", inspections: 1 }));
    await saving;
    expect(c.getState().drafts.detailsStatus).toEqual({ state: "saved" });
  });

  it("an explicit check that fails again leaves a usable check button, not a spinner", async () => {
    const { api, c } = await refusedThenUnchecked("details", outage);
    const checking = c.checkAccess();
    api.take("get").fail(offline());
    await checking;
    expectUnconfirmed(c);
    const second = c.checkAccess();
    expect(api.count("get")).toBe(1);
    api.take("get").fail(gone()); // now access really has ended
    await second;
    expectNothingPrivate(c);
  });

  it("a check that finds a new control epoch drops drafts and retires older requests", async () => {
    const { api, c } = await refusedThenUnchecked("dep", outage);
    const late = c.load(); // a read issued before the check
    const checking = c.checkAccess();
    const [lateCall, checkCall] = [api.take("get"), api.take("get")];
    checkCall.ok(view({ epoch: "noah:1", name: "Noah's name" }));
    await checking;
    const s = c.getState();
    expect(s.access).toBe("current");
    expect(s.view?.workspace.owner_epoch).toBe("noah:1");
    expect(s.drafts).toEqual({ details: null, detailsStatus: null, deps: {}, depStatus: {} });
    expect(s.manifest.value).toBeNull();
    lateCall.ok(view({ epoch: "mara:0", name: "Old owner's data" }));
    await late;
    expect(c.getState().view?.workspace.name).toBe("Noah's name");
  });

  it("answers that started before the doubt, or name an older epoch, never confirm access", async () => {
    const { api, c } = await opened();
    draftEverything(c);
    const before = c.load(); // in flight before the refusal
    const saving = c.saveDetails();
    api.take("update").fail(new ApiError(404, "No such import"));
    await settle();
    const [beforeCall, recheckCall] = [api.take("get"), api.take("get")];
    recheckCall.fail(outage());
    await saving;
    expect(c.getState().access).toBe("unconfirmed");
    beforeCall.ok(view({}));
    await before;
    expect(c.getState().access).toBe("unconfirmed"); // it was asked before the doubt arose
    // A fresh read that moves to a newer epoch confirms access to it.
    const loading = c.load();
    api.take("get").ok(view({ epoch: "mara:2" }));
    await loading;
    expect(c.getState().access).toBe("current");
    c.editDetails({ name: "Typed after", description: "", product_kind: "saas", base: 1 });
    const save2 = c.saveDetails();
    api.take("update").fail(new ApiError(404, "No such import"));
    await settle();
    api.take("get").fail(outage());
    await save2;
    // The check answers with an older generation (a stale replica): still unconfirmed, no spinner.
    const stale = c.checkAccess();
    api.take("get").ok(view({ epoch: "mara:0", name: "Old owner's data" }));
    await stale;
    expect(c.getState().access).toBe("unconfirmed");
    expect(c.getState().view?.workspace.owner_epoch).toBe("mara:2");
    expect(c.getState().drafts.details?.name).toBe("Typed after");
  });
});
