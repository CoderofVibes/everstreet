// Job 001d: a published digital profile as customers see it. The same component renders the
// owner's exact preview and the public page, so what is reviewed is what is published. A product
// gets a Use action only when it has an active customer offer; otherwise its status says why.

import type { DigitalPublic } from "../api.ts";
import { AVAILABILITY_LABEL, PRODUCT_PUBLIC_STATUS } from "../publication.ts";
import { Link } from "../router.tsx";

export function DigitalProfile({ d, preview = false }: { d: DigitalPublic; preview?: boolean }) {
  return (
    <section className="card digital-profile" aria-labelledby="digital-profile-title">
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <span className={`pill ${d.availability === "available" ? "mint" : "caution"}`}>
          {AVAILABILITY_LABEL[d.availability]}
        </span>
      </div>
      <h2 id="digital-profile-title" style={{ margin: "10px 0 6px" }}>
        {d.headline}
      </h2>
      <p style={{ fontSize: 17, margin: "0 0 8px" }}>{d.summary}</p>
      {d.audience && (
        <p className="muted" style={{ margin: "0 0 10px" }}>
          For: {d.audience}
        </p>
      )}
      {d.capabilities.length > 0 && (
        <ul className="capabilities">
          {d.capabilities.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      )}
      <div className="eyebrow" style={{ marginTop: 14 }}>
        Products
      </div>
      <ul className="product-cards">
        {d.products.map((p, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: an immutable published snapshot, never reordered; names may repeat
          <li key={i} className="product-card row" style={{ flexWrap: "wrap" }}>
            <div style={{ minWidth: 0 }}>
              <strong style={{ overflowWrap: "anywhere" }}>{p.name}</strong>{" "}
              <span className="pill">{p.family_label}</span>
              <div className="muted" style={{ fontSize: 13 }}>
                {PRODUCT_PUBLIC_STATUS[p.status]}
              </div>
            </div>
            <span className="spacer" />
            {p.use_offer_id &&
              (preview ? (
                <span className="btn btn-primary btn-sm" aria-disabled="true">
                  Use this product (preview)
                </span>
              ) : (
                <Link to={`/use/${p.use_offer_id}`} className="btn btn-primary btn-sm">
                  Use this product
                </Link>
              ))}
          </li>
        ))}
      </ul>
    </section>
  );
}
