// The handoff proof (Continuity Receipt, design/sale-proof/proof-a; Tony's choice): after a close,
// the customer's next settled use leads; every fact carries where it came from; the receipt
// export is one click away. Nothing here is narrated: labels, values, sources and actions.

import { type ReactNode, useEffect, useState } from "react";
import { Link } from "../router.tsx";
import {
  type EvidenceSource,
  type HandoffProofView,
  type ProofFact,
  proofHttp,
  SaleError,
} from "../saleApi.ts";
import { tokenAmount } from "../saleCalls.ts";
import { useSession } from "../session.tsx";
import { when } from "../when.ts";

/** Each source has its own mark and words, so tags never rely on colour. */
export const SOURCE: Record<EvidenceSource, { mark: string; label: string; detail: string }> = {
  synthetic: {
    mark: "◇",
    label: "Synthetic run",
    detail: "Read from the synthetic chain this demo runs on; it follows the contract's rules.",
  },
  local_node: {
    mark: "□",
    label: "Local NEAR node",
    detail: "Read from a local NEAR node running the contract's real code.",
  },
  testnet_final: {
    mark: "●",
    label: "Testnet final read",
    detail: "Read from NEAR testnet at a final block.",
  },
  testnet_receipt: {
    mark: "◆",
    label: "Testnet receipt",
    detail: "The transaction's final outcome on NEAR testnet.",
  },
  light_client: {
    mark: "⬡",
    label: "Light-client proof",
    detail: "Proved against a block header with NEAR's light-client proof.",
  },
  everstreet: {
    mark: "≡",
    label: "Everstreet record",
    detail: "Recorded by Everstreet; not a chain read.",
  },
};

export function SourceTag({ source, block }: { source: EvidenceSource; block?: string | null }) {
  const s = SOURCE[source];
  return (
    <span
      className={`src-tag src-${source}`}
      title={block ? `${s.detail} Block ${block}.` : s.detail}
    >
      <span aria-hidden="true">{s.mark}</span> {s.label}
      {block && <span className="sr-only">, block {block}</span>}
    </span>
  );
}

const short = (v: string) => (v.length > 18 ? `${v.slice(0, 8)}…${v.slice(-6)}` : v);

function factValue(f: ProofFact, p: HandoffProofView) {
  // A use that hasn't happened is "None yet"; anything else missing is genuinely unknown.
  if (f.value === null && f.key === "next_settled_use" && p.snapshot) return "None yet";
  if (f.value === null) return <span className="unknown">Not recorded</span>;
  const v = String(f.value);
  if (f.key === "code_hash" && v === "synthetic") return "None (synthetic chain)";
  if (f.key === "close_tx" || f.key === "terms_digest" || f.key === "code_hash")
    return (
      <span className="mono" title={v}>
        {short(v)}
      </span>
    );
  if (f.key === "contract") return <span className="mono wrap">{v}</span>;
  if (f.key === "owner") return <span className="mono wrap">{v}</span>;
  if (f.key === "next_settled_use") return `1 · ${v} remaining`;
  return v;
}

