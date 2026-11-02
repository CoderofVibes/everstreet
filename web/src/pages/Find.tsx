// Find a solution: plain words become editable constraints. Hard constraints filter first;
// each result says why it is here; when nothing fits, it says which constraint did it, offers to
// relax that one (with a way back), and lets the person publish the request as a need.

import { type FormEvent, useState } from "react";
import { api, type Constraints, type SearchResult } from "../api.ts";
import { Link } from "../router.tsx";
import { useSession } from "../session.tsx";
import { FAMILY_LABEL, money } from "../ui.tsx";
import { Tile } from "./Explore.tsx";

const EXAMPLES = [
  "beginner printmaking class under $40",
  "receipts for my online shop",
  "someone to fix my bike",
  "a left-handed carving kit delivered tomorrow",
];

const LABEL: Record<string, string> = {
  family: "kind of business",
  max_price_cents: "price limit",
  online: "online only",
  confirmed_only: "confirmed details only",
};

function params(c: Constraints): Record<string, string> {
  return {
    family: c.family ?? "any",
    max: c.max_price_cents !== undefined ? String(c.max_price_cents / 100) : "none",
    online: c.online ? "1" : "0",
    ...(c.confirmed_only ? { confirmed: "1" } : {}),
  };
}

function describe(c: Constraints) {
  const out: string[] = [];
  if (c.family) out.push(FAMILY_LABEL[c.family] ?? c.family);
  if (c.max_price_cents !== undefined) out.push(`up to ${money(c.max_price_cents)}`);
  if (c.online) out.push("online");
  if (c.confirmed_only) out.push("confirmed details");
  return out;
}

