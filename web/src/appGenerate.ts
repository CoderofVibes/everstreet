// Job 002e (Astra's AppStudioReview): one web app generation request at a time, recoverable.
// A generation is a PAID build job. Its exact request (key, instructions, base, budget) is kept,
// apart from the editable draft, until the server answers it. A lost answer (no answer, a 5xx or
// an unreadable one) keeps it: "Recover my request" sends the SAME request again (the server
// returns the job it already made), never a fresh one. The kept request survives a tab switch
// (the view stays mounted) and a reload (session storage, scoped to person, project and owner
// epoch; only the request, never a secret). A definite refusal (4xx) ends it.
// Job 001k1: the UNSENT draft is kept the same way (composerDrafts.ts, its own versioned entry),
// so leaving the Studio and coming back, or a reload, brings it back. It is never sent by itself;
// a submitted draft is gone from it (the request is kept apart), and an emptied box stays empty.

import { ApiError } from "./api.ts";
import type { GenerationBudget, GenerationJob, GenerationRequest } from "./appApi.ts";
import { clearScope, readDraft, writeDraft } from "./composerDrafts.ts";

export interface GenerationPort {
  generate(r: GenerationRequest): Promise<{ job: GenerationJob }>;
  build(jobId: string): Promise<{ job: GenerationJob }>;
  cancelBuild(jobId: string): Promise<{ job: GenerationJob }>;
}

export interface Storage {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

export interface GenerationState {
  /** What the founder is typing now; never the request in flight. */
  draft: string;
  /** The exact request sent and not yet answered (or answer lost). */
  pending: GenerationRequest | null;
  /** True when the last send of `pending` got no usable answer. */
  unanswered: boolean;
  /** The generation job once the server answered. */
  job: GenerationJob | null;
  busy: boolean;
  notice: string | null;
  /** 002e1: the last progress read failed; "Check progress" tries again (never a new job). */
  readFailed: boolean;
}

const LIVE = ["queued", "running", "validating"];
/** 002e1: what is kept across a reload: the unanswered request, or the acknowledged job. */
type Kept = { kind: "request"; request: GenerationRequest } | { kind: "job"; id: string };
const ID = /^[0-9a-f-]{36}$/;
const KEY = /^[A-Za-z0-9_-]{8,80}$/;

export class Generations {
  private state: GenerationState = {
    draft: "",
    pending: null,
    unanswered: false,
    job: null,
    busy: false,
    notice: null,
    readFailed: false,
  };
  private listeners = new Set<() => void>();
  /**
   * 001k1 (Astra's StudioDraftLifetimeReview): only the MOUNTED controller writes this scope's
   * storage. After a route change the old instance is detached: a late answer to its request can
   * no longer overwrite what the new instance holds (its kept envelope stays, so the new one
   * recovers the same request under the same key). After forget() (access ended) nothing,
   * however late, changes or restores anything.
   */
  private attached = true;
  private ended = false;

  constructor(
    private readonly port: GenerationPort,
    private readonly opts: {
      /** person:project:owner-epoch; a different scope starts clean. */
      scope: string;
      storage: Storage | null;
      newKey: () => string;
    },
  ) {
    this.state = { ...this.state, draft: readDraft(opts.storage, "app", opts.scope) };
    const kept = this.recall();
    if (kept?.kind === "request")
      this.state = { ...this.state, pending: kept.request, unanswered: true };
    // An acknowledged job is recovered by its id; its state is read before anything else.
    if (kept?.kind === "job")
      this.state = { ...this.state, job: { id: kept.id, state: "unknown", failure: null } };
  }

  getState = () => this.state;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  /** The view mounted (again): this instance owns the scope's storage. */
  attach() {
    if (!this.ended) this.attached = true;
  }
  /** The view unmounted: this instance never writes the scope's storage again. */
  detach() {
    this.attached = false;
  }
  private get writable() {
    return this.attached && !this.ended;
  }
  private set(patch: Partial<GenerationState>) {
    if (this.ended) return;
    this.state = { ...this.state, ...patch };
    if ("draft" in patch && this.writable)
      writeDraft(this.opts.storage, "app", this.opts.scope, this.state.draft);
    for (const l of this.listeners) l();
  }
  private storeKey() {
    return `everstreet.app-generation.${this.opts.scope}`;
  }
  private remember(k: Kept | null) {
    if (!this.writable) return;
    try {
      if (k) this.opts.storage?.setItem(this.storeKey(), JSON.stringify(k));
      else this.opts.storage?.removeItem(this.storeKey());
    } catch {
      // storage denied: in-session recovery still works
    }
  }
  private recall(): Kept | null {
    try {
      const v = JSON.parse(this.opts.storage?.getItem(this.storeKey()) ?? "null") as
        | (Kept & { request?: GenerationRequest })
        | null;
      if (v?.kind === "job") return typeof v.id === "string" && ID.test(v.id) ? v : null;
      const r = v?.kind === "request" ? v.request : null;
      return r && typeof r.key === "string" && KEY.test(r.key) && typeof r.instructions === "string"
        ? { kind: "request", request: r }
        : null;
    } catch {
      return null;
    }
  }
  /** Keeps the job until a terminal state has been read back. */
  private settle(job: GenerationJob) {
    if (LIVE.includes(job.state)) this.remember({ kind: "job", id: job.id });
    else this.remember(null);
  }

