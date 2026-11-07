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

export function RecordedProof({ e }: { e: Example }) {
  const at = (n: string) => e.checkpoints.find((c) => c.name === n) ?? null;
  const bought = at("bought_100");
  const closed = at("closed");
  const next = at("next_use_under_buyer");
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
      <section className="card proof-hero" aria-labelledby="rp-cont">
        <div className="eyebrow" id="rp-cont">
          Customer's unused uses · prepaid before the sale
        </div>
        <p className="proof-units">
          <span>{closed?.free ?? "—"}</span>
          <span aria-hidden="true" className="proof-arrow">
            →
          </span>
          <span className="sr-only"> then </span>
          <span>{next?.free ?? "—"}</span>
        </p>
        <div className="row proof-hero-tags">
          {bought?.free && <span className="pill">{bought.free} uses bought</span>}
          {closed?.free && <span className="pill">{closed.free} unused at close</span>}
          {next?.free && <span className="pill success">Next use settled under the buyer</span>}
          <SourceTag source="testnet_final" block={next?.block} />
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
