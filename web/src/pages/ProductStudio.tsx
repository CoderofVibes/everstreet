// The product studio workspace for one project: a compact header with the save state and one
// next action, a step rail, brief and screen controls on the left, and the working canvas
// (Preview, Brief, Checks, Versions, Continuity). Saved work lives on the server as immutable
// revisions; unsaved edits are also kept in this browser so a refresh or crash never loses
// them, and a save from an outdated revision is refused rather than overwriting newer work.

import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useReducer,
  useState,
} from "react";
import { ApiError } from "../api.ts";
import { FOUNDATION_ICON, Icon } from "../icons.tsx";
import {
  ago,
  type Brief,
  type CheckState,
  type KnownState,
  PRICE_LABEL,
  type PriceModel,
  type ProposalDetail,
  type Prototype,
  priceText,
  productsApi,
  type StudioView,
} from "../productsApi.ts";
import { historyReducer, initialHistory, shownRevision } from "../revisionHistory.ts";
import { Link, useRouter } from "../router.tsx";
import { useSession } from "../session.tsx";
import { type Prefill, prefillFor, studioScope } from "../studioScope.ts";
import { BuildsView } from "./Builds.tsx";
import { ConversationPanel } from "./Conversation.tsx";
import { emptySample, PrototypeEditor, PrototypePreview, type SampleState } from "./Prototype.tsx";
import { ServiceView } from "./Service.tsx";

type Tab =
  | "preview"
  | "proposal"
  | "brief"
  | "checks"
  | "versions"
  | "builds"
  | "service"
  | "continuity";
type Content = { brief: Brief; prototype: Prototype };
interface LocalDraft extends Content {
  base: number;
  at: string;
}

