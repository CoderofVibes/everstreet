// Job 006c (docs/design/SUCCESSOR_REHEARSAL.md): the successor rehearsal. The owner starts one; the
// server takes an exact, digested snapshot of the product to rehearse and hands it to a runner: a
// separate child process running the existing synthetic successor flow in its own temporary
// directory, never this database. The runner answers with a record; the server checks its digests,
// that it rehearsed this snapshot, that it holds no secret material, and that its directory is
// gone, then stores it immutably. A run the server can't finish (restart, death, deadline) is
// "interrupted", never retried silently. One rehearsal at a time per server.

import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import type { Db } from "./db.ts";
import { canonical, sha256 } from "./handoverVerify.ts";
import { HttpError, type Person, type Store } from "./store.ts";

export const SUCCESSOR_FORMAT = "everstreet-successor-rehearsal";
export const SUCCESSOR_VERSION = 1;
const SECRETISH = /ed25519:[1-9A-HJ-NP-Za-km-z]{60,}|evs_agent_|"private_key"|"secret"|es_session=/;
const SECTIONS = ["header", "snapshot", "steps", "dependencies", "outcome", "disposal"] as const;

// biome-ignore lint/suspicious/noExplicitAny: records are read field by field
type Json = Record<string, any>;

export const SUCCESSOR_SCHEMA = `
CREATE TABLE IF NOT EXISTS successor_rehearsals (
  id TEXT PRIMARY KEY, business_id TEXT NOT NULL REFERENCES businesses(id),
  state TEXT NOT NULL CHECK (state IN ('running','passed','failed','interrupted','stale')),
  snapshot_digest TEXT NOT NULL, snapshot TEXT NOT NULL, record TEXT, detail TEXT NOT NULL DEFAULT '',
  started_by TEXT NOT NULL REFERENCES people(id), owner_generation INTEGER NOT NULL,
  started_at TEXT NOT NULL, finished_at TEXT
) STRICT;
CREATE INDEX IF NOT EXISTS successor_rehearsals_business ON successor_rehearsals(business_id, started_at);
CREATE TRIGGER IF NOT EXISTS successor_rehearsals_final BEFORE UPDATE ON successor_rehearsals
WHEN OLD.state != 'running'
BEGIN SELECT RAISE(ABORT, 'a finished rehearsal is immutable'); END;
`;

/** What the rehearsal rebuilds: a SaaS workflow's saved revision, or a web app's bundle and terms. */
export type RehearsalSeed =
  | { kind: "workflow"; business_name: string; brief: unknown; prototype: unknown }
  | {
      kind: "web_app";
      business_name: string;
      bundle: unknown;
      app_terms: { access: "pass"; pass_days: number; limitations: string };
    };

export interface RehearsalSnapshot {
  business: { id: string; name: string; owner_generation: number };
  product: {
    project_id: string;
    release_id: string;
    kind: string;
    artifact_digest: string;
    supported: boolean;
    reason: string | null;
  } | null;
  offers: { id: string; plan_id: number; retention_days: number }[];
  dependencies: {
    key: string;
    label: string;
    responsibility: "contract" | "owner_appointed" | "platform" | "external";
    note: string;
  }[];
}

/** The dependencies every rehearsal reports, and how each one is (or isn't) rehearsed. */
const BASE_DEPENDENCIES: RehearsalSnapshot["dependencies"] = [
  {
    key: "business_contract",
    label: "Control of the business contract",
    responsibility: "contract",
    note: "Moves with a sale, on chain. Rehearsed on the synthetic contract.",
  },
  {
    key: "metering_operator",
    label: "Metering operator appointed by the current owner",
    responsibility: "owner_appointed",
    note: "Serves customers' units. Ends at the close unless the terms name it; the new owner appoints it.",
  },
  {
    key: "customer_offers",
    label: "Customer offers and prepaid uses",
    responsibility: "contract",
    note: "Stay with the business contract; customers keep them through a sale.",
  },
  {
    key: "runtime",
    label: "Where the released product runs",
    responsibility: "platform",
    note: "Everstreet runs the release (the workflow engine, or the app site); it stays with the business.",
  },
  {
    key: "protected_storage",
    label: "Customers' kept requests and results",
    responsibility: "platform",
    note: "Kept by Everstreet for each customer only; never transferred or shown to an owner.",
  },
  {
    key: "external",
    label: "Hosting, domain, source and billing outside Everstreet",
    responsibility: "external",
    note: "Pending external transfer: a rehearsal can't check or complete it.",
  },
];

