// Job 001e: the digital storefront. One header (identity, promise, audience, founder, honest
// availability, one primary action), then the owner's illustrative example, capabilities and the
// products. The example is the owner's reviewed text under a fixed "not a live run" label; its tabs
// are a real, keyboard-operable tab list. Use goes to the actual customer workspace route.

import { type KeyboardEvent, useId, useRef, useState } from "react";
import type { DigitalPublic } from "../api.ts";
import {
  AVAILABILITY_LABEL,
  nextTab,
  PRODUCT_PUBLIC_STATUS,
  primaryAction,
} from "../publication.ts";
import { Link } from "../router.tsx";

const TABS = ["Example input", "Example result"] as const;

export function Example({ e }: { e: NonNullable<DigitalPublic["example"]> }) {
  const id = useId();
  const [tab, setTab] = useState(0);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (ev: KeyboardEvent<HTMLButtonElement>) => {
    const n = nextTab(tab, ev.key, TABS.length);
    if (n === null) return;
    ev.preventDefault();
    setTab(n);
    refs.current[n]?.focus();
  };
  return (
    <section className="sf-example" aria-labelledby={`${id}-title`}>
      <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "baseline" }}>
        <h2 id={`${id}-title`} className="sf-section-title">
          Example: {e.product_name}
        </h2>
        <span className="pill">Illustrative</span>
      </div>
      <p className="muted sf-note">{e.label}</p>
      <div role="tablist" aria-label={`Example for ${e.product_name}`} className="sf-tabs">
        {TABS.map((t, i) => (
          <button
            key={t}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`${id}-tab-${i}`}
            aria-selected={tab === i}
            aria-controls={`${id}-panel-${i}`}
            tabIndex={tab === i ? 0 : -1}
            className={`sf-tab${tab === i ? " active" : ""}`}
            onClick={() => setTab(i)}
            onKeyDown={onKey}
          >
            {t}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`${id}-panel-0`}
        aria-labelledby={`${id}-tab-0`}
        hidden={tab !== 0}
        className="sf-panel"
      >
        <pre className="sf-input">{e.input}</pre>
      </div>
      <div
        role="tabpanel"
        id={`${id}-panel-1`}
        aria-labelledby={`${id}-tab-1`}
        hidden={tab !== 1}
        className="sf-panel"
      >
        <dl className="sf-output">
          {e.outputs.map((o, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: an immutable published list; labels may repeat
            <div key={i}>
              <dt>{o.label}</dt>
              <dd>{o.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

export function DigitalStorefront({
  name,
  d,
  family,
  founder,
  followers,
  following,
  onFollow,
  preview = false,
  prices = {},
}: {
  name: string;
  d: DigitalPublic;
  family: string;
  founder: { id?: string; display_name: string } | null;
  followers?: number;
  following?: boolean;
  onFollow?: () => void;
  preview?: boolean;
  /** Each offer's price per use, by offer id, where its token is known. */
  prices?: Record<string, string | null>;
}) {
  const action = primaryAction(d);
  // Second first-use pass (Nov 7, finding 50): one Use button for a single product.
  const oneProduct = d.products.length === 1 && action.kind === "use";
  const kind = d.products[0]?.family_label ?? family;
  return (
    <div className="sf">
      <header className="sf-hero">
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <span className="eyebrow" style={{ margin: 0 }}>
            {kind}
          </span>
          <span className={`pill ${d.availability === "available" ? "mint" : "caution"}`}>
            {AVAILABILITY_LABEL[d.availability]}
          </span>
        </div>
        <h1 className="sf-name">{name}</h1>
        <p className="sf-promise">{d.headline}</p>
        <p className="sf-summary">{d.summary}</p>
        {d.audience && <p className="muted sf-audience">For {d.audience}</p>}
        <div className="row sf-actions" style={{ gap: 10, flexWrap: "wrap" }}>
          {action.kind === "use" ? (
            preview ? (
              <span className="btn btn-primary" aria-disabled="true">
                {action.label} (preview)
              </span>
            ) : (
              <Link to={`/use/${action.offer_id}`} className="btn btn-primary">
                {action.label}
              </Link>
            )
          ) : (
            onFollow &&
            !preview && (
              <button type="button" className="btn btn-primary" onClick={onFollow}>
                {following ? "Following" : action.label}
              </button>
            )
          )}
          {action.kind === "use" && onFollow && !preview && (
            <button type="button" className="btn btn-secondary" onClick={onFollow}>
              {following ? "Following" : "Follow"}
            </button>
          )}
          {founder && (
            <span className="muted" style={{ fontSize: 14 }}>
              by{" "}
              {founder.id && !preview ? (
                <Link to={`/p/${founder.id}`}>{founder.display_name}</Link>
              ) : (
                founder.display_name
              )}
              {followers ? ` · ${followers} ${followers === 1 ? "follower" : "followers"}` : ""}
            </span>
          )}
        </div>
      </header>

      <div className="sf-body">
        {d.example && <Example e={d.example} />}
        <div className="sf-side">
          {d.capabilities.length > 0 && (
            <section>
              <h2 className="sf-section-title">What it can do</h2>
              <ul className="capabilities">
                {d.capabilities.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </section>
          )}
          <section>
            <h2 className="sf-section-title">
              {d.products.length === 1 ? "The product" : "Products"}
            </h2>
            <ul className="product-cards">
              {d.products.map((p, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: an immutable published snapshot, never reordered; names may repeat
                <li key={i} className="product-card">
                  <strong style={{ overflowWrap: "anywhere" }}>{p.name}</strong>{" "}
                  <span className="pill">{p.family_label}</span>
                  <div className="row" style={{ gap: 8, marginTop: 6, flexWrap: "wrap" }}>
                    <span className="muted" style={{ fontSize: 13 }}>
                      {PRODUCT_PUBLIC_STATUS[p.status]}
                      {p.use_offer_id && prices[p.use_offer_id]
                        ? ` · ${prices[p.use_offer_id]}`
                        : ""}
                    </span>
                    <span className="spacer" />
                    {p.use_offer_id &&
                      !oneProduct &&
                      (preview ? (
                        <span className="btn btn-secondary btn-sm" aria-disabled="true">
                          Use this product (preview)
                        </span>
                      ) : (
                        <Link to={`/use/${p.use_offer_id}`} className="btn btn-secondary btn-sm">
                          Use this product
                        </Link>
                      ))}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
