// Job 003x: the buyer's control sheet and the portable handover record, composed from records
// that already exist (ownership and its generations, v3 observations, releases and their checks,
// customer offers, economics obligations, import transfer duties). No parallel authority
// registry; no grant is broadened: only the business's current owner may read either, fenced on
// control before and after composing (a sale during an export discloses nothing).
//
// Excluded always: customer documents and results, raw credentials, signed transaction bytes,
// founder conversations and work logs.

import type { Db } from "./db.ts";
import { economics } from "./economics.ts";
import { digestsFor, RECORD_FORMAT, RECORD_VERSION, type Section } from "./handoverVerify.ts";
import { CATEGORIES, TRANSFER } from "./imports.ts";
import type { Person, Store } from "./store.ts";

type Kind = "current" | "historical" | "pending_external" | "as_recorded";
interface Statement {
  text: string;
  kind: Kind;
  basis: string;
  observed_at: string | null;
}

export class HandoverRecords {
  constructor(
    private readonly db: Db,
    private readonly store: Store,
    private readonly binding: (businessId: string) => { network: string; account: string } | null,
    /** 006c: the latest finished successor rehearsal (as recorded), or null. */
    private readonly rehearsal: (businessId: string) => {
      id: string;
      state: string;
      finished_at: string | null;
      record_digest: string | null;
      outcome: { result?: string; summary?: string; boundaries?: string } | null;
      steps: { key: string; outcome: string }[];
      dependencies: { key: string; label: string; status: string }[];
    } | null = () => null,
  ) {}

  /** 006c: what a rehearsal showed, said as recorded, with its boundaries. Never "current". */
  private rehearsalOf(businessId: string) {
    const r = this.rehearsal(businessId);
    if (!r) return null;
    return {
      id: r.id,
      state: r.state,
      finished_at: r.finished_at,
      record_digest: r.record_digest,
      result: r.outcome?.result ?? null,
      boundaries: r.outcome?.boundaries ?? null,
      steps: r.steps.map((s) => ({ key: s.key, outcome: s.outcome })),
      dependencies: r.dependencies.map((d) => ({ key: d.key, status: d.status })),
      kind: "as_recorded" as const,
    };
  }

  private name(id: string) {
    return (
      (
        this.db.prepare("SELECT display_name FROM people WHERE id = ?").get(id) as
          | { display_name: string }
          | undefined
      )?.display_name ?? ""
    );
  }