const iso = () => new Date().toISOString();

/** The digest a snapshot is identified by (its seed included: the exact content rehearsed). */
export const snapshotDigest = (s: RehearsalSnapshot, seed: RehearsalSeed | null) =>
  sha256(canonical({ snapshot: s, seed }));

/** Takes the business's rehearsal snapshot: the product to rehearse and what it depends on. */
export function takeSnapshot(
  db: Db,
  businessId: string,
): { snapshot: RehearsalSnapshot; seed: RehearsalSeed | null } {
  const b = db.prepare("SELECT id, name FROM businesses WHERE id = ?").get(businessId) as {
    id: string;
    name: string;
  };
  const generation = (
    db.prepare("SELECT COUNT(*) AS n FROM ownership WHERE business_id = ?").get(businessId) as {
      n: number;
    }
  ).n;
  const releases = db
    .prepare(
      `SELECT r.id, r.project_id, r.artifact_job, r.artifact_digest, a.kind, a.content, j.revision
         FROM runtime_releases r JOIN build_artifacts a ON a.job_id = r.artifact_job
         JOIN build_jobs j ON j.id = r.artifact_job
        WHERE r.business_id = ? AND r.state = 'active' ORDER BY r.activated_at, r.id`,
    )
    .all(businessId) as {
    id: string;
    project_id: string;
    artifact_job: string;
    artifact_digest: string;
    kind: string;
    content: string;
    revision: number;
  }[];
  const rank = (k: string) => (k === "workflow_spec" ? 0 : k === "web_app_bundle" ? 1 : 2);
  const r = [...releases].sort((x, y) => rank(x.kind) - rank(y.kind))[0];
  let seed: RehearsalSeed | null = null;
  let reason: string | null = null;
  if (!r) reason = "Nothing is released, so there is no product to rehearse.";
  else if (r.kind === "workflow_spec") {
    const rev = db
      .prepare("SELECT brief, prototype FROM product_revisions WHERE project_id = ? AND number = ?")
      .get(r.project_id, r.revision) as { brief: string; prototype: string } | undefined;
    if (rev)
      seed = {
        kind: "workflow",
        business_name: b.name,
        brief: JSON.parse(rev.brief),
        prototype: JSON.parse(rev.prototype),
      };
    else reason = "The released version's saved revision couldn't be read.";
  } else if (r.kind === "web_app_bundle") {
    const t = db
      .prepare("SELECT access, pass_days, limitations FROM app_release_terms WHERE release_id = ?")
      .get(r.id) as { access: string; pass_days: number | null; limitations: string } | undefined;
    if (t?.access === "pass" && t.pass_days)
      seed = {
        kind: "web_app",
        business_name: b.name,
        bundle: JSON.parse(r.content),
        app_terms: { access: "pass", pass_days: t.pass_days, limitations: t.limitations },
      };
    else
      reason =
        "A free web app has no customer entitlement to serve, so its handover isn't rehearsed this way.";
  } else
    reason =
      "AI products aren't rehearsed yet: rebuilding and checking them would spend the model budget.";
  const offers = r
    ? (
        db
          .prepare(
            "SELECT id, plan_id, retention_days FROM customer_offers WHERE release_id = ? AND state = 'active' ORDER BY created_at, id",
          )
          .all(r.id) as { id: string; plan_id: number; retention_days: number }[]
      ).map((o) => ({ ...o }))
    : [];
  if (r && !reason && offers.length === 0)
    reason =
      "The released product has no customer offer, so there is no existing customer to serve.";
  // An imported business also names its own external dependencies.
  const imported = (
    db
      .prepare(
        `SELECT d.category, d.note FROM import_dependencies d JOIN import_workspaces w ON w.id = d.workspace_id
          WHERE w.business_id = ? AND d.uses = 1 ORDER BY d.category`,
      )
      .all(businessId) as { category: string; note: string }[]
  ).map((d) => ({
    key: `import:${d.category}`,
    label: `Imported: ${d.category.replaceAll("_", " ")}`,
    responsibility: "external" as const,
    note: "Pending external transfer, as recorded in the import.",
  }));
  return {
    snapshot: {
      business: { id: b.id, name: b.name, owner_generation: generation },
      product: r
        ? {
            project_id: r.project_id,
            release_id: r.id,
            kind: r.kind,
            artifact_digest: r.artifact_digest,
            supported: seed !== null && reason === null,
            reason,
          }
        : null,
      offers,
      dependencies: [...BASE_DEPENDENCIES, ...imported],
    },
    seed: reason ? null : seed,
  };
}

