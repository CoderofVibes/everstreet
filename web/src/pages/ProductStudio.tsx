// The product studio workspace for one project: a compact header with the save state and one
// next action, the conversation companion at the side, and the working canvas. Job 001g
// (docs/design/CANVAS_STUDIO.md): Preview and Brief put the product on a stage with context
// tools for the one element selected in Edit mode; the other views (Proposal, Versions, Checks,
// Builds, Service, Continuity) are unchanged. Saved work lives on the server as immutable
// revisions; unsaved edits are also kept in this browser so a refresh or crash never loses
// them, and a save from an outdated revision is refused rather than overwriting newer work.

import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import { ApiError } from "../api.ts";
import { briefComposerShown } from "../appCanvas.ts";
import {
  BRIEF_SECTIONS,
  type BriefSection,
  type Content,
  type EditHistory,
  elementDomId,
  emptyHistory,
  firstForm,
  type Mode,
  recordEdit,
  redoEdit,
  resolveSelection,
  type Selection,
  screenOfSelection,
  selectionFor,
  selectionKey,
  undoEdit,
} from "../canvasEdit.ts";
import { clearProject } from "../composerDrafts.ts";
import { FOUNDATION_ICON, Icon } from "../icons.tsx";
import { offerHttp } from "../offerSetup.ts";
import type { ProjectSource } from "../opportunitiesApi.ts";
import {
  ago,
  type Brief,
  type CheckState,
  type KnownState,
  type ProposalDetail,
  type Prototype,
  priceText,
  productsApi,
  type StudioView,
} from "../productsApi.ts";
import { nextTab } from "../publication.ts";
import { historyReducer, initialHistory, shownRevision } from "../revisionHistory.ts";
import { Link, queryParam, useRouter } from "../router.tsx";
import { runtimeApi } from "../runtimeApi.ts";
import { useSession } from "../session.tsx";
import { type Records, type RecordsPort, type Source, StudioRecords } from "../studioRecords.ts";
import { type Prefill, prefillFor, studioScope } from "../studioScope.ts";
import { projectStatus, type Target } from "../studioStatus.ts";
import { AppView } from "./AppView.tsx";
import { BuildsView } from "./Builds.tsx";
import {
  BRIEF_FIELD_ID,
  ContextTools,
  FIRST_ID,
  reveal,
  type SaveControls,
  TOOLS_ID,
} from "./CanvasTools.tsx";
import { ConversationPanel } from "./Conversation.tsx";
import { emptySample, type PreviewEdit, PrototypePreview, type SampleState } from "./Prototype.tsx";
import { SERVICE_TASKS, type ServiceTask, ServiceView } from "./Service.tsx";

type Tab =
  | "preview"
  | "proposal"
  | "brief"
  | "checks"
  | "versions"
  | "builds"
  | "app"
  | "service"
  | "continuity";
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
  { id: "app", label: "Web app" },
  { id: "service", label: "Service" },
  { id: "continuity", label: "Continuity" },
];

/**
 * Job 001b: the studio has two kinds of task. Shaping (the brief, screens and conversation beside
 * a working preview) and operating (builds, service, continuity), which get the whole canvas with
 * the editor one deliberate click away. The editor is only hidden, never unmounted.
 */
export const OPERATE_TABS: readonly Tab[] = ["builds", "app", "service", "continuity"];
export function studioLayout(tab: Tab, editorOpen: boolean) {
  const operate = OPERATE_TABS.includes(tab);
  return { operate, editorShown: !operate || editorOpen };
}

/**
 * Job 001b1: the view and Service task a query names (null when it names none). A query-only
 * navigation, or Back/Forward between them, selects them on the mounted studio: nothing is
 * remounted, so drafts and pending work stay.
 */
export function viewFromSearch(search: string): { tab: Tab; task: ServiceTask | null } {
  const v = queryParam("view", search);
  const t = queryParam("task", search);
  return {
    tab: TABS.some((x) => x.id === v) ? (v as Tab) : "preview",
    task: SERVICE_TASKS.some((x) => x.id === t) ? (t as ServiceTask) : null,
  };
}
const recordsHttp: RecordsPort = {
  releases: (p) => runtimeApi.releases(p),
  offers: (b) => offerHttp.list(b),
};