  private compose(businessId: string) {
    const b = this.db
      .prepare("SELECT id, name, slug, owner_id, created_at FROM businesses WHERE id = ?")
      .get(businessId) as {
      id: string;
      name: string;
      slug: string;
      owner_id: string;
      created_at: string;
    };
    const generation = (
      this.db
        .prepare("SELECT COUNT(*) AS n FROM ownership WHERE business_id = ?")
        .get(businessId) as { n: number }
    ).n;
    const bind = this.binding(businessId);
    const obs = this.db
      .prepare(
        "SELECT account, network, owner, generation, control_seq, block_height, block_hash, digest, observed_at FROM v3_observations WHERE business_id = ? ORDER BY id DESC LIMIT 1",
      )
      .get(businessId) as
      | {
          account: string;
          network: string;
          owner: string;
          generation: number;
          control_seq: string;
          block_height: string;
          block_hash: string;
          digest: string;
          observed_at: string;
        }
      | undefined;
    const receipt = this.db
      .prepare(
        "SELECT from_id, to_id, generation, deal_id, tx, at FROM ownership WHERE business_id = ? ORDER BY id DESC LIMIT 1",
      )
      .get(businessId) as
      | {
          from_id: string;
          to_id: string;
          generation: number | null;
          deal_id: string | null;
          tx: string | null;
          at: string;
        }
      | undefined;
    const releases = this.db
      .prepare(
        `SELECT r.id, r.project_id, r.artifact_job, r.artifact_digest, r.eval_run, r.policy, r.validator, r.state, r.activated_at,
                e.passed, e.failed, e.errors, e.total
           FROM runtime_releases r LEFT JOIN eval_runs e ON e.id = r.eval_run
          WHERE r.business_id = ? ORDER BY r.activated_at DESC LIMIT 50`,
      )
      .all(businessId) as Record<string, unknown>[];
    const offers = (
      this.db
        .prepare(
          "SELECT id, release_id, artifact_digest, network, account, plan_id, plan, asset, retention_days, state, created_at FROM customer_offers WHERE business_id = ? ORDER BY created_at DESC LIMIT 50",
        )
        .all(businessId) as {
        plan: string;
        state: string;
        id: string;
        release_id: string;
        [k: string]: unknown;
      }[]
    ).map(({ plan, ...o }) => ({
      ...o,
      unit_price: String((JSON.parse(plan) as { unit_price?: string }).unit_price ?? ""),
    }));
    const eco = economics(this.db, businessId, 1);
    const declared = this.db
      .prepare(
        `SELECT d.category, d.uses, d.note FROM import_dependencies d JOIN import_workspaces w ON w.id = d.workspace_id
          WHERE w.business_id = ? AND d.uses = 1`,
      )
      .all(businessId) as { category: string; uses: number; note: string }[];
    const external = CATEGORIES.filter((c) => c !== "customer_promises").map((c) => ({
      category: c,
      label: TRANSFER[c].label,
      declared_in_use: declared.some((d) => d.category === c),
      status: "pending_external" as const,
      how: TRANSFER[c].mechanism,
      note: "Not transferred by the NEAR close. Done outside Everstreet, with its own evidence.",
    }));
    return { b, generation, bind, obs, receipt, releases, offers, eco, external };
  }

  /** The buyer's readable sheet: what they control, what customers keep, what's left to transfer. */
  sheet(viewer: Person, businessId: string) {
    const epoch = this.store.controlEpoch(viewer, businessId);
    const c = this.compose(businessId);
    this.store.stillControls(viewer, epoch, { handover: "allow" });
    const statements: { group: string; items: Statement[] }[] = [
      {
        group: "What you control",
        items: [
          {
            text: `You control ${c.b.name} on this server (owner generation ${c.generation}).`,
            kind: "current",
            basis: "This server's ownership record, checked on this read.",
            observed_at: new Date().toISOString(),
          },
          c.obs
            ? {
                text: `The contract ${c.obs.account} named ${c.obs.owner} as owner at generation ${c.obs.generation}.`,
                kind: "as_recorded",
                basis: `A read of the contract at block ${c.obs.block_height}. True then; read the contract to rely on it now.`,
                observed_at: c.obs.observed_at,
              }
            : {
                text: "No contract observation is recorded here.",
                kind: "as_recorded",
                basis: "Nothing read from the contract on this server.",
                observed_at: null,
              },
          ...(c.receipt
            ? [
                {
                  text: `Control moved from ${this.name(c.receipt.from_id)} to ${this.name(c.receipt.to_id)}${c.receipt.tx ? " by a recorded close" : ""}.`,
                  kind: "historical" as const,
                  basis:
                    "The ownership record of that change: a receipt of what happened, not current authority.",
                  observed_at: c.receipt.at,
                },
              ]
            : []),
        ],
      },
      {
        group: "What customers keep",
        items: [
          {
            text: `${c.offers.filter((o) => o.state === "active").length} active customer offer(s) on ${c.releases.filter((r) => r.state === "active").length} active release(s).`,
            kind: "current",
            basis: "This server's offers and releases.",
            observed_at: new Date().toISOString(),
          },
          ...c.eco.obligations.map((o) => ({
            text:
              o.outstanding_units === null
                ? `Prepaid uses still owed in ${o.asset}: unknown here.`
                : `${o.outstanding_units} prepaid uses are still owed to customers (${o.asset}).`,
            kind: "as_recorded" as const,
            basis: o.note,
            observed_at: c.eco.as_of,
          })),
          {
            text: "Customers keep their units, requests and results through the change of owner; their documents and results stay theirs and aren't in this record.",
            kind: "current",
            basis:
              "Everstreet's customer-continuity rule (results are readable only by the customer).",
            observed_at: null,
          },
        ],
      },
      ...(() => {
        const r = this.rehearsalOf(c.b.id);
        return r
          ? [
              {
                group: "Successor rehearsal",
                items: [
                  {
                    text:
                      r.state === "passed"
                        ? "A synthetic successor rehearsal passed: a successor served an existing customer, fixed a founder-only dependency and released a checked version."
                        : `The latest successor rehearsal was ${r.state}.`,
                    kind: "as_recorded" as const,
                    basis: `Rehearsal record ${(r.record_digest ?? "").slice(0, 12)}. ${r.boundaries ?? "Synthetic; not NEAR control or any external transfer."}`,
                    observed_at: r.finished_at,
                  },
                ],
              },
            ]
          : [];
      })(),
      {
        group: "Still to transfer outside NEAR",
        items: c.external.map((e) => ({
          text: `${e.label}${e.declared_in_use ? " (declared in use)" : ""}: ${e.how}`,
          kind: "pending_external" as const,
          basis: e.note,
          observed_at: null,
        })),
      },
    ];
    return {
      business: { id: c.b.id, name: c.b.name, slug: c.b.slug },
      statements,
      record: {
        available: true,
        note: "You can download a portable record of the permitted evidence. A downloaded file can't be recalled later.",
      },
    };
  }

