// Job 005c: expert help. A directory of opt-in, self-reported profiles (reasons from stated fields
// only), a request form that previews EXACTLY what the expert receives, private request threads
// with explicit actions, and the person's own profile editor. Discussing or accepting a request
// grants no access to a business. Fictional people in previews.

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Link, useRouter } from "../router.tsx";
import { useSession } from "../session.tsx";

// biome-ignore lint/suspicious/noExplicitAny: loosely typed API projections, read field by field
type Json = Record<string, any>;

async function call<T = Json>(path: string, method = "GET", body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Json;
  if (!res.ok)
    throw Object.assign(new Error(data.error ?? `Request failed (${res.status})`), {
      status: res.status,
    });
  return data as T;
}
const newKey = () => `help-${crypto.randomUUID()}`;
const STATE: Record<string, string> = {
  requested: "Requested",
  accepted: "Accepted",
  declined: "Declined",
  withdrawn: "Withdrawn",
  delivered: "Delivered (the expert's account)",
  completed: "Completed",
};
const ACTION: Record<string, string> = {
  accept: "Accept",
  decline: "Decline",
  withdraw: "Withdraw request",
  deliver: "Mark delivered",
  complete: "Confirm complete",
  reopen: "Needs more work",
};

function SignInFirst({ reason }: { reason: string }) {
  const { requireSignIn } = useSession();
  return (
    <div className="page empty">
      <h2>{reason}</h2>
      <button type="button" className="btn btn-primary" onClick={() => requireSignIn(reason)}>
        Sign in or join
      </button>
    </div>
  );
}

// ---------- directory ----------

