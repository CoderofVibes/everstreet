// Job 001f: Discover's shared pieces in the "stage and rail" composition. A featured published
// product on stage (its owner-written example when there is one, its real Use action), and an
// editorial list of published businesses: one honest line each, not a grid of equal cards.

import type { PublicBusiness } from "../api.ts";
import { marketLine } from "../discover.ts";
import { primaryAction } from "../publication.ts";
import { Link } from "../router.tsx";
import { Example } from "./DigitalStorefront.tsx";

const TONE: Record<string, string> = { success: "mint", caution: "caution", neutral: "" };

/** One published business as an editorial row. */
export function MarketRow({ b, via = "discovery" }: { b: PublicBusiness; via?: string }) {
  const m = marketLine(b);
  return (
    <li className="market-row">
      <Link to={`/b/${b.slug}?via=${via}`} className="market-link">
        <span className="market-main">
          <span className="market-name">{b.name}</span>
          {m.line && <span className="market-line">{m.line}</span>}
          {m.detail && <span className="market-detail">{m.detail}</span>}
        </span>
        <span className="market-side">
          <span className={`pill ${TONE[m.tone]}`}>{m.status}</span>
          {m.example && <span className="pill">Example included</span>}
          <span className="market-meta">{m.meta}</span>
        </span>
      </Link>
    </li>
  );
}

export function MarketList({ list, via }: { list: PublicBusiness[]; via?: string }) {
  return (
    <ul className="market-list">
      {list.map((b) => (
        <MarketRow key={b.slug} b={b} via={via} />
      ))}
    </ul>
  );
}

/** The stage's featured published digital product: headline, example, real actions. */
export function FeaturedProduct({ b }: { b: PublicBusiness }) {
  const d = b.digital;
  if (!d) return null;
  const action = primaryAction(d);
  return (
    <section className="featured" aria-labelledby="featured-title">
      <div className="featured-head">
        <span className="eyebrow" style={{ margin: 0 }}>
          Published on Everstreet
        </span>
        <span className={`pill ${d.availability === "available" ? "mint" : "caution"}`}>
          {marketLine(b).status}
        </span>
      </div>
      <h2 id="featured-title" className="featured-name">
        <Link to={`/b/${b.slug}?via=discovery`}>{b.name}</Link>
      </h2>
      <p className="featured-promise">{d.headline}</p>
      {d.example ? (
        <Example e={d.example} />
      ) : (
        d.capabilities.length > 0 && (
          <ul className="capabilities">
            {d.capabilities.slice(0, 4).map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        )
      )}
      <div className="row" style={{ gap: 10, marginTop: 14 }}>
        {action.kind === "use" && (
          <Link to={`/use/${action.offer_id}`} className="btn btn-primary">
            {action.label}
          </Link>
        )}
        <Link to={`/b/${b.slug}?via=discovery`} className="btn btn-secondary">
          See the product page
        </Link>
      </div>
    </section>
  );
}
