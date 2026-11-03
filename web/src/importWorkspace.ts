// Job 004a2: one owner for an import workspace's private state and every request that can change
// it. The page renders this controller's state and calls its methods; it holds none of its own.
//
// Scope. Every request captures the current scope number when it starts. Losing access,
// leaving the page, or a change of control retires the scope, and any answer, failure, file read
// or saved-report result from a retired scope is dropped: it can neither restore private data
// nor clear newer input.
//
// Access. A 404 from a write or a saved-report read doesn't by itself prove access ended: the
// controller asks, with a guarded read of the workspace, whether the workspace is still visible.
// If it isn't (404), everything private is cleared and the page shows that the import is no
// longer available. A missing saved report is reported as just that.
//
// Control epochs. Each view names the business's control epoch (`owner:generation`). A change of
// epoch is accepted only from an explicit, current read, never from an answer that was already
// in flight. An older generation never replaces a newer one. A newer one, even with the same
// person owning again (away and back), drops every draft.

import { ApiError } from "./api.ts";
import {
  cleared,
  type DepDraft,
  type DetailsDraft,
  depAfter,
  depAfterOwnSave,
  detailsAfter,
  detailsAfterOwnSave,
  editDep,
  editDetails,
  emptyManifest,
  fileChosen,
  fileRead,
  type InspectAttempt,
  inspectFinished,
  type ManifestDraft,
  type Outcome,
  pasted,
  type RowStatus,
  reconcile,
  recoverInspect,
  rowStatus,
  type Snapshot,
  select,
  snapshotLoaded,
  startInspect,
} from "./importDraft.ts";
import type { Category, ImportView, importsApi, Manifest } from "./importsApi.ts";

/** The calls the controller makes; the real client in the app, a scripted one in tests. */
export type ImportsPort = Pick<
  typeof importsApi,
  "get" | "update" | "declare" | "inspect" | "report"
>;

export interface Drafts {
  details: DetailsDraft | null;
  detailsStatus: RowStatus | null;
  deps: Partial<Record<Category, DepDraft>>;
  depStatus: Partial<Record<Category, RowStatus>>;
}

export interface WorkspaceState {
  /** "ready" with a view; "unavailable" once access is observed to have ended. */
  status: "loading" | "ready" | "unavailable" | "error";
  message: string | null;
  view: ImportView | null;
  drafts: Drafts;
  manifest: ManifestDraft;
  attempt: InspectAttempt | null;
  snapshot: Snapshot;
}

const noDrafts = (): Drafts => ({ details: null, detailsStatus: null, deps: {}, depStatus: {} });

const blank = (status: WorkspaceState["status"], message: string | null): WorkspaceState => ({
  status,
  message,
  view: null,
  drafts: noDrafts(),
  manifest: emptyManifest(),
  attempt: null,
  snapshot: select(null),
});

/** The generation part of an `owner:generation` control epoch. */
export function epochGeneration(epoch: string): number {
  const n = Number(epoch.slice(epoch.lastIndexOf(":") + 1));
  return Number.isInteger(n) && n >= 0 ? n : -1;
}

const failure = (e: unknown): Extract<Outcome, { ok: false }> => ({
  ok: false,
  status: e instanceof ApiError ? e.status : 0,
  message: (e as Error).message,
});

export const ACCESS_ENDED =
  "This import is no longer available to you. If the business changed hands, it now belongs to its new owner. Nothing private from it is kept on this page.";

export class WorkspaceController {
  private state: WorkspaceState = blank("loading", null);
  private listeners = new Set<() => void>();
  /** Raised to retire every request in flight. */
  private scope = 0;
  /** The control generation of the view shown (−1 before the first). */
  private generation = -1;

  constructor(
    private readonly id: string,
    private readonly api: ImportsPort,
    private readonly mint: () => string,
  ) {}

  // ---------- store ----------

  getState = (): WorkspaceState => this.state;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private set(fn: (s: WorkspaceState) => WorkspaceState) {
    this.state = fn(this.state);
    for (const l of this.listeners) l();
  }

  private live(scope: number) {
    return scope === this.scope;
  }

  /** Leaving the page: nothing in flight may touch this controller again. */
  dispose() {
    this.scope++;
  }

  // ---------- access and epochs ----------

  /** Access ended: retire every request and drop everything private. */
  private lost(scope: number) {
    if (!this.live(scope)) return;
    this.scope++;
    this.generation = -1;
    this.set(() => blank("unavailable", ACCESS_ENDED));
  }

  /** A new control epoch: retire what was in flight and drop drafts, keep nothing older. */
  private resetForEpoch() {
    this.scope++;
    this.set((s) => ({
      ...s,
      drafts: noDrafts(),
      manifest: cleared(s.manifest),
      attempt: null,
      snapshot: select(null),
    }));
  }

