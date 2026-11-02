// A candidate's overview for buyers (Astra, PlatformVision §3B step 4): what customers buy, why
// the owner is open, the estimate's calculation beside a separate asking price, "Could I operate
// this?", and a named, purposeful request for specific evidence.

import { useCallback, useEffect, useState } from "react";
import { api5, type CandidateDetail, rememberedBuyer, STATUS_LABEL, when } from "../api5.ts";
import { Link } from "../router.tsx";
import { useSession } from "../session.tsx";
import { money } from "../ui.tsx";
import { CandidateHead, FigLine } from "./Acquire.tsx";

function RequestForm({
  d,
  listingId,
  onSent,
}: {
  d: CandidateDetail;
  listingId: string;
  onSent: () => void;
}) {
  const [buyers, setBuyers] = useState<{ id: string; name: string; role: string }[]>([]);
  const [buyerId, setBuyerId] = useState("");
  const [cats, setCats] = useState<string[]>(["financials", "operations"]);
  const [purpose, setPurpose] = useState("");
  const [days, setDays] = useState(7);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api5.buyers().then(({ buyers: list }) => {
      const able = list.filter((b) => b.role === "approve");
      setBuyers(able);
      const remembered = rememberedBuyer.get();
      setBuyerId(able.find((b) => b.id === remembered)?.id ?? able[0]?.id ?? "");
    });
  }, []);
  if (buyers.length === 0)
    return (
      <p className="muted" style={{ fontSize: 14 }}>
        To ask for evidence, <Link to="/acquire">set up a buying profile</Link> (or ask your team's
        lead, who has the approve role).
      </p>
    );
  return (
    <div>
      {buyers.length > 1 && (
        <select
          className="input"
          aria-label="Buying profile"
          value={buyerId}
          onChange={(e) => setBuyerId(e.target.value)}
          style={{ marginBottom: 10 }}
        >
          {buyers.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      )}
      <strong style={{ fontSize: 14 }}>What you'd like to see</strong>
      <div style={{ margin: "6px 0 12px" }}>
        {Object.entries(d.categories).map(([k, label]) => (
          <label key={k} className="check" style={{ margin: "0 0 6px" }}>
            <input
              type="checkbox"
              checked={cats.includes(k)}
              onChange={(e) =>
                setCats(e.target.checked ? [...cats, k] : cats.filter((c) => c !== k))
              }
            />
            <span style={{ fontSize: 14 }}>{label}</span>
          </label>
        ))}
      </div>
      <label className="field">
        <span style={{ fontSize: 14 }}>What it's for</span>
        <textarea
          className="input"
          rows={3}
          placeholder="e.g. Check the numbers behind the estimate before we talk price"
          value={purpose}
          onChange={(e) => setPurpose(e.target.value)}
        />
      </label>
      <label className="field">
        <span style={{ fontSize: 14 }}>For how long</span>
        <select className="input" value={days} onChange={(e) => setDays(Number(e.target.value))}>
          {[3, 7, 14, 30].map((n) => (
            <option key={n} value={n}>
              {n} days
            </option>
          ))}
        </select>
      </label>
      {error && <p className="error-text">{error}</p>}
      <button
        type="button"
        className="btn btn-primary"
        onClick={async () => {
          try {
            await api5.request(listingId, { buyer_id: buyerId, categories: cats, purpose, days });
            setError(null);
            onSent();
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        Send the request
      </button>
      <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
        The owner sees your buying profile and team, and can grant, narrow or decline. Nothing is
        shared until they decide.
      </p>
    </div>
  );
}

export function AcquireListing({ id }: { id: string }) {
  const { person } = useSession();
  const [d, setD] = useState<CandidateDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(
    () =>
      api5
        .candidate(id)
        .then(setD)
        .catch((e) => setError((e as Error).message)),
    [id],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: person is a trigger: reload when the viewer changes
  useEffect(() => {
    load();
  }, [load, person]);
  if (error)
    return (
      <div className="page empty">
        <h2>{error}</h2>
        <Link to="/acquire">Back to acquisitions</Link>
      </div>
    );
  if (!d) return <div className="page muted">Loading…</div>;
  const c = d.candidate;
  const open = d.requests.find((r) => r.status === "pending" || r.status === "granted");
  return (
    <div className="page">
      <Link to="/acquire">← Back to acquisitions</Link>
      <div className="storefront" style={{ marginTop: 16 }}>
        <div>
          <CandidateHead c={c} />
          <h1 className="display" style={{ fontSize: 42, margin: "12px 0 6px" }}>
            {c.title}
          </h1>
          {c.tagline && (
            <p style={{ fontSize: 20, color: "var(--ink-2)", margin: 0 }}>{c.tagline}</p>
          )}
          {c.founder && (
            <p className="muted">
              Listed by {c.founder} ·{" "}
              {c.slug && <Link to={`/b/${c.slug}`}>See what customers see</Link>}
            </p>
          )}
          {c.mode === "anonymous" && (
            <p className="notice">
              An anonymous teaser: the owner shares only coarse bands until they grant a team
              access. Ask for access to learn which business this is.
            </p>
          )}

          <div className="stat-row" style={{ margin: "20px 0" }}>
            <FigLine label="Asking price" fig={c.asking} />
            <FigLine label="Everstreet estimate" fig={c.value} />
            <FigLine label="Revenue" fig={c.revenue} />
            <FigLine label="Operating profit" fig={c.profit} />
          </div>

          {(c.reason || c.transition) && (
            <section className="card">
              <h2>Why it's open</h2>
              {c.reason && <p style={{ margin: 0 }}>{c.reason}</p>}
              {c.transition && (
                <p className="muted" style={{ marginBottom: 0 }}>
                  Handover: {c.transition}
                </p>
              )}
            </section>
          )}

          <section className="card">
            <h2>What customers buy</h2>
            <dl className="facts">
              {d.offer.outcome && (
                <>
                  <dt>Outcome</dt>
                  <dd>{d.offer.outcome}</dd>
                </>
              )}
              {d.offer.audience && (
                <>
                  <dt>For</dt>
                  <dd>{d.offer.audience}</dd>
                </>
              )}
              {d.offer.deliverable && (
                <>
                  <dt>They get</dt>
                  <dd>{d.offer.deliverable}</dd>
                </>
              )}
              {typeof d.offer.price_cents === "number" && (
                <>
                  <dt>Price</dt>
                  <dd>
                    {money(d.offer.price_cents)} {d.offer.price_unit}
                  </dd>
                </>
              )}
              {d.offer.where_text && (
                <>
                  <dt>Where</dt>
                  <dd>{d.offer.where_text}</dd>
                </>
              )}
            </dl>
          </section>

          {d.calculation && (
            <section className="card">
              <h2>How the estimate is formed</h2>
              <pre className="calc">{d.calculation.explanation.join("\n")}</pre>
              <p className="muted" style={{ fontSize: 13 }}>
                {d.calculation.label}. The asking price ({c.asking.text}) is the owner's own number
                and is not part of this calculation.
              </p>
              {d.calculation.missing.length > 0 && (
                <ul className="missing-list">
                  {d.calculation.missing.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              )}
            </section>
          )}

          <section className="card">
            <h2>Could I operate this?</h2>
            <dl className="facts" style={{ gridTemplateColumns: "180px 1fr" }}>
              <dt>Owner work</dt>
              <dd>
                {d.operate.founder_hours.text}
                {d.operate.founder_hours.source ? ` · ${d.operate.founder_hours.source}` : ""}
              </dd>
              <dt>Helpers</dt>
              <dd>{d.operate.helpers ? `${d.operate.helpers} appointed` : "None appointed"}</dd>
              <dt>Ownership on NEAR</dt>
              <dd>
                {d.operate.payments_on_near
                  ? "Yes: the business has its own testnet account and contract"
                  : "Not yet: payments are off, so ownership isn't on a contract"}
              </dd>
              <dt>History</dt>
              <dd>{c.history.text}</dd>
            </dl>
          </section>
        </div>

        <aside className="studio-side">
          <section className="card" style={{ padding: 20 }}>
            <h2 style={{ fontSize: 19 }}>Ask for evidence</h2>
            {d.requests.map((r) => (
              <div
                key={r.id}
                style={{ borderTop: "1px solid var(--border)", padding: "8px 0", fontSize: 14 }}
              >
                <div className="row">
                  <strong>{r.buyer.name}</strong>
                  <span
                    className={`pill ${r.status === "granted" ? "lime" : r.status === "pending" ? "" : "caution"}`}
                  >
                    {STATUS_LABEL[r.status]}
                  </span>
                </div>
                <div className="muted">
                  {r.status === "granted" && r.expires_at
                    ? `Until ${when(r.expires_at)}`
                    : when(r.created_at)}
                </div>
                {r.status === "granted" && (
                  <div style={{ marginTop: 8 }}>
                    <Link to={`/acquire/room/${r.id}`} className="btn btn-primary">
                      Open the evidence room
                    </Link>
                  </div>
                )}
              </div>
            ))}
            {c.yours ? (
              <p className="muted">This is your listing. Requests arrive on your desk.</p>
            ) : !person ? (
              <p className="muted">Sign in and set up a buying profile to ask for evidence.</p>
            ) : open ? null : (
              <RequestForm d={d} listingId={id} onSent={load} />
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