function ShareNeed({ query, constraints }: { query: string; constraints: Constraints }) {
  const { person, requireSignIn } = useSession();
  const [text, setText] = useState(query);
  const [replies, setReplies] = useState(true);
  const [days, setDays] = useState(14);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (done)
    return (
      <p className="notice ok">
        Posted. Founders who can help will reply in <Link to="/activity">My activity</Link>. Your
        name is not shown.
      </p>
    );
  return (
    <div className="card" style={{ maxWidth: 760 }}>
      <h2>Share this request</h2>
      <p className="muted">
        Founders on Everstreet can see it and reply with an offer. Your name and contact stay
        private; you choose whether to answer.
      </p>
      <label className="field">
        <span>What you need</span>
        <textarea className="input" value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      {describe(constraints).length > 0 && (
        <p className="muted" style={{ fontSize: 14 }}>
          With: {describe(constraints).join(", ")}
        </p>
      )}
      <label className="check">
        <input type="checkbox" checked={replies} onChange={(e) => setReplies(e.target.checked)} />
        <span>Founders may reply to me here</span>
      </label>
      <label className="field" style={{ maxWidth: 240 }}>
        <span>Keep it up for</span>
        <select className="input" value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={7}>7 days</option>
          <option value={14}>14 days</option>
          <option value={30}>30 days</option>
        </select>
      </label>
      {error && <p className="error-text">{error}</p>}
      <button
        type="button"
        className="btn btn-primary"
        onClick={async () => {
          if (
            !person &&
            !(await requireSignIn("Join to post a request. Your name is not shown with it."))
          )
            return;
          try {
            await api.postNeed({ text, constraints, allow_replies: replies, days });
            setDone(true);
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        Post my request
      </button>
    </div>
  );
}

const KEY: Record<string, keyof Constraints> = {
  family: "family",
  max_price_cents: "max_price_cents",
  online: "online",
  confirmed_only: "confirmed_only",
};

export function Find() {
  const [q, setQ] = useState("");
  const [asked, setAsked] = useState("");
  const [result, setResult] = useState<SearchResult | null>(null);
  const [original, setOriginal] = useState<Constraints | null>(null);
  const [busy, setBusy] = useState(false);

  const fresh = async (query: string) => {
    setBusy(true);
    setAsked(query);
    const r = await api.search(query, { interpret: "1" });
    setOriginal(r.constraints);
    setResult(r);
    setBusy(false);
  };
  const refine = async (c: Constraints) => setResult(await api.search(asked, params(c)));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (q.trim()) fresh(q);
  };

  const c = result?.constraints ?? {};
  const changed = original && JSON.stringify(original) !== JSON.stringify(c);
  const set = (patch: Partial<Constraints>) => {
    const next: Constraints = { ...c, ...patch };
    for (const k of Object.keys(next) as (keyof Constraints)[])
      if (next[k] === undefined || next[k] === false) delete next[k];
    refine(next);
  };
  const chip = (label: string, key: keyof Constraints) => (
    <span className="chip" key={key}>
      {label}
      <button
        type="button"
        aria-label={`Remove ${LABEL[key]}`}
        onClick={() => set({ [key]: undefined })}
      >
        ×
      </button>
    </span>
  );

  return (
    <div className="page">
      <div className="eyebrow">Find a solution</div>
      <h1 className="display" style={{ fontSize: 44 }}>
        What do you need?
      </h1>
      <form className="row" onSubmit={submit} style={{ maxWidth: 820 }}>
        <input
          className="input"
          style={{ flex: 1, fontSize: 18, minHeight: 52 }}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Say it in your own words, with a budget if you have one"
          aria-label="What do you need?"
        />
        <button className="btn btn-primary btn-lg" type="submit" disabled={busy}>
          Search
        </button>
      </form>
      <div className="row" style={{ margin: "12px 0 24px" }}>
        <span className="muted" style={{ fontSize: 14 }}>
          Try:
        </span>
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            className="pill"
            style={{ cursor: "pointer" }}
            onClick={() => {
              setQ(ex);
              fresh(ex);
            }}
          >
            {ex}
          </button>
        ))}
      </div>

      {result && (
        <>
          <div className="card" style={{ padding: 18 }}>
            <div className="chips">
              <strong style={{ marginRight: 4 }}>Looking for:</strong>
              {result.words.length > 0 ? (
                <span className="chip" style={{ paddingRight: 12 }}>
                  {result.words.join(" ")}
                </span>
              ) : (
                <span className="muted">anything</span>
              )}
              {c.family && chip(FAMILY_LABEL[c.family] ?? c.family, "family")}
              {c.max_price_cents !== undefined &&
                chip(`Up to ${money(c.max_price_cents)}`, "max_price_cents")}
              {c.online && chip("Online", "online")}
              {c.confirmed_only && chip("Confirmed details", "confirmed_only")}
              <span className="spacer" />
              {changed && original && (
                <button type="button" className="btn btn-quiet" onClick={() => refine(original)}>
                  Back to my original search
                </button>
              )}
            </div>
            <div className="filters">
              <label className="field" style={{ margin: 0 }}>
                <span style={{ fontSize: 14 }}>Kind</span>
                <select
                  className="input"
                  value={c.family ?? ""}
                  onChange={(e) =>
                    set({ family: (e.target.value || undefined) as Constraints["family"] })
                  }
                >
                  <option value="">Any</option>
                  <option value="class">Class or workshop</option>
                  <option value="service">Service</option>
                  <option value="product">Physical product</option>
                  <option value="software">Software or API</option>
                </select>
              </label>
              <label className="field" style={{ margin: 0 }}>
                <span style={{ fontSize: 14 }}>Most I'll pay ($)</span>
                <input
                  className="input"
                  inputMode="decimal"
                  key={c.max_price_cents ?? "none"}
                  defaultValue={c.max_price_cents !== undefined ? c.max_price_cents / 100 : ""}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    const cents = v ? Math.round(Number(v) * 100) : undefined;
                    if (
                      cents !== c.max_price_cents &&
                      (cents === undefined || Number.isFinite(cents))
                    )
                      set({ max_price_cents: cents });
                  }}
                  placeholder="No limit"
                />
              </label>
              <label className="check" style={{ alignSelf: "end" }}>
                <input
                  type="checkbox"
                  checked={Boolean(c.online)}
                  onChange={(e) => set({ online: e.target.checked || undefined })}
                />
                <span>Online only</span>
              </label>
              <label className="check" style={{ alignSelf: "end" }}>
                <input
                  type="checkbox"
                  checked={Boolean(c.confirmed_only)}
                  onChange={(e) => set({ confirmed_only: e.target.checked || undefined })}
                />
                <span>Confirmed details only</span>
              </label>
            </div>
            <p className="muted" style={{ fontSize: 13, margin: 0 }}>
              We read your words into these. Remove or change any of them. Nobody pays to appear
              higher, and your search stays private.
            </p>
          </div>

          <div style={{ marginTop: 24 }}>
            {result.matches.length > 0 && (
              <>
                <h2 style={{ fontSize: 20 }}>
                  {result.matches.length} {result.matches.length === 1 ? "match" : "matches"}
                </h2>
                <div className="shelf">
                  {result.matches.map((b) => (
                    <Tile
                      key={b.slug}
                      b={b}
                      why={[
                        b.matched?.length ? `Mentions ${b.matched.join(", ")}` : null,
                        describe(c).length ? `fits ${describe(c).join(", ")}` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    />
                  ))}
                </div>
              </>
            )}

            {result.ask_to_confirm.length > 0 && (
              <>
                <h2 style={{ fontSize: 20, marginTop: 28 }}>Might fit: ask to confirm</h2>
                <p className="muted">
                  These don't say yet whether they meet everything you asked for.
                </p>
                <div className="shelf">
                  {result.ask_to_confirm.map((b) => (
                    <Tile
                      key={b.slug}
                      b={b}
                      why={`Not stated: ${(b.unknown_constraints ?? []).map((k) => LABEL[k] ?? k).join(", ")}`}
                    />
                  ))}
                </div>
              </>
            )}

            {result.matches.length === 0 && (
              <div className="card" style={{ marginTop: 8, maxWidth: 760 }}>
                <h2>Nothing fits all of that yet</h2>
                {Object.keys(result.blocked_by).length > 0 ? (
                  <>
                    <p>Here is what ruled things out. Relax one to see them:</p>
                    <div className="row">
                      {Object.entries(result.blocked_by).map(([k, n]) => (
                        <button
                          key={k}
                          type="button"
                          className="btn btn-secondary"
                          onClick={() => set({ [KEY[k] ?? "family"]: undefined })}
                        >
                          Drop the {LABEL[k] ?? k} ({n} more)
                        </button>
                      ))}
                    </div>
                  </>
                ) : (
                  <p className="muted">No published business mentions these words yet.</p>
                )}
              </div>
            )}
          </div>

          {result.matches.length < 2 && (
            <div style={{ marginTop: 24 }}>
              <ShareNeed key={asked} query={asked} constraints={c} />
            </div>
          )}
        </>
      )}

      {!result && (
        <p className="muted">
          Or browse what's new on <Link to="/explore">Explore</Link>.
        </p>
      )}
    </div>
  );
}