  /**
   * The authoritative read: the only path that may move to another control epoch. Returns the
   * view, null if access ended, or undefined if it failed for another reason (or was retired).
   */
  load = async (): Promise<ImportView | null | undefined> => {
    const scope = this.scope;
    try {
      const v = await this.api.get(this.id);
      if (!this.live(scope)) return undefined;
      this.applyRead(v);
      return v;
    } catch (e) {
      if (!this.live(scope)) return undefined;
      if (e instanceof ApiError && e.status === 404) {
        this.lost(scope);
        return null;
      }
      this.set((s) =>
        s.view
          ? s
          : { ...s, status: "error", message: (e as Error).message || "It couldn't be loaded." },
      );
      return undefined;
    }
  };

  private applyRead(v: ImportView) {
    if (v.workspace.id !== this.id) return;
    const g = epochGeneration(v.workspace.owner_epoch);
    if (this.generation >= 0 && g < this.generation) return; // an older epoch never wins
    if (this.generation >= 0 && g > this.generation) this.resetForEpoch();
    const changedEpoch =
      this.state.view && this.state.view.workspace.owner_epoch !== v.workspace.owner_epoch;
    this.generation = g;
    const current = changedEpoch ? null : this.state.view;
    // Within one epoch an authoritative read older than what is shown (it started before a write
    // and finished after it) is ignored; otherwise it is the current state.
    if (reconcile(current, v) === "ignore") return;
    this.set((s) => ({ ...s, status: "ready", message: null, view: v }));
  }

  /** A write's answer: shown only within the same epoch; anything else asks for a fresh read. */
  private applyWrite(v: ImportView, scope: number) {
    if (!this.live(scope) || v.workspace.id !== this.id) return;
    if (epochGeneration(v.workspace.owner_epoch) !== this.generation) {
      void this.load();
      return;
    }
    const r = reconcile(this.state.view, v);
    if (r === "accept") this.set((s) => ({ ...s, view: v }));
    else if (r === "reload" || r === "reset") void this.load();
  }

  /**
   * After a 404 from a write or a saved-report read: is the workspace still ours? Asks with a
   * guarded read. True if it is (the 404 was about something else), false if access ended or the
   * scope was retired meanwhile.
   */
  private async stillMine(scope: number): Promise<boolean> {
    try {
      const v = await this.api.get(this.id);
      if (!this.live(scope)) return false;
      this.applyRead(v);
      // Still ours, unless that read moved to another control epoch (which retires this scope).
      return this.live(scope);
    } catch (e) {
      if (!this.live(scope)) return false;
      if (e instanceof ApiError && e.status === 404) this.lost(scope);
      return false;
    }
  }

  // ---------- product details ----------

  editDetails = (d: DetailsDraft) => {
    const v = this.state.view;
    if (!v) return;
    this.set((s) => ({
      ...s,
      drafts: { ...s.drafts, details: editDetails(v, d), detailsStatus: null },
    }));
  };

  discardDetails = () =>
    this.set((s) => ({ ...s, drafts: { ...s.drafts, details: null, detailsStatus: null } }));

  rebaseDetails = () => {
    const v = this.state.view;
    if (!v) return;
    this.set((s) => ({
      ...s,
      drafts: {
        ...s.drafts,
        details: s.drafts.details ? { ...s.drafts.details, base: v.workspace.version } : null,
        detailsStatus: null,
      },
    }));
  };

  saveDetails = async () => {
    const { view, drafts } = this.state;
    const d = drafts.details;
    if (!view || !d || drafts.detailsStatus?.state === "saving") return;
    const scope = this.scope;
    this.set((s) => ({ ...s, drafts: { ...s.drafts, detailsStatus: { state: "saving" } } }));
    try {
      const nv = await this.api.update(this.id, {
        version: d.base,
        name: d.name.trim(),
        description: d.description.trim(),
        product_kind: d.product_kind,
      });
      if (!this.live(scope)) return;
      this.applyWrite(nv, scope);
      if (!this.live(scope)) return;
      this.set((s) => ({
        ...s,
        drafts: {
          ...s.drafts,
          details: detailsAfterOwnSave(nv, d, s.drafts.details),
          detailsStatus: { state: "saved" },
        },
      }));
    } catch (e) {
      if (!this.live(scope)) return;
      const o = failure(e);
      if (o.status === 404 && !(await this.stillMine(scope))) return;
      const now = o.status === 409 || o.status === 0 ? await this.load() : null;
      if (!this.live(scope)) return;
      this.set((s) => {
        const left =
          now && s.drafts.details ? detailsAfter(now, s.drafts.details) : s.drafts.details;
        return {
          ...s,
          drafts: {
            ...s.drafts,
            details: left,
            detailsStatus: rowStatus(o, Boolean(now) && left === null),
          },
        };
      });
    }
  };

  // ---------- dependency statements ----------

  private putDep(
    s: WorkspaceState,
    c: Category,
    d: DepDraft | null,
    status: RowStatus | undefined,
  ): WorkspaceState {
    const deps = { ...s.drafts.deps };
    if (d) deps[c] = d;
    else delete deps[c];
    const depStatus = { ...s.drafts.depStatus };
    if (status) depStatus[c] = status;
    else delete depStatus[c];
    return { ...s, drafts: { ...s.drafts, deps, depStatus } };
  }