export function ExpertsDirectory() {
  useRouter(); // re-render on navigation
  const params = new URLSearchParams(typeof window === "undefined" ? "" : window.location.search);
  const [skill, setSkill] = useState(params.get("skill") ?? "");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Json | null>(null);
  const [error, setError] = useState<string | null>(null);
  const uid = useId();
  const context = params.get("business")
    ? `?${new URLSearchParams({ business: params.get("business") ?? "", project: params.get("project") ?? "" })}`
    : "";
  useEffect(() => {
    const t = setTimeout(() => {
      const qs = new URLSearchParams({
        ...(skill ? { skill } : {}),
        ...(q ? { q } : {}),
        ...(open ? { capacity: "open" } : {}),
      });
      call(`/api/experts?${qs}`)
        .then((d) => {
          setData(d);
          setError(null);
        })
        .catch((e: Error) => setError(e.message));
    }, 200);
    return () => clearTimeout(t);
  }, [skill, q, open]);
  return (
    <div className="page">
      <p className="eyebrow">Build · Expert help</p>
      <h1 className="display" style={{ fontSize: 40 }}>
        Find expert help
      </h1>
      <p className="lead">
        People who offer help with AI products, in their own words. A request shares only what you
        choose, and accepting it gives an expert no access to your business.
      </p>
      <div className="row expert-filters" style={{ flexWrap: "wrap", gap: 12 }}>
        <label htmlFor={`${uid}-skill`} className="sr-only">
          Skill
        </label>
        <select
          id={`${uid}-skill`}
          className="input"
          value={skill}
          onChange={(e) => setSkill(e.target.value)}
        >
          <option value="">Any skill</option>
          {(data?.skills ?? []).map((s: Json) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
        <label htmlFor={`${uid}-q`} className="sr-only">
          Search what they offer
        </label>
        <input
          id={`${uid}-q`}
          className="input"
          placeholder="Search what they offer"
          value={q}
          maxLength={80}
          onChange={(e) => setQ(e.target.value)}
        />
        <label className="row" style={{ gap: 6 }}>
          <input type="checkbox" checked={open} onChange={(e) => setOpen(e.target.checked)} />{" "}
          Taking new work
        </label>
        <Link to="/expert-help" className="btn btn-quiet btn-sm">
          My requests and profile
        </Link>
      </div>
      {error && <p className="error">The directory couldn't be read ({error}).</p>}
      {data && <p className="muted small">{data.note}</p>}
      {data && data.experts.length === 0 && (
        <section className="card">
          <h2>No one matches yet</h2>
          <p className="muted">
            Try another skill or search. Profiles appear only when their owners publish them.
          </p>
        </section>
      )}
      <div className="expert-list">
        {(data?.experts ?? []).map((x: Json) => (
          <article key={x.person.id} className="card expert-card">
            <h2 style={{ marginTop: 0 }}>
              <Link to={`/experts/${x.person.id}${context}`}>{x.person.name}</Link>
            </h2>
            <p className="expert-headline">{x.headline}</p>
            <p className="small">{x.skills.map((s: Json) => s.label).join(" · ")}</p>
            <p className="small muted">
              {x.capacity === "open"
                ? "Taking new work"
                : x.capacity === "limited"
                  ? "Limited capacity"
                  : "Not taking new work"}{" "}
              ·{" "}
              {x.pricing.basis === "unknown"
                ? "Pricing not stated"
                : `Prices ${x.pricing.basis === "quote" ? "by quote" : x.pricing.basis}`}
            </p>
            {x.reasons.length > 0 && (
              <ul className="plain small">
                {x.reasons.map((r: string) => (
                  <li key={r}>Matched: {r}</li>
                ))}
              </ul>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}

// ---------- one expert, and the request form ----------

export function ExpertProfilePage({ id }: { id: string }) {
  const { person } = useSession();
  const { go } = useRouter();
  const params = new URLSearchParams(typeof window === "undefined" ? "" : window.location.search);
  const [x, setX] = useState<Json | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing">("loading");
  const [projects, setProjects] = useState<Json[]>([]);
  const [f, setF] = useState({
    title: "",
    task: "",
    outcome: "",
    deliverables: "",
    timing: "",
    budget_amount: "",
    budget_unit: "USD",
    business_id: params.get("business") ?? "",
    project_id: params.get("project") ?? "",
  });
  const [preview, setPreview] = useState<Json | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const keyRef = useRef<string | null>(null);
  const uid = useId();
  useEffect(() => {
    call(`/api/experts/${encodeURIComponent(id)}`)
      .then((d) => {
        setX(d);
        setState("ready");
      })
      .catch(() => setState("missing"));
  }, [id]);
  useEffect(() => {
    if (person)
      call<{ projects: Json[] }>("/api/product-projects")
        .then((d) => setProjects(d.projects ?? []))
        .catch(() => {});
  }, [person]);
  const body = () => ({
    expert_id: id,
    ...f,
    business_id: f.business_id || undefined,
    project_id: f.project_id || undefined,
    budget_amount: f.budget_amount === "" ? null : Number(f.budget_amount),
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => {
    setF({ ...f, [k]: e.target.value });
    setPreview(null);
    keyRef.current = null; // a changed request is a new request
  };
  if (state === "loading") return <div className="page muted">Loading…</div>;
  if (state === "missing" || !x)
    return (
      <div className="page empty">
        <h2>This profile isn't published</h2>
        <Link to="/experts">Back to expert help</Link>
      </div>
    );
  const businesses = [...new Map(projects.map((p) => [p.business_id, p])).values()];
  return (
    <div className="page narrow">
      <p className="eyebrow">
        <Link to="/experts">Expert help</Link>
      </p>
      <h1 className="display" style={{ fontSize: 36 }}>
        {x.person.name}
      </h1>
      <p className="lead">{x.headline}</p>
      <section className="card">
        <p style={{ whiteSpace: "pre-wrap" }}>{x.offer}</p>
        <dl className="source-dl">
          <dt>Skills</dt>
          <dd>{x.skills.map((s: Json) => s.label).join(", ")}</dd>
          <dt>Availability</dt>
          <dd>{x.availability || "Not stated"}</dd>
          <dt>Pricing</dt>
          <dd>
            {x.pricing.basis === "unknown" ? "Not stated" : x.pricing.basis}
            {x.pricing.note ? ` · ${x.pricing.note}` : ""}
          </dd>
          {x.work.length > 0 && (
            <>
              <dt>Their public work</dt>
              <dd>
                {x.work.map((w: Json) => (
                  <Link key={w.slug} to={`/b/${w.slug}`}>
                    {w.name}{" "}
                  </Link>
                ))}
              </dd>
            </>
          )}
        </dl>
        <p className="muted small">{x.self_reported}</p>
      </section>
      {!person ? (
        <SignInFirst reason="Sign in to ask for help" />
      ) : person.id === id ? (
        <p className="muted">
          This is your profile. <Link to="/expert-help">Edit it</Link>.
        </p>
      ) : (
        <section className="card" aria-labelledby={`${uid}-h`}>
          <h2 id={`${uid}-h`}>Ask for help</h2>
          <form
            className="help-form"
            onSubmit={(e) => {
              e.preventDefault();
              setBusy(true);
              setError(null);
              const go2 = async () => {
                if (!preview) {
                  setPreview((await call("/api/help-requests/preview", "POST", body())).shared);
                  return;
                }
                keyRef.current ??= newKey();
                const r = await call("/api/help-requests", "POST", {
                  ...body(),
                  idempotency_key: keyRef.current,
                });
                go(`/expert-help/${r.request.id}`);
              };
              go2()
                .catch((e2: Error) => setError(e2.message))
                .finally(() => setBusy(false));
            }}
          >
            <label htmlFor={`${uid}-t`}>Title</label>
            <input
              id={`${uid}-t`}
              className="input"
              maxLength={120}
              value={f.title}
              onChange={set("title")}
              required
            />
            <label htmlFor={`${uid}-task`}>The task</label>
            <textarea
              id={`${uid}-task`}
              className="input"
              rows={4}
              maxLength={2000}
              value={f.task}
              onChange={set("task")}
              required
            />
            <label htmlFor={`${uid}-o`}>The outcome you want (optional)</label>
            <textarea
              id={`${uid}-o`}
              className="input"
              rows={2}
              maxLength={2000}
              value={f.outcome}
              onChange={set("outcome")}
            />
            <label htmlFor={`${uid}-d`}>Deliverables (optional)</label>
            <input
              id={`${uid}-d`}
              className="input"
              maxLength={2000}
              value={f.deliverables}
              onChange={set("deliverables")}
            />
            <div className="grid-2">
              <div>
                <label htmlFor={`${uid}-b`}>Budget (optional, not an agreed price)</label>
                <input
                  id={`${uid}-b`}
                  className="input"
                  inputMode="decimal"
                  value={f.budget_amount}
                  onChange={set("budget_amount")}
                />
              </div>
              <div>
                <label htmlFor={`${uid}-u`}>In</label>
                <input
                  id={`${uid}-u`}
                  className="input"
                  maxLength={20}
                  value={f.budget_unit}
                  onChange={set("budget_unit")}
                />
              </div>
            </div>
            <label htmlFor={`${uid}-biz`}>About one of your businesses (optional)</label>
            <select
              id={`${uid}-biz`}
              className="input"
              value={f.business_id}
              onChange={(e) => {
                setF({ ...f, business_id: e.target.value, project_id: "" });
                setPreview(null);
                keyRef.current = null;
              }}
            >
              <option value="">No business context</option>
              {businesses.map((p) => (
                <option key={p.business_id} value={p.business_id}>
                  {p.business_name ?? p.business?.name ?? p.name ?? "Your business"}
                </option>
              ))}
            </select>
            {f.business_id && (
              <>
                <label htmlFor={`${uid}-pr`}>Product (optional)</label>
                <select
                  id={`${uid}-pr`}
                  className="input"
                  value={f.project_id}
                  onChange={set("project_id")}
                >
                  <option value="">No product</option>
                  {projects
                    .filter((p) => p.business_id === f.business_id)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name ?? p.head?.brief?.name ?? "Untitled product"}
                      </option>
                    ))}
                </select>
              </>
            )}
            {preview && (
              <section className="help-preview" aria-label="Exactly what the expert receives">
                <h3>Exactly what {x.person.name} receives</h3>
                <dl className="source-dl">
                  <dt>Title</dt>
                  <dd>{preview.title}</dd>
                  <dt>Task</dt>
                  <dd style={{ whiteSpace: "pre-wrap" }}>{preview.task}</dd>
                  {preview.outcome && (
                    <>
                      <dt>Outcome</dt>
                      <dd>{preview.outcome}</dd>
                    </>
                  )}
                  {preview.deliverables && (
                    <>
                      <dt>Deliverables</dt>
                      <dd>{preview.deliverables}</dd>
                    </>
                  )}
                  <dt>Budget</dt>
                  <dd>
                    {preview.budget
                      ? `${preview.budget.amount} ${preview.budget.unit} (${preview.budget.note})`
                      : "None stated"}
                  </dd>
                  <dt>Context</dt>
                  <dd>
                    {preview.context.business ? preview.context.business.name : "None"}
                    {preview.context.project ? ` · ${preview.context.project.name}` : ""}
                  </dd>
                </dl>
                <p className="small muted">{preview.not_shared}</p>
              </section>
            )}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {preview ? "Send this request" : "Preview what's shared"}
            </button>
          </form>
        </section>
      )}
    </div>
  );
}

// ---------- my requests and my profile ----------

function ProfileEditor() {
  const [d, setD] = useState<Json | null>(null);
  const [f, setF] = useState<Json | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const uid = useId();
  const load = useCallback(() => {
    call("/api/me/expert-profile").then((r) => {
      setD(r);
      const p = r.profile;
      setF({
        headline: p?.headline ?? "",
        offer: p?.offer ?? "",
        skills: (p?.skills ?? []).map((s: Json) => s.key),
        availability: p?.availability ?? "",
        capacity: p?.capacity ?? "open",
        pricing_basis: p?.pricing.basis ?? "unknown",
        pricing_note: p?.pricing.note ?? "",
        links: (p?.work ?? []).map((w: Json) => w.slug),
        version: p?.version ?? 0,
      });
    });
  }, []);
  useEffect(load, [load]);
  if (!d || !f) return null;
  const save = (e: { preventDefault: () => void }) => {
    e.preventDefault();
    call("/api/me/expert-profile", "PUT", f)
      .then(() => {
        setMsg("Saved. Only you see it until you publish.");
        load();
      })
      .catch((x: Error) => setMsg(x.message));
  };
  const state = d.profile?.state ?? "none";
  return (
    <section className="card" aria-labelledby={`${uid}-h`}>
      <h2 id={`${uid}-h`}>Your expert profile</h2>
      <p className="muted small">
        Optional.{" "}
        {state === "published"
          ? "Published: people can find it."
          : "Not published: only you see it."}{" "}
        What you write is shown as your own statement.
      </p>
      <form className="help-form" onSubmit={save}>
        <label htmlFor={`${uid}-hl`}>Headline</label>
        <input
          id={`${uid}-hl`}
          className="input"
          maxLength={120}
          value={f.headline}
          onChange={(e) => setF({ ...f, headline: e.target.value })}
        />
        <label htmlFor={`${uid}-of`}>What you offer</label>
        <textarea
          id={`${uid}-of`}
          className="input"
          rows={4}
          maxLength={1200}
          value={f.offer}
          onChange={(e) => setF({ ...f, offer: e.target.value })}
        />
        <fieldset>
          <legend>Skills</legend>
          {d.skills.map((s: Json) => (
            <label key={s.key} className="row" style={{ gap: 6 }}>
              <input
                type="checkbox"
                checked={f.skills.includes(s.key)}
                onChange={(e) =>
                  setF({
                    ...f,
                    skills: e.target.checked
                      ? [...f.skills, s.key]
                      : f.skills.filter((k: string) => k !== s.key),
                  })
                }
              />{" "}
              {s.label}
            </label>
          ))}
        </fieldset>
        <label htmlFor={`${uid}-av`}>Availability</label>
        <input
          id={`${uid}-av`}
          className="input"
          maxLength={200}
          value={f.availability}
          onChange={(e) => setF({ ...f, availability: e.target.value })}
        />
        <div className="grid-2">
          <div>
            <label htmlFor={`${uid}-cap`}>Capacity</label>
            <select
              id={`${uid}-cap`}
              className="input"
              value={f.capacity}
              onChange={(e) => setF({ ...f, capacity: e.target.value })}
            >
              <option value="open">Taking new work</option>
              <option value="limited">Limited</option>
              <option value="full">Not taking new work</option>
            </select>
          </div>
          <div>
            <label htmlFor={`${uid}-pb`}>Pricing</label>
            <select
              id={`${uid}-pb`}
              className="input"
              value={f.pricing_basis}
              onChange={(e) => setF({ ...f, pricing_basis: e.target.value })}
            >
              <option value="unknown">Not stated</option>
              <option value="fixed">Fixed</option>
              <option value="hourly">Hourly</option>
              <option value="quote">By quote</option>
            </select>
          </div>
        </div>
        <label htmlFor={`${uid}-pn`}>Pricing note (optional)</label>
        <input
          id={`${uid}-pn`}
          className="input"
          maxLength={200}
          value={f.pricing_note}
          onChange={(e) => setF({ ...f, pricing_note: e.target.value })}
        />
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <button type="submit" className="btn btn-primary">
            Save
          </button>
          {d.profile && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() =>
                call(
                  `/api/me/expert-profile/${state === "published" ? "unpublish" : "publish"}`,
                  "POST",
                )
                  .then(load)
                  .catch((x: Error) => setMsg(x.message))
              }
            >
              {state === "published" ? "Unpublish" : "Publish"}
            </button>
          )}
        </div>
        {msg && (
          <p className="notice info" role="status">
            {msg}
          </p>
        )}
      </form>
    </section>
  );
}

export function MyHelpRequests() {
  const { person } = useSession();
  const [list, setList] = useState<Json[] | null>(null);
  useEffect(() => {
    if (person)
      call<{ requests: Json[] }>("/api/help-requests")
        .then((d) => setList(d.requests))
        .catch(() => setList([]));
  }, [person]);
  if (!person) return <SignInFirst reason="Sign in to see your help requests" />;
  return (
    <div className="page narrow">
      <p className="eyebrow">Expert help</p>
      <h1 className="display" style={{ fontSize: 36 }}>
        Help requests
      </h1>
      <p>
        <Link to="/experts" className="btn btn-primary btn-sm">
          Find expert help
        </Link>
      </p>
      <section className="card">
        <h2>Your requests</h2>
        {list === null ? (
          <p className="muted">Loading…</p>
        ) : list.length === 0 ? (
          <p className="muted">None yet. Requests you send or receive appear here.</p>
        ) : (
          <ul className="plain help-list">
            {list.map((r) => (
              <li key={r.id}>
                <Link to={`/expert-help/${r.id}`}>{r.title}</Link> ·{" "}
                {r.role === "requester" ? `to ${r.with.name}` : `from ${r.with.name}`} ·{" "}
                {r.paused ? "Paused" : STATE[r.state]}
              </li>
            ))}
          </ul>
        )}
      </section>
      <ProfileEditor />
    </div>
  );
}

export function HelpRequestThread({ id }: { id: string }) {
  const { person } = useSession();
  const [r, setR] = useState<Json | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing">("loading");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const keys = useRef<Record<string, string>>({});
  const uid = useId();
  const load = useCallback(() => {
    call(`/api/help-requests/${encodeURIComponent(id)}`)
      .then((d) => {
        setR(d);
        setState("ready");
      })
      .catch(() => setState("missing"));
  }, [id]);
  useEffect(() => {
    if (person) load();
  }, [person, load]);
  if (!person) return <SignInFirst reason="Sign in to see this request" />;
  if (state === "loading") return <div className="page muted">Loading…</div>;
  if (state === "missing" || !r)
    return (
      <div className="page empty">
        <h2>This request isn't available to you</h2>
        <Link to="/expert-help">Your help requests</Link>
      </div>
    );
  const act = (kind: string, body = "") => {
    setBusy(true);
    setError(null);
    // One key per intended action and text, kept across a retry of a lost answer.
    const k = `${kind}:${body}`;
    keys.current[k] ??= newKey();
    call(`/api/help-requests/${encodeURIComponent(id)}/events`, "POST", {
      kind,
      body,
      idempotency_key: keys.current[k],
    })
      .then((d) => {
        setR(d.request);
        delete keys.current[k];
        if (kind === "message" || kind === "deliver") setText("");
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };
  const s = r.shared;
  return (
    <div className="page narrow">
      <p className="eyebrow">
        <Link to="/expert-help">Help requests</Link>
      </p>
      <h1 className="display" style={{ fontSize: 32 }}>
        {s.title}
      </h1>
      <p>
        <span className="pill">{r.paused ? "Paused" : STATE[r.state]}</span> {r.requester.name}{" "}
        asked {r.expert.name}
      </p>
      {r.paused && <p className="notice warn">{r.paused_reason}</p>}
      <section className="card">
        <h2>What was shared</h2>
        <p style={{ whiteSpace: "pre-wrap" }}>{s.task}</p>
        <dl className="source-dl">
          {s.outcome && (
            <>
              <dt>Outcome</dt>
              <dd>{s.outcome}</dd>
            </>
          )}
          {s.deliverables && (
            <>
              <dt>Deliverables</dt>
              <dd>{s.deliverables}</dd>
            </>
          )}
          <dt>Budget</dt>
          <dd>
            {s.budget ? `${s.budget.amount} ${s.budget.unit} (${s.budget.note})` : "None stated"}
          </dd>
          <dt>Context</dt>
          <dd>
            {s.context.business ? s.context.business.name : "None"}
            {s.context.project ? ` · ${s.context.project.name}` : ""}
          </dd>
        </dl>
        <p className="small muted">{r.authority}</p>
      </section>
      <section className="card" aria-labelledby={`${uid}-h`}>
        <h2 id={`${uid}-h`}>Thread</h2>
        <ol className="plain help-events">
          {r.events.map((e: Json) => (
            <li key={e.id}>
              <strong>{e.actor}</strong>{" "}
              {e.kind === "message"
                ? "wrote"
                : e.kind === "requested"
                  ? "sent the request"
                  : `· ${ACTION[e.kind] ?? e.kind}`}{" "}
              <span className="muted small">{new Date(e.created_at).toLocaleString()}</span>
              {e.body && <p style={{ whiteSpace: "pre-wrap", margin: "4px 0 0" }}>{e.body}</p>}
            </li>
          ))}
        </ol>
        {(r.can_message || r.actions.includes("deliver")) && (
          <>
            <label htmlFor={`${uid}-msg`}>
              {r.actions.includes("deliver") ? "Message, or what you delivered" : "Message"}
            </label>
            <textarea
              id={`${uid}-msg`}
              className="input"
              rows={3}
              maxLength={2000}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </>
        )}
        <div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 8 }}>
          {r.can_message && (
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || !text.trim()}
              onClick={() => act("message", text)}
            >
              Send message
            </button>
          )}
          {r.actions.map((a: string) => (
            <button
              key={a}
              type="button"
              className={
                a === "decline" || a === "withdraw" ? "btn btn-quiet" : "btn btn-secondary"
              }
              disabled={busy || (a === "deliver" && !text.trim())}
              onClick={() => act(a, a === "deliver" ? text : "")}
            >
              {ACTION[a]}
            </button>
          ))}
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </section>
    </div>
  );
}
