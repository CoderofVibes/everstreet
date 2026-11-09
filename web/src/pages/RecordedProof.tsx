// The recorded testnet example in the Continuity Receipt layout (design/sale-proof/testnet-example):
// the committed, verified Ledgerline v3 rehearsal (data/evidence/v3-direct-testnet.json, served by
// GET /api/examples/ledgerline), with each fact's source and the transactions' explorer links.
// Public. Separate from the synthetic Signalwatch fixtures.

import { type ReactNode, useEffect, useState } from "react";
import { Link } from "../router.tsx";
import type { EvidenceSource } from "../saleApi.ts";
import { SourceLegend, SourceTag } from "./HandoffProof.tsx";

interface Checkpoint {
  name: string;
  block: string | null;
  free: string | null;
  owner: string | null;
  owner_role: string | null;
  generation: number | null;
}
interface Tx {
  step: string;
  role: string | null;
  method: string | null;
  hash: string | null;
  explorer: string | null;
  succeeded: boolean;
}
interface Example {
  label: string;
  network: string;
  contract: { account: string; code_hash: string };
  record: { digest: string; commit: string; verified_offline: boolean; reproduce: string };
  model: { note: string };
  checkpoints: Checkpoint[];
  transactions: Tx[];
  refusals: { step: string; status: number | null }[];
  light_client: null | {
    transaction: string;
    receipt: string;
    block: { hash: string; height: number };
    head: { hash: string; height: number };
    reproduce: string;
  };
  handovers?: Handovers;
}
interface TxRef {
  hash: string | null;
  explorer: string | null;
}
type Refusal = TxRef & {
  method: string | null;
  /** The contract that refused: a companion, or the business itself. */
  receiver: string | null;
  code: string;
  /** Refused in the call's answer (the transaction succeeded) or as a failed transaction. */
  how: "answer" | "failed";
  /** Whether the refusing contract asked this business during the call. */
  asked_business: boolean;
  record: string;
};
export interface Handovers {
  sales: {
    from: { account: string | null; generation: number | null };
    to: { account: string | null; generation: number | null };
    closed: TxRef;
    /** The first final read of the new owner after the close (that read's block). */
    read_after: null | { owner: string | null; block: string | null };
    former_owner_refused: null | Refusal;
    /** The business contract's own refusal of the former owner, when it is a different call. */
    business_refused?: null | Refusal;
    customer_unused_at_close: string | null;
    record: string;
  }[];
  after: null | {
    block: string | null;
    owner: string | null;
    generation: number | null;
    customer: {
      account: string | null;
      unused: string | null;
      used: string | null;
      bought: string | null;
    };
    record: string;
  };
}

function Row({
  label,
  children,
  source,
  block,
}: {
  label: string;
  children: ReactNode;
  source?: EvidenceSource;
  block?: string | null;
}) {
  return (
    <div className="proof-row">
      <dt>{label}</dt>
      <dd>
        <span className="proof-value">{children}</span>
        {source && <SourceTag source={source} block={block} />}
      </dd>
    </div>
  );
}

const short = (h: string) => `${h.slice(0, 8)}…${h.slice(-6)}`;
/** The account's first label (the full id is in the title). */
const who = (a: string | null) =>
  a ? (
    <span className="mono" title={a}>
      {a.split(".")[0]}
    </span>
  ) : (
    "—"
  );
const txLink = (t: TxRef | null) =>
  t?.hash && t.explorer ? (
    <a href={t.explorer} target="_blank" rel="noreferrer" className="mono">
      {short(t.hash)}
    </a>
  ) : (
    <span className="unknown">Not recorded</span>
  );