const TABS: { id: Tab; label: string }[] = [
  { id: "preview", label: "Preview" },
  { id: "proposal", label: "Proposal" },
  { id: "brief", label: "Brief" },
  { id: "checks", label: "Checks" },
  { id: "versions", label: "Versions" },
  { id: "builds", label: "Builds" },
  { id: "service", label: "Service" },
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

/**
 * Unsaved edits are kept per person, project and owner epoch: another person signed in on the
 * same browser, or the next owner after a sale, is never offered someone else's unaccepted
 * edits. (The earlier project-only key cannot be attributed to anyone, so it is not offered.)
 */
const draftKey = (personId: string, projectId: string, ownerEpoch: string) =>
  `everstreet.product-draft.v2.${personId}.${projectId}.${ownerEpoch}`;
const legacyDraftKey = (projectId: string) => `everstreet.product-draft.${projectId}`;

function readLocal(key: string): LocalDraft | null {
  try {
    const raw = window.localStorage.getItem(key);
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
          <Icon name="check" /> Brief checks · {c.passed} of {c.deterministic.length} rules met
        </h3>
        <p>
          Rules that check whether the brief and prototype of revision {view.head.number} say
          enough. They do not test a product: no build exists yet.
        </p>
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
  const projectId = view.project.id;
  const [history, dispatch] = useReducer(historyReducer, null, () =>
    initialHistory(projectId, view.head),
  );
  useEffect(() => dispatch({ type: "head", head: view.head }), [view.head]);
  const shown = shownRevision(history);
  const selected = shown.number;
  const loaded = shown.revision;
  const error = shown.error;
  useEffect(() => {
    if (!shown.needsFetch) return;
    productsApi
      .revision(projectId, selected)
      .then((revision) => dispatch({ type: "received", projectId, revision }))
      .catch((e) =>
        dispatch({ type: "failed", projectId, number: selected, message: (e as Error).message }),
      );
  }, [shown.needsFetch, projectId, selected]);
  const changes = loaded && !shown.isHead ? differences(loaded, view.head) : [];
  return (
    <div className="versions">
      <div className="version-list">
        {view.revisions.map((r) => (
          <button
            key={r.number}
            type="button"
            className="version-item"
            aria-pressed={selected === r.number}
            onClick={() => dispatch({ type: "select", number: r.number })}
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
      <div className="check-group version-detail" style={{ margin: 0 }} aria-live="polite">
        {error && (
          <p className="error-text">
            Revision {selected} could not be loaded: {error}
          </p>
        )}
        {!loaded && !error && <p className="muted">Loading revision {selected}…</p>}
        {loaded && loaded.number === selected && (
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
            {shown.isHead ? (
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

// ---------- an AI proposal, beside the current revision ----------

function ProposalView({
  view,
  proposalId,
  dirty,
  onApplied,
  onAskAgain,
}: {
  view: StudioView;
  proposalId: string | null;
  dirty: boolean;
  onApplied: (v: StudioView, message: string) => void;
  onAskAgain: (text: string) => void;
}) {
  const [chosen, setChosen] = useState<string | null>(proposalId);
  const [p, setP] = useState<ProposalDetail | null>(null);
  const [empty, setEmpty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sample, setSample] = useState<SampleState>(emptySample);
  const projectId = view.project.id;
  const head = view.head.number;

  // With nothing chosen, show the latest proposal, if any.
  useEffect(() => {
    if (chosen) return;
    let gone = false;
    productsApi
      .conversation(projectId)
      .then((c) => {
        if (gone) return;
        const latest = c.proposals[0];
        if (latest) setChosen(latest.id);
        else setEmpty(true);
      })
      .catch((e) => !gone && setError((e as Error).message));
    return () => {
      gone = true;
    };
  }, [chosen, projectId]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new head (after apply) re-reads the comparison
  useEffect(() => {
    if (!chosen) return;
    let gone = false;
    productsApi
      .proposal(projectId, chosen)
      .then((d) => !gone && setP(d))
      .catch((e) => !gone && setError((e as Error).message));
    return () => {
      gone = true;
    };
  }, [chosen, projectId, head]);

  if (empty)
    return (
      <div className="card empty">
        <h2>No proposal yet</h2>
        <p>
          Tell the assistant what you want. Its proposal appears here next to your current revision,
          and nothing changes until you choose to use it.
        </p>
      </div>
    );
  if (error && !p) return <p className="error-text">{error}</p>;
  if (!p) return <p className="muted">Loading the proposal…</p>;

  const proposed: Content = { brief: p.brief, prototype: p.prototype };
  const changes = differences({ brief: view.head.brief, prototype: view.head.prototype }, proposed);
  const stale = p.head.number !== p.base_revision;
  const apply = async () => {
    setBusy(true);
    setError(null);
    try {
      const v = await productsApi.applyProposal(projectId, p.id);
      onApplied(
        v,
        v.applied.already
          ? `This proposal is already revision ${v.applied.revision}.`
          : v.applied.created
            ? `Used the proposal as revision ${v.applied.revision}.`
            : `The proposal matched revision ${v.applied.revision}; nothing new was saved.`,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="proposal">
      <div className="row" style={{ gap: 8 }}>
        <h2 style={{ fontSize: 19, margin: 0 }}>Proposal from the assistant</h2>
        <span
          className={`pill ${p.status === "applied" ? "mint" : p.status === "open" ? "blue" : ""}`}
        >
          {p.status === "applied"
            ? `Used as revision ${p.applied_revision}`
            : p.status === "open"
              ? "Not used yet"
              : "A newer proposal replaced it"}
        </span>
        <span className="muted" style={{ fontSize: 13 }}>
          Made from revision {p.base_revision} · {ago(p.created_at)}
        </span>
      </div>
      <p style={{ fontSize: 15, marginTop: 8 }}>{p.summary}</p>

      {!p.current_owner && (
        <p className="notice">
          This proposal was made before the business changed hands. It can be read, not used; ask
          again for one of your own.
        </p>
      )}
      {stale && p.status !== "applied" && (
        <div className="notice">
          Revision {p.head.number} was saved after this proposal was made from revision{" "}
          {p.base_revision}. Using it would replace those edits, so it can't be used as is. Compare
          below, or ask again on revision {p.head.number}.
          <div style={{ marginTop: 8 }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() =>
                onAskAgain(`Please update your last proposal for revision ${p.head.number}.`)
              }
            >
              Ask again on revision {p.head.number}
            </button>
          </div>
        </div>
      )}

      <div className="grid-2 proposal-notes">
        <section className="check-group">
          <h3>What changes</h3>
          {changes.length ? (
            <ul className="diff-list">
              {changes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          ) : (
            <p className="muted">Same as revision {head}.</p>
          )}
        </section>
        <section className="check-group">
          <h3>Assumptions and questions</h3>
          {p.assumptions.length > 0 && (
            <ul style={{ margin: "0 0 8px", paddingLeft: 18, fontSize: 14 }}>
              {p.assumptions.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          )}
          {p.questions.length > 0 && (
            <>
              <strong style={{ fontSize: 13.5 }}>Questions for you</strong>
              <ul style={{ margin: "4px 0 0", paddingLeft: 18, fontSize: 14 }}>
                {p.questions.map((q) => (
                  <li key={q}>{q}</li>
                ))}
              </ul>
            </>
          )}
          <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            {p.note} Sample data in the preview is fictional.
          </p>
        </section>
      </div>

      <div className="row" style={{ gap: 10, margin: "4px 0 16px" }}>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || dirty || stale || !p.current_owner || p.status === "applied"}
          onClick={apply}
        >
          {busy ? "Using it…" : p.status === "applied" ? "Used" : "Use this version"}
        </button>
        <span className="muted" style={{ fontSize: 13 }}>
          {p.status === "applied"
            ? `Used as revision ${p.applied_revision}. Nothing was published.`
            : !p.current_owner
              ? "Made for the previous owner; ask again for your own."
              : stale
                ? `Revision ${p.head.number} was saved since; ask again on it.`
                : dirty
                  ? "Save or discard your unsaved edits first; using a proposal never overwrites them."
                  : `Makes revision ${head + 1}. It does not publish anything.`}
        </span>
      </div>
      {error && (
        <p className="error-text" aria-live="polite">
          {error}
        </p>
      )}

      <div className="compare">
        <section aria-label="Proposed">
          <h3 className="compare-title">Proposed</h3>
          <BriefDoc view={view} brief={p.brief} starter={false} />
          <div style={{ marginTop: 12 }}>
            <PrototypePreview
              name={p.brief.name}
              prototype={p.prototype}
              sample={sample}
              setSample={setSample}
            />
          </div>
        </section>
        <section aria-label={`Revision ${head}`}>
          <h3 className="compare-title">Revision {head} (current)</h3>
          <BriefDoc view={view} brief={view.head.brief} starter={false} />
        </section>
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
  const [side, setSide] = useState<"assistant" | "brief" | "screens">("assistant");
  const [proposalId, setProposalId] = useState<string | null>(null);
  const [prefill, setPrefill] = useState<Prefill | null>(null);
  const personId = person?.id ?? "";
  const reviewProposal = useCallback((pid: string) => {
    setProposalId(pid);
    setTab("proposal");
  }, []);
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
        window.localStorage.removeItem(legacyDraftKey(id));
        const key = draftKey(personId, id, v.business.owner_epoch);
        const local = readLocal(key);
        if (
          local &&
          canon({ brief: local.brief, prototype: local.prototype }) !==
            canon({ brief: v.head.brief, prototype: v.head.prototype })
        )
          setOffered(local);
        else window.localStorage.removeItem(key);
      })
      .catch((e) =>
        setLoadError({
          status: e instanceof ApiError ? e.status : 0,
          message: (e as Error).message,
        }),
      );
  }, [id, adopt, personId]);

  useEffect(() => {
    if (person) load();
  }, [person, load]);

  const dirty = Boolean(
    view &&
      draft &&
      canon(draft) !== canon({ brief: view.head.brief, prototype: view.head.prototype }),
  );
  const storageKey = view ? draftKey(personId, id, view.business.owner_epoch) : null;

  // Keep unsaved edits in this browser, for this person and owner, until saved or discarded.
  useEffect(() => {
    if (!view || !draft || offered || !storageKey) return;
    if (dirty)
      window.localStorage.setItem(
        storageKey,
        JSON.stringify({ ...draft, base, at: new Date().toISOString() } satisfies LocalDraft),
      );
    else window.localStorage.removeItem(storageKey);
  }, [view, draft, dirty, base, storageKey, offered]);

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
      if (storageKey) window.localStorage.removeItem(storageKey);
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

  // The signed-in person now (not the person the view was loaded for), so a switch of person
  // resets the conversation at once, before the studio reloads.
  const scope = studioScope(personId, view.project.id, view.business.owner_epoch);
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
      current: tab === "builds",
      act: () => setTab("builds"),
    },
    {
      key: "test",
      label: "Test",
      // Brief rules only; nothing is marked tested until a build has been tested.
      detail: `Brief checks ${view.checks.passed}/${total}`,
      state: "open",
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
              if (storageKey) window.localStorage.removeItem(storageKey);
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

        <aside className="ps-side" aria-label="Assistant, brief and screens">
          <div className="ps-side-scroll">
            <fieldset className="seg">
              <legend className="sr-only">Work with</legend>
              <button
                type="button"
                aria-pressed={side === "assistant"}
                onClick={() => setSide("assistant")}
              >
                Assistant
              </button>
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
            {/* Kept mounted while hidden, so the unsent thought and an unresolved request
                survive switching to Brief or Screens. The key starts it clean for another
                person, project or owner epoch. */}
            <div hidden={side !== "assistant"}>
              <ConversationPanel
                key={scope}
                projectId={view.project.id}
                businessId={view.business.id}
                idea={view.project.idea}
                prefill={prefillFor(prefill, scope)}
                onReview={reviewProposal}
                onManual={() => setSide("brief")}
              />
            </div>
            {side === "assistant" ? null : side === "brief" ? (
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
                  <span className="badge" title="Brief rules met">
                    brief {view.checks.passed}/{total}
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
            {tab === "proposal" && (
              <ProposalView
                key={proposalId ?? "latest"}
                view={view}
                proposalId={proposalId}
                dirty={dirty}
                onApplied={(v, message) => {
                  adopt(v);
                  setFlash(message);
                }}
                onAskAgain={(text) => {
                  setSide("assistant");
                  setPrefill((p) => ({ text, n: (p?.n ?? 0) + 1, scope }));
                }}
              />
            )}
            {tab === "brief" && <BriefDoc view={view} brief={brief} starter={starter} />}
            {tab === "checks" && <ChecksView view={view} dirty={dirty} />}
            {tab === "versions" && (
              <VersionsView view={view} dirty={dirty} busy={busy} onRestore={restore} />
            )}
            {tab === "builds" && (
              <BuildsView
                projectId={view.project.id}
                businessId={view.business.id}
                headRevision={view.head.number}
                dirty={dirty}
              />
            )}
            {tab === "service" && (
              <ServiceView key={scope} projectId={view.project.id} businessId={view.business.id} />
            )}
            {tab === "continuity" && <ContinuityView view={view} />}
          </div>
        </section>
      </div>
    </div>
  );
}