/** Offline-checkable integrity of a record: format, digests, and no secret material. */
export function verifySuccessorRecord(raw: string) {
  const problems: string[] = [];
  let r: Json;
  try {
    r = JSON.parse(raw) as Json;
  } catch {
    return { ok: false, problems: ["not JSON"], record: null };
  }
  if (r.format !== SUCCESSOR_FORMAT || r.version !== SUCCESSOR_VERSION)
    problems.push("unknown format");
  for (const k of SECTIONS) {
    if (!(k in r)) problems.push(`missing ${k}`);
    else if (r.digests?.sections?.[k] !== sha256(canonical(r[k])))
      problems.push(`${k} digest differs`);
  }
  if (r.digests?.record !== sha256(canonical(r.digests?.sections ?? {})))
    problems.push("record digest differs");
  if (SECRETISH.test(raw)) problems.push("contains key or token material");
  return { ok: problems.length === 0, problems, record: problems.length ? null : r };
}

/** Seals a record's sections with the handover record's canonical digests. */
export function sealSuccessorRecord(body: Record<(typeof SECTIONS)[number], unknown>) {
  const sections = Object.fromEntries(SECTIONS.map((k) => [k, sha256(canonical(body[k]))]));
  return {
    format: SUCCESSOR_FORMAT,
    version: SUCCESSOR_VERSION,
    ...body,
    digests: { sections, record: sha256(canonical(sections)) },
  };
}

/** Runs one rehearsal in isolation; answers the record's text, or throws. Aborted on deadline. */
export type SuccessorRunner = (
  input: { snapshot: RehearsalSnapshot; seed: RehearsalSeed; digest: string },
  signal: AbortSignal,
) => Promise<string>;

interface Row {
  id: string;
  business_id: string;
  state: "running" | "passed" | "failed" | "interrupted" | "stale";
  snapshot_digest: string;
  snapshot: string;
  record: string | null;
  detail: string;
  started_by: string;
  owner_generation: number;
  started_at: string;
  finished_at: string | null;
}

export class SuccessorRehearsals {
  private running: Promise<void> | null = null;
  constructor(
    private readonly db: Db,
    private readonly store: Store,
    private readonly runner: SuccessorRunner | null,
    private readonly opts: { deadlineMs?: number } = {},
  ) {
    db.exec(SUCCESSOR_SCHEMA);
  }

  /** At start: a rehearsal left running by an earlier process is interrupted, never resumed. */
  recover() {
    this.db
      .prepare(
        "UPDATE successor_rehearsals SET state = 'interrupted', detail = 'The server stopped while it ran; nothing from it was kept.', finished_at = ? WHERE state = 'running'",
      )
      .run(iso());
  }

  private row(id: string) {
    return this.db.prepare("SELECT * FROM successor_rehearsals WHERE id = ?").get(id) as
      | Row
      | undefined;
  }

  private finish(id: string, state: Row["state"], detail: string, record: string | null) {
    this.db
      .prepare(
        "UPDATE successor_rehearsals SET state = ?, detail = ?, record = ?, finished_at = ? WHERE id = ? AND state = 'running'",
      )
      .run(state, detail, record, iso(), id);
  }

  /** The owner's page: whether a rehearsal can run now, and the runs so far. */
  list(viewer: Person, businessId: string) {
    this.store.ownedBusiness(viewer, businessId);
    const { snapshot } = takeSnapshot(this.db, businessId);
    const rows = this.db
      .prepare(
        "SELECT * FROM successor_rehearsals WHERE business_id = ? ORDER BY started_at DESC, rowid DESC LIMIT 20",
      )
      .all(businessId) as unknown as Row[];
    return {
      available: this.runner !== null,
      unavailable_reason: this.runner
        ? null
        : "Rehearsals aren't available on this server: no rehearsal runner is configured.",
      product: snapshot.product,
      rehearsals: rows.map((r) => this.summary(r)),
    };
  }

  private summary(r: Row) {
    const rec = r.record ? (JSON.parse(r.record) as Json) : null;
    return {
      id: r.id,
      state: r.state,
      detail: r.detail,
      started_at: r.started_at,
      finished_at: r.finished_at,
      snapshot_digest: r.snapshot_digest,
      steps: rec ? (rec.steps as Json[]) : [],
      dependencies: rec ? (rec.dependencies as Json[]) : [],
      outcome: rec ? (rec.outcome as Json) : null,
      disposal: rec ? (rec.disposal as Json) : null,
      record_digest: rec ? (rec.digests?.record as string) : null,
    };
  }

