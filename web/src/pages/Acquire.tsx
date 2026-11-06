// Explore acquisitions (Astra, LaunchPad §4 and PlatformVision §4): a buying profile with a team,
// a brief in words that fills the same visible filters, results that say why they match and what
// is unknown, a shortlist to compare, and the team's access requests.

import { useCallback, useEffect, useState } from "react";
import { api } from "../api.ts";
import {
  api5,
  type Candidate,
  type Criteria,
  type Fig,
  type Meta,
  type Result,
  rememberedBuyer,
  type SearchResult,
  STATUS_LABEL,
  type Workspace,
  when,
} from "../api5.ts";
import { Link } from "../router.tsx";
import { scopeList } from "../scopes.ts";
import { useSession } from "../session.tsx";
import { ago } from "../via.ts";
import { DealsList } from "./Deal.tsx";
import { MyDeals } from "./MyDeals.tsx";

const FAMILIES: [string, string][] = [
  ["software", "Software or API"],
  ["class", "Class or workshop"],
  ["service", "Service"],
  ["product", "Physical product"],
];

export function FigLine({ label, fig }: { label: string; fig: Fig }) {
  return (
    <div className="stat">
      <span className="muted" style={{ fontSize: 13 }}>
        {label}
      </span>
      <strong
        style={{
          fontSize: fig.status === "shown" ? 17 : 15,
          color: fig.status === "shown" ? undefined : "var(--ink-3)",
          fontWeight: fig.status === "shown" ? 700 : 500,
        }}
      >
        {fig.text}
      </strong>
      {fig.source && (
        <span className="muted" style={{ fontSize: 12 }}>
          {fig.source}
        </span>
      )}
    </div>
  );
}

export function CandidateHead({ c }: { c: Candidate }) {
  return (
    <div className="row" style={{ gap: 8 }}>
      <span className={`pill ${c.mode === "anonymous" ? "caution" : "lime"}`}>
        {c.mode === "anonymous"
          ? "Anonymous teaser"
          : c.mode === "private"
            ? "Private introduction"
            : "Named profile"}
      </span>
      <span className="pill">{c.family_label}</span>
      <span className="pill">{c.openness_label}</span>
      {c.remote && <span className="pill">Runs remotely</span>}
      {c.yours && <span className="pill caution">Your listing</span>}
    </div>
  );
}

