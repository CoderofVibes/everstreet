// Job 001b1: the records the studio's status is derived from, refreshed by ACTUAL events. Each
// panel that changes them (builds, service checks/releases, customer offers) already reloads its
// own records after an action; it reports a small signature of what it now shows, and when that
// signature changes the studio reads the releases and offers again. Reads are sequenced (a late
// answer never overwrites a newer one), coalesced (at most one in flight and one queued, so no
// burst of reads), and dropped after the page is disposed or access ends. Nothing is optimistic:
// the status only ever reflects what the records say.

import { ApiError } from "./api.ts";
import type { OwnerOffer } from "./offerSetup.ts";
import { parseOwnerOffers } from "./offerSetup.ts";
import type { Releases } from "./runtimeApi.ts";

export interface RecordsPort {
  releases(projectId: string): Promise<Releases>;
  offers(businessId: string): Promise<unknown>;
}

export interface Records {
  releases: Releases | "unknown";
  offers: { active: number; retired: number } | "unknown";
}

export interface RecordsState {
  records: Records | null;
  /** True once a read answered 404: this person no longer reaches the project or business. */
  gone: boolean;
  reads: number;
}

export type Source = "builds" | "service" | "offers";

/** What a panel shows, reduced to the facts the status depends on. */
export const offersSignature = (offers: Pick<OwnerOffer, "id" | "state">[]) =>
  offers
    .map((o) => `${o.id}:${o.state}`)
    .sort()
    .join("|");
export const releasesSignature = (
  r: Pick<Releases, "active" | "candidates">,
  latestRun: { id: string; state: string } | undefined,
) =>
  [
    r.active?.id ?? "-",
    ...r.candidates.map(
      (c) =>
        `${c.artifact_job}:${c.status}:${c.latest_check?.id ?? "-"}:${c.latest_check?.release_ready ?? "-"}`,
    ),
    latestRun ? `${latestRun.id}:${latestRun.state}` : "-",
  ].join("|");
export const buildsSignature = (jobs: { id: string; state: string }[]) =>
  jobs.map((j) => `${j.id}:${j.state}`).join("|");

export class StudioRecords {
  private state: RecordsState = { records: null, gone: false, reads: 0 };
  private listeners = new Set<() => void>();
  private alive = true;
  private seq = 0;
  private running: Promise<void> | null = null;
  private queued = false;
  private seen = new Map<Source, string>();

  constructor(
    private readonly port: RecordsPort,
    private readonly scope: { projectId: string; businessId: string },
  ) {}

  getState = () => this.state;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  dispose() {
    this.alive = false;
    this.seq++;
    this.listeners.clear();
  }
  private set(p: Partial<RecordsState>) {
    if (!this.alive) return;
    this.state = { ...this.state, ...p };
    for (const l of this.listeners) l();
  }

  /**
   * A panel reports what it now shows. The first report from a panel is its initial load (the
   * studio already read the records); later changes mean its records actually changed.
   */
  notice(source: Source, signature: string) {
    const before = this.seen.get(source);
    this.seen.set(source, signature);
    if (before !== undefined && before !== signature) void this.refresh();
  }

  /**
   * Reads the records again; at most one read in flight and one queued. The promise settles once
   * the records reflect every refresh asked for before it (the queued read included).
   */
  refresh(): Promise<void> {
    if (!this.alive || this.state.gone) return Promise.resolve();
    if (this.running) {
      this.queued = true;
      return this.running;
    }
    this.running = (async () => {
      try {
        do {
          this.queued = false;
          await this.readOnce();
        } while (this.queued && this.alive && !this.state.gone);
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }

  private async readOnce() {
    const mine = ++this.seq;
    this.set({ reads: this.state.reads + 1 });
    const [r, o] = await Promise.allSettled([
      this.port.releases(this.scope.projectId),
      this.port.offers(this.scope.businessId),
    ]);
    if (!this.alive || mine !== this.seq) return;
    const lost = [r, o].some(
      (x) => x.status === "rejected" && x.reason instanceof ApiError && x.reason.status === 404,
    );
    if (lost) return this.set({ gone: true, records: null });
    let offers: Records["offers"] = "unknown";
    if (o.status === "fulfilled")
      try {
        const list = parseOwnerOffers(o.value).filter((x) => x.project_id === this.scope.projectId);
        offers = {
          active: list.filter((x) => x.state === "active").length,
          retired: list.filter((x) => x.state === "retired").length,
        };
      } catch {
        offers = "unknown";
      }
    this.set({ records: { releases: r.status === "fulfilled" ? r.value : "unknown", offers } });
  }
}
