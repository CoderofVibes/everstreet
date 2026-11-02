// Selling, from the founder's side (Astra, PlatformVision §4): who may discover the business as
// one to buy, exactly what buyers see, and named access requests to grant, narrow or decline.
// Customers never see any of this; sharing numbers on the public page is a separate choice.

import { useCallback, useEffect, useState } from "react";
import {
  type AccessRequest,
  api5,
  type Meta,
  type SellerListing,
  STATUS_LABEL,
  when,
} from "../api5.ts";
import { api6 } from "../api6.ts";
import { Link, useRouter } from "../router.tsx";
import { CandidateHead, FigLine } from "./Acquire.tsx";
import { DealsList, TermsForm } from "./Deal.tsx";

const MODE_HELP: Record<string, string> = {
  closed: "No acquisition listing. Nobody can find it as a business to buy.",
  private: "Only buying teams you invite can see it.",
  anonymous: "A teaser with coarse bands and no name. Buyers ask you for access to learn more.",
  named: "An acquisition profile with your chosen numbers, separate from your storefront.",
};

function Decide({ r, meta, onDone }: { r: AccessRequest; meta: Meta; onDone: () => void }) {
  const [cats, setCats] = useState<string[]>(r.categories);
  const [days, setDays] = useState(r.days);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const act = async (action: "grant" | "decline") => {
    try {
      await api5.decide(r.id, { action, categories: cats, days, note });
      onDone();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <div style={{ background: "var(--paper)", borderRadius: 8, padding: 14, marginTop: 10 }}>
      <strong style={{ fontSize: 14 }}>Grant all of it, narrow it, or decline</strong>
      <div style={{ margin: "8px 0" }}>
        {r.categories.map((k) => (
          <label key={k} className="check" style={{ margin: "0 0 6px" }}>
            <input
              type="checkbox"
              checked={cats.includes(k)}
              onChange={(e) =>
                setCats(e.target.checked ? [...cats, k] : cats.filter((c) => c !== k))
              }
            />
            <span style={{ fontSize: 14 }}>{meta.categories[k] ?? k}</span>
          </label>
        ))}
      </div>
      <div className="row">
        <label className="field" style={{ margin: 0 }}>
          <span style={{ fontSize: 14 }}>For</span>
          <select className="input" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {Array.from({ length: r.days }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n} {n === 1 ? "day" : "days"}
              </option>
            ))}
          </select>
        </label>
        <label className="field" style={{ margin: 0, flex: 1 }}>
          <span style={{ fontSize: 14 }}>Note to the team (optional)</span>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      </div>
      <p className="muted" style={{ fontSize: 12 }}>
        Granting shows this team your business's name, even for an anonymous teaser.
      </p>
      {error && <p className="error-text">{error}</p>}
      <div className="row">
        <button
          type="button"
          className="btn btn-primary"
          disabled={cats.length === 0}
          onClick={() => act("grant")}
        >
          {cats.length === r.categories.length && days === r.days
            ? "Grant"
            : "Grant the narrower access"}
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => act("decline")}>
          Decline
        </button>
      </div>
    </div>
  );
}

function ProposeTerms({ r, businessId }: { r: AccessRequest; businessId: string }) {
  const { go } = useRouter();
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <button
        type="button"
        className="btn btn-secondary"
        style={{ marginTop: 8 }}
        onClick={() => setOpen(true)}
      >
        Propose terms to {r.buyer.name}
      </button>
    );
  return (
    <div style={{ background: "var(--paper)", borderRadius: 8, padding: 14, marginTop: 10 }}>
      <strong style={{ fontSize: 14 }}>Exact terms for {r.buyer.name}</strong>
      <p className="muted" style={{ fontSize: 13 }}>
        What transfers, what stays and what's excluded are filled in from the business as it is now
        and frozen into the terms. {r.buyer.members.find((m) => m.lead)?.name ?? "The team's lead"}
        's testnet account accepts for the team.
      </p>
      <TermsForm
        label="Propose these terms on NEAR"
        initial={{ days: 7, handover: "Two weeks of help after the sale" }}
        submit={async (t) => {
          const v = await api6.propose(businessId, { ...t, buyer_id: r.buyer.id });
          go(`/deal/${v.deal.id}`);
        }}
      />
    </div>
  );
}

