// Job 002e (Astra's AppStudioReview): one web app generation request at a time, recoverable.
// A generation is a PAID build job. Its exact request (key, instructions, base, budget) is kept,
// apart from the editable draft, until the server answers it. A lost answer (no answer, a 5xx or
// an unreadable one) keeps it: "Recover my request" sends the SAME request again (the server
// returns the job it already made), never a fresh one. The kept request survives a tab switch
// (the view stays mounted) and a reload (session storage, scoped to person, project and owner
// epoch; only the request, never a secret). A definite refusal (4xx) ends it.

import { ApiError } from "./api.ts";
import type { GenerationBudget, GenerationJob, GenerationRequest } from "./appApi.ts";

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
}

const LIVE = ["queued", "running", "validating"];
const KEY = /^[A-Za-z0-9_-]{8,80}$/;

export class Generations {
  private state: GenerationState = {
    draft: "",
    pending: null,
    unanswered: false,
    job: null,
    busy: false,
    notice: null,
  };
  private listeners = new Set<() => void>();

  constructor(
    private readonly port: GenerationPort,
    private readonly opts: {
      /** person:project:owner-epoch; a different scope starts clean. */
      scope: string;
      storage: Storage | null;
      newKey: () => string;
    },
  ) {
    const kept = this.recall();
    if (kept) this.state = { ...this.state, pending: kept, unanswered: true };
  }

  getState = () => this.state;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  private set(patch: Partial<GenerationState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }
  private storeKey() {
    return `everstreet.app-generation.${this.opts.scope}`;
  }
  private remember(r: GenerationRequest | null) {
    try {
      if (r) this.opts.storage?.setItem(this.storeKey(), JSON.stringify(r));
      else this.opts.storage?.removeItem(this.storeKey());
    } catch {
      // storage denied: in-session recovery still works
    }
  }
  private recall(): GenerationRequest | null {
    try {
      const v = JSON.parse(
        this.opts.storage?.getItem(this.storeKey()) ?? "null",
      ) as GenerationRequest | null;
      return v && typeof v.key === "string" && KEY.test(v.key) && typeof v.instructions === "string"
        ? v
        : null;
    } catch {
      return null;
    }
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
    if (this.state.job && LIVE.includes(this.state.job.state)) return;
    const request: GenerationRequest = this.state.pending ?? {
      key: this.opts.newKey(),
      instructions: this.state.draft.trim(),
      ...base,
    };
    if (!request.instructions) return;
    const fresh = this.state.pending === null;
    // Kept BEFORE sending: a reload during the call still finds it.
    this.remember(request);
    this.set({
      pending: request,
      busy: true,
      notice: null,
      // The draft becomes the request only when it is fresh; typed-ahead text stays.
      ...(fresh ? { draft: "" } : {}),
    });
    try {
      const r = await this.port.generate(request);
      this.remember(null);
      this.set({ pending: null, unanswered: false, job: r.job, busy: false });
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

  /** Reads the job's state again (polling while it is live). */
  async refresh() {
    const j = this.state.job;
    if (!j) return;
    try {
      const r = await this.port.build(j.id);
      this.set({ job: r.job });
    } catch {
      // keep the last known state; the next poll tries again
    }
  }

  async cancel() {
    const j = this.state.job;
    if (!j || !LIVE.includes(j.state)) return;
    this.set({ busy: true });
    try {
      const r = await this.port.cancelBuild(j.id);
      this.set({ job: r.job, busy: false });
    } catch (e) {
      this.set({ busy: false, notice: e instanceof Error ? e.message : "Couldn't cancel" });
    }
  }

  /** The job finished (or the view is done with it): ready for the next generation. */
  clearJob() {
    this.set({ job: null });
  }
}
