// Job 001c: the digital business desk's operating summary: the business's products (saved brief,
// release, customer offers, exact contract price) and the work waiting now, split into what needs
// the founder and what is waiting on the system. Labels and links only: nothing here settles a
// unit, restores authority or completes a transfer.

import type { DigitalDeskView } from "../api4.ts";
import { PRODUCT_STATUS_LABEL, productName, workHref } from "../digitalDesk.ts";
import { settlementText } from "../operations.ts";
import { Link } from "../router.tsx";
import { ago } from "../via.ts";

function Go({ to, children, className }: { to: string; children: string; className?: string }) {
  return to.startsWith("#") ? (
    <a href={to} className={className}>
      {children}
    </a>
  ) : (
    <Link to={to} className={className}>
      {children}
    </Link>
  );
}

export function OperatingSummary({ d, businessId }: { d: DigitalDeskView; businessId: string }) {
  const you = d.work.filter((w) => w.who === "you");
  const system = d.work.filter((w) => w.who === "system");
  return (
    <section className="card ops-summary" aria-labelledby="ops-summary-title">
      <h2 id="ops-summary-title" style={{ marginTop: 0 }}>
        Operating summary
      </h2>
      <div className="ops-summary-grid">
        <div id="desk-products">
          <div className="row" style={{ marginBottom: 8 }}>
            <h3 style={{ fontSize: 15, margin: 0 }}>Products</h3>
            <span className="spacer" />
            <Link to={`/build?business=${businessId}`} className="btn btn-quiet btn-sm">
              New product project
            </Link>
          </div>
          {d.products.total === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              No digital product project yet.{" "}
              <Link to={`/build?business=${businessId}`}>Start one in Studio</Link>
              {d.imports.total > 0 ? "; imported products are listed below." : "."}
            </p>
          ) : (
            <ul className="product-cards">
              {d.products.shown.map((p) => (
                <li key={p.project_id} className="product-card">
                  <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                    <strong style={{ overflowWrap: "anywhere" }}>{productName(p)}</strong>
                    <span className="pill">{p.foundation_label}</span>
                    <span
                      className={`pill ${p.status === "offered" ? "mint" : p.status === "brief_only" ? "" : "caution"}`}
                    >
                      {PRODUCT_STATUS_LABEL[p.status]}
                    </span>
                  </div>
                  <p className="muted" style={{ fontSize: 13, margin: "6px 0" }}>
                    Brief revision {p.revision}
                    {p.release.state === "active"
                      ? ` · release active since ${ago(p.release.activated_at)}`
                      : p.release.state === "retired_only"
                        ? " · earlier release retired, none active"
                        : " · no release"}
                    {" · "}
                    {p.offers.active} active, {p.offers.retired} retired customer{" "}
                    {p.offers.active + p.offers.retired === 1 ? "offer" : "offers"}
                  </p>
                  {p.offer && (
                    <p style={{ fontSize: 13, margin: "0 0 6px" }}>
                      Price on the contract (plan {p.offer.plan_id}):{" "}
                      {p.offer.unit_price === null ? (
                        <span className="fin-unknown">not recorded</span>
                      ) : (
                        <>
                          <span className="mono">{p.offer.unit_price}</span> base units of{" "}
                          <span className="mono" style={{ overflowWrap: "anywhere" }}>
                            {p.offer.asset}
                          </span>
                        </>
                      )}{" "}
                      per use, as recorded with the offer
                    </p>
                  )}
                  <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                    <Link to={`/build/${p.project_id}`} className="btn btn-secondary btn-sm">
                      Open studio
                    </Link>
                    {p.status !== "brief_only" && (
                      <Link
                        to={`/build/${p.project_id}?view=service&task=customers`}
                        className="btn btn-quiet btn-sm"
                      >
                        Customer access
                      </Link>
                    )}
                    {p.offer && (
                      <Link to={`/use/${p.offer.id}`} className="btn btn-quiet btn-sm">
                        View as a customer
                      </Link>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {d.products.total > d.products.shown.length && (
            <p className="muted" style={{ fontSize: 13 }}>
              Showing the {d.products.shown.length} most recently changed of {d.products.total}.
            </p>
          )}
        </div>
        <div>
          <h3 style={{ fontSize: 15, margin: "0 0 8px" }}>Waiting now</h3>
          {d.work.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              Nothing is waiting on you or the system in these records.
            </p>
          ) : (
            <>
              {you.length > 0 && (
                <>
                  <div className="eyebrow">Needs you</div>
                  <ul className="work-list">
                    {you.map((w) => (
                      <li key={w.key}>
                        <Go to={workHref(w, businessId)}>
                          {w.key.includes(":") ? w.label : `${w.count} ${w.label}`}
                        </Go>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {system.length > 0 && (
                <>
                  <div className="eyebrow" style={{ color: "var(--ink-2)" }}>
                    Waiting on the system
                  </div>
                  <ul className="work-list">
                    {system.map((w) => (
                      <li key={w.key}>
                        <Go to={workHref(w, businessId)}>{`${w.count} ${w.label}`}</Go>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
          {d.products.shown.some((p) => p.status !== "brief_only") && (
            <p
              className={d.settlement.worker === "running" ? "muted" : "notice"}
              style={{ fontSize: 13 }}
            >
              {settlementText(d.settlement)}
            </p>
          )}
          <p className="muted" style={{ fontSize: 12 }}>
            From this business's own records as of {d.as_of.replace("T", " ").slice(0, 16)} UTC.
            Nothing here is done for you; links open where the work is.
          </p>
        </div>
      </div>
    </section>
  );
}