/** Each recorded sale at the moment control changed, then the business after the last one. */
export function HandoverStrip({ h }: { h: Handovers }) {
  if (h.sales.length === 0) return null;
  // The answers first (the Nov 8 review: a judge should find them on the first screen): who owns
  // it now, the business contract refusing the last former owner, and the customer's uses.
  const lastRefusal = h.sales.at(-1)?.business_refused ?? null;
  return (
    <section className="card handover-strip" aria-labelledby="rp-hand">
      <h2 id="rp-hand" className="sale-h3">
        Sales of this business
      </h2>
      {h.after && (
        <div className="hand-row hand-after">
          <div className="hand-cell">
            <span className="hand-k">Now</span>
            <span>
              {who(h.after.owner)} · generation {h.after.generation ?? "—"}
            </span>
            <span className="row hand-src">
              block {h.after.block ?? "—"}
              <SourceTag source="testnet_final" block={h.after.block} />
            </span>
          </div>
          <div className="hand-cell">
            <span className="hand-k">Former owner</span>
            {lastRefusal ? (
              <>
                <span>
                  refused by this business · <span className="mono">{lastRefusal.code}</span>
                </span>
                <span className="row hand-src">
                  {txLink(lastRefusal)}
                  <SourceTag source="testnet_receipt" />
                </span>
              </>
            ) : (
              <span className="unknown">Not recorded</span>
            )}
          </div>
          <div className="hand-cell hand-wide">
            <span className="hand-k">
              Customer {who(h.after.customer.account)}'s prepaid uses{" "}
              <span
                className="hand-info"
                title="A use is one prepaid run of the service: for Ledgerline, one invoice read. The customer bought them before the first sale; the contract holds them through every sale."
                role="img"
                aria-label="A use is one prepaid run of the service: for Ledgerline, one invoice read. The customer bought them before the first sale; the contract holds them through every sale."
              >
                (i)
              </span>
            </span>
            <span>
              <span className="hand-big">{h.after.customer.unused ?? "—"}</span> unused ·{" "}
              {h.after.customer.used ?? "—"} used · {h.after.customer.bought ?? "—"} bought
            </span>
          </div>
        </div>
      )}
      <ol className="hand-list">
        {h.sales.map((x, i) => (
          <li key={x.closed.hash ?? i} className="hand-row">
            <div className="hand-cell">
              <span className="hand-k">Sale {i + 1}</span>
              <span>
                {who(x.from.account)} → {who(x.to.account)}
              </span>
              <span className="muted">
                generation {x.from.generation ?? "—"} → {x.to.generation ?? "—"}
              </span>
            </div>
            <div className="hand-cell">
              <span className="hand-k">Closed</span>
              <span className="row hand-src">
                {txLink(x.closed)}
                <SourceTag source="testnet_receipt" />
              </span>
              <span className="hand-k">New owner read at</span>
              <span className="row hand-src">
                block {x.read_after?.block ?? "—"}
                <SourceTag source="testnet_final" block={x.read_after?.block ?? null} />
              </span>
            </div>
            <div className="hand-cell">
              <span className="hand-k">Former owner after the close</span>
              {x.former_owner_refused ? (
                <>
                  <span>
                    <span className="mono">{x.former_owner_refused.method}</span> to{" "}
                    {who(x.former_owner_refused.receiver)} · refused{" "}
                    <span className="mono">{x.former_owner_refused.code}</span>
                  </span>
                  <span className="muted">
                    {x.former_owner_refused.how === "answer"
                      ? "in the call's answer"
                      : "transaction failed"}
                    {x.former_owner_refused.asked_business &&
                      " · it asked this business who the owner is"}
                    {x.former_owner_refused.record !== x.record && " · recorded in a later run"}
                  </span>
                  <span className="row hand-src">
                    {txLink(x.former_owner_refused)}
                    <SourceTag source="testnet_receipt" />
                  </span>
                </>
              ) : (
                <span className="unknown">Not recorded</span>
              )}
              {x.business_refused && (
                <>
                  <span>
                    <span className="mono">{x.business_refused.method}</span> to this business ·
                    refused <span className="mono">{x.business_refused.code}</span>
                  </span>
                  <span className="muted">
                    transaction failed
                    {x.business_refused.record !== x.record && " · recorded in a later run"}
                  </span>
                  <span className="row hand-src">
                    {txLink(x.business_refused)}
                    <SourceTag source="testnet_receipt" />
                  </span>
                </>
              )}
            </div>
            <div className="hand-cell">
              <span className="hand-k">Customer's unused uses at the close</span>
              {x.customer_unused_at_close ? (
                <span className="hand-big">{x.customer_unused_at_close}</span>
              ) : (
                <span
                  className="unknown"
                  title="This sale's run didn't read the customer's balance. The read after the last sale, at the top, accounts for all of them."
                >
                  Not recorded in this run
                </span>
              )}
            </div>
          </li>
        ))}
      </ol>
      <details className="proof-small">
        <summary>Check these records</summary>
        {[...new Set([...h.sales.map((x) => x.record), ...(h.after ? [h.after.record] : [])])].map(
          (r) => (
            <p key={r}>
              <code>npx tsx scripts/verify-rehearsal.ts {r} --live</code>
            </p>
          ),
        )}
      </details>
    </section>
  );
}