  editDep = (c: Category, d: DepDraft) => {
    const v = this.state.view;
    if (!v) return;
    this.set((s) => this.putDep(s, c, editDep(v, c, d), undefined));
  };

  discardDep = (c: Category) => this.set((s) => this.putDep(s, c, null, undefined));

  rebaseDep = (c: Category) => {
    const v = this.state.view;
    const cur = this.state.drafts.deps[c];
    if (!v || !cur) return;
    const version = v.inventory.find((i) => i.category === c)?.version ?? 0;
    this.set((s) => this.putDep(s, c, { ...cur, base: version }, undefined));
  };

  saveDep = async (c: Category) => {
    const { view, drafts } = this.state;
    const d = drafts.deps[c];
    if (!view || !d || drafts.depStatus[c]?.state === "saving") return;
    const scope = this.scope;
    this.set((s) => this.putDep(s, c, s.drafts.deps[c] ?? null, { state: "saving" }));
    try {
      const nv = await this.api.declare(this.id, c, {
        version: d.base,
        uses: d.uses === "unsaid" ? null : d.uses === "yes",
        note: d.uses === "unsaid" ? "" : d.note.trim(),
      });
      if (!this.live(scope)) return;
      this.applyWrite(nv, scope);
      if (!this.live(scope)) return;
      this.set((s) =>
        this.putDep(s, c, depAfterOwnSave(nv, c, d, s.drafts.deps[c] ?? null), { state: "saved" }),
      );
    } catch (e) {
      if (!this.live(scope)) return;
      const o = failure(e);
      if (o.status === 404 && !(await this.stillMine(scope))) return;
      const now = o.status === 409 || o.status === 0 ? await this.load() : null;
      if (!this.live(scope)) return;
      this.set((s) => {
        const cur = s.drafts.deps[c] ?? null;
        const left = now && cur ? depAfter(now, c, cur) : cur;
        return this.putDep(s, c, left, rowStatus(o, Boolean(now) && left === null));
      });
    }
  };

  // ---------- the manifest being prepared ----------

  /** A file was chosen; `read` produces its contents (or an error) later. */
  chooseFile = (read: () => Promise<{ manifest: Manifest } | { error: string }>) => {
    const scope = this.scope;
    let rev = 0;
    this.set((s) => {
      const m = fileChosen(s.manifest);
      rev = m.rev;
      return { ...s, manifest: m };
    });
    read().then(
      (result) =>
        this.live(scope) &&
        this.set((s) => ({ ...s, manifest: fileRead(s.manifest, rev, result) })),
      () =>
        this.live(scope) &&
        this.set((s) => ({
          ...s,
          manifest: fileRead(s.manifest, rev, { error: "That file couldn't be read." }),
        })),
    );
  };

  paste = (text: string, tooLarge: boolean) =>
    this.set((s) => ({ ...s, manifest: pasted(s.manifest, text, tooLarge) }));

  clearManifest = () => this.set((s) => ({ ...s, manifest: cleared(s.manifest) }));

  // ---------- inspections ----------

  inspect = async (recover: boolean) => {
    if (!this.state.view) return;
    const a = recover
      ? recoverInspect(this.state.attempt)
      : startInspect(this.state.manifest, this.state.attempt, this.mint);
    if (!a) return;
    const scope = this.scope;
    this.set((s) => ({ ...s, attempt: a }));
    let outcome: Outcome;
    try {
      const nv = await this.api.inspect(this.id, { idempotency_key: a.key, ...a.manifest });
      if (!this.live(scope)) return;
      this.applyWrite(nv, scope);
      outcome = { ok: true };
    } catch (e) {
      if (!this.live(scope)) return;
      outcome = failure(e);
      if (outcome.status === 404 && !(await this.stillMine(scope))) return;
    }
    if (!this.live(scope)) return;
    this.set((s) => {
      const done = inspectFinished(s.manifest, a, outcome);
      return { ...s, manifest: done.draft, attempt: done.attempt };
    });
  };

  // ---------- saved reports ----------

  chooseReport = async (n: number | null) => {
    this.set((s) => ({ ...s, snapshot: select(n) }));
    if (n === null || !this.state.view) return;
    const scope = this.scope;
    try {
      const r = await this.api.report(this.id, n);
      if (this.live(scope)) this.set((s) => ({ ...s, snapshot: snapshotLoaded(s.snapshot, n, r) }));
    } catch (e) {
      if (!this.live(scope)) return;
      const o = failure(e);
      // A missing report and an ended access are both 404: the workspace read tells them apart.
      if (o.status === 404 && !(await this.stillMine(scope))) return;
      if (!this.live(scope)) return;
      const message =
        o.status === 404 ? `Report ${n} doesn't exist.` : o.message || "It couldn't be loaded.";
      this.set((s) => ({ ...s, snapshot: snapshotLoaded(s.snapshot, n, { error: message }) }));
    }
  };
}