  /** The portable record (owner only, fenced): versioned, digested, with explicit omissions. */
  record(viewer: Person, businessId: string) {
    const epoch = this.store.controlEpoch(viewer, businessId);
    const c = this.compose(businessId);
    const body: Record<Section, unknown> = {
      business: {
        id: c.b.id,
        name: c.b.name,
        slug: c.b.slug,
        network: c.bind?.network ?? null,
        contract: c.bind?.account ?? null,
      },
      control: {
        business_id: c.b.id,
        local_owner_generation: c.generation,
        observed: c.obs
          ? {
              account: c.obs.account,
              network: c.obs.network,
              owner: c.obs.owner,
              generation: c.obs.generation,
              control_seq: c.obs.control_seq,
              block_height: c.obs.block_height,
              block_hash: c.obs.block_hash,
              snapshot_digest: c.obs.digest,
              observed_at: c.obs.observed_at,
            }
          : null,
        // 006c: the latest successor rehearsal, as recorded (synthetic; its boundaries included).
        successor_rehearsal: this.rehearsalOf(c.b.id),
      },
      receipt: c.receipt
        ? {
            generation: c.receipt.generation,
            deal: c.receipt.deal_id,
            tx: c.receipt.tx,
            at: c.receipt.at,
            kind: "historical",
          }
        : null,
      releases: c.releases,
      offers: c.offers,
      obligations: c.eco.obligations,
      external_transfers: c.external,
      omissions: [
        "Customer documents and results (they belong to the customers).",
        "Credentials, keys, tokens and signed transaction bytes.",
        "Founder conversations, work logs and private notes.",
        "Anything this owner isn't permitted to read.",
      ],
    };
    const digests = digestsFor(body);
    this.store.stillControls(viewer, epoch, { handover: "allow" });
    return {
      format: RECORD_FORMAT,
      version: RECORD_VERSION,
      generated_at: new Date().toISOString(),
      generated_by: "This Everstreet server, for the business's owner at the time. Not signed.",
      body,
      digests,
      reading_note:
        "Digests show these bytes are unchanged. They don't show who made the file, that control is still as recorded, legal title, or that any product is free of errors.",
    };
  }
}