  /** The stored record, exactly as received and checked (owner only). */
  record(viewer: Person, businessId: string, id: string) {
    this.store.ownedBusiness(viewer, businessId);
    const r = this.row(id);
    if (!r || r.business_id !== businessId || !r.record)
      throw new HttpError(404, "No such rehearsal record");
    return r.record;
  }

  /** For the handover record (003x): the latest finished rehearsal, as recorded. */
  latest(businessId: string) {
    const r = this.db
      .prepare(
        "SELECT * FROM successor_rehearsals WHERE business_id = ? AND state != 'running' ORDER BY started_at DESC, rowid DESC LIMIT 1",
      )
      .get(businessId) as Row | undefined;
    return r ? this.summary(r) : null;
  }

  start(viewer: Person, businessId: string) {
    const b = this.store.ownedBusiness(viewer, businessId);
    this.store.requireNoHandover(businessId);
    if (!this.runner)
      throw new HttpError(409, "Rehearsals aren't available on this server", "unavailable");
    const { snapshot, seed } = takeSnapshot(this.db, b.id);
    if (!snapshot.product?.supported || !seed)
      throw new HttpError(
        409,
        snapshot.product?.reason ?? "Nothing is released, so there is no product to rehearse.",
        "not_supported",
      );
    if (
      this.running ||
      this.db.prepare("SELECT 1 FROM successor_rehearsals WHERE state = 'running'").get()
    )
      throw new HttpError(
        409,
        "A rehearsal is already running on this server; try again shortly",
        "busy",
      );
    const id = randomUUID();
    const digest = snapshotDigest(snapshot, seed);
    this.db
      .prepare(
        `INSERT INTO successor_rehearsals (id, business_id, state, snapshot_digest, snapshot, record, detail, started_by, owner_generation, started_at)
         VALUES (?, ?, 'running', ?, ?, NULL, '', ?, ?, ?)`,
      )
      .run(
        id,
        b.id,
        digest,
        JSON.stringify(snapshot),
        viewer.id,
        snapshot.business.owner_generation,
        iso(),
      );
    const runner = this.runner;
    const ac = new AbortController();
    const deadline = setTimeout(() => ac.abort(), this.opts.deadlineMs ?? 180_000);
    // The deadline is the server's own: it ends the run whether or not the runner listens.
    const stopped = new Promise<never>((_, reject) =>
      ac.signal.addEventListener("abort", () => reject(new Error("deadline"))),
    );
    this.running = Promise.race([runner({ snapshot, seed, digest }, ac.signal), stopped])
      .then((raw) => this.receive(id, b.id, digest, raw))
      .catch((e: unknown) =>
        this.finish(
          id,
          "interrupted",
          ac.signal.aborted
            ? "The rehearsal took longer than its time limit and was stopped; nothing from it was kept."
            : `The rehearsal stopped before it finished: ${(e as Error).message}`.slice(0, 300),
          null,
        ),
      )
      .finally(() => {
        clearTimeout(deadline);
        this.running = null;
      });
    return { rehearsal: this.summary(this.row(id) as Row), done: this.running };
  }

  /** Checks a runner's record before keeping it; anything that doesn't check out isn't kept. */
  private receive(id: string, businessId: string, digest: string, raw: string) {
    const v = verifySuccessorRecord(raw);
    if (!v.ok || !v.record)
      return this.finish(
        id,
        "interrupted",
        `The record didn't check out: ${v.problems.join(", ")}`,
        null,
      );
    const r = v.record;
    if (r.header?.snapshot_digest !== digest)
      return this.finish(id, "interrupted", "The record is for a different snapshot", null);
    // The disposable directory must really be gone.
    const dir = r.disposal?.directory as string | undefined;
    if (!dir || existsSync(dir) || r.disposal?.removed !== true)
      return this.finish(id, "interrupted", "The rehearsal's directory wasn't removed", null);
    // The business may have changed while it ran: then the result describes an older version.
    const now = takeSnapshot(this.db, businessId);
    const stale = now.seed === null || snapshotDigest(now.snapshot, now.seed) !== digest;
    const passed = r.outcome?.result === "passed";
    this.finish(
      id,
      stale ? "stale" : passed ? "passed" : "failed",
      stale
        ? "The business's product or offers changed while it ran; rehearse again for the current version."
        : String(r.outcome?.summary ?? ""),
      raw,
    );
  }
}
