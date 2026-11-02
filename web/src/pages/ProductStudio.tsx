// The product studio workspace for one project: a compact header with the save state and one
// next action, a step rail, brief and screen controls on the left, and the working canvas
// (Preview, Brief, Checks, Versions, Continuity). Saved work lives on the server as immutable
// revisions; unsaved edits are also kept in this browser so a refresh or crash never loses
// them, and a save from an outdated revision is refused rather than overwriting newer work.

import { type KeyboardEvent, type ReactNode, useCallback, useEffect, useState } from "react";
import { ApiError } from "../api.ts";
import { FOUNDATION_ICON, Icon } from "../icons.tsx";
import {
  ago,
  type Brief,
  type CheckState,
  type KnownState,
  PRICE_LABEL,
  type PriceModel,
  type Prototype,
  priceText,
  productsApi,
  type Revision,
  type StudioView,
} from "../productsApi.ts";
import { Link, useRouter } from "../router.tsx";
import { useSession } from "../session.tsx";
import { emptySample, PrototypeEditor, PrototypePreview, type SampleState } from "./Prototype.tsx";

type Tab = "preview" | "brief" | "checks" | "versions" | "continuity";
type Content = { brief: Brief; prototype: Prototype };
interface LocalDraft extends Content {
  base: number;
  at: string;
}

const TABS: { id: Tab; label: string }[] = [
  { id: "preview", label: "Preview" },
  { id: "brief", label: "Brief" },
  { id: "checks", label: "Checks" },
  { id: "versions", label: "Versions" },
  { id: "continuity", label: "Continuity" },
];

