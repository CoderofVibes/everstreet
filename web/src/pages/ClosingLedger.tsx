// The Closing Ledger (design/sale-proof/terms-b; Tony's choice): while a sale is live, one review
// flow with the deal, funded escrow, acceptance, exactly what is included at the close, Gated
// readiness and everything still in progress. Labels and values only; the terms document and
// digests are one click away. Authority boundaries stay visible: escrow counts as funded only
// when the business contract shows it.

import type { ReactNode } from "react";
import type { CompanionView, SaleSetup } from "../saleApi.ts";
import { tokenAmount } from "../saleCalls.ts";
import { when } from "../when.ts";

const capsWords = (c: number) =>
  [c & 1 && "metering", c & 2 && "support"].filter(Boolean).join(" and ") || "no capabilities";

function Amount({ base, s }: { base: string; s: SaleSetup }) {
  const m = s.token.meta;
  return m ? (
    <>
      {tokenAmount(base, m.decimals)} {m.symbol}
    </>
  ) : (
    <span className="mono">{base}</span>
  );
}

function Rows({ children, label }: { children: ReactNode; label: string }) {
  return (
    <dl className="proof-rows" aria-label={label}>
      {children}
    </dl>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="proof-row">
      <dt>{label}</dt>
      <dd>
        <span className="proof-value">{children}</span>
      </dd>
    </div>
  );
}

/** Done reads as a success pill; anything not done is outlined, never filled. */
function State({ done, children }: { done: boolean; children: ReactNode }) {
  return <span className={done ? "pill success" : "pill caution proof-pending"}>{children}</span>;
}