function RequestCard({
  r,
  meta,
  onDone,
  businessId,
}: {
  r: AccessRequest;
  meta: Meta;
  onDone: () => void;
  businessId: string;
}) {
  const b = r.buyer;
  return (
    <div className="message">
      <div className="row">
        <strong style={{ fontSize: 17 }}>{b.name}</strong>
        <span className="muted">
          {b.kind_label} · {b.intent_label}
        </span>
        <span className="spacer" />
        <span
          className={`pill ${r.status === "granted" ? "lime" : r.status === "pending" ? "caution" : ""}`}
        >
          {STATUS_LABEL[r.status]}
        </span>
      </div>
      {b.about && <p style={{ margin: "6px 0" }}>{b.about}</p>}
      <dl
        className="facts"
        style={{ gridTemplateColumns: "150px 1fr", fontSize: 14, marginBottom: 8 }}
      >
        {b.interests && (
          <>
            <dt>Looking for</dt>
            <dd>{b.interests}</dd>
          </>
        )}
        {b.time_available && (
          <>
            <dt>Time they can give</dt>
            <dd>{b.time_available}</dd>
          </>
        )}
        {b.skills && (
          <>
            <dt>Skills</dt>
            <dd>{b.skills}</dd>
          </>
        )}
        {b.budget_basis && (
          <>
            <dt>Budget basis</dt>
            <dd>{b.budget_basis} (not verified)</dd>
          </>
        )}
        <dt>Team</dt>
        <dd>{b.members.map((m) => `${m.name} (${m.lead ? "lead" : m.role})`).join(", ")}</dd>
        <dt>Asked by</dt>
        <dd>
          {r.requested_by}, {when(r.created_at)}, for {r.days} days
        </dd>
        <dt>Wants</dt>
        <dd>{r.categories.map((c) => meta.categories[c] ?? c).join("; ")}</dd>
      </dl>
      <blockquote>{r.purpose}</blockquote>
      {r.status === "pending" && <Decide r={r} meta={meta} onDone={onDone} />}
      {r.status !== "declined" && r.status !== "withdrawn" && (
        <ProposeTerms r={r} businessId={businessId} />
      )}
      {r.status === "granted" && (
        <div className="row" style={{ marginTop: 8 }}>
          <span className="muted" style={{ fontSize: 14 }}>
            Granted {(r.granted ?? []).join(", ")} until {when(r.expires_at)} · opened{" "}
            {r.opened.count} {r.opened.count === 1 ? "time" : "times"}
            {r.opened.last_at ? `, last ${when(r.opened.last_at)}` : ""}
          </span>
          <span className="spacer" />
          <button
            type="button"
            className="btn btn-secondary"
            onClick={async () => {
              await api5.revoke(r.id);
              onDone();
            }}
          >
            End access now
          </button>
        </div>
      )}
      {(r.status === "revoked" || r.status === "expired") && (
        <p className="muted" style={{ fontSize: 14, margin: "6px 0 0" }}>
          Access ended {when(r.revoked_at ?? r.expires_at)} · opened {r.opened.count}{" "}
          {r.opened.count === 1 ? "time" : "times"}
        </p>
      )}
    </div>
  );
}