/** Stable JSON: same content, same string, whatever the key order. */
function canon(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canon).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canon((value as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

const draftKey = (id: string) => `everstreet.product-draft.${id}`;

function readLocal(id: string): LocalDraft | null {
  try {
    const raw = window.localStorage.getItem(draftKey(id));
    return raw ? (JSON.parse(raw) as LocalDraft) : null;
  } catch {
    return null;
  }
}

function StateIcon({ state }: { state: CheckState | KnownState }) {
  const word: Record<string, string> = {
    pass: "Passed",
    ok: "In place",
    todo: "To do",
    missing: "Missing",
    unavailable: "Not available",
    unknown: "Unknown",
    manual: "Checked by you",
    assumption: "Assumption",
    known: "Known",
  };
  return (
    <span className={`state-icon ${state}`} title={word[state]}>
      {state === "pass" || state === "ok" ? (
        <Icon name="check" />
      ) : state === "manual" || state === "assumption" || state === "known" ? (
        <Icon name="dot" />
      ) : null}
      <span className="sr-only">{word[state]}</span>
    </span>
  );
}

// ---------- left panel: brief controls ----------

function MiniField({
  id,
  label,
  extra,
  children,
}: {
  id: string;
  label: string;
  extra?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mini-field">
      <label className="mini-label" htmlFor={id}>
        <span>{label}</span>
        {extra}
      </label>
      {children}
    </div>
  );
}

function MoneyInput({
  cents,
  onChange,
  id,
}: {
  cents: number | null;
  onChange: (c: number | null) => void;
  id: string;
}) {
  const fromCents = cents === null ? "" : String(cents / 100);
  const [text, setText] = useState(fromCents);
  useEffect(() => {
    setText((t) => {
      const parsed = t.trim() === "" ? null : Math.round(Number(t) * 100);
      return parsed === cents ? t : fromCents;
    });
  }, [cents, fromCents]);
  return (
    <input
      id={id}
      className="input"
      inputMode="decimal"
      value={text}
      placeholder="0.00"
      aria-describedby={`${id}-hint`}
      onChange={(e) => {
        const v = e.target.value;
        setText(v);
        if (v.trim() === "") return onChange(null);
        const n = Number(v);
        if (Number.isFinite(n) && n >= 0) onChange(Math.round(n * 100));
      }}
    />
  );
}

function BriefEditor({
  brief,
  starter,
  onChange,
}: {
  brief: Brief;
  starter: boolean;
  onChange: (b: Brief) => void;
}) {
  const set = (patch: Partial<Brief>) => onChange({ ...brief, ...patch });
  const needsAmount = brief.price.model !== "free" && brief.price.model !== "undecided";
  return (
    <div>
      <MiniField id="brief-name" label="Product name">
        <input
          id="brief-name"
          className="input"
          maxLength={80}
          value={brief.name}
          onChange={(e) => set({ name: e.target.value })}
        />
      </MiniField>
      <MiniField id="brief-audience" label="Who it's for">
        <textarea
          id="brief-audience"
          className="input"
          maxLength={600}
          value={brief.audience}
          placeholder="The people who would use and pay for it"
          onChange={(e) => set({ audience: e.target.value })}
        />
      </MiniField>
      <MiniField id="brief-problem" label="Problem">
        <textarea
          id="brief-problem"
          className="input"
          maxLength={600}
          value={brief.problem}
          placeholder="What goes wrong for them today"
          onChange={(e) => set({ problem: e.target.value })}
        />
      </MiniField>
      <MiniField id="brief-promise" label="Promised result">
        <textarea
          id="brief-promise"
          className="input"
          maxLength={600}
          value={brief.promise}
          placeholder="What a customer can count on getting"
          onChange={(e) => set({ promise: e.target.value })}
        />
      </MiniField>
      <div className="mini-field">
        <div className="mini-label">
          <span>Core features</span>
          {starter && <span className="starter-tag">Starter suggestions</span>}
        </div>
        <div className="list-edit">
          {brief.features.map((feature, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: features are edited in place; position is their identity
            <div className="item" key={i}>
              <input
                className="input"
                aria-label={`Feature ${i + 1}`}
                maxLength={140}
                value={feature}
                onChange={(e) =>
                  set({ features: brief.features.map((x, j) => (j === i ? e.target.value : x)) })
                }
              />
              <button
                type="button"
                className="btn btn-danger btn-icon"
                aria-label={`Remove feature ${i + 1}`}
                onClick={() => set({ features: brief.features.filter((_, j) => j !== i) })}
              >
                <Icon name="x" size="sm" />
              </button>
            </div>
          ))}
          <button
            id="brief-feature-add"
            type="button"
            className="btn btn-quiet btn-sm"
            style={{ justifySelf: "start" }}
            disabled={brief.features.length >= 8}
            onClick={() => set({ features: [...brief.features, ""] })}
          >
            <Icon name="plus" size="sm" /> Add feature
          </button>
        </div>
      </div>
      <div className="mini-field">
        <span className="mini-label">Pricing assumption</span>
        <fieldset className="seg wrap">
          <legend className="sr-only">Pricing model</legend>
          {(Object.keys(PRICE_LABEL) as PriceModel[]).map((m, i) => (
            <button
              key={m}
              id={i === 0 ? "brief-price" : undefined}
              type="button"
              aria-pressed={brief.price.model === m}
              onClick={() => set({ price: { ...brief.price, model: m } })}
            >
              {PRICE_LABEL[m]}
            </button>
          ))}
        </fieldset>
        {needsAmount && (
          <div className="grid-2" style={{ gap: 8, marginTop: 6 }}>
            <MoneyInput
              id="brief-amount"
              cents={brief.price.amount_cents}
              onChange={(amount_cents) => set({ price: { ...brief.price, amount_cents } })}
            />
            <span
              id="brief-amount-hint"
              className="muted"
              style={{ fontSize: 12.5, alignSelf: "center" }}
            >
              US dollars{" "}
              {{ per_use: "per use", monthly: "per month", one_time: "once" }[
                brief.price.model as "per_use"
              ] ?? ""}
            </span>
          </div>
        )}
        <input
          className="input"
          aria-label="Pricing note"
          style={{ marginTop: 6 }}
          maxLength={600}
          value={brief.price.note}
          placeholder="Note, e.g. prepaid packs of 100"
          onChange={(e) => set({ price: { ...brief.price, note: e.target.value } })}
        />
      </div>
    </div>
  );
}

// ---------- canvas views ----------

function BriefDoc({ view, brief, starter }: { view: StudioView; brief: Brief; starter: boolean }) {
  const none = <em className="unknown">Not decided yet</em>;
  const price = priceText(brief.price);
  return (
    <article className="doc" aria-label="Product brief">
      <div className="eyebrow">{view.foundation.label} · product brief</div>
      <h2>{brief.name}</h2>
      <p className="lede">{brief.promise || <em className="unknown">No promised result yet</em>}</p>
      <dl className="doc-grid">
        <dt>For</dt>
        <dd>{brief.audience || none}</dd>
        <dt>Problem</dt>
        <dd>{brief.problem || none}</dd>
        <dt>Core features</dt>
        <dd>
          {brief.features.filter(Boolean).length ? (
            <>
              <ul>
                {brief.features.filter(Boolean).map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              {starter && (
                <span className="starter-tag">
                  Starter suggestions from {view.foundation.label}
                </span>
              )}
            </>
          ) : (
            none
          )}
        </dd>
        <dt>Pricing assumption</dt>
        <dd>
          {price ?? none}
          {brief.price.note && <span className="muted"> · {brief.price.note}</span>}
          <div className="muted" style={{ fontSize: 13 }}>
            An assumption to test, not a published price.
          </div>
        </dd>
        <dt>Foundation</dt>
        <dd>
          {view.foundation.label}: {view.foundation.summary}
        </dd>
        <dt>Where it started</dt>
        <dd className="muted">“{view.project.idea}”</dd>
      </dl>
    </article>
  );
}

function ChecksView({ view, dirty }: { view: StudioView; dirty: boolean }) {
  const c = view.checks;
  return (
    <div style={{ maxWidth: 860 }}>
      {dirty && (
        <p className="notice info">
          Checks run on the saved revision {view.head.number}. Save to check your latest changes.
        </p>
      )}
      <section className="check-group">
        <h3>
          <Icon name="check" /> Checked automatically · {c.passed} of {c.deterministic.length}
        </h3>
        <p>Rules applied to the brief and prototype of revision {view.head.number}.</p>
        {c.deterministic.map((d) => (
          <div className="check-row" key={d.id}>
            <StateIcon state={d.state} />
            <span>
              {d.label}
              {d.detail && <div className="detail">{d.detail}</div>}
            </span>
            <span className={`pill ${d.state === "pass" ? "mint" : "caution"}`}>
              {d.state === "pass" ? "Passed" : "To do"}
            </span>
          </div>
        ))}
      </section>
      <div className="grid-2" style={{ gap: 12 }}>
        <section className="check-group">
          <h3>
            <Icon name="spark" /> Model evaluations
          </h3>
          <div className="check-row">
            <StateIcon state={c.model_evaluations.state} />
            <span className="detail">{c.model_evaluations.detail}</span>
            <span className="pill">Not available</span>
          </div>
        </section>
        <section className="check-group">
          <h3>
            <Icon name="user" /> Customer journey tests
          </h3>
          <div className="check-row">
            <StateIcon state={c.journey_tests.state} />
            <span className="detail">{c.journey_tests.detail}</span>
            <span className="pill">Not available</span>
          </div>
        </section>
      </div>
      <div className="grid-2" style={{ gap: 12 }}>
        <section className="check-group">
          <h3>
            <Icon name="eye" /> Check yourself
          </h3>
          <p>Not tracked by Everstreet.</p>
          {c.manual.map((m) => (
            <div className="check-row" key={m.label}>
              <StateIcon state={m.state} />
              <span>{m.label}</span>
              <span />
            </div>
          ))}
        </section>
        <section className="check-group">
          <h3>
            <Icon name="compass" /> Still unknown
          </h3>
          {c.unknowns.map((u) => (
            <div className="check-row" key={u}>
              <StateIcon state="unknown" />
              <span>{u}</span>
              <span />
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}

function differences(a: Content, b: Content): string[] {
  const out: string[] = [];
  const fields: [keyof Brief, string][] = [
    ["name", "Name"],
    ["audience", "Audience"],
    ["problem", "Problem"],
    ["promise", "Promised result"],
  ];
  for (const [k, label] of fields) if (canon(a.brief[k]) !== canon(b.brief[k])) out.push(label);
  if (canon(a.brief.features) !== canon(b.brief.features)) out.push("Core features");
  if (canon(a.brief.price) !== canon(b.brief.price)) out.push("Pricing assumption");
  const titles = (p: Prototype) => p.screens.map((s) => s.title).join(", ");
  if (canon(a.prototype) !== canon(b.prototype))
    out.push(
      titles(a.prototype) === titles(b.prototype)
        ? "Prototype screens (fields or settings)"
        : `Prototype screens: ${titles(a.prototype)} → ${titles(b.prototype)}`,
    );
  return out;
}

function VersionsView({
  view,
  dirty,
  busy,
  onRestore,
}: {
  view: StudioView;
  dirty: boolean;
  busy: boolean;
  onRestore: (n: number) => void;
}) {
  const head = view.head.number;
  const [selected, setSelected] = useState(head);
  const [loaded, setLoaded] = useState<Revision | null>(view.head);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setSelected(head), [head]);
  useEffect(() => {
    if (selected === view.head.number) {
      setLoaded(view.head);
      return;
    }
    setLoaded(null);
    setError(null);
    productsApi
      .revision(view.project.id, selected)
      .then(setLoaded)
      .catch((e) => setError((e as Error).message));
  }, [selected, view.head, view.project.id]);
  const changes = loaded && selected !== head ? differences(loaded, view.head) : [];
  return (
    <div className="versions">
      <div className="version-list">
        {view.revisions.map((r) => (
          <button
            key={r.number}
            type="button"
            className="version-item"
            aria-pressed={selected === r.number}
            onClick={() => setSelected(r.number)}
          >
            <span className="v-top">
              Revision {r.number}
              {r.number === head && <span className="pill mint">Current</span>}
              {r.restored_from !== null && <span className="pill">from {r.restored_from}</span>}
            </span>
            <span style={{ fontSize: 13.5 }}>{r.note}</span>
            <span className="v-meta">
              {r.author} · {ago(r.created_at)}
            </span>
          </button>
        ))}
      </div>
      <div className="check-group" style={{ margin: 0 }}>
        {error && <p className="error-text">{error}</p>}
        {!loaded && !error && <p className="muted">Loading revision {selected}…</p>}
        {loaded && (
          <>
            <h3 style={{ fontSize: 17 }}>Revision {loaded.number}</h3>
            <p className="muted" style={{ fontSize: 13.5 }}>
              {loaded.note} · {loaded.author} · {new Date(loaded.created_at).toLocaleString()}
            </p>
            <dl className="doc-grid" style={{ marginTop: 8 }}>
              <dt>Name</dt>
              <dd>{loaded.brief.name}</dd>
              <dt>Promised result</dt>
              <dd>{loaded.brief.promise || <em className="unknown">Not stated</em>}</dd>
              <dt>Features</dt>
              <dd>{loaded.brief.features.length}</dd>
              <dt>Price</dt>
              <dd>{priceText(loaded.brief.price) ?? <em className="unknown">Not decided</em>}</dd>
              <dt>Screens</dt>
              <dd>{loaded.prototype.screens.map((s) => s.title).join(", ")}</dd>
              <dt>Fingerprint</dt>
              <dd className="mono" title={loaded.content_hash}>
                {loaded.content_hash.slice(0, 12)}
              </dd>
            </dl>
            {selected === head ? (
              <p className="notice ok" style={{ marginTop: 16 }}>
                This is the current revision.
              </p>
            ) : (
              <>
                <h4 style={{ fontSize: 14, marginTop: 18 }}>
                  Compared with the current revision {head}
                </h4>
                {changes.length ? (
                  <ul className="diff-list">
                    {changes.map((c) => (
                      <li key={c}>{c} differs</li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted">Same content as the current revision.</p>
                )}
                <div className="row" style={{ marginTop: 16 }}>
                  <button
                    type="button"
                    className="btn btn-dark"
                    disabled={dirty || busy}
                    onClick={() => onRestore(selected)}
                  >
                    <Icon name="history" size="sm" /> Restore as revision {head + 1}
                  </button>
                  <span className="muted" style={{ fontSize: 13 }}>
                    {dirty
                      ? "Save or discard your unsaved changes first."
                      : "Nothing is deleted: the restore becomes a new revision."}
                  </span>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function ContinuityView({ view }: { view: StudioView }) {
  const group = (
    title: string,
    icon: Parameters<typeof Icon>[0]["name"],
    rows: StudioView["continuity"]["promises"],
  ) => (
    <section className="check-group">
      <h3>
        <Icon name={icon} /> {title}
      </h3>
      {rows.map((r) => (
        <div className="cont-row" key={r.label}>
          <StateIcon state={r.state} />
          <span>
            <strong>{r.label}</strong>
            <span className="detail">{r.detail}</span>
          </span>
        </div>
      ))}
    </section>
  );
  return (
    <div>
      <p className="muted" style={{ maxWidth: "75ch" }}>
        What would carry over to customers and a future owner, as known today. Missing stays
        missing; assumptions are labelled.
      </p>
      <div className="continuity">
        {group("Customer promises", "shield", view.continuity.promises)}
        {group("Dependencies", "plug", view.continuity.dependencies)}
        {group("Transfer readiness", "handshake", view.continuity.transfer)}
      </div>
    </div>
  );
}

// ---------- the workspace ----------

export function ProductStudio({ id }: { id: string }) {
  const { person, requireSignIn } = useSession();
  const { go } = useRouter();
  const [view, setView] = useState<StudioView | null>(null);
  const [loadError, setLoadError] = useState<{ status: number; message: string } | null>(null);
  const [draft, setDraft] = useState<Content | null>(null);
  const [base, setBase] = useState(0);
  const [note, setNote] = useState("");
  const [tab, setTab] = useState<Tab>("preview");
  const [side, setSide] = useState<"brief" | "screens">("brief");
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<{ message: string; conflict: boolean } | null>(null);
  const [offered, setOffered] = useState<LocalDraft | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [sample, setSample] = useState<SampleState>(emptySample);

  const adopt = useCallback((v: StudioView) => {
    setView(v);
    setDraft({ brief: v.head.brief, prototype: v.head.prototype });
    setBase(v.head.number);
  }, []);

  const load = useCallback(() => {
    setLoadError(null);
    return productsApi
      .get(id)
      .then((v) => {
        adopt(v);
        const local = readLocal(id);
        if (
          local &&
          canon({ brief: local.brief, prototype: local.prototype }) !==
            canon({ brief: v.head.brief, prototype: v.head.prototype })
        )
          setOffered(local);
        else window.localStorage.removeItem(draftKey(id));
      })
      .catch((e) =>
        setLoadError({
          status: e instanceof ApiError ? e.status : 0,
          message: (e as Error).message,
        }),
      );
  }, [id, adopt]);

  useEffect(() => {
    if (person) load();
  }, [person, load]);

  const dirty = Boolean(
    view &&
      draft &&
      canon(draft) !== canon({ brief: view.head.brief, prototype: view.head.prototype }),
  );

  // Keep unsaved edits in this browser until they are saved or discarded.
  useEffect(() => {
    if (!view || !draft || offered) return;
    if (dirty)
      window.localStorage.setItem(
        draftKey(id),
        JSON.stringify({ ...draft, base, at: new Date().toISOString() } satisfies LocalDraft),
      );
    else window.localStorage.removeItem(draftKey(id));
  }, [view, draft, dirty, base, id, offered]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  useEffect(() => {
    if (!flash) return;
    const t = window.setTimeout(() => setFlash(null), 5000);
    return () => window.clearTimeout(t);
  }, [flash]);

  const save = async () => {
    if (!draft || busy || !dirty) return;
    setBusy(true);
    setSaveError(null);
    try {
      const v = await productsApi.save(id, { base_revision: base, ...draft, note: note.trim() });
      adopt(v);
      setNote("");
      window.localStorage.removeItem(draftKey(id));
      setFlash(
        v.created
          ? `Saved as revision ${v.head.number}.`
          : `Nothing changed since revision ${v.head.number}.`,
      );
    } catch (e) {
      setSaveError({
        message: (e as Error).message,
        conflict: e instanceof ApiError && e.status === 409,
      });
    } finally {
      setBusy(false);
    }
  };

  const restore = async (n: number) => {
    setBusy(true);
    setSaveError(null);
    try {
      const v = await productsApi.restore(id, n, base);
      adopt(v);
      setFlash(
        v.created
          ? `Restored revision ${n} as revision ${v.head.number}.`
          : `Revision ${n} has the same content as the current revision.`,
      );
    } catch (e) {
      setSaveError({
        message: (e as Error).message,
        conflict: e instanceof ApiError && e.status === 409,
      });
    } finally {
      setBusy(false);
    }
  };

  const focusField = (fieldId: string, panel: "brief" | "screens" = "brief") => {
    setSide(panel);
    window.setTimeout(() => {
      const el = document.getElementById(fieldId);
      el?.focus();
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 0);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      save();
    }
  };

  if (!person)
    return (
      <div className="page empty">
        <h2>Sign in to open this project</h2>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => requireSignIn("Sign in to open your product project.")}
        >
          Sign in or join
        </button>
      </div>
    );
  if (loadError)
    return (
      <div className="page empty">
        <h2>
          {loadError.status === 404
            ? "This project doesn't exist, or it belongs to someone else's business"
            : loadError.message}
        </h2>
        <div className="row" style={{ justifyContent: "center" }}>
          {loadError.status !== 404 && (
            <button type="button" className="btn btn-secondary" onClick={() => load()}>
              Try again
            </button>
          )}
          <Link to="/build" className="btn btn-primary">
            Product studio
          </Link>
        </div>
      </div>
    );
  if (!view || !draft) return <div className="page muted">Loading project…</div>;

  const brief = draft.brief;
  const starter =
    brief.features.length === view.foundation.features.length &&
    view.foundation.features.every((f, i) => brief.features[i] === f);
  const todo = view.checks.deterministic.find((c) => c.state === "todo");
  const total = view.checks.deterministic.length;
  const shapeDone = view.checks.deterministic
    .filter((c) => ["name", "audience", "problem", "promise", "features"].includes(c.id))
    .every((c) => c.state === "pass");
  const todoTarget: Record<string, [string, "brief" | "screens"]> = {
    name: ["brief-name", "brief"],
    audience: ["brief-audience", "brief"],
    problem: ["brief-problem", "brief"],
    promise: ["brief-promise", "brief"],
    features: ["brief-feature-add", "brief"],
    price: ["brief-price", "brief"],
    input: ["screens-panel", "screens"],
  };

  const steps: {
    key: string;
    label: string;
    detail: string;
    state: "done" | "open" | "blocked";
    current: boolean;
    act: () => void;
  }[] = [
    {
      key: "shape",
      label: "Shape",
      detail: shapeDone ? "Brief in place" : "Brief to finish",
      state: shapeDone ? "done" : "open",
      current: tab === "brief",
      act: () => {
        setTab("brief");
        setSide("brief");
      },
    },
    {
      key: "choose",
      label: "Choose",
      detail: view.foundation.label,
      state: "done",
      current: false,
      act: () => setTab("brief"),
    },
    {
      key: "build",
      label: "Build",
      detail: view.build.available ? "Ready" : "Not connected",
      state: "blocked",
      current: tab === "preview",
      act: () => setTab("preview"),
    },
    {
      key: "test",
      label: "Test",
      detail: `${view.checks.passed}/${total} checks`,
      state: view.checks.passed === total ? "done" : "open",
      current: tab === "checks",
      act: () => setTab("checks"),
    },
    {
      key: "prepare",
      label: "Prepare",
      detail: "Continuity",
      state: "open",
      current: tab === "continuity",
      act: () => setTab("continuity"),
    },
    {
      key: "launch",
      label: "Launch",
      detail: "Business desk",
      state: view.business.published_at ? "done" : "open",
      current: false,
      act: () => go(`/desk/${view.business.id}`),
    },
  ];

  const onTabKey = (e: KeyboardEvent, i: number) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const next = TABS[(i + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length];
    if (!next) return;
    setTab(next.id);
    document.getElementById(`tab-${next.id}`)?.focus();
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: listens for the save shortcut from any field inside
    <div className="ps" onKeyDown={onKeyDown}>
      <header className="ps-head">
        <span className="glyph dark">
          <Icon name={FOUNDATION_ICON[view.project.foundation] ?? "layers"} />
        </span>
        <div style={{ minWidth: 0 }}>
          <div className="crumbs">
            <Link to="/build">Product studio</Link>
            <span aria-hidden="true">/</span>
            <Link to={`/desk/${view.business.id}`}>{view.business.name}</Link>
          </div>
          <h1>{brief.name || "Untitled product"}</h1>
        </div>
        <span className="pill">{view.foundation.label}</span>
        <span className="pill caution">Prototype</span>
        <span className="spacer" />
        <span className={`save-state${dirty ? " dirty" : ""}`} aria-live="polite">
          <span className="dot" />
          {dirty
            ? "Unsaved changes, kept in this browser"
            : `Revision ${view.head.number} · saved ${ago(view.head.created_at)}`}
        </span>
        {dirty ? (
          <button type="button" className="btn btn-primary" disabled={busy} onClick={save}>
            {busy ? "Saving…" : `Save revision ${view.head.number + 1}`}
          </button>
        ) : todo ? (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              const [target, panel] = todoTarget[todo.id] ?? ["brief-name", "brief"];
              focusField(target, panel);
            }}
          >
            Next: {todo.detail} <Icon name="arrowRight" size="sm" />
          </button>
        ) : (
          <button type="button" className="btn btn-primary" onClick={() => setTab("continuity")}>
            Next: review continuity <Icon name="arrowRight" size="sm" />
          </button>
        )}
      </header>

      {offered && (
        <div className="banner info" role="alert">
          <Icon name="history" />
          <span>
            This browser kept unsaved changes from {ago(offered.at)}, started from revision{" "}
            {offered.base}
            {offered.base !== view.head.number
              ? ` (the project is now at ${view.head.number})`
              : ""}
            .
          </span>
          <span className="spacer" />
          <button
            type="button"
            className="btn btn-dark btn-sm"
            onClick={() => {
              setDraft({ brief: offered.brief, prototype: offered.prototype });
              setBase(view.head.number);
              setOffered(null);
            }}
          >
            Bring them back
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => {
              window.localStorage.removeItem(draftKey(id));
              setOffered(null);
            }}
          >
            Discard
          </button>
        </div>
      )}
      {saveError && (
        <div className="banner error" role="alert">
          <span>{saveError.message}</span>
          <span className="spacer" />
          {saveError.conflict && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                setSaveError(null);
                load();
              }}
            >
              Load the latest revision
            </button>
          )}
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => setSaveError(null)}>
            Dismiss
          </button>
        </div>
      )}
      {flash && (
        <div className="banner ok" aria-live="polite">
          <Icon name="check" /> {flash}
        </div>
      )}

      <div className="ps-body">
        <nav className="ps-steps" aria-label="Project steps">
          <div className="label">Steps</div>
          {steps.map((s) => (
            <button
              key={s.key}
              type="button"
              className={`ps-step${s.current ? " current" : ""}`}
              aria-current={s.current ? "step" : undefined}
              onClick={s.act}
            >
              <span className={`marker ${s.state}`}>
                {s.state === "done" && <Icon name="check" />}
              </span>
              <strong>{s.label}</strong>
              <small>{s.detail}</small>
            </button>
          ))}
        </nav>

        <aside className="ps-side" aria-label="Brief and screens">
          <div className="ps-side-scroll">
            <div className="build-card">
              <div className="row">
                <Icon name="spark" />
                <strong style={{ fontSize: 14 }}>AI generation</strong>
                <span className="spacer" />
                <span className={`pill ${view.build.available ? "mint" : ""}`}>
                  {view.build.available ? "Connected" : "Not connected"}
                </span>
              </div>
              <p>{view.build.reason}</p>
            </div>
            <fieldset className="seg">
              <legend className="sr-only">Edit</legend>
              <button
                type="button"
                aria-pressed={side === "brief"}
                onClick={() => setSide("brief")}
              >
                Brief
              </button>
              <button
                id="screens-panel"
                type="button"
                aria-pressed={side === "screens"}
                onClick={() => setSide("screens")}
              >
                Screens · {draft.prototype.screens.length}
              </button>
            </fieldset>
            {side === "brief" ? (
              <BriefEditor
                brief={brief}
                starter={starter}
                onChange={(b) => setDraft({ ...draft, brief: b })}
              />
            ) : (
              <PrototypeEditor
                prototype={draft.prototype}
                onChange={(p) => {
                  setDraft({ ...draft, prototype: p });
                  setTab("preview");
                }}
              />
            )}
          </div>
          <div className="ps-savebar">
            <input
              className="input"
              aria-label="What changed (optional)"
              placeholder="What changed? (optional)"
              maxLength={200}
              value={note}
              disabled={!dirty}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") save();
              }}
            />
            <div className="row" style={{ gap: 8 }}>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!dirty || busy}
                onClick={save}
              >
                {busy ? "Saving…" : "Save revision"}
              </button>
              {dirty && (
                <button
                  type="button"
                  className="btn btn-quiet btn-sm"
                  onClick={() => {
                    if (window.confirm("Discard your unsaved changes? Saved revisions stay."))
                      adopt(view);
                  }}
                >
                  Discard changes
                </button>
              )}
              <span className="spacer" />
              <span className="muted" style={{ fontSize: 12 }}>
                <kbd>Ctrl</kbd> + <kbd>S</kbd>
              </span>
            </div>
          </div>
        </aside>

        <section className="ps-canvas" aria-label="Canvas">
          <div className="tabs" role="tablist" aria-label="Project views">
            {TABS.map((t, i) => (
              <button
                key={t.id}
                id={`tab-${t.id}`}
                type="button"
                role="tab"
                className="tab"
                aria-selected={tab === t.id}
                aria-controls="ps-view"
                tabIndex={tab === t.id ? 0 : -1}
                onClick={() => setTab(t.id)}
                onKeyDown={(e) => onTabKey(e, i)}
              >
                {t.label}
                {t.id === "checks" && (
                  <span className="badge">
                    {view.checks.passed}/{total}
                  </span>
                )}
                {t.id === "versions" && <span className="badge">{view.revisions.length}</span>}
              </button>
            ))}
          </div>
          <div className="ps-view" id="ps-view" role="tabpanel" aria-labelledby={`tab-${tab}`}>
            {tab === "preview" && (
              <>
                {dirty && (
                  <p className="notice info">
                    Showing your unsaved changes. Save to keep them as revision{" "}
                    {view.head.number + 1}.
                  </p>
                )}
                <PrototypePreview
                  name={brief.name || "Untitled product"}
                  prototype={draft.prototype}
                  sample={sample}
                  setSample={setSample}
                />
              </>
            )}
            {tab === "brief" && <BriefDoc view={view} brief={brief} starter={starter} />}
            {tab === "checks" && <ChecksView view={view} dirty={dirty} />}
            {tab === "versions" && (
              <VersionsView view={view} dirty={dirty} busy={busy} onRestore={restore} />
            )}
            {tab === "continuity" && <ContinuityView view={view} />}
          </div>
        </section>
      </div>
    </div>
  );
}