function Rows({ children, label }: { children: ReactNode; label: string }) {
  return (
    <dl className="proof-rows" aria-label={label}>
      {children}
    </dl>
  );
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

function Continuity({ p }: { p: HandoffProofView }) {
  const c = p.continuity;
  const units = p.facts.find((f) => f.key === "units_at_close");
  const who = c.customer?.name ?? (p.viewer.operates ? c.customer?.account : null);
  return (
    <section className="card proof-hero" aria-labelledby="proof-cont">
      <div className="eyebrow" id="proof-cont">
        {who ? `${who} · customer` : "Customers"}
      </div>
      {c.at_close !== null && c.after !== null ? (
        <p className="proof-units">
          <span>{c.at_close}</span>
          <span aria-hidden="true" className="proof-arrow">
            →
          </span>
          <span className="sr-only"> then </span>
          <span>{c.after}</span>
        </p>
      ) : (
        <p className="proof-units">
          <span>{units?.value ?? "—"}</span>
          <span className="proof-units-label">units carried over</span>
        </p>
      )}
      <div className="row proof-hero-tags">
        {c.at_close !== null && c.after !== null && (
          <span className="pill">{c.at_close} at close</span>
        )}
        {c.after !== null ? (
          <>
            <span className="pill">1 use charged</span>
            <span className="pill success">Next use settled</span>
          </>
        ) : (
          <span className="pill caution proof-pending">No use since the close</span>
        )}
        <SourceTag source={p.source} block={c.after_block ?? c.at_close_block} />
      </div>
    </section>
  );
}

function CloseEvidence({ p }: { p: HandoffProofView }) {
  return (
    <section className="card" aria-labelledby="proof-ev">
      <h2 id="proof-ev" className="sale-h3">
        Close evidence
      </h2>
      <Rows label="Close evidence">
        {p.facts.map((f) => (
          <Row key={f.key} label={f.label} source={f.source} block={f.block}>
            {factValue(f, p)}
            {p.agreement.status === "uncertain" &&
              (f.key === "owner" || f.key === "generation") && (
                <span className="pill caution proof-pending"> Uncertain</span>
              )}
          </Row>
        ))}
      </Rows>
    </section>
  );
}

function Rights({ p }: { p: HandoffProofView }) {
  const r = p.rights;
  const amount = (v: string | null) =>
    v === null ? (
      <span className="unknown">Not recorded</span>
    ) : p.token ? (
      `${tokenAmount(v, p.token.decimals)} ${p.token.symbol}`
    ) : (
      <span className="mono">{v}</span>
    );
  const ended = r.ended.map((e) =>
    e.what === "owner_role"
      ? `${e.account}'s owner role (generation ${e.generation})`
      : `${e.account} as operator (generation ${e.generation})`,
  );
  const ops = r.carried_over.operators.map(
    (o) => `${o.account} (${o.caps & 1 ? "metering" : ""}${o.caps & 2 ? " support" : ""})`,
  );
  return (
    <section className="card" aria-labelledby="proof-rights">
      <h2 id="proof-rights" className="sale-h3">
        Rights after the sale
      </h2>
      <Rows label="Rights after the sale">
        <Row label="Ended" source={p.source}>
          {ended.join(" · ")}
        </Row>
        <Row label="Carried over" source={p.source}>
          {[
            ...ops,
            r.carried_over.units !== null
              ? `${r.carried_over.units} customer units (${r.carried_over.customers} ${r.carried_over.customers === 1 ? "customer" : "customers"})`
              : null,
          ]
            .filter(Boolean)
            .join(" · ") || "Nothing named"}
        </Row>
        <Row label={r.operates.moved ? "Buyer operates" : "Operates now"} source={p.source}>
          <span className="mono wrap">{r.operates.account}</span> · generation{" "}
          {r.operates.generation}
        </Row>
        <Row label="Seller's claim" source={p.source}>
          {amount(r.seller_claim.owed)} owed
          {r.seller_claim.in_flight !== "0" && <> · {amount(r.seller_claim.in_flight)} in flight</>}
        </Row>
        <Row label="Still possible" source={p.source}>
          {r.still_possible.length === 0
            ? "No signed hold open"
            : r.still_possible
                .map(
                  (h) =>
                    `${h.customer ? `${h.customer}'s` : "A customer's"} signed hold (${h.units} ${h.units === 1 ? "unit" : "units"}) until ${when(Number(h.until_ms))}`,
                )
                .join(" · ")}
        </Row>
      </Rows>
    </section>
  );
}

function Agreement({ p }: { p: HandoffProofView }) {
  const a = p.agreement;
  const status =
    a.status === "agree"
      ? { cls: "pill success", text: "Agree at the same block" }
      : a.status === "single"
        ? { cls: "pill", text: "One provider" }
        : { cls: "pill caution proof-pending", text: "Uncertain" };
  return (
    <section className="card" aria-labelledby="proof-rpc">
      <h2 id="proof-rpc" className="sale-h3">
        RPC comparison
      </h2>
      <Rows label="RPC comparison">
        <Row label="Block">
          <span className="mono">{a.block.height}</span>
        </Row>
        {a.providers.map((x) => (
          <Row key={x.name} label={x.name} source={x.error ? undefined : p.source}>
            {x.error ? (
              <span className="unknown">No answer ({x.error.replace(/_/g, " ")})</span>
            ) : (
              <>
                <span className="mono wrap">{x.owner}</span> · generation {x.generation}
              </>
            )}
          </Row>
        ))}
        <Row label="Observation">
          <span className={status.cls}>{status.text}</span>
        </Row>
        {a.status === "uncertain" && (
          <Row label="Last coherent">
            {a.last_coherent ? (
              <>
                <span className="mono wrap">{a.last_coherent.owner}</span> · generation{" "}
                {a.last_coherent.generation} · block{" "}
                <span className="mono">{a.last_coherent.block_height}</span>
              </>
            ) : (
              <span className="unknown">None recorded</span>
            )}
          </Row>
        )}
      </Rows>
    </section>
  );
}

function Receipt({ p }: { p: HandoffProofView }) {
  return (
    <section className="card" aria-labelledby="proof-receipt">
      <h2 id="proof-receipt" className="sale-h3">
        Handoff receipt
      </h2>
      <p className="row">
        <a
          className="btn btn-primary"
          href={proofHttp.receiptUrl(p.business.id)}
          download={`handoff-receipt-deal-${p.deal.seq}.json`}
        >
          Download handoff receipt
        </a>
      </p>
      <p className="muted proof-small">
        Check it with <code>npx tsx scripts/verify-receipt.ts &lt;file&gt; --live</code>
      </p>
    </section>
  );
}

function SourceKey({ p }: { p: HandoffProofView }) {
  const used = new Set<EvidenceSource>([...p.facts.map((f) => f.source), p.source]);
  return (
    <section className="card quiet" aria-labelledby="proof-key">
      <h2 id="proof-key" className="sale-h3">
        Evidence sources
      </h2>
      <details>
        <summary>Source key</summary>
        <ul className="proof-key">
          {(Object.keys(SOURCE) as EvidenceSource[]).map((k) => (
            <li key={k} className={used.has(k) ? "" : "muted"}>
              <SourceTag source={k} /> {SOURCE[k].detail}
            </li>
          ))}
        </ul>
      </details>
      <Rows label="Other evidence">
        <Row label="Light-client proof">
          <span className="unknown">Not attached</span>
        </Row>
        <Row label="Attack suite">
          <Link to="/attacks">What we tried to break</Link>
        </Row>
      </Rows>
    </section>
  );
}

export function HandoffProofPage({ id }: { id: string }) {
  const { account, person } = useSession();
  const [p, setP] = useState<HandoffProofView | null>(null);
  const [err, setErr] = useState<{ text: string; code?: string } | null>(null);
  const [n, setN] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: n reloads on request
  useEffect(() => {
    if (!account) return;
    let live = true;
    setErr(null);
    proofHttp
      .proof(id)
      .then((x) => live && setP(x))
      .catch(
        (e) =>
          live &&
          setErr({
            text: e instanceof Error ? e.message : "This proof couldn't be shown.",
            code: e instanceof SaleError ? e.code : undefined,
          }),
      );
    return () => {
      live = false;
    };
  }, [id, account, n]);
  if (!person || !account)
    return (
      <div className="page empty">
        <h2>Sign in with your NEAR account to see this proof.</h2>
      </div>
    );
  if (err)
    return (
      <div className="page empty" role="alert">
        <h2>
          {err.code === "no_close" ? "No closed sale here yet" : "This proof couldn't be shown"}
        </h2>
        <p>{err.text}</p>
        <p className="row" style={{ justifyContent: "center" }}>
          <button type="button" className="btn btn-secondary" onClick={() => setN((x) => x + 1)}>
            Try again
          </button>
          <Link to={`/sales/${id}`}>Back to the sale</Link>
        </p>
      </div>
    );
  if (!p)
    return (
      <div className="page muted" role="status">
        Reading the contract…
      </div>
    );
  return (
    <div className="page handover sale-room proof-page">
      <div className="row" style={{ marginBottom: 4 }}>
        <Link to={`/sales/${id}`} className="muted">
          Sale
        </Link>
      </div>
      <header className="sale-head">
        <div className="eyebrow">
          Continuity receipt · {p.business.name} · deal {p.deal.seq}
        </div>
        <div className="sale-title-row">
          <h1 className="display sale-title">Handoff proof</h1>
          <button type="button" className="btn btn-secondary" onClick={() => setN((x) => x + 1)}>
            Read again
          </button>
        </div>
        <p className="muted proof-small">
          Closed {when(Number(p.deal.at_ms))} · read at block{" "}
          <span className="mono">{p.block.height}</span>
        </p>
      </header>
      <Continuity p={p} />
      <div className="sale-grid proof-grid">
        <div className="sale-main">
          <CloseEvidence p={p} />
          <Rights p={p} />
        </div>
        <div className="sale-main">
          <Receipt p={p} />
          <Agreement p={p} />
          <SourceKey p={p} />
        </div>
      </div>
    </div>
  );
}