function Check({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <span className={ok ? "ledger-ok" : "ledger-open"}>
      <span aria-hidden="true">{ok ? "✓" : "○"}</span>
      <span className="sr-only">{ok ? "Done: " : "Not yet: "}</span> {children}
    </span>
  );
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function ClosingLedger({
  s,
  terms,
  companions = null,
}: {
  s: SaleSetup;
  terms: ReactNode;
  companions?: CompanionView | null;
}) {
  const d = s.control.live_deal;
  if (!d) return null;
  const asset = companions?.asset ?? null;
  const allowance = companions?.allowance ?? null;
  const funded = d.escrow !== "0" && BigInt(d.escrow) >= BigInt(d.price);
  const gated = s.control.close_mode === "gated";
  const inv = s.inventory ?? null;
  const ready = s.readiness ?? null;
  const kept = d.grants;
  const p = s.party;
  const claims =
    p && (p.sale_proceeds_claim !== "0" || p.escrow_return_claim !== "0" || p.profit_claim !== "0");
  return (
    <div className="ledger">
      <section className="card ledger-rail" aria-labelledby="ledger-deal">
        <h2 id="ledger-deal" className="ledger-h">
          Deal {d.seq}
        </h2>
        <Rows label={`Deal ${d.seq}`}>
          <Row label="Price">
            <Amount base={d.price} s={s} />
          </Row>
          <Row label="Escrow">
            <State done={funded}>{funded ? "Funded" : "Not funded"}</State>
          </Row>
          <Row label="Control">Generation {s.control.generation}</Row>
          <Row label="Mode">{gated ? "Gated" : "Direct"}</Row>
          <Row label="Version">{d.version}</Row>
          <Row label="Open until">{when(Number(d.expires_at_ms))}</Row>
          {claims && p && (
            <Row label="Your claims">
              {[
                p.sale_proceeds_claim !== "0" && "sale proceeds",
                p.escrow_return_claim !== "0" && "returned escrow",
                p.profit_claim !== "0" && "operating profit",
              ]
                .filter(Boolean)
                .join(" · ")}
            </Row>
          )}
        </Rows>
      </section>

      <div className="ledger-cards">
        <section className="card" aria-labelledby="ledger-escrow">
          <div className="ledger-head">
            <h2 id="ledger-escrow" className="ledger-h">
              Escrow funding
            </h2>
            <State done={funded}>{funded ? "Funded" : "Not funded"}</State>
          </div>
          <p className="ledger-amount">
            <Amount base={d.escrow === "0" ? d.price : d.escrow} s={s} />
          </p>
          <Rows label="Escrow funding">
            <Row label="Route">Direct transfer to the business contract</Row>
            <Row label="Funding confirmation">Business contract</Row>
          </Rows>
        </section>

        <section className="card" aria-labelledby="ledger-accept">
          <h2 id="ledger-accept" className="ledger-h">
            Acceptance
          </h2>
          <Rows label="Acceptance">
            <Row label="Seller">
              <span className="mono wrap">{d.seller}</span>{" "}
              <State done={d.seller_accepted}>
                {d.seller_accepted ? "Accepted" : "Awaiting acceptance"}
              </State>
            </Row>
            <Row label="Buyer">
              <span className="mono wrap">{d.buyer}</span>{" "}
              <State done={d.buyer_accepted}>
                {d.buyer_accepted ? "Accepted" : "Awaiting acceptance"}
              </State>
            </Row>
            <Row label="Closes">
              {gated
                ? `By its named closer (${s.control.closer ?? "not shown"}) after both accept, before a deadline ${Number(d.close_window_ms) / 60_000} minutes after the second acceptance`
                : "On the second matching acceptance"}
            </Row>
            {d.state === "closing" && d.deadline_ms !== "0" && (
              <Row label="Close by">
                <State done={false}>{when(Number(d.deadline_ms))}</State>
              </Row>
            )}
          </Rows>
          {terms}
        </section>

        <section className="card" aria-labelledby="ledger-included">
          <h2 id="ledger-included" className="ledger-h">
            Included at close
          </h2>
          <Rows label="Included at close">
            <Row label="Owner role">
              <span className="mono wrap">{d.buyer}</span> · generation {d.expected_generation + 1}
            </Row>
            {s.customer_obligations && (
              <Row label="Customer rights">
                <Amount base={s.customer_obligations.prepaid_unused} s={s} /> prepaid, carried over
              </Row>
            )}
            <Row label={kept.length === 1 ? "Operator kept" : "Operators kept"}>
              {kept.length === 0
                ? "None"
                : kept.map((g) => `${g.account} (${capsWords(g.caps)})`).join(" · ")}
            </Row>
            {asset && (
              <Row label="External feed">
                Controller role · {asset.chain ?? "other chain"} · moves to generation{" "}
                {d.expected_generation + 1}'s address after the close
              </Row>
            )}
            {allowance && (
              <Row label="Supplier allowance">
                <Amount base={allowance.balance} s={s} /> budget · ends at close unless{" "}
                <span className="mono wrap">{d.buyer}</span> grants it again
              </Row>
            )}
            <Row label="Ends at close">Every other operator</Row>
            <Row label="Not included">Domains, provider accounts, secrets</Row>
          </Rows>
        </section>

        {gated && (
          <section className="card" aria-labelledby="ledger-ready">
            <div className="ledger-head">
              <h2 id="ledger-ready" className="ledger-h">
                Gated readiness
              </h2>
              {ready && (
                <State done={ready.items.every((i) => i.ok)}>
                  {ready.items.every((i) => i.ok) ? "Ready" : "Not ready"}
                </State>
              )}
            </div>
            {ready ? (
              <Rows label="Gated readiness">
                {ready.items.map((i) => (
                  <Row key={i.key} label={i.label}>
                    <Check ok={i.ok}>{i.value}</Check>
                  </Row>
                ))}
                <Row label="Signed by">
                  <span className="mono wrap" title={ready.signature}>
                    {ready.signer.slice(0, 20)}…
                  </span>
                </Row>
                <Row label="Bound to">
                  Deal {ready.deal.seq} v{ready.deal.version} · generation {ready.generation} ·{" "}
                  <span className="mono" title={ready.deal.digest}>
                    {ready.deal.digest.slice(0, 8)}…
                  </span>
                </Row>
                <Row label="Valid until">{when(Number(ready.valid_until_ms))}</Row>
              </Rows>
            ) : (
              <p className="unknown">Not issued</p>
            )}
          </section>
        )}

        <section className="card ledger-wide" aria-labelledby="ledger-progress">
          <h2 id="ledger-progress" className="ledger-h">
            In progress
          </h2>
          {inv ? (
            <Rows label="In progress">
              <Row label="Customer holds">
                {inv.reserved_unexecuted + inv.executions_running === 0 ? (
                  "None open"
                ) : (
                  <State done={false}>
                    {count(inv.reserved_unexecuted + inv.executions_running, "open", "open")}
                  </State>
                )}
              </Row>
              <Row label="Unsettled uses">
                {inv.settlements_unsettled === 0 ? (
                  "None"
                ) : (
                  <State done={false}>
                    {count(inv.settlements_unsettled, "awaiting settlement", "awaiting settlement")}
                  </State>
                )}
              </Row>
              <Row label="Pending payouts">
                {inv.pending_payouts === 0 ? (
                  "None"
                ) : (
                  <State done={false}>
                    {count(inv.pending_payouts, "awaiting receipt", "awaiting receipt")}
                  </State>
                )}
              </Row>
              <Row label="Open wallet requests">
                {inv.open_wallet_requests === 0 ? (
                  "None"
                ) : (
                  <State done={false}>
                    {count(inv.open_wallet_requests, "awaiting signature", "awaiting signature")}
                  </State>
                )}
              </Row>
              <Row label="Queued writes">
                {inv.reservations_pending + inv.settlements_pending === 0 ? (
                  "None"
                ) : (
                  <State done={false}>
                    {count(inv.reservations_pending + inv.settlements_pending, "queued", "queued")}
                  </State>
                )}
              </Row>
              {asset && (
                <Row label="Feed controller">
                  {asset.controller_generation !== null
                    ? `Generation ${asset.controller_generation}'s address`
                    : "Not this business's address"}
                </Row>
              )}
              {allowance && (
                <Row label="Supplier grant">
                  {allowance.active && allowance.grant
                    ? `Active · generation ${allowance.grant.generation}`
                    : "Not granted for this generation"}
                  {allowance.awaiting.length > 0 && (
                    <>
                      {" "}
                      <State done={false}>
                        {count(
                          allowance.awaiting.length,
                          "invoice awaiting approval",
                          "invoices awaiting approval",
                        )}
                      </State>
                    </>
                  )}
                </Row>
              )}
              {inv.unresolved > 0 && (
                <Row label="Unresolved">
                  <span className="error-text">{inv.unresolved}</span>
                </Row>
              )}
            </Rows>
          ) : (
            <p className="unknown">Not shown to you</p>
          )}
        </section>
      </div>
    </div>
  );
}