function ResultCard({
  r,
  buyerId,
  onShortlist,
}: {
  r: Result;
  buyerId?: string;
  onShortlist?: (on: boolean) => void;
}) {
  return (
    <section className="card">
      <div className="row" style={{ alignItems: "flex-start" }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <CandidateHead c={r} />
          <h2 style={{ fontSize: 22, margin: "10px 0 4px" }}>
            <Link to={`/acquire/l/${r.listing_id}`}>{r.title}</Link>
            {r.is_new && (
              <span className="pill lime" style={{ marginLeft: 8, fontSize: 12 }}>
                New for this brief
              </span>
            )}
          </h2>
          {r.tagline && (
            <p className="muted" style={{ margin: 0 }}>
              {r.tagline}
            </p>
          )}
        </div>
        {buyerId && onShortlist && (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => onShortlist(!r.shortlisted)}
          >
            {r.shortlisted ? "On the shortlist ✓" : "Add to shortlist"}
          </button>
        )}
      </div>
      <div className="stat-row" style={{ marginTop: 14 }}>
        <FigLine label="Asking price" fig={r.asking} />
        <FigLine label="Everstreet estimate" fig={r.value} />
        <FigLine label="Revenue" fig={r.revenue} />
        <FigLine label="Operating profit" fig={r.profit} />
      </div>
      <p className="muted" style={{ fontSize: 14, margin: "10px 0 0" }}>
        Owner work: {r.founder_hours.text} · History: {r.history.text}
        {r.value.basis && r.value.status === "shown" ? ` · ${r.value.basis}` : ""}
      </p>
      {(r.reasons.length > 0 || r.unknowns.length > 0) && (
        <div className="why" style={{ marginTop: 10 }}>
          {r.reasons.map((x) => (
            <div key={x}>✓ {x}</div>
          ))}
          {r.unknowns.map((x) => (
            <div key={x} style={{ color: "var(--caution)" }}>
              ? {x}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

const dollars = (c?: number) => (c === undefined ? "" : String(Math.round(c / 100)));
const cents = (s: string) => (s.trim() === "" ? undefined : Math.round(Number(s) * 100));
const num = (s: string) => (s.trim() === "" ? undefined : Number(s));

function Filters({ c, set }: { c: Criteria; set: (c: Criteria) => void }) {
  const toggle = (key: "families" | "openness", v: string) => {
    const list = new Set(c[key] ?? []);
    if (list.has(v)) list.delete(v);
    else list.add(v);
    set({ ...c, [key]: [...list] });
  };
  const box = (label: string, checked: boolean, onChange: (v: boolean) => void) => (
    <label className="check" style={{ margin: "0 0 6px" }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span style={{ fontSize: 14 }}>{label}</span>
    </label>
  );
  const field = (label: string, value: string, onChange: (v: string) => void, hint?: string) => (
    <label className="field" style={{ margin: "0 0 12px" }}>
      <span style={{ fontSize: 14 }}>{label}</span>
      {hint && <small style={{ fontSize: 12 }}>{hint}</small>}
      <input
        className="input"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
  return (
    <div>
      <strong style={{ fontSize: 14 }}>Kind of business</strong>
      <div style={{ margin: "6px 0 12px" }}>
        {FAMILIES.map(([k, label]) =>
          box(label, Boolean(c.families?.includes(k)), () => toggle("families", k)),
        )}
        {box("Can run remotely", Boolean(c.remote), (v) => set({ ...c, remote: v || undefined }))}
      </div>
      {field("Asking price up to ($)", dollars(c.max_asking_cents), (v) =>
        set({ ...c, max_asking_cents: cents(v) }),
      )}
      {box("Only businesses with an asking price", Boolean(c.require_asking), (v) =>
        set({ ...c, require_asking: v || undefined }),
      )}
      <div style={{ borderTop: "1px solid var(--border)", margin: "10px 0", paddingTop: 10 }}>
        <strong style={{ fontSize: 14 }}>Everstreet estimate</strong>
        <p className="muted" style={{ fontSize: 12, margin: "2px 0 8px" }}>
          A separate filter from asking price. Scenario model, not an appraisal.
        </p>
        <div className="row" style={{ gap: 8, flexWrap: "nowrap" }}>
          {field("From ($)", dollars(c.value_min_cents), (v) =>
            set({ ...c, value_min_cents: cents(v) }),
          )}
          {field("To ($)", dollars(c.value_max_cents), (v) =>
            set({ ...c, value_max_cents: cents(v) }),
          )}
        </div>
        <select
          className="input"
          aria-label="How the estimate must fit"
          value={c.value_mode ?? "overlap"}
          onChange={(e) => set({ ...c, value_mode: e.target.value as "overlap" | "within" })}
          style={{ marginBottom: 8 }}
        >
          <option value="overlap">Range overlaps mine</option>
          <option value="within">Whole range within mine</option>
        </select>
        {box("Include businesses with no estimate", Boolean(c.include_unestimated), (v) =>
          set({ ...c, include_unestimated: v || undefined }),
        )}
      </div>
      <div style={{ borderTop: "1px solid var(--border)", margin: "10px 0", paddingTop: 10 }}>
        {field("At least this many months of history", c.min_months?.toString() ?? "", (v) =>
          set({ ...c, min_months: num(v) }),
        )}
        {field("Owner work at most (hours a week)", c.max_founder_hours?.toString() ?? "", (v) =>
          set({ ...c, max_founder_hours: num(v) }),
        )}
        {box("Only revenue verified on NEAR testnet", Boolean(c.verified_only), (v) =>
          set({ ...c, verified_only: v || undefined }),
        )}
        {box(
          "Only owners actively seeking a successor",
          Boolean(c.openness?.includes("seeking")),
          () => toggle("openness", "seeking"),
        )}
      </div>
    </div>
  );
}

function SearchTab({ ws, onChange }: { ws: Workspace | null; onChange: () => void }) {
  const buyerId = ws?.buyer.id;
  const [criteria, setCriteria] = useState<Criteria>({});
  const [mandateId, setMandateId] = useState<string | undefined>();
  const [text, setText] = useState("");
  const [sort, setSort] = useState("fit");
  const [result, setResult] = useState<SearchResult | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(
    () =>
      api5
        .search(criteria, buyerId, mandateId, sort)
        .then(setResult)
        .catch((e) => setError((e as Error).message)),
    [criteria, buyerId, mandateId, sort],
  );
  useEffect(() => {
    const t = setTimeout(run, 250);
    return () => clearTimeout(t);
  }, [run]);
  const fillFromWords = async () => {
    const { criteria: c } = await api5.interpret(text);
    setCriteria({ ...criteria, ...c });
  };
  const relax = (r: Partial<Criteria>) => {
    const next: Record<string, unknown> = { ...criteria };
    for (const [k, v] of Object.entries(r)) {
      if (v === false || v === null) delete next[k];
      else next[k] = v;
    }
    setCriteria(next as Criteria);
  };
  // First-use review #7: with nothing listed, say so once; no filters over an empty market.
  if (result && result.total_listed === 0)
    return <p className="card muted">No businesses are listed for sale yet.</p>;
  return (
    <div className="studio acq-search">
      <aside className="studio-side" style={{ position: "static" }}>
        <section className="card" style={{ padding: 18 }}>
          <strong>Describe what you're looking for</strong>
          <textarea
            className="input"
            rows={4}
            style={{ marginTop: 8 }}
            placeholder="Software or services for independent studios, remote, up to $200k asking"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <button
            type="button"
            className="btn btn-secondary"
            style={{ marginTop: 8 }}
            disabled={!text.trim()}
            onClick={fillFromWords}
          >
            Fill the filters from this
          </button>
          <p className="muted" style={{ fontSize: 12, margin: "8px 0 0" }}>
            Your words become the filters below, which you can change. Nothing is guessed silently.
          </p>
        </section>
        <section className="card" style={{ padding: 18 }}>
          <Filters
            c={criteria}
            set={(c) => {
              setCriteria(c);
            }}
          />
          <button type="button" className="btn btn-quiet" onClick={() => setCriteria({})}>
            Clear filters
          </button>
        </section>
        {ws && (
          <section className="card" style={{ padding: 18 }}>
            <strong>Saved briefs</strong>
            {ws.mandates.length === 0 && (
              <p className="muted" style={{ fontSize: 14 }}>
                Save these filters as a brief to come back to. Matches that are new since you last
                looked are marked.
              </p>
            )}
            {ws.mandates.map((m) => (
              <div
                key={m.id}
                className="row"
                style={{ padding: "6px 0", borderTop: "1px solid var(--border)" }}
              >
                <button
                  type="button"
                  className="btn btn-quiet"
                  style={{ padding: 0, fontWeight: mandateId === m.id ? 700 : 500 }}
                  onClick={() => {
                    setCriteria(m.criteria);
                    setMandateId(m.id);
                    setText(m.text);
                  }}
                >
                  {m.name}
                </button>
                <span className="spacer" />
                <button
                  type="button"
                  className="btn btn-quiet"
                  aria-label={`Delete ${m.name}`}
                  onClick={async () => {
                    await api5.deleteMandate(ws.buyer.id, m.id);
                    if (mandateId === m.id) setMandateId(undefined);
                    onChange();
                  }}
                >
                  ×
                </button>
              </div>
            ))}
            <div className="row" style={{ marginTop: 10, flexWrap: "nowrap" }}>
              <input
                className="input"
                placeholder="Name this brief"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <button
                type="button"
                className="btn btn-secondary"
                onClick={async () => {
                  await api5.saveMandate(ws.buyer.id, {
                    id: mandateId,
                    name: name || ws.mandates.find((m) => m.id === mandateId)?.name || "My brief",
                    text,
                    criteria,
                  });
                  setName("");
                  onChange();
                }}
              >
                {mandateId ? "Update" : "Save"}
              </button>
            </div>
          </section>
        )}
      </aside>
      <div>
        <div className="row" style={{ marginBottom: 12 }}>
          <span className="muted">
            {result
              ? `${result.results.length} of ${result.total_listed} businesses open to buyers`
              : "Searching…"}
          </span>
          <span className="spacer" />
          <select
            className="input"
            style={{ width: "auto", maxWidth: "100%" }}
            aria-label="Sort"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
          >
            <option value="fit">Best fit first</option>
            <option value="asking">Lowest asking price</option>
            <option value="value">Highest estimate</option>
            <option value="newest">Recently updated</option>
          </select>
        </div>
        {error && <p className="error-text">{error}</p>}
        {result?.hidden.map((h) => (
          <p key={h.text} className="notice">
            {h.text}.{" "}
            <button type="button" className="btn btn-quiet" onClick={() => relax(h.relax)}>
              Include them
            </button>
          </p>
        ))}
        {result && result.results.length === 0 && (
          <section className="card empty">
            <h2>No business matches all of these yet</h2>
            {result.ruled_out.length > 0 ? (
              <p>
                Ruled out by: {result.ruled_out.map((r) => `${r.filter} (${r.count})`).join(", ")}.
                Loosen one of these to see them.
              </p>
            ) : (
              <p>Only businesses whose owners chose to be found appear here.</p>
            )}
          </section>
        )}
        {result?.results.map((r) => (
          <ResultCard
            key={r.listing_id}
            r={r}
            buyerId={buyerId}
            onShortlist={
              ws
                ? async (on) => {
                    await api5.shortlist(ws.buyer.id, r.listing_id, on);
                    run();
                    onChange();
                  }
                : undefined
            }
          />
        ))}
        {result && result.results.length > 0 && result.ruled_out.length > 0 && (
          <p className="muted" style={{ fontSize: 14 }}>
            Also ruled out by your filters:{" "}
            {result.ruled_out.map((r) => `${r.filter} (${r.count})`).join(", ")}.
          </p>
        )}
      </div>
    </div>
  );
}

/** Plan step 6 (TEAM_AUTHORITY.md §3): who signs for the team; only the lead names them. */
function Representative({ ws, onChange }: { ws: Workspace; onChange: (w?: Workspace) => void }) {
  const { person } = useSession();
  const lead = ws.members.find((m) => m.lead);
  const isLead = !!person && lead?.person_id === person.id;
  const [pick, setPick] = useState(ws.representative?.person_id ?? "");
  const [error, setError] = useState<string | null>(null);
  const rep = ws.representative ?? null;
  return (
    <div style={{ margin: "0 0 10px", fontSize: 14 }}>
      <div>
        <strong>Signs for the team:</strong>{" "}
        {rep ? (
          <>
            {rep.name} <span className="mono muted">{rep.account}</span>
          </>
        ) : (
          <span className="muted">nobody named yet</span>
        )}
      </div>
      {isLead && (
        <div className="row" style={{ marginTop: 6, gap: 6 }}>
          <select
            className="input"
            aria-label="Who signs for the team"
            value={pick}
            onChange={(e) => setPick(e.target.value)}
          >
            <option value="">Choose who signs…</option>
            {ws.members.map((m) => (
              <option key={m.person_id} value={m.person_id}>
                {m.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={!pick}
            onClick={async () => {
              setError(null);
              try {
                onChange(await api5.setRepresentative(ws.buyer.id, pick));
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            Name them
          </button>
        </div>
      )}
      {error && (
        <p className="notice error" role="status">
          {error}
        </p>
      )}
      {(ws.team_history ?? []).length > 0 && (
        <details style={{ marginTop: 6 }}>
          <summary>Team history</summary>
          <ul className="muted" style={{ paddingLeft: 18 }}>
            {(ws.team_history ?? []).map((e) => (
              <li key={`${e.at}-${e.kind}-${e.name}`}>
                {TEAM_EVENT[e.kind] ?? e.kind}: {e.name ?? "someone"}
                {e.kind === "representative" ? ` (${e.detail})` : ""} · {ago(e.at)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

const TEAM_EVENT: Record<string, string> = {
  added: "Added",
  role_changed: "Role changed",
  removed: "Removed",
  representative: "Named to sign for the team",
  representative_cleared: "No longer signs for the team",
};
const POSITION_WORDS: Record<string, string> = {
  support: "Supports",
  object: "Objects",
  abstain: "Abstains",
};

/** Members' recorded positions on one candidate: a record for discussion, never a vote. */
function Positions({
  ws,
  listingId,
  onChange,
}: {
  ws: Workspace;
  listingId: string;
  onChange: (w?: Workspace) => void;
}) {
  const [position, setPosition] = useState("support");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const list = ws.positions?.[listingId] ?? [];
  return (
    <div className="muted" style={{ fontSize: 14, margin: "4px 0 10px 28px" }}>
      {list.length > 0 ? (
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {list.map((p) => (
            <li key={p.name}>
              {p.name}: {POSITION_WORDS[p.position] ?? p.position}
              {p.note ? ` · "${p.note}"` : ""} · {ago(p.at)}
            </li>
          ))}
        </ul>
      ) : (
        <span>No positions recorded.</span>
      )}
      {ws.role === "approve" && (
        <div className="row" style={{ gap: 6, marginTop: 4 }}>
          <select
            className="input"
            aria-label="Your position"
            value={position}
            onChange={(e) => setPosition(e.target.value)}
          >
            <option value="support">Support</option>
            <option value="object">Object</option>
            <option value="abstain">Abstain</option>
          </select>
          <input
            className="input"
            aria-label="Why (optional)"
            placeholder="Why (optional)"
            value={note}
            maxLength={300}
            onChange={(e) => setNote(e.target.value)}
          />
          <button
            type="button"
            className="btn btn-quiet btn-sm"
            onClick={async () => {
              setError(null);
              try {
                onChange(await api5.recordPosition(ws.buyer.id, listingId, position, note));
                setNote("");
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            Record my position
          </button>
        </div>
      )}
      {error && <span className="notice error">{error}</span>}
    </div>
  );
}

function CompareTab({ ws, onChange }: { ws: Workspace; onChange: (w?: Workspace) => void }) {
  const [ids, setIds] = useState<string[]>(ws.shortlist.slice(0, 3).map((c) => c.listing_id));
  const [data, setData] = useState<{ candidates: Candidate[]; basis: string } | null>(null);
  useEffect(() => {
    if (ids.length) api5.compare(ws.buyer.id, ids).then(setData);
    else setData(null);
  }, [ids, ws.buyer.id]);
  if (ws.shortlist.length === 0)
    return (
      <section className="card empty">
        <h2>Nothing on the shortlist yet</h2>
        <p>Add businesses from the search to compare up to three side by side.</p>
      </section>
    );
  const rows: [string, (c: Candidate) => string][] = [
    ["Asking price", (c) => c.asking.text],
    ["Everstreet estimate", (c) => c.value.text],
    ["Estimate basis", (c) => (c.value.status === "shown" ? (c.value.basis ?? "—") : "—")],
    ["Revenue", (c) => c.revenue.text],
    ["Operating profit", (c) => c.profit.text],
    ["Owner work", (c) => c.founder_hours.text],
    ["History", (c) => c.history.text],
    ["Sources", (c) => c.history.source ?? c.revenue.source ?? "—"],
    ["Runs remotely", (c) => (c.remote === null ? "Not stated" : c.remote ? "Yes" : "No")],
    ["Openness", (c) => c.openness_label],
  ];
  return (
    <div>
      <section className="card">
        <h2>Shortlist</h2>
        {ws.shortlist.map((c) => (
          <label key={c.listing_id} className="check">
            <input
              type="checkbox"
              checked={ids.includes(c.listing_id)}
              disabled={!ids.includes(c.listing_id) && ids.length >= 3}
              onChange={(e) =>
                setIds(
                  e.target.checked ? [...ids, c.listing_id] : ids.filter((x) => x !== c.listing_id),
                )
              }
            />
            <span>
              <Link to={`/acquire/l/${c.listing_id}`}>{c.title}</Link>{" "}
              <span className="muted">· {c.family_label}</span>
            </span>
          </label>
        ))}
      </section>
      <section className="card" aria-labelledby="team-positions">
        <h2 id="team-positions">Team positions</h2>
        <p className="muted" style={{ fontSize: 14 }}>
          A record for discussing each candidate. It binds nobody: the person who signs for the team
          decides in their own wallet.
        </p>
        {ws.shortlist.map((c) => (
          <div key={c.listing_id}>
            <strong>{c.title}</strong>
            <Positions ws={ws} listingId={c.listing_id} onChange={onChange} />
          </div>
        ))}
      </section>
      {data && data.candidates.length > 0 && (
        <section className="card">
          <h2>Side by side</h2>
          <p className="muted" style={{ fontSize: 14 }}>
            {data.basis}
          </p>
          <table className="table">
            <thead>
              <tr>
                <th />
                {data.candidates.map((c) => (
                  <th key={c.listing_id}>{c.title}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(([label, get]) => (
                <tr key={label}>
                  <td className="muted">{label}</td>
                  {data.candidates.map((c) => (
                    <td key={c.listing_id}>{get(c)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

function RequestsTab({ ws, onChange }: { ws: Workspace; onChange: () => void }) {
  if (ws.requests.length === 0)
    return (
      <section className="card empty">
        <h2>No access requests yet</h2>
        <p>
          Open a business from the search and ask for specific evidence, for a set time and purpose.
        </p>
      </section>
    );
  return (
    <>
      <DealsList title="Deals offered to your team" buyerId={ws.buyer.id} />
      <section className="card">
        <h2>Your team's access requests</h2>
        {ws.requests.map((r) => (
          <div key={r.id} className="message">
            <div className="row">
              <strong>{r.title}</strong>
              <span
                className={`pill ${r.status === "granted" ? "lime" : r.status === "pending" ? "" : "caution"}`}
              >
                {STATUS_LABEL[r.status]}
              </span>
              <span className="spacer" />
              {r.status === "granted" && (
                <Link to={`/acquire/room/${r.id}`} className="btn btn-primary">
                  Open the evidence room
                </Link>
              )}
              {r.status === "pending" && ws.role === "approve" && (
                <button
                  type="button"
                  className="btn btn-quiet"
                  onClick={async () => {
                    await api5.withdraw(r.id);
                    onChange();
                  }}
                >
                  Withdraw
                </button>
              )}
            </div>
            <div className="meta">
              Asked by {r.requested_by} on {when(r.created_at)} for {r.days} days:{" "}
              {scopeList(r.categories)}
              {r.granted && ` · Granted: ${scopeList(r.granted)}`}
              {r.status === "granted" && r.expires_at && ` · until ${when(r.expires_at)}`}
              {r.status === "expired" && r.expires_at && ` · ended ${when(r.expires_at)}`}
              {r.status === "revoked" && r.revoked_at && ` · ended ${when(r.revoked_at)}`}
            </div>
            <blockquote>{r.purpose}</blockquote>
            {r.decision_note && <div className="reply">Seller: {r.decision_note}</div>}
          </div>
        ))}
      </section>
    </>
  );
}

function BuyerForm({
  meta,
  initial,
  onSave,
  saveLabel,
}: {
  meta: Meta;
  initial?: Workspace["buyer"];
  onSave: (b: Record<string, string>) => Promise<void>;
  saveLabel: string;
}) {
  const [f, setF] = useState<Record<string, string>>({
    name: initial?.name ?? "",
    kind: initial?.kind ?? "individual",
    intent: initial?.intent ?? "operate",
    about: initial?.about ?? "",
    interests: initial?.interests ?? "",
    time_available: initial?.time_available ?? "",
    skills: initial?.skills ?? "",
    budget_basis: initial?.budget_basis ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const text = (key: string, label: string, hint: string, rows = 0) =>
    rows ? (
      <label className="field">
        <span>{label}</span>
        <small>{hint}</small>
        <textarea
          className="input"
          rows={rows}
          value={f[key]}
          onChange={(e) => setF({ ...f, [key]: e.target.value })}
        />
      </label>
    ) : (
      <label className="field">
        <span>{label}</span>
        <small>{hint}</small>
        <input
          className="input"
          value={f[key]}
          onChange={(e) => setF({ ...f, [key]: e.target.value })}
        />
      </label>
    );
  const choose = (key: "kind" | "intent", options: Record<string, string>) => (
    <div
      className="choices"
      style={{
        gridTemplateColumns: `repeat(${Object.keys(options).length}, 1fr)`,
        marginTop: 8,
        marginBottom: 18,
      }}
    >
      {Object.entries(options).map(([k, label]) => (
        <button
          key={k}
          type="button"
          className="card choice"
          style={{
            padding: 14,
            margin: 0,
            borderColor: f[key] === k ? "var(--forest)" : undefined,
            boxShadow: f[key] === k ? "0 0 0 2px var(--forest)" : undefined,
          }}
          aria-pressed={f[key] === k}
          onClick={() => setF({ ...f, [key]: k })}
        >
          <strong style={{ fontSize: 15 }}>{label}</strong>
        </button>
      ))}
    </div>
  );
  return (
    <div>
      {text("name", "Name", "Yourself, your business, or your group")}
      <strong>Who is buying</strong>
      {choose("kind", meta.buyer_kinds)}
      <strong>How you would own it</strong>
      {choose("intent", meta.intents)}
      {text("about", "About you", "What sellers see when you ask for access", 3)}
      {text(
        "interests",
        "What you're looking for",
        "Kinds of business, customers, problems you want to own",
      )}
      <div className="filters filters-3">
        {text("time_available", "Time you can give", "e.g. 20 hours a week")}
        {text("skills", "Operating skills", "e.g. support, billing, teaching")}
        {text("budget_basis", "Budget basis", "e.g. savings, the business's cash flow")}
      </div>
      {error && <p className="error-text">{error}</p>}
      <button
        type="button"
        className="btn btn-primary"
        onClick={async () => {
          try {
            await onSave(f);
            setError(null);
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        {saveLabel}
      </button>
    </div>
  );
}

function ProfileTab({
  ws,
  meta,
  onChange,
}: {
  ws: Workspace;
  meta: Meta;
  onChange: (w?: Workspace) => void;
}) {
  const [people, setPeople] = useState<{ id: string; display_name: string }[]>([]);
  const [pick, setPick] = useState("");
  const [role, setRole] = useState("research");
  useEffect(() => {
    api
      .people()
      .then((r) => setPeople(r.people))
      .catch(() => {});
  }, []);
  const approve = ws.role === "approve";
  const candidates = people.filter((p) => !ws.members.some((m) => m.person_id === p.id));
  return (
    <div className="desk">
      <section className="card">
        <h2>Buying profile</h2>
        {approve ? (
          <BuyerForm
            meta={meta}
            initial={ws.buyer}
            saveLabel="Save profile"
            onSave={async (b) => onChange(await api5.updateBuyer(ws.buyer.id, b))}
          />
        ) : (
          <p className="muted">Only someone with the approve role can change the profile.</p>
        )}
      </section>
      <aside className="studio-side" style={{ position: "static" }}>
        <section className="card" style={{ padding: 18 }}>
          <strong>Team</strong>
          <p className="muted" style={{ fontSize: 14, margin: "6px 0 10px" }}>
            {ws.team_is_not ??
              "Being on the team doesn't make someone the person who can accept a sale; that is agreed per deal."}
          </p>
          <Representative ws={ws} onChange={onChange} />
          {ws.members.map((m) => (
            <div
              key={m.person_id}
              className="row"
              style={{ padding: "6px 0", borderTop: "1px solid var(--border)", fontSize: 14 }}
            >
              <strong>{m.name}</strong>
              <span className="muted">{m.lead ? "lead · approve" : m.role}</span>
              <span className="spacer" />
              {approve && !m.lead && (
                <button
                  type="button"
                  className="btn btn-quiet"
                  onClick={async () => onChange(await api5.removeMember(ws.buyer.id, m.person_id))}
                >
                  Remove
                </button>
              )}
            </div>
          ))}
          {approve && candidates.length > 0 && (
            <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
              <select
                className="input"
                aria-label="Person"
                value={pick}
                onChange={(e) => setPick(e.target.value)}
              >
                <option value="">Add someone…</option>
                {candidates.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.display_name}
                  </option>
                ))}
              </select>
              <select
                className="input"
                aria-label="Role"
                value={role}
                onChange={(e) => setRole(e.target.value)}
              >
                {Object.entries(meta.roles).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={!pick}
                onClick={async () => {
                  onChange(await api5.addMember(ws.buyer.id, pick, role));
                  setPick("");
                }}
              >
                Add to the team
              </button>
            </div>
          )}
        </section>
      </aside>
    </div>
  );
}

function Intro() {
  return (
    <>
      <div className="eyebrow">Explore acquisitions</div>
      <h1 className="display" style={{ fontSize: 44, margin: "0 0 8px" }}>
        Find a business worth owning.
      </h1>
      <p className="muted" style={{ fontSize: 18, maxWidth: "62ch" }}>
        Only businesses whose owners chose to be found are here. Every number says where it came
        from; asking price and Everstreet's estimate are never mixed up. Fictional examples, test
        dollars.
      </p>
    </>
  );
}

export function Acquire() {
  const { person, requireSignIn } = useSession();
  const [meta, setMeta] = useState<Meta | null>(null);
  const [buyers, setBuyers] = useState<{ id: string; name: string; kind_label: string }[] | null>(
    null,
  );
  const [ws, setWs] = useState<Workspace | null>(null);
  const [tab, setTab] = useState("search");
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    api5.meta().then(setMeta);
  }, []);
  const loadWorkspace = useCallback(async (id: string) => {
    setWs(await api5.workspace(id));
    rememberedBuyer.set(id);
  }, []);
  const loadBuyers = useCallback(async () => {
    if (!person) {
      setBuyers([]);
      setWs(null);
      return;
    }
    const { buyers: list } = await api5.buyers();
    setBuyers(list);
    const remembered = rememberedBuyer.get();
    const pick = list.find((b) => b.id === remembered) ?? list[0];
    if (pick) await loadWorkspace(pick.id);
    else setWs(null);
  }, [person, loadWorkspace]);
  useEffect(() => {
    loadBuyers();
  }, [loadBuyers]);

  if (!meta || buyers === null) return <div className="page muted">Loading…</div>;

  if (!ws || creating)
    return (
      <div className="page">
        <Intro />
        <MyDeals />
        <section className="card" style={{ marginTop: 20 }}>
          <h2>Set up a buying profile</h2>
          <p className="muted" style={{ fontSize: 15 }}>
            On your own, for your business, or with a group, even the customers of a business you
            love. It lives under your own account; sellers see it when you ask for access.
          </p>
          {person ? (
            <BuyerForm
              meta={meta}
              saveLabel="Create the buying profile"
              onSave={async (b) => {
                const w = await api5.createBuyer(b);
                setCreating(false);
                rememberedBuyer.set(w.buyer.id);
                await loadBuyers();
              }}
            />
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => requireSignIn("Join to set up a buying profile.")}
            >
              Sign in to start
            </button>
          )}
          {creating && (
            <button type="button" className="btn btn-quiet" onClick={() => setCreating(false)}>
              Cancel
            </button>
          )}
        </section>
        {!creating && (
          <>
            <h2 className="section-title" style={{ marginTop: 32 }}>
              Open to buyers now
            </h2>
            <SearchTab ws={null} onChange={() => {}} />
          </>
        )}
      </div>
    );

  const refresh = () => loadWorkspace(ws.buyer.id);
  const tabs: [string, string][] = [
    ["search", "Search"],
    ["compare", `Shortlist and compare (${ws.shortlist.length})`],
    ["requests", `Access requests (${ws.requests.length})`],
    ["profile", "Profile and team"],
  ];
  return (
    <div className="page" style={{ maxWidth: 1320 }}>
      <MyDeals />
      <div className="row" style={{ alignItems: "flex-end" }}>
        <div>
          <div className="eyebrow">Explore acquisitions</div>
          <h1 className="display" style={{ fontSize: 36, margin: 0 }}>
            {ws.buyer.name}
          </h1>
          <p className="muted" style={{ margin: "4px 0 0" }}>
            {ws.buyer.kind_label} · {ws.buyer.intent_label} · you: {ws.role}
          </p>
        </div>
        <span className="spacer" />
        {buyers.length > 1 && (
          <select
            className="input"
            style={{ width: 260 }}
            aria-label="Buying profile"
            value={ws.buyer.id}
            onChange={(e) => loadWorkspace(e.target.value)}
          >
            {buyers.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        )}
        <button type="button" className="btn btn-secondary" onClick={() => setCreating(true)}>
          New buying profile
        </button>
      </div>
      <div className="tabs" style={{ marginTop: 20 }}>
        {tabs.map(([k, label]) => (
          <button
            key={k}
            type="button"
            className={`tab${tab === k ? " active" : ""}`}
            onClick={() => setTab(k)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "search" && <SearchTab ws={ws} onChange={refresh} />}
      {tab === "compare" && <CompareTab ws={ws} onChange={(w) => (w ? setWs(w) : refresh())} />}
      {tab === "requests" && <RequestsTab ws={ws} onChange={refresh} />}
      {tab === "profile" && (
        <ProfileTab ws={ws} meta={meta} onChange={(w) => (w ? setWs(w) : refresh())} />
      )}
    </div>
  );
}
