// Job 001k1: the brief companion's composer state, as a small controller the conversation panel
// subscribes to (as the Web app view does with Generations). It holds the unsent text and the
// unresolved message (outbox: its text and exact request key), and keeps both for this scope in
// the tab's session storage (composerDrafts.ts), so leaving the Studio and coming back, or a
// reload, restores them. Nothing is ever sent by this class: sending stays in the panel, and a
// message that was in flight comes back as "unknown", to be sent again only by the founder,
// under the same key (the server never takes it twice).

import {
  clearScope,
  type DraftStorage,
  readDraft,
  readOutbox,
  writeDraft,
  writeOutbox,
} from "./composerDrafts.ts";
import type { Outbox } from "./outbox.ts";

export interface BriefComposerState {
  text: string;
  outbox: Outbox | null;
}

export class BriefComposer {
  private state: BriefComposerState;
  private listeners = new Set<() => void>();
  /**
   * Only the MOUNTED panel's composer writes this scope's storage (as Generations): a send that
   * answers after the panel unmounted can't overwrite what the new instance holds (the kept
   * "unknown" message is resent there under the same key). After forget() nothing, however late,
   * changes or restores anything.
   */
  private attached = true;
  private ended = false;

  constructor(private readonly opts: { scope: string; storage: DraftStorage | null }) {
    this.state = {
      text: readDraft(opts.storage, "brief", opts.scope),
      outbox: readOutbox(opts.storage, opts.scope),
    };
  }

  getState = () => this.state;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  attach() {
    if (!this.ended) this.attached = true;
  }
  detach() {
    this.attached = false;
  }
  private set(patch: Partial<BriefComposerState>) {
    if (this.ended) return;
    this.state = { ...this.state, ...patch };
    if (this.attached) {
      if ("text" in patch) writeDraft(this.opts.storage, "brief", this.opts.scope, this.state.text);
      if ("outbox" in patch) writeOutbox(this.opts.storage, this.opts.scope, this.state.outbox);
    }
    for (const l of this.listeners) l();
  }

  setText(text: string) {
    this.set({ text });
  }
  /** Functional update (e.g. a prefill added below what is already typed). */
  updateText(f: (current: string) => string) {
    this.set({ text: f(this.state.text) });
  }
  setOutbox(outbox: Outbox | null) {
    this.set({ outbox });
  }
  /** Access to the project definitely ended: everything kept for this scope goes. */
  forget() {
    // Deletions are fenced like writes: a stale, detached panel can't clear the new one's.
    if (this.attached && !this.ended) clearScope(this.opts.storage, this.opts.scope);
    this.set({ text: "", outbox: null });
    this.ended = true;
  }
}