export function DeskSale({ id }: { id: string }) {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [data, setData] = useState<SellerListing | null>(null);
  const [f, setF] = useState<SellerListing["listing"] | null>(null);
  const [asking, setAsking] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const apply = useCallback((d: SellerListing) => {
    setData(d);
    setF(d.listing);
    setAsking(d.listing.asking_cents === null ? "" : String(d.listing.asking_cents / 100));
  }, []);
  const load = useCallback(
    () =>
      api5
        .listing(id)
        .then(apply)
        .catch((e) => setError((e as Error).message)),
    [id, apply],
  );
  useEffect(() => {
    api5.meta().then(setMeta);
    load();
  }, [load]);
  if (error && !data)
    return (
      <div className="page empty">
        <h2>{error}</h2>
        <Link to="/desk">Your businesses</Link>
      </div>
    );
  if (!data || !f || !meta) return <div className="page muted">Loading…</div>;
  const save = async () => {
    try {
      apply(
        await api5.updateListing(id, {
          ...f,
          asking_cents: asking.trim() ? Math.round(Number(asking) * 100) : null,
        }),
      );
      setError(null);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const preview = f.mode === "anonymous" ? data.preview.anonymous : data.preview.named;
  const pending = data.requests.filter((r) => r.status === "pending");
  const others = data.requests.filter((r) => r.status !== "pending");
  return (
    <div className="page">
      <Link to={`/desk/${id}`}>← Back to the desk</Link>
      <div className="eyebrow" style={{ marginTop: 16 }}>
        Selling
      </div>
      <h1 className="display" style={{ fontSize: 34, margin: "0 0 6px" }}>
        Who may discover {data.preview.named.title} as a business to buy
      </h1>
      <p className="muted" style={{ fontSize: 16, maxWidth: "70ch" }}>
        Your public page and customer search never show any of this. Sharing numbers on your public
        page {data.share_numbers ? "(on now)" : "(off now)"} is a separate choice and doesn't list
        you.
      </p>

      <div className="desk">
        <div>
          <section className="card">
            <h2>Discovery</h2>
            <div
              className="choices"
              style={{ gridTemplateColumns: "repeat(4, 1fr)", marginTop: 8 }}
            >
              {Object.entries(meta.modes).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  className="card choice"
                  style={{
                    padding: 14,
                    margin: 0,
                    boxShadow: f.mode === k ? "0 0 0 2px var(--forest)" : undefined,
                  }}
                  aria-pressed={f.mode === k}
                  onClick={() => setF({ ...f, mode: k })}
                >
                  <strong style={{ fontSize: 15 }}>{label}</strong>
                  <p className="muted" style={{ fontSize: 13, margin: "6px 0 0" }}>
                    {MODE_HELP[k]}
                  </p>
                </button>
              ))}
            </div>
            {f.mode !== "closed" && (
              <>
                <div
                  className="filters"
                  style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))", marginTop: 18 }}
                >
                  <label className="field" style={{ margin: 0 }}>
                    <span>How open you are</span>
                    <select
                      className="input"
                      value={f.openness}
                      onChange={(e) => setF({ ...f, openness: e.target.value })}
                    >
                      {Object.entries(meta.openness).map(([k, label]) => (
                        <option key={k} value={k}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field" style={{ margin: 0 }}>
                    <span>Asking price ($, optional)</span>
                    <small>Your own number; it stays separate from Everstreet's estimate</small>
                    <input
                      className="input"
                      inputMode="decimal"
                      value={asking}
                      onChange={(e) => setAsking(e.target.value)}
                    />
                  </label>
                </div>
                {f.mode !== "anonymous" && (
                  <label className="field">
                    <span>Why you're open to a buyer</span>
                    <textarea
                      className="input"
                      rows={2}
                      value={f.reason}
                      onChange={(e) => setF({ ...f, reason: e.target.value })}
                    />
                  </label>
                )}
                <label className="field">
                  <span>Handover you'd offer</span>
                  <small>e.g. Two weeks of support after a sale</small>
                  <input
                    className="input"
                    value={f.transition}
                    onChange={(e) => setF({ ...f, transition: e.target.value })}
                  />
                </label>
                <strong>What buyers may see before asking</strong>
                <div style={{ margin: "8px 0 12px" }}>
                  {Object.entries(meta.disclose).map(([k, label]) => (
                    <label key={k} className="check" style={{ margin: "0 0 6px" }}>
                      <input
                        type="checkbox"
                        checked={f.disclose.includes(k)}
                        onChange={(e) =>
                          setF({
                            ...f,
                            disclose: e.target.checked
                              ? [...f.disclose, k]
                              : f.disclose.filter((d) => d !== k),
                          })
                        }
                      />
                      <span style={{ fontSize: 15 }}>{label}</span>
                    </label>
                  ))}
                </div>
                {f.mode === "private" && (
                  <>
                    <strong>Buying teams you invite</strong>
                    <div style={{ margin: "8px 0 12px" }}>
                      {data.buyers.length === 0 && <p className="muted">No buying teams yet.</p>}
                      {data.buyers.map((b) => (
                        <label key={b.id} className="check" style={{ margin: "0 0 6px" }}>
                          <input
                            type="checkbox"
                            checked={f.invites.includes(b.id)}
                            onChange={(e) =>
                              setF({
                                ...f,
                                invites: e.target.checked
                                  ? [...f.invites, b.id]
                                  : f.invites.filter((x) => x !== b.id),
                              })
                            }
                          />
                          <span style={{ fontSize: 15 }}>
                            {b.name} <span className="muted">· {b.kind_label}</span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
            {error && <p className="error-text">{error}</p>}
            <div className="row">
              <button type="button" className="btn btn-primary" onClick={save}>
                Save
              </button>
              {saved && <span className="saved">Saved</span>}
            </div>
          </section>

          <DealsList title="Deals" businessId={id} />

          <section className="card">
            <h2>Access requests</h2>
            {data.requests.length === 0 && (
              <p className="muted">
                None yet. When a buying team asks, you'll see who they are, what they want and why.
              </p>
            )}
            {pending.map((r) => (
              <RequestCard key={r.id} r={r} meta={meta} onDone={load} businessId={id} />
            ))}
            {others.map((r) => (
              <RequestCard key={r.id} r={r} meta={meta} onDone={load} businessId={id} />
            ))}
          </section>
        </div>

        <aside className="studio-side">
          <section className="card" style={{ padding: 18 }}>
            <strong>What buyers see</strong>
            {f.mode === "closed" ? (
              <p className="muted" style={{ fontSize: 14 }}>
                Nothing: the business isn't listed.
              </p>
            ) : (
              <>
                <p className="muted" style={{ fontSize: 13, margin: "4px 0 10px" }}>
                  Saved settings. Save to refresh this preview.
                </p>
                <CandidateHead c={preview} />
                <h3 style={{ fontSize: 19, margin: "10px 0 4px" }}>{preview.title}</h3>
                {preview.tagline && (
                  <p className="muted" style={{ margin: "0 0 10px" }}>
                    {preview.tagline}
                  </p>
                )}
                <div className="stat-row" style={{ gridTemplateColumns: "1fr 1fr" }}>
                  <FigLine label="Asking price" fig={preview.asking} />
                  <FigLine label="Estimate" fig={preview.value} />
                  <FigLine label="Revenue" fig={preview.revenue} />
                  <FigLine label="Profit" fig={preview.profit} />
                </div>
                <p className="muted" style={{ fontSize: 13 }}>
                  Owner work: {preview.founder_hours.text} · {preview.history.text}
                </p>
              </>
            )}
          </section>
          {f.mode === "anonymous" && (
            <section className="card" style={{ padding: 18 }}>
              <strong>Before you rely on anonymity</strong>
              <ul className="missing-list" style={{ marginTop: 8 }}>
                {data.anonymous_warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}

/** A small card on the desk: the current setting and how many requests are waiting. */
export function DeskSelling({ businessId }: { businessId: string }) {
  const [s, setS] = useState<{ mode: string; mode_label: string; pending: number } | null>(null);
  useEffect(() => {
    api5
      .listingSummary(businessId)
      .then(setS)
      .catch(() => {});
  }, [businessId]);
  if (!s) return null;
  return (
    <div className="card" style={{ padding: 18 }}>
      <div className="row">
        <strong>Selling</strong>
        <span className="spacer" />
        {s.pending > 0 && <span className="pill caution">{s.pending} waiting</span>}
      </div>
      <p className="muted" style={{ fontSize: 14, margin: "6px 0 10px" }}>
        {s.mode === "closed"
          ? "Closed to approaches. Buyers can't find this business."
          : `${s.mode_label}. Customers never see this.`}
      </p>
      <Link to={`/desk/${businessId}/sale`}>
        {s.pending > 0 ? "Review access requests" : "Choose who may discover it"}
      </Link>
    </div>
  );
}