const tabFromQuery = (): Tab => viewFromSearch(window.location.search).tab;
const taskFromQuery = (): ServiceTask => viewFromSearch(window.location.search).task ?? "try";

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
    manual: "Not recorded",
    fail: "Found problems",
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

// ---------- canvas views ----------

/**
 * Job 001g: the brief as Edit mode shows it: each section a selectable button whose context tools
 * edit that field only. The foundation and where it started are set when the project is made, so
 * they aren't selectable.
 */
function BriefEditDoc({
  view,
  brief,
  edit,
}: {
  view: StudioView;
  brief: Brief;
  edit: PreviewEdit;
}) {
  const none = "Not decided yet";
  const value: Record<BriefSection, string> = {
    name: brief.name || "Untitled product",
    audience: brief.audience || none,
    problem: brief.problem || none,
    promise: brief.promise || none,
    features: brief.features.filter(Boolean).join(" · ") || none,
    price: [priceText(brief.price) ?? none, brief.price.note].filter(Boolean).join(" · "),
  };
  return (
    <article className="doc doc-edit" aria-label="Product brief, Edit mode">
      <div className="eyebrow">{view.foundation.label} · product brief</div>
      {BRIEF_SECTIONS.map((b) => {
        const sel: Selection = { kind: "brief", section: b.id };
        const on = edit.selection !== null && selectionKey(edit.selection) === selectionKey(sel);
        return (
          <button
            key={b.id}
            type="button"
            id={elementDomId(sel)}
            className={`pick pick-section${on ? " picked" : ""}${b.id === "name" ? " pick-title" : ""}`}
            aria-pressed={on}
            aria-label={`Edit ${b.label.toLowerCase()}`}
            onClick={() => edit.onSelect(sel)}
          >
            <span className="pick-label">{b.label}</span>
            <span className="pick-value">{value[b.id]}</span>
          </button>
        );
      })}
      <p className="edit-why">
        The foundation ({view.foundation.label}) and where it started are set when the project is
        made, so they aren't edited here.
      </p>
    </article>
  );
}

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
        </dd>
        <dt>Foundation</dt>
        <dd>
          {view.foundation.label}: {view.foundation.summary}
        </dd>
        {/* Review #23: shown only when it differs from the problem it became. */}
        {view.project.idea.trim() !== brief.problem.trim() && (
          <>
            <dt>Where it started</dt>
            <dd className="muted">“{view.project.idea}”</dd>
          </>
        )}
      </dl>
    </article>
  );
}

const PILL: Record<string, { label: string; tone: string }> = {
  pass: { label: "Passed", tone: "mint" },
  fail: { label: "Found problems", tone: "caution" },
  todo: { label: "To do", tone: "caution" },
  unavailable: { label: "Not available", tone: "" },
  manual: { label: "Not recorded", tone: "" },
};

function EvidenceRow({ c }: { c: { state: CheckState; detail: string } }) {
  return (
    <div className="check-row">
      <StateIcon state={c.state} />
      <span className="detail">{c.detail}</span>
      <span className={`pill ${PILL[c.state]?.tone ?? ""}`}>{PILL[c.state]?.label ?? c.state}</span>
    </div>
  );
}

