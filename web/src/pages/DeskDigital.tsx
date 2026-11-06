// Job 001c: the digital business desk's operating pieces: the business's products (saved brief,
// release, customer offers, exact contract price) and the work waiting now, split into what needs
// the founder and what is waiting on the system. Labels and links only: nothing here settles a
// unit, restores authority or completes a transfer.
//
// Job 001h: split into the work list (Overview) and product cards (Products), and each card names
// the released product apart from a divergent draft brief.

import type { DigitalDeskView } from "../api4.ts";
import { deskViewHref, PRODUCT_STATUS_LABEL, productIdentity, workHref } from "../digitalDesk.ts";
import { settlementText } from "../operations.ts";
import { Link } from "../router.tsx";
import { TokenAmount } from "../TokenAmount.tsx";
import { ago } from "../via.ts";
import { when } from "../when.ts";

/** What needs the founder, and what is waiting on the system, each a link to where it is. */
export function WorkList({ d, businessId }: { d: DigitalDeskView; businessId: string }) {
  const you = d.work.filter((w) => w.who === "you");
  const system = d.work.filter((w) => w.who === "system");
  return (
    <div className="ws-work">
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
                    <Link to={workHref(w, businessId)}>
                      {w.key.includes(":") ? w.label : `${w.count} ${w.label}`}
                    </Link>
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
                    <Link to={workHref(w, businessId)}>{`${w.count} ${w.label}`}</Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
      {/* First-use review #49: the worker matters only when uses are waiting on it. */}
      {d.work.some((w) => w.key === "system") && (
        <p
          className={d.settlement.worker === "running" ? "muted" : "notice"}
          style={{ fontSize: 13 }}
        >
          {settlementText(d.settlement)}
        </p>
      )}
      <p className="muted" style={{ fontSize: 12 }}>
        As of {when(d.as_of)}
      </p>
    </div>
  );
}

/** One line per product for the overview: identity and status, linking to Products. */
export function ProductLines({ d, businessId }: { d: DigitalDeskView; businessId: string }) {
  if (d.products.total === 0)
    return (
      <p className="muted" style={{ margin: 0 }}>
        No digital product yet.{" "}
        <Link to={`/build?business=${businessId}`}>Start one in Studio</Link>
      </p>
    );
  return (
    <ul className="ws-product-lines">
      {d.products.shown.map((p) => {
        const id = productIdentity(p);
        return (
          <li key={p.project_id}>
            <Link to={deskViewHref(businessId, "products", `product-${p.project_id}`)}>
              {id.title}
            </Link>
            <span className="muted"> · {PRODUCT_STATUS_LABEL[p.status]}</span>
            {/* Review #54: say what differs. */}
            {id.draft && <span className="muted"> · brief has unreleased changes</span>}
          </li>
        );
      })}
    </ul>
  );
}

/** The business's products as cards, with every product action. */
export function ProductCards({ d, businessId }: { d: DigitalDeskView; businessId: string }) {
  return (
    <div id="desk-products">
      <div className="row" style={{ marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}>Products</h2>
        <span className="spacer" />
        <Link to={`/build?business=${businessId}`} className="btn btn-secondary btn-sm">
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
          {d.products.shown.map((p) => {
            const id = productIdentity(p);
            return (
              <li key={p.project_id} id={`product-${p.project_id}`} className="product-card">
                <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                  <strong style={{ overflowWrap: "anywhere" }}>{id.title}</strong>
                  <span className="pill">{p.foundation_label}</span>
                  <span
                    className={`pill ${p.status === "offered" ? "mint" : p.status === "brief_only" ? "" : "caution"}`}
                  >
                    {PRODUCT_STATUS_LABEL[p.status]}
                  </span>
                </div>
                {id.released ? (
                  <p className="muted" style={{ fontSize: 13, margin: "6px 0 0" }}>
                    Released name, as customers see it (built from brief revision{" "}
                    {p.released?.revision}).
                  </p>
                ) : (
                  <p className="muted" style={{ fontSize: 13, margin: "6px 0 0" }}>
                    Name from the saved brief; nothing is released yet.
                  </p>
                )}
                {id.draft && (
                  <p className="ws-draft" style={{ fontSize: 13, margin: "4px 0 0" }}>
                    {id.draft}. The release keeps its name until a new build is released.
                  </p>
                )}
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
                      <TokenAmount
                        base={p.offer.unit_price}
                        asset={p.offer.asset}
                        token={p.offer.token}
                      />
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
            );
          })}
        </ul>
      )}
      {d.products.total > d.products.shown.length && (
        <p className="muted" style={{ fontSize: 13 }}>
          Showing the {d.products.shown.length} most recently changed of {d.products.total}.
        </p>
      )}
    </div>
  );
}
