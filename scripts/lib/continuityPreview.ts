// Job 003j: the in-memory scenario behind scripts/preview-continuity.ts, kept apart from any
// listener so tests can drive it through the real API without a network.
//
// Fictional and SYNTHETIC: an in-memory database, the real API (everstreetApi) and the real
// Rust-produced view JSON (server/test/fixtures/v3), served by an in-memory transport. No NEAR
// endpoint is contacted; block heights and hashes are made up. No keys, secrets or runtime data.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { everstreetApi } from "../../server/src/app.ts";
import { openDb } from "../../server/src/db.ts";
import { Store } from "../../server/src/store.ts";
import { type BlockRef, V3ReadError, type ViewTransport } from "../../server/src/v3read.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const fixture = (name: string) =>
  JSON.parse(
    readFileSync(join(root, "server", "test", "fixtures", "v3", `${name}.json`), "utf8"),
  ) as Record<string, string>;
const ACCEPTING = fixture("direct-accepting");
const CLOSED = fixture("direct-closed");
const CLOSING = fixture("gated-closing");

/** Synthetic: the real 202611 answer renumbered to another month. */
const month = (views: Record<string, string>, m: number) => ({
  ...views,
  [`get_period:${m}`]: (ACCEPTING["get_period:202611"] as string).replaceAll("202611", String(m)),
});

/** Synthetic, coherent: ten earlier deals ended unsold, so deals 1-2 are a history gap. */
function wrapped(owner: string): Record<string, string> {
  const one = JSON.parse(CLOSED.get_outcomes as string)[0];
  const ring = Array.from({ length: 8 }, (_, i) => 10 - i).map((n) => ({
    ...one,
    seq: String(n),
    status: n % 2 ? "cancelled" : "expired",
    generation_after: 2,
    control_seq: String(3 * n),
    price: "1",
    escrow_returned: "0",
  }));
  const control = {
    ...JSON.parse(CLOSED.get_control as string),
    owner,
    control_seq: "50",
    operators: [],
  };
  return { ...CLOSED, get_control: JSON.stringify(control), get_outcomes: JSON.stringify(ring) };
}

export const hashAt = (h: number, v = "P") => `${v}${String(h).replace(/0/g, "z")}`.padEnd(44, "x");

export type PreviewMode = "ok" | "offline" | "slow" | "block_unavailable";
export const MODES: PreviewMode[] = ["ok", "offline", "slow", "block_unavailable"];