/** Phase B: one manual check, recorded by the founder (self-reported, kept with the revision). */
function ManualCheck({
  m,
  view,
  onView,
}: {
  m: StudioView["checks"]["manual"][number];
  view: StudioView;
  onView: (v: StudioView) => void;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const record = async (outcome: "done" | "issues") => {
    setBusy(true);
    setError(null);
    try {
      onView(
        await productsApi.recordManualCheck(view.project.id, {
          revision: view.head.number,
          check_key: m.key,
          outcome,
          note,
        }),
      );
      setOpen(false);
      setNote("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const noteId = `manual-note-${m.key}`;
  const noteRef = useRef<HTMLTextAreaElement>(null);
  // Opening the form moves focus to its first field (keyboard and screen-reader users).
  useEffect(() => {
    if (open) noteRef.current?.focus();
  }, [open]);
  return (
    <div className="check-row manual-check">
      <StateIcon state={m.state} />
      <span>
        {m.label}
        {m.recorded && (
          <div className="detail">
            {m.recorded.outcome === "done" ? "Done" : "Problems found"}, recorded by {m.recorded.by}{" "}
            on {new Date(m.recorded.at).toLocaleDateString()} for revision {view.head.number}
            {m.recorded.note ? `: ${m.recorded.note}` : "."}
          </div>
        )}
        {open && (
          <div className="manual-form">
            <label htmlFor={noteId}>What you did or found (required for problems)</label>
            <textarea
              ref={noteRef}
              id={noteId}
              className="input"
              rows={2}
              maxLength={600}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <div className="row-actions">
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={() => record("done")}
              >
                Record as done
              </button>
              <button
                type="button"
                className="btn"
                disabled={busy || !note.trim()}
                onClick={() => record("issues")}
              >
                Record problems found
              </button>
              <button type="button" className="btn btn-quiet" onClick={() => setOpen(false)}>
                Cancel
              </button>
            </div>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
          </div>
        )}
      </span>
      {!open && (
        <button type="button" className="btn btn-sm" onClick={() => setOpen(true)}>
          {m.recorded ? "Record again" : "Record result"}
        </button>
      )}
    </div>
  );
}

function ChecksView({
  view,
  dirty,
  onView,
}: {
  view: StudioView;
  dirty: boolean;
  onView: (v: StudioView) => void;
}) {
  const c = view.checks;
  const built = c.build.state === "pass";
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
          enough.{" "}
          {built
            ? "They describe the product; the checks below test what was built."
            : "They do not test a product: this revision hasn't been built."}
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
      <div className="checks-evidence">
        <section className="check-group">
          <h3>
            <Icon name="spark" /> Build
          </h3>
          <EvidenceRow c={c.build} />
        </section>
        <section className="check-group">
          <h3>
            <Icon name="spark" /> Model evaluations
          </h3>
          <EvidenceRow c={c.model_evaluations} />
        </section>
        <section className="check-group">
          <h3>
            <Icon name="user" /> Released and in use
          </h3>
          <EvidenceRow c={c.journey_tests} />
        </section>
      </div>
      <div className="checks-evidence">
        <section className="check-group">
          <h3>
            <Icon name="eye" /> Check yourself
          </h3>
          <p>
            Your own checks of revision {view.head.number}. Everstreet records what you report; it
            doesn't verify it.
          </p>
          {c.manual.map((m) => (
            <ManualCheck key={m.key} m={m} view={view} onView={onView} />
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
                      : "Nothing is deleted: the restore becomes a new revision. A released build and its customers don't change until you build and release again."}
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

const SOURCE_STATE: Record<ProjectSource["state"], string> = {
  open: "Still open",
  closed: "Closed by the person who posted it",
  expired: "Expired",
  unavailable: "No longer available",
};

/** Job 005a: where the idea came from. A request is inspiration, not a customer or a contract. */
function SourcePanel({ source }: { source: ProjectSource }) {
  const s = source.snapshot;
  return (
    <details className="card" style={{ marginBottom: 10, fontSize: 13.5 }}>
      <summary>
        <strong>{source.label}</strong>{" "}
        <span className={source.state === "open" ? "pill lime" : "pill"}>
          {SOURCE_STATE[source.state]}
        </span>
      </summary>
      <p style={{ margin: "8px 0", overflowWrap: "anywhere" }}>“{s.text}”</p>
      <p className="muted" style={{ margin: "0 0 6px" }}>
        Captured {new Date(source.captured_at).toLocaleDateString()} · posted{" "}
        {new Date(s.posted_at).toLocaleDateString()} · open until{" "}
        {new Date(s.open_until).toLocaleDateString()}
        {s.constraints.max_price_cents !== undefined &&
          ` · stated price limit up to $${(s.constraints.max_price_cents / 100).toFixed(2)}`}
      </p>
      {(s.constraints_unreadable ?? []).length > 0 && (
        <p className="muted" style={{ margin: "0 0 6px" }}>
          Some stated details couldn't be read when this was captured, so none of them is assumed.
        </p>
      )}
      <ul className="missing-list" style={{ margin: "6px 0" }}>
        {source.notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
      {source.can_reply ? (
        <Link to="/opportunities">Reply with a published business</Link>
      ) : (
        <p className="muted" style={{ margin: 0 }}>
          {source.state !== "open"
            ? "Replying isn't possible: the request is no longer open."
            : "The person who posted it asked not to receive replies."}
        </p>
      )}
    </details>
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
  const [tab, setTab] = useState<Tab>(tabFromQuery);
  /** Service stays mounted once opened (job 002c1); see the Service tab below. */
  const [serviceOpened, setServiceOpened] = useState(false);
  if (tab === "service" && !serviceOpened) setServiceOpened(true);
  /** Job 002e: the Web app view also stays mounted once opened (its draft and pending request). */
  const [appOpened, setAppOpened] = useState(false);
  if (tab === "app" && !appOpened) setAppOpened(true);
  const [serviceTask, setServiceTask] = useState<ServiceTask>(taskFromQuery);
  // 2026-11-05 browser review: the open view (and Service task) are kept in the address, so a
  // reload or a shared link returns to the same place. replaceState: no extra history entries.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (tab === "preview") q.delete("view");
    else q.set("view", tab);
    if (tab === "service" && serviceTask !== "try") q.set("task", serviceTask);
    else q.delete("task");
    const next = `${window.location.pathname}${q.toString() ? `?${q}` : ""}${window.location.hash}`;
    if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`)
      window.history.replaceState(window.history.state, "", next);
  }, [tab, serviceTask]);
  /** Job 001b: on operating tabs the editor is shown only on request. */
  const [editorOpen, setEditorOpen] = useState(false);
  /** Job 001b: the records the status is derived from (never a single boolean). */
  const [records, setRecords] = useState<Records | null>(null);
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
  /** Job 001g: Try it or Edit, and the one selected element; both survive view switches. */
  const [mode, setMode] = useState<Mode>("try");
  const [selection, setSelection] = useState<Selection | null>(null);
  /** Job 001g: undo of unsaved edits only; reset when the draft is replaced from the server. */
  const [history, setHistory] = useState<EditHistory<Content>>(emptyHistory);

  const adopt = useCallback((v: StudioView) => {
    setView(v);
    setDraft({ brief: v.head.brief, prototype: v.head.prototype });
    setBase(v.head.number);
    setHistory(emptyHistory());
  }, []);
  /** Every edit from the context tools goes through here, so it can be undone. */
  const edit = (next: Content) => {
    if (!draft) return;
    setHistory((h) => recordEdit(h, draft, next));
    setDraft(next);
  };

  // 001k1: only the mounted studio deletes kept composer state (a load that answers after this
  // page unmounted must not clear what a newer studio for the project holds).
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
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
      .catch((e) => {
        // 001k1: the project definitely isn't this person's (any owner epoch): their kept
        // composer text and unresolved requests for it are removed from this tab.
        if (mounted.current && e instanceof ApiError && e.status === 404)
          clearProject(typeof sessionStorage === "undefined" ? null : sessionStorage, personId, id);
        setLoadError({
          status: e instanceof ApiError ? e.status : 0,
          message: (e as Error).message,
        });
      });
  }, [id, adopt, personId]);

  useEffect(() => {
    if (person) load();
  }, [person, load]);

  // Job 001b1: the status records, read on load and after a save, and again whenever a panel
  // reports that its own records actually changed (a build finished, a check or release, an
  // offer created or retired). Sequenced and coalesced; no polling; dropped on unmount.
  const projectId = view?.project.id;
  const businessId = view?.business.id;
  const headNumber = view?.head.number;
  const [store, setStore] = useState<StudioRecords | null>(null);
  useEffect(() => {
    if (!projectId || !businessId) return;
    const s = new StudioRecords(recordsHttp, { projectId, businessId });
    setStore(s);
    const off = s.subscribe(() => setRecords(s.getState().records));
    return () => {
      off();
      s.dispose();
    };
  }, [projectId, businessId]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: headNumber is a trigger (a save)
  useEffect(() => {
    void store?.refresh();
  }, [store, headNumber]);
  const onRecords = useCallback(
    (source: Source, signature: string) => store?.notice(source, signature),
    [store],
  );

  // Job 001b1: a query-only navigation (or Back/Forward) selects its view and task here,
  // without remounting the studio.
  const { search } = useRouter();
  useEffect(() => {
    const q = viewFromSearch(search);
    setTab(q.tab);
    if (q.task) setServiceTask(q.task);
  }, [search]);

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

  /** Focus an element once the view, mode and selection just set have rendered. */
  const focusSoon = (elementId: string) =>
    window.setTimeout(() => reveal(document.getElementById(elementId)), 0);

  /**
   * Job 001g: select an element; its tools appear and focus moves to their first control (on a
   * narrow screen the tools sit under the stage, so this also brings them into view).
   */
  const select = (s: Selection | null) => {
    setSelection(s);
    const screen = screenOfSelection(s);
    if (screen) setSample((x) => (x.screen === screen ? x : { ...x, screen }));
    if (s) focusSoon(s.kind === "brief" ? BRIEF_FIELD_ID[s.section] : FIRST_ID);
  };

  /** The header's "Next" brief to-do: open the part that needs it, in Edit mode. */
  const focusTodo = (todoId: string) => {
    setMode("edit");
    if (todoId === "input") {
      setTab("preview");
      const form = draft ? firstForm(draft.prototype) : null;
      select(form ? { kind: "screen", screen: form } : null);
      if (!form) focusSoon(TOOLS_ID);
      return;
    }
    const section = BRIEF_SECTIONS.find((b) => b.id === todoId)?.id ?? "name";
    setTab("brief");
    select({ kind: "brief", section });
  };

  const undo = () => {
    if (!draft) return;
    const r = undoEdit(history, draft);
    if (!r) return;
    setDraft(r.value);
    setHistory(r.history);
  };
  const redo = () => {
    if (!draft) return;
    const r = redoEdit(history, draft);
    if (!r) return;
    setDraft(r.value);
    setHistory(r.history);
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

  const status = records
    ? projectStatus({
        head: view.head.number,
        dirty,
        build: { available: view.build.available, reason: view.build.reason },
        businessId: view.business.id,
        releases: records.releases,
        offers: records.offers,
      })
    : null;
  const goTarget = (t: Target) => {
    if ("route" in t) return go(t.route);
    if (t.tab === "service") setServiceTask(t.task);
    setTab(t.tab);
  };
  const layout = studioLayout(tab, editorOpen);
  const item = (k: string) => status?.items.find((i) => i.key === k);
  /** Job 001b1: whether the companion is visible now (on narrow screens it is opt-in everywhere). */
  const editorVisible = layout.operate ? layout.editorShown : editorOpen;
  /** Job 001g: Preview and Brief are the views with a stage and context tools. */
  const toolsView = tab === "preview" || tab === "brief" ? tab : null;
  const shown = toolsView
    ? selectionFor(toolsView, resolveSelection(selection, draft.prototype))
    : null;
  const saveControls: SaveControls = {
    dirty,
    busy,
    note,
    setNote,
    save,
    discard: () => {
      if (window.confirm("Discard your unsaved changes? Saved revisions stay.")) adopt(view);
    },
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    undo,
    redo,
  };

  const onTabKey = (e: KeyboardEvent, i: number) => {
    const n = nextTab(i, e.key, TABS.length);
    const next = n === null ? undefined : TABS[n];
    if (!next || e.key === "ArrowUp" || e.key === "ArrowDown") return;
    e.preventDefault();
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
            {/* Review #24: "Recipe Reader / Recipe Reader" reads as a mistake. */}
            <Link to={`/desk/${view.business.id}`}>
              {view.business.name === (brief.name || "Untitled product")
                ? "Business desk"
                : view.business.name}
            </Link>
          </div>
          <h1>{brief.name || "Untitled product"}</h1>
        </div>
        <span className="pill">{view.foundation.label}</span>
        {/* Job 001b: from the release and build records (was a hardcoded "Prototype"). */}
        <span className={`pill ${status?.chip.tone ?? ""}`}>
          {status?.chip.label ?? "Checking status…"}
        </span>
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
          <button type="button" className="btn btn-primary" onClick={() => focusTodo(todo.id)}>
            Next: {todo.detail} <Icon name="arrowRight" size="sm" />
          </button>
        ) : status?.next ? (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => status.next && goTarget(status.next.target)}
          >
            Next: {status.next.label} <Icon name="arrowRight" size="sm" />
          </button>
        ) : null}
      </header>

      {/* Job 001b1: one short line (release and customer offer), with the full progress behind a
          disclosure; it replaces the separate status cards and the step rail. */}
      {status && (
        <div className="ps-summary">
          <span>
            <span className="muted">Release:</span> {item("release")?.value}
          </span>
          <span>
            <span className="muted">Customer offer:</span> {item("customers")?.value}
          </span>
          <details className="ps-progress">
            <summary>Progress and status</summary>
            <ul>
              {status.items.map((i) => (
                <li key={i.key} className={`tone-${i.tone}`}>
                  <button type="button" onClick={() => goTarget(i.target)}>
                    <span className="ps-status-label">{i.label}</span>
                    <span className="ps-status-value">{i.value}</span>
                  </button>
                </li>
              ))}
              <li className={`tone-${shapeDone ? "done" : "now"}`}>
                <button type="button" onClick={() => setTab("checks")}>
                  <span className="ps-status-label">Brief checks</span>
                  <span className="ps-status-value">
                    {view.checks.passed} of {total} rules met
                  </span>
                </button>
              </li>
              <li className={`tone-${view.business.published_at ? "done" : "now"}`}>
                {/* Job 001d: straight to the public profile's draft, review and publish. */}
                <button type="button" onClick={() => go(`/desk/${view.business.id}/public`)}>
                  <span className="ps-status-label">Public profile</span>
                  <span className="ps-status-value">
                    {view.business.published_at ? "Published" : "Not published"}
                  </span>
                </button>
              </li>
            </ul>
            {status.releaseNote && <p className="muted ps-status-note">{status.releaseNote}</p>}
          </details>
        </div>
      )}

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
              setHistory(emptyHistory());
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

      <StudioBody
        editorShown={layout.editorShown}
        editorOpen={editorOpen}
        editor={
          <div className="ps-side-scroll">
            <div className="companion-head">
              {/* Job 001k: the two assistant tasks are named apart: this one shapes the brief
                  (proposals); the Web app view's composer changes the app's code. */}
              <span className="ctx-kicker">Companion · brief</span>
              <span className="muted">
                Shape the business brief in words; proposals open beside your revision. It doesn't
                change the web app's code.
              </span>
            </div>
            {view.source && <SourcePanel source={view.source} />}
            {/* Job 001k: on the Web app view the app's own composer ("Change the web app") is the
                one assistant composer shown, so the brief conversation is set aside here (hidden,
                still mounted: its unsent text and any pending request are kept). */}
            {!briefComposerShown(tab) && (
              <div className="notice info companion-aside">
                <p>
                  On the Web app view, the assistant changes the app's code, in “Change the web
                  app”. The brief conversation is set aside; your unsent text there is kept.
                </p>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setTab("brief")}
                >
                  Shape the brief instead
                </button>
              </div>
            )}
            {/* Job 001g: the conversation is the companion's only content, always mounted, so
                the unsent thought and an unresolved request survive every view, mode and layout
                switch. The key starts it clean for another person, project or owner epoch. */}
            <div hidden={!briefComposerShown(tab)}>
              <ConversationPanel
                key={scope}
                scope={scope}
                projectId={view.project.id}
                businessId={view.business.id}
                idea={view.project.idea}
                prefill={prefillFor(prefill, scope)}
                onReview={reviewProposal}
                onManual={() => {
                  setTab("brief");
                  setMode("edit");
                  setSelection(null);
                  focusSoon(TOOLS_ID);
                }}
              />
            </div>
          </div>
        }
        canvas={
          <section className="ps-canvas" aria-label="Canvas">
            <div className="ps-tabbar">
              <div className="tabs" role="tablist" aria-label="Project views">
                {TABS.map((t, i) => (
                  <button
                    key={t.id}
                    id={`tab-${t.id}`}
                    type="button"
                    role="tab"
                    className={`tab${t.id === "builds" ? " tab-group-start" : ""}`}
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
              {/* Job 001g: Try it or Edit, on the views with a stage. */}
              {toolsView && (
                <fieldset className="seg ps-mode">
                  <legend className="sr-only">Mode</legend>
                  <button
                    type="button"
                    aria-pressed={mode === "try"}
                    onClick={() => setMode("try")}
                  >
                    {toolsView === "preview" ? "Try it" : "Read"}
                  </button>
                  <button
                    type="button"
                    aria-pressed={mode === "edit"}
                    onClick={() => setMode("edit")}
                  >
                    Edit
                  </button>
                </fieldset>
              )}
              {/* On wide screens shown for operating views only; on narrow screens the companion
                is opt-in for every view, so the chosen task comes first. */}
              <button
                type="button"
                className={`btn btn-quiet btn-sm ps-editor-toggle${layout.operate ? "" : " shaping"}`}
                aria-expanded={editorVisible}
                aria-controls="ps-side"
                onClick={() => setEditorOpen((o) => !o)}
              >
                {editorVisible ? "Hide the companion" : "Show the companion"}
              </button>
            </div>
            <div className="ps-view" id="ps-view" role="tabpanel" aria-labelledby={`tab-${tab}`}>
              {toolsView && (
                <div className="ps-work">
                  <div className="ps-stage-wrap">
                    {dirty && (
                      <p className="notice info">
                        Showing your unsaved changes. Save to keep them as revision{" "}
                        {view.head.number + 1}.
                      </p>
                    )}
                    {tab === "preview" ? (
                      <div className={`ps-stage${mode === "edit" ? " editing" : ""}`}>
                        <PrototypePreview
                          name={brief.name || "Untitled product"}
                          prototype={draft.prototype}
                          sample={sample}
                          setSample={setSample}
                          edit={
                            mode === "edit"
                              ? { selection: shown, onSelect: (s) => select(s) }
                              : undefined
                          }
                        />
                      </div>
                    ) : mode === "edit" ? (
                      <BriefEditDoc
                        view={view}
                        brief={brief}
                        edit={{ selection: shown, onSelect: (s) => select(s) }}
                      />
                    ) : (
                      <BriefDoc view={view} brief={brief} starter={starter} />
                    )}
                  </div>
                  <ContextTools
                    view={toolsView}
                    mode={mode}
                    selection={shown}
                    draft={draft}
                    starter={starter}
                    onDraft={edit}
                    onSelect={(s) => select(s)}
                    save={saveControls}
                  />
                </div>
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
                    setEditorOpen(true);
                    setPrefill((p) => ({ text, n: (p?.n ?? 0) + 1, scope }));
                  }}
                />
              )}
              {tab === "checks" && <ChecksView view={view} dirty={dirty} onView={setView} />}
              {tab === "versions" && (
                <VersionsView view={view} dirty={dirty} busy={busy} onRestore={restore} />
              )}
              {tab === "builds" && (
                <BuildsView
                  projectId={view.project.id}
                  businessId={view.business.id}
                  headRevision={view.head.number}
                  dirty={dirty}
                  onRecords={onRecords}
                />
              )}
              {/* Job 002e: keyed by person, project and owner epoch: another scope starts clean. */}
              {appOpened && (
                <div hidden={tab !== "app"}>
                  <AppView
                    key={scope}
                    scope={scope}
                    projectId={view.project.id}
                    headRevision={view.head.number}
                    buildAvailable={view.build.available}
                    onShapeBrief={() => {
                      setTab("brief");
                      setEditorOpen(true);
                    }}
                  />
                </div>
              )}
              {/* Job 002c1: once opened, Service stays mounted (hidden on other tabs) so a pending
                request, its text and target survive switching tabs. Keyed by person, project
                and owner epoch, so another scope starts clean. */}
              {serviceOpened && (
                <div hidden={tab !== "service"}>
                  <ServiceView
                    key={scope}
                    projectId={view.project.id}
                    businessId={view.business.id}
                    task={serviceTask}
                    onTask={setServiceTask}
                    onRecords={onRecords}
                  />
                </div>
              )}
              {tab === "continuity" && <ContinuityView view={view} />}
            </div>
          </section>
        }
      />
    </div>
  );
}

/**
 * Job 001b: the studio's three regions. The editor (conversation, brief, screens, save bar) is
 * always rendered; on operating views it is hidden, never unmounted, so its outbox, unsaved brief
 * and typed text keep their state while the canvas takes the whole width.
 */
export function StudioBody({
  editorShown,
  editorOpen = false,
  editor,
  canvas,
}: {
  editorShown: boolean;
  /** Job 001b1: the person asked for the editor (narrow screens show it only then). */
  editorOpen?: boolean;
  editor: ReactNode;
  canvas: ReactNode;
}) {
  return (
    <div className={`ps-body${editorShown ? "" : " operate"}${editorOpen ? " editor-open" : ""}`}>
      <aside className="ps-side" id="ps-side" aria-label="Companion" hidden={!editorShown}>
        {editor}
      </aside>
      {canvas}
    </div>
  );
}