  setDraft(text: string) {
    this.set({ draft: text });
  }

  /** Starts a new generation from the draft, or recovers the unanswered one (same request). */
  async submit(base: {
    project_id: string;
    revision: number;
    base_job: string | null;
    budget: GenerationBudget;
  }) {
    if (this.state.busy) return;
    // A known job not yet read to its end blocks a new paid generation (also "unknown" after a reload).
    if (
      this.state.job &&
      (LIVE.includes(this.state.job.state) || this.state.job.state === "unknown")
    )
      return;
    const request: GenerationRequest = this.state.pending ?? {
      key: this.opts.newKey(),
      instructions: this.state.draft.trim(),
      ...base,
    };
    if (!request.instructions) return;
    const fresh = this.state.pending === null;
    // Kept BEFORE sending: a reload during the call still finds it.
    this.remember({ kind: "request", request });
    this.set({
      pending: request,
      busy: true,
      notice: null,
      // The draft becomes the request only when it is fresh; typed-ahead text stays.
      ...(fresh ? { draft: "" } : {}),
    });
    try {
      const r = await this.port.generate(request);
      // 002e1: acknowledged is not finished: the job stays recoverable until its end is read.
      this.settle(r.job);
      this.set({ pending: null, unanswered: false, job: r.job, busy: false, readFailed: false });
    } catch (e) {
      const lost = !(e instanceof ApiError) || e.status >= 500;
      if (lost) {
        this.set({
          unanswered: true,
          busy: false,
          notice:
            "Your generation request didn't get an answer. It may have started. Recover it: the same request is sent again, never a second paid one.",
        });
      } else {
        this.remember(null);
        // A definite refusal: nothing started. The founder's words go back into the draft unless
        // they've typed something newer.
        this.set({
          pending: null,
          unanswered: false,
          busy: false,
          draft: this.state.draft || request.instructions,
          notice: e.message,
        });
      }
    }
  }

  /**
   * Reads the job's state again ("Check progress", and polling while it is live). A failed read
   * keeps the job and says so; a definite 404 (access ended) forgets it here.
   */
  async refresh() {
    const j = this.state.job;
    if (!j) return;
    try {
      const r = await this.port.build(j.id);
      if (this.state.job?.id !== j.id) return;
      this.settle(r.job);
      this.set({ job: r.job, readFailed: false });
    } catch (e) {
      if (this.state.job?.id !== j.id) return;
      if (e instanceof ApiError && e.status === 404) {
        this.remember(null);
        // 001k1: access definitely ended: the unsent draft goes too.
        clearScope(this.opts.storage, this.opts.scope);
        this.set({
          draft: "",
          job: null,
          readFailed: false,
          notice: "That generation is no longer available to you here.",
        });
      } else this.set({ readFailed: true });
    }
  }

  async cancel() {
    const j = this.state.job;
    if (!j || !LIVE.includes(j.state)) return;
    this.set({ busy: true });
    try {
      const r = await this.port.cancelBuild(j.id);
      this.settle(r.job);
      this.set({ job: r.job, busy: false });
    } catch (e) {
      this.set({ busy: false, notice: e instanceof Error ? e.message : "Couldn't cancel" });
    }
  }

  /**
   * 001k1: access to this project definitely ended (the view got a 404): every private thing kept
   * for this scope (the request, the job, the unsent draft) is removed here and in storage.
   */
  forget() {
    this.remember(null);
    clearScope(this.opts.storage, this.opts.scope);
    this.set({
      draft: "",
      pending: null,
      unanswered: false,
      job: null,
      busy: false,
      notice: null,
      readFailed: false,
    });
    this.ended = true;
  }

  /** The job finished (or the view is done with it): ready for the next generation. */
  clearJob() {
    this.set({ job: null });
  }
}