/** In memory only. Each final-block request advances the synthetic chain by one block. */
export class PreviewTransport implements ViewTransport {
  readonly network = "testnet";
  mode: PreviewMode = "ok";
  height = 187_310_000;
  views: Record<string, Record<string, string>> = {};
  /** When set, the final block is this one (used to set up a genuine same-height conflict). */
  fixed: BlockRef | null = null;
  async finalBlock(_network: string, signal?: AbortSignal): Promise<BlockRef> {
    await this.gate(signal);
    if (this.fixed) return this.fixed;
    this.height += 1;
    return { height: String(this.height), hash: hashAt(this.height) };
  }
  async view(input: Parameters<ViewTransport["view"]>[0]) {
    await this.gate(input.signal);
    const key = input.method === "get_period" ? `get_period:${input.args.yyyymm}` : input.method;
    const result = this.views[input.account]?.[key];
    if (result === undefined) throw new V3ReadError("execution_failed", "no such preview view");
    return { result, block: input.block };
  }
  private async gate(signal?: AbortSignal) {
    if (this.mode === "offline") throw new Error("preview: offline");
    if (this.mode === "block_unavailable") throw new V3ReadError("block_unavailable", "preview");
    if (this.mode === "slow")
      // Ends when the snapshot's deadline aborts it: bounded, never an open-ended wait.
      await new Promise<void>((_, reject) => {
        if (signal?.aborted) reject(new Error("aborted"));
        signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
  }
}

export async function continuityPreview(opts: { paused?: boolean; timeoutMs?: number } = {}) {
  const store = new Store(openDb(":memory:"));
  const { person: mara, token: maraToken } = store.createPerson("Mara Solis");
  const { person: noah, token: noahToken } = store.createPerson("Noah Fenn");
  const biz = (name: string) =>
    store.tx(() => store.insertBusiness(mara, "started", name, "software")).businessId;
  const ids = {
    ledger: biz("Ledgerline Labs"),
    harbor: biz("Harbor Analytics"),
    quay: biz("Quayside Agents"),
    tide: biz("Tidewater Tools"),
    quill: biz("Quillmark Studio"),
    north: biz("Northline Tools"),
  };
  const link = (personId: string, account: string) =>
    store.db
      .prepare(
        "INSERT INTO chain_accounts (owner_kind, owner_id, account_id, secret, tx, created_at) VALUES ('person', ?, ?, NULL, 'preview', ?)",
      )
      .run(personId, account, new Date().toISOString());
  link(mara.id, "founder.near"); // matches for Ledgerline and Quayside
  link(noah.id, "buyer.near"); // Harbor's chain owner is someone else here: a mismatch

  if (opts.paused) {
    // A stored observation in an unreadable old format: the upgrade refuses it, v3 pauses.
    store.db.prepare("DELETE FROM v3_meta").run();
    store.db
      .prepare(
        "INSERT INTO v3_observations (business_id, network, account, schema, block_height, block_hash, control_seq, generation, owner, snapshot, digest, observed_at) VALUES (?, 'testnet', 'ledger.biz.testnet', 'business-v3/003g', '1', ?, '0', 1, 'founder.near', '{not json', 'x', ?)",
      )
      .run(ids.ledger, hashAt(1), new Date().toISOString());
  }

  const transport = new PreviewTransport();
  transport.views = {
    "ledger.biz.testnet": month(month(ACCEPTING, 202610), 202611),
    "harbor.biz.testnet": CLOSED,
    "quay.biz.testnet": month(CLOSING, 202611),
    "tide.biz.testnet": wrapped("tidewater-owner.testnet"),
    "quill.biz.testnet": ACCEPTING,
  };
  const clock = { skew: 0 };
  const app = everstreetApi(store, {
    localPreview: true,
    environment: "preview",
    v3: {
      transport,
      timeoutMs: opts.timeoutMs ?? 3_000,
      now: () => Date.now() + clock.skew,
      bindings: [
        { business_id: ids.ledger, network: "testnet", account: "ledger.biz.testnet" },
        { business_id: ids.harbor, network: "testnet", account: "harbor.biz.testnet" },
        { business_id: ids.quay, network: "testnet", account: "quay.biz.testnet" },
        { business_id: ids.tide, network: "testnet", account: "tide.biz.testnet" },
        { business_id: ids.quill, network: "testnet", account: "quill.biz.testnet" },
      ],
    },
  });

  /** A setup refresh; the preview refuses to start if its states weren't actually built. */
  const refresh = async (id: string, expect: string, period?: number) => {
    const res = await app.request(`/api/businesses/${id}/v3/refresh`, {
      method: "POST",
      headers: { cookie: `es_session=${maraToken}`, "content-type": "application/json" },
      body: JSON.stringify(period ? { period } : {}),
    });
    const body = (await res.json()) as { outcome?: string; code?: string; error?: string };
    if (body.outcome !== expect)
      throw new Error(
        `preview setup: expected ${expect}, got ${body.outcome ?? res.status} ${body.code ?? body.error ?? ""}`,
      );
  };

  if (!opts.paused) {
    // Ledgerline: fresh, November read (October left unread: absent, not zero).
    await refresh(ids.ledger, "accepted", 202611);
    // Harbor: read 25 minutes "ago" (stale) at a fixed block, then the same height answered with
    // another hash: a genuine, sticky conflict.
    clock.skew = -25 * 60_000;
    transport.fixed = { height: "187309000", hash: hashAt(187309000) };
    await refresh(ids.harbor, "accepted");
    transport.fixed = { height: "187309000", hash: hashAt(187309000, "Q") };
    await refresh(ids.harbor, "conflict");
    transport.fixed = null;
    clock.skew = 0;
    // Quayside: a Gated sale closing, with a month. Tidewater: unknown mapping, history gap.
    await refresh(ids.quay, "accepted", 202611);
    await refresh(ids.tide, "accepted");
    // Quillmark stays never observed; Northline is unbound.
  }

  /** Moves a business to Noah in the app (as a completed sale would), to review access loss. */
  const transfer = (id: string) => {
    const n = (
      store.db.prepare("SELECT COUNT(*) AS n FROM ownership WHERE business_id = ?").get(id) as {
        n: number;
      }
    ).n;
    store.db.prepare("UPDATE businesses SET owner_id = ? WHERE id = ?").run(noah.id, id);
    store.db
      .prepare(
        "INSERT INTO ownership (business_id, from_id, to_id, generation, at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(id, mara.id, noah.id, n + 2, new Date().toISOString());
  };

  return { store, app, transport, ids, mara, noah, maraToken, noahToken, transfer };
}