export function RecordedProof({ e }: { e: Example }) {
  const at = (n: string) => e.checkpoints.find((c) => c.name === n) ?? null;
  const bought = at("bought_100");
  const closed = at("closed");
  const next = at("next_use_under_buyer");
  const updated = at("after_update");
  const before = at("before_close");
  const closeTx = e.transactions.filter((t) => t.method === "accept_sale").at(-1) ?? null;
  const link = (t: Tx | null) =>
    t?.hash && t.explorer ? (
      <a href={t.explorer} target="_blank" rel="noreferrer" className="mono">
        {short(t.hash)}
      </a>
    ) : (
      <span className="unknown">Not recorded</span>
    );
  return (
    <div className="page handover sale-room proof-page">
      <header className="sale-head">
        <div className="eyebrow">Recorded example · Ledgerline · NEAR testnet</div>
        <h1 className="display sale-title">Handoff proof</h1>
        <p className="muted proof-small">
          A run recorded on NEAR testnet by the repository's rehearsal script at commit{" "}
          <span className="mono">{e.record.commit.slice(0, 7)}</span> (record{" "}
          <span className="mono" title={e.record.digest}>
            {e.record.digest.slice(0, 12)}
          </span>
          )
        </p>
        {/* Second first-use pass (Nov 7, finding 2): what each badge means, once. */}
        <details className="proof-small">
          <summary>What the badges mean</summary>
          <SourceLegend only={["testnet_final", "testnet_receipt", "light_client", "everstreet"]} />
        </details>
      </header>
      {e.handovers && <HandoverStrip h={e.handovers} />}
      <section className="card proof-hero" aria-labelledby="rp-cont">
        <div className="eyebrow" id="rp-cont">
          The customer's prepaid uses, after the first sale
        </div>
        <ol className="proof-units proof-steps">
          <li>
            <span className="proof-n">{closed?.free ?? "—"}</span>
            <span className="proof-n-k">unused at the close</span>
          </li>
          <li>
            <span className="proof-n">{next?.free ?? "—"}</span>
            <span className="proof-n-k">next use, served by the buyer</span>
          </li>
          {updated?.free && (
            <li>
              <span className="proof-n">{updated.free}</span>
              <span className="proof-n-k">after the buyer's update</span>
            </li>
          )}
        </ol>
        <div className="row proof-hero-tags">
          {bought?.free && <span className="pill">{bought.free} bought before the sale</span>}
          {next?.free && <span className="pill success">Served under the buyer</span>}
          <SourceTag source="testnet_final" block={(updated ?? next)?.block} />
        </div>
      </section>
      <div className="sale-grid proof-grid">
        <div className="sale-main">
          <section className="card" aria-labelledby="rp-ev">
            <h2 id="rp-ev" className="sale-h3">
              Close evidence
            </h2>
            <dl className="proof-rows">
              <Row label="Business contract">
                <a
                  className="mono wrap"
                  href={`https://testnet.nearblocks.io/address/${e.contract.account}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {e.contract.account}
                </a>
              </Row>
              <Row label="Code hash" source="everstreet">
                <span className="mono" title={e.contract.code_hash}>
                  {short(e.contract.code_hash)}
                </span>
              </Row>
              <Row label="Owner before" source="testnet_final" block={before?.block}>
                {before?.owner_role ?? "—"} · generation {before?.generation ?? "—"}
              </Row>
              <Row label="Owner after" source="testnet_final" block={closed?.block}>
                {closed?.owner_role ?? "—"} · generation {closed?.generation ?? "—"}
              </Row>
              <Row label="Close transaction" source="testnet_receipt">
                {link(closeTx)}
              </Row>
              <Row
                label="Light-client proof"
                source={e.light_client ? "light_client" : undefined}
                block={e.light_client ? String(e.light_client.block.height) : null}
              >
                {e.light_client ? (
                  <>
                    The close at block {e.light_client.block.height}, proved against the later
                    header at height {e.light_client.head.height} (
                    <span className="mono" title={e.light_client.head.hash}>
                      {short(e.light_client.head.hash)}
                    </span>
                    )
                  </>
                ) : (
                  <span className="unknown">Not attached</span>
                )}
              </Row>
              <Row label="Units at close" source="testnet_final" block={closed?.block}>
                {closed?.free ?? "—"}
              </Row>
              <Row label="Next settled use" source="testnet_final" block={next?.block}>
                1 · {next?.free ?? "—"} remaining
              </Row>
              <Row label="Customer results" source="everstreet">
                Produced by a labelled stand-in model, not a real AI
              </Row>
            </dl>
          </section>
          <section className="card" aria-labelledby="rp-rights">
            <h2 id="rp-rights" className="sale-h3">
              Rights after the sale
            </h2>
            <dl className="proof-rows">
              {e.refusals.map((r) => (
                <Row
                  key={r.step}
                  label={
                    r.step === "old_owner_denied"
                      ? "Former owner reads in Everstreet"
                      : "Former owner writes in Everstreet"
                  }
                  source="everstreet"
                >
                  Refused (HTTP {r.status})
                </Row>
              ))}
              <Row label="Buyer operates" source="testnet_final" block={closed?.block}>
                generation {closed?.generation ?? "—"}
              </Row>
            </dl>
          </section>
        </div>
        <div className="sale-main">
          <section className="card" aria-labelledby="rp-verify">
            <h2 id="rp-verify" className="sale-h3">
              Check it yourself
            </h2>
            <p className="proof-small muted">From a checkout of the repository:</p>
            <p className="proof-small">
              <code>
                npx tsx scripts/verify-rehearsal.ts data/evidence/v3-direct-testnet.json --live
              </code>
            </p>
            {e.light_client && (
              <p className="proof-small">
                <code>{e.light_client.reproduce}</code>
              </p>
            )}
          </section>
          <section className="card" aria-labelledby="rp-tx">
            <h2 id="rp-tx" className="sale-h3">
              Transactions
            </h2>
            <dl className="proof-rows">
              {e.transactions.map((t) => (
                <Row key={`${t.step}-${t.hash}`} label={`${t.role ?? ""} · ${t.method ?? t.step}`}>
                  {link(t)}
                </Row>
              ))}
            </dl>
          </section>
          <section className="card quiet">
            <p className="row">
              <Link to="/example/ledgerline?tab=acquire">The example business</Link>
              <Link to="/attacks">What we tried to break</Link>
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}

export function RecordedProofPage() {
  const [e, setE] = useState<Example | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/examples/ledgerline")
      .then(async (r) => {
        if (!r.ok)
          throw new Error(((await r.json()) as { error?: string }).error ?? "Not available");
        setE((await r.json()) as Example);
      })
      .catch((x) => setErr(x instanceof Error ? x.message : "Not available"));
  }, []);
  if (err)
    return (
      <div className="page empty" role="alert">
        <h2>The recorded example couldn't be shown</h2>
        <p>{err}</p>
      </div>
    );
  if (!e)
    return (
      <div className="page muted" role="status">
        Loading the record…
      </div>
    );
  return <RecordedProof e={e} />;
}
