// Bring an existing product (jobs 004a, 004a1). A private import workspace for one product: what
// its supplied package.json declares, an inventory of what it depends on, and a readiness report
// for handing it over. Nothing is fetched, installed or run, and nothing here is "verified":
// verifying accounts needs connections that come in a later step.
//
// 004a1: every unsaved draft (product details, the manifest being prepared, each dependency
// statement) and every request's identity live in the workspace, not in a tab, so switching tabs
// loses nothing. They are dropped when the person, the workspace or control of the business
// changes, and never written to browser storage. Answers are reconciled by what they contain
// (importDraft.ts), so an answer finishing late never replaces a newer one or hides a success.
//
// 004a2: the workspace's state and requests belong to one controller (importWorkspace.ts) that
// retires everything in flight and clears every private draft when access is observed to end,
// whichever request observed it.

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ApiError, api } from "../api.ts";
import {
  cleared,
  type DepDraft,
  type DetailsDraft,
  depShown,
  detailsShown,
  emptyManifest,
  fileChosen,
  fileRead,
  type InspectAttempt,
  type ManifestDraft,
  type Outcome,
  pasted,
  type RowStatus,
  type Snapshot,
  type Uses,
} from "../importDraft.ts";
import {
  byteLength,
  type Category,
  type Detection,
  type Facts,
  type ImportSummary,
  type ImportView,
  type ItemStatus,
  importsApi,
  MAX_MANIFEST_BYTES,
  type Manifest,
  PRODUCT_KIND_LABEL,
  type ProductKind,
  type Report,
  STATUS_LABEL,
} from "../importsApi.ts";
import { type Drafts, WorkspaceController } from "../importWorkspace.ts";
import { ago } from "../productsApi.ts";
import { Link, useRouter } from "../router.tsx";
import { useSession } from "../session.tsx";
import { newKey } from "./Builds.tsx";
import { Scroll } from "./FinanceChart.tsx";

const SCOPE_SHORT =
  "We read the package.json you supply: its package details and the packages it declares. Your code isn't fetched, installed or run, scripts are ignored, and nothing that looks like a key or password is accepted.";

const STATUS_PILL: Record<ItemStatus, string> = {
  verified: "pill lime",
  detected: "pill blue",
  declared: "pill",
  unknown: "pill caution",
};

/** State read synchronously by event handlers and async completions, and rendered. */
function useLive<T>(initial: T) {
  const ref = useRef(initial);
  const [value, setValue] = useState(initial);
  const update = useCallback((fn: (t: T) => T) => {
    ref.current = fn(ref.current);
    setValue(ref.current);
    return ref.current;
  }, []);
  return [value, ref, update] as const;
}

/** What a failed call means: a status for refusals, 0 when no answer arrived at all. */
const outcomeOf = (e: unknown): Extract<Outcome, { ok: false }> => ({
  ok: false,
  status: e instanceof ApiError ? e.status : 0,
  message: (e as Error).message,
});

function SignIn({ reason }: { reason: string }) {
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

/** Reads a chosen file as a manifest, checking size and name here (the server decides). */
function readManifestFile(f: File): Promise<{ manifest: Manifest } | { error: string }> {
  if (f.size > MAX_MANIFEST_BYTES)
    return Promise.resolve({
      error: "That file is larger than 64 KiB. Only the package.json file is needed.",
    });
  if (f.name !== "package.json")
    return Promise.resolve({
      error: "Choose the file named package.json; other files aren't read.",
    });
  return f.text().then(
    (content) => ({ manifest: { file_name: f.name, content } }),
    () => ({ error: "That file couldn't be read." }),
  );
}

/**
 * The package.json being prepared, chosen as a file or pasted. Whoever owns the draft applies a
 * file read only if nothing was chosen, pasted or cleared since it started.
 */
function ManifestInput({
  draft,
  onFile,
  onPaste,
  onClear,
  id,
}: {
  draft: ManifestDraft;
  onFile: (f: File) => void;
  onPaste: (text: string) => void;
  onClear: () => void;
  id: string;
}) {
  const pastedText = draft.value && draft.value.file_name === null ? draft.value.content : "";
  const fileInput = useRef<HTMLInputElement>(null);
  const holdsFile = draft.reading || draft.value?.file_name !== null;
  // When the draft no longer holds a chosen file (cleared, pasted over, refused or inspected),
  // the browser's file box is emptied too, so it never shows a file that isn't the draft.
  useEffect(() => {
    if (fileInput.current && (!holdsFile || !draft.value) && !draft.reading)
      fileInput.current.value = "";
  }, [holdsFile, draft.value, draft.reading]);
  return (
    <div>
      <label className="field" htmlFor={`${id}-file`}>
        <span>package.json file</span>
        <input
          ref={fileInput}
          id={`${id}-file`}
          type="file"
          accept=".json,application/json"
          className="input"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
            else onClear();
          }}
        />
        <small>Or paste its text below.</small>
      </label>
      <label className="field" htmlFor={`${id}-paste`}>
        <span>Paste package.json text</span>
        <textarea
          id={`${id}-paste`}
          className="input mono"
          rows={6}
          value={pastedText}
          spellCheck={false}
          onChange={(e) => onPaste(e.target.value)}
        />
      </label>
      <div className="row" style={{ gap: 8, marginTop: -8, marginBottom: 12 }}>
        <span className="muted" style={{ fontSize: 13 }} role="status">
          {draft.reading
            ? "Reading the file…"
            : draft.value
              ? `${draft.value.file_name ? `Chosen: ${draft.value.file_name}` : "Pasted text"} · ${byteLength(draft.value.content).toLocaleString()} bytes, not inspected yet`
              : "Nothing chosen"}
        </span>
        {(draft.value || draft.error) && (
          <button type="button" className="btn btn-quiet btn-sm" onClick={onClear}>
            Clear
          </button>
        )}
      </div>
      {draft.error && (
        <p className="error-text" role="alert">
          {draft.error}
        </p>
      )}
    </div>
  );
}

function KindSelect({
  value,
  onChange,
  id,
}: {
  value: ProductKind;
  onChange: (k: ProductKind) => void;
  id: string;
}) {
  return (
    <label className="field" htmlFor={id}>
      <span>What kind of product</span>
      <select
        id={id}
        className="input"
        value={value}
        onChange={(e) => onChange(e.target.value as ProductKind)}
      >
        {(Object.keys(PRODUCT_KIND_LABEL) as ProductKind[]).map((k) => (
          <option key={k} value={k}>
            {PRODUCT_KIND_LABEL[k]}
          </option>
        ))}
      </select>
    </label>
  );
}

function Counts({ counts }: { counts: Record<ItemStatus, number> }) {
  return (
    <span className="chips" style={{ gap: 6 }}>
      {(["verified", "detected", "declared", "unknown"] as ItemStatus[]).map((s) => (
        <span key={s} className={STATUS_PILL[s]}>
          {counts[s]} {STATUS_LABEL[s].toLowerCase()}
        </span>
      ))}
    </span>
  );
}

function StatusLine({ status, unsaved }: { status: RowStatus | null; unsaved: boolean }) {
  const text =
    status?.state === "saving"
      ? "Saving…"
      : status?.state === "conflict" || status?.state === "refused" || status?.state === "unknown"
        ? status.message
        : unsaved
          ? "Unsaved changes"
          : status?.state === "saved"
            ? "Saved"
            : "";
  if (!text) return null;
  const bad = status && ["conflict", "refused", "unknown"].includes(status.state);
  return (
    <p
      className={bad ? "error-text" : "muted"}
      role={bad ? "alert" : "status"}
      style={{ fontSize: 13 }}
    >
      {text}
    </p>
  );
}

// ---------- /import ----------

export function ImportHome() {
  const { person } = useSession();
  const { go } = useRouter();
  const [mine, setMine] = useState<ImportSummary[] | null>(null);
  const [businesses, setBusinesses] = useState<{ business_id: string; name: string }[]>([]);
  const [target, setTarget] = useState<string>("new");
  const [businessName, setBusinessName] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState<ProductKind>("saas");
  const [manifest, , updateManifest] = useLive<ManifestDraft>(emptyManifest());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One key per intended request: a retry after a lost answer reuses it, so nothing is
  // created twice; changing anything makes it a new request.
  const attempt = useRef<{ key: string; sig: string } | null>(null);

  useEffect(() => {
    if (!person) return;
    let live = true;
    importsApi
      .list()
      .then((r) => live && setMine(r.imports))
      .catch(() => live && setMine([]));
    api
      .projects()
      .then(
        (r) =>
          live &&
          setBusinesses(r.projects.map((p) => ({ business_id: p.business_id, name: p.name }))),
      )
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [person]);

  if (!person) return <SignIn reason="Sign in to bring a product you already run." />;

  const submit = async () => {
    if (busy) return;
    setError(null);
    const fields = {
      ...(target === "new" ? { new_business_name: businessName.trim() } : { business_id: target }),
      name: name.trim(),
      description: description.trim(),
      product_kind: kind,
      ...(manifest.value ? { manifest: manifest.value } : {}),
    };
    const sig = JSON.stringify(fields);
    if (!attempt.current || attempt.current.sig !== sig)
      attempt.current = { key: newKey("import"), sig };
    setBusy(true);
    try {
      const v = await importsApi.create({ idempotency_key: attempt.current.key, ...fields });
      attempt.current = null;
      go(`/import/${v.workspace.id}`);
    } catch (e) {
      const o = outcomeOf(e);
      setError(
        o.ok || o.status !== 0
          ? (e as Error).message
          : "No answer arrived. Your entries are still here; creating again won't make a second copy.",
      );
    } finally {
      setBusy(false);
    }
  };

  const ready =
    name.trim() &&
    (target !== "new" || businessName.trim()) &&
    !manifest.reading &&
    !manifest.error;
  return (
    <div className="page">
      <div className="eyebrow">Bring a product</div>
      <h1 className="display" style={{ fontSize: 40, margin: "4px 0 8px" }}>
        Bring a product you already run
      </h1>
      <p className="lede" style={{ maxWidth: 760 }}>
        Record what it is, see what its package.json declares, and track what handing it over would
        take. It stays private to you and belongs to one of your businesses. Connecting
        repositories, hosting and other accounts comes in a later step.
      </p>

      {mine && mine.length > 0 && (
        <section className="home-section">
          <h2 className="section-title">Your imported products</h2>
          <div className="biz-list">
            {mine.map((i) => (
              <Link key={i.id} to={`/import/${i.id}`} className="card link biz-row">
                <div style={{ minWidth: 0 }}>
                  <h3 style={{ fontSize: 18, margin: 0, overflowWrap: "anywhere" }}>{i.name}</h3>
                  <span className="muted" style={{ fontSize: 14 }}>
                    {i.business_name} · {PRODUCT_KIND_LABEL[i.product_kind]} ·{" "}
                    {i.inspections
                      ? `${i.inspections} inspection${i.inspections === 1 ? "" : "s"}`
                      : "No manifest yet"}{" "}
                    · {ago(i.updated_at)}
                  </span>
                </div>
                <span className="spacer" />
                <Counts counts={i.counts} />
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="card" style={{ maxWidth: 760 }} aria-labelledby="new-import">
        <h2 id="new-import">New import</h2>
        <p className="notice info">{SCOPE_SHORT}</p>
        <label className="field" htmlFor="imp-business">
          <span>Which business it belongs to</span>
          <select
            id="imp-business"
            className="input"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          >
            <option value="new">A new private business</option>
            {businesses.map((b) => (
              <option key={b.business_id} value={b.business_id}>
                {b.name}
              </option>
            ))}
          </select>
          <small>It moves with that business if the business is ever sold.</small>
        </label>
        {target === "new" && (
          <label className="field" htmlFor="imp-bname">
            <span>Name of the new business</span>
            <input
              id="imp-bname"
              className="input"
              maxLength={80}
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
            />
          </label>
        )}
        <label className="field" htmlFor="imp-name">
          <span>Product name</span>
          <input
            id="imp-name"
            className="input"
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="field" htmlFor="imp-desc">
          <span>What it does, in your words</span>
          <textarea
            id="imp-desc"
            className="input"
            rows={3}
            maxLength={1000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <KindSelect id="imp-kind" value={kind} onChange={setKind} />
        <ManifestInput
          id="imp-manifest"
          draft={manifest}
          onFile={(f) => {
            const rev = updateManifest(fileChosen).rev;
            readManifestFile(f).then((r) => updateManifest((d) => fileRead(d, rev, r)));
          }}
          onPaste={(t) => updateManifest((d) => pasted(d, t, byteLength(t) > MAX_MANIFEST_BYTES))}
          onClear={() => updateManifest(cleared)}
        />
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <div className="row" style={{ gap: 8 }}>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!ready || busy}
            onClick={submit}
          >
            {busy ? "Saving…" : manifest.value ? "Create and inspect" : "Create"}
          </button>
          <span className="muted" style={{ fontSize: 13 }}>
            You can add or update the manifest later.
          </span>
        </div>
      </section>
    </div>
  );
}

// ---------- /import/:id ----------

type Tab = "overview" | "dependencies" | "readiness";

export function ImportWorkspace({ id }: { id: string }) {
  const { person } = useSession();
  // One controller per person and workspace (the route is keyed by both). It owns every private
  // draft and every request, and retires them all when access ends or the page goes (004a2).
  const [c] = useState(() => new WorkspaceController(id, importsApi, () => newKey("inspect")));
  const s = useSyncExternalStore(c.subscribe, c.getState);
  const [tab, setTab] = useState<Tab>("overview");
  useEffect(() => {
    if (person) void c.load();
    return () => c.dispose();
  }, [person, c]);

  if (!person) return <SignIn reason="Sign in to open this import." />;
  if (s.status === "unavailable")
    return (
      <div className="page empty" role="status">
        <h2>This import is no longer available</h2>
        <p>{s.message}</p>
        <Link to="/import">Your imported products</Link>
      </div>
    );
  if (!s.view)
    return s.status === "error" ? (
      <div className="page empty">
        <h2>{s.message}</h2>
        <button type="button" className="btn btn-secondary" onClick={() => void c.load()}>
          Try again
        </button>{" "}
        <Link to="/import">Your imported products</Link>
      </div>
    ) : (
      <div className="page muted">Loading…</div>
    );
  const view = s.view;
  const { drafts, manifest, attempt, snapshot } = s;
  const w = view.workspace;
  const unsavedDeps = Object.keys(drafts.deps).length;
  const tabs: { id: Tab; label: string; note?: string }[] = [
    {
      id: "overview",
      label: "Overview",
      note: drafts.details || manifest.value ? "unsaved" : undefined,
    },
    {
      id: "dependencies",
      label: "Dependencies",
      note: unsavedDeps ? `${unsavedDeps} unsaved` : `${view.report.live.counts.unknown} unknown`,
    },
    { id: "readiness", label: "Readiness" },
  ];

  return (
    <div className="page">
      <div className="row" style={{ marginBottom: 4, flexWrap: "wrap" }}>
        <Link to="/import" className="muted">
          Bring a product
        </Link>
        <span className="muted">/</span>
        <span className="pill caution">Private</span>
        <span className="pill">{PRODUCT_KIND_LABEL[w.product_kind]}</span>
        <Link to={`/desk/${w.business.id}`} className="pill">
          {w.business.name}
        </Link>
      </div>
      <h1 className="display" style={{ fontSize: 36, margin: "6px 0", overflowWrap: "anywhere" }}>
        {w.name}
      </h1>
      <p className="notice" style={{ maxWidth: 900 }}>
        <strong>{view.report.live.headline}</strong>
        <br />
        Next: {view.report.live.next_action.text}
      </p>
      <div className="tabs" role="tablist" aria-label="Import sections">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            className="tab"
            onClick={() => setTab(t.id)}
            onKeyDown={(e) => {
              const i = tabs.findIndex((x) => x.id === tab);
              const next =
                e.key === "ArrowRight"
                  ? i + 1
                  : e.key === "ArrowLeft"
                    ? i - 1
                    : e.key === "Home"
                      ? 0
                      : e.key === "End"
                        ? tabs.length - 1
                        : null;
              if (next === null) return;
              e.preventDefault();
              const t2 = tabs[(next + tabs.length) % tabs.length];
              if (t2) {
                setTab(t2.id);
                document.getElementById(`tab-${t2.id}`)?.focus();
              }
            }}
          >
            {t.label}
            {t.note ? <span className="badge">{t.note}</span> : null}
          </button>
        ))}
      </div>
      {/* Only the chosen panel is in the page (and so in keyboard and screen-reader order);
          its drafts live in the controller, so leaving a tab loses nothing. */}
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === "overview" && (
          <Overview
            view={view}
            drafts={drafts}
            onDetails={c.editDetails}
            onDiscardDetails={c.discardDetails}
            onRebaseDetails={c.rebaseDetails}
            onSaveDetails={() => void c.saveDetails()}
            manifest={manifest}
            onFile={(f) => c.chooseFile(() => readManifestFile(f))}
            onPaste={(t) => c.paste(t, byteLength(t) > MAX_MANIFEST_BYTES)}
            onClear={c.clearManifest}
            attempt={attempt}
            onInspect={(recover) => void c.inspect(recover)}
          />
        )}
        {tab === "dependencies" && (
          <Dependencies
            view={view}
            drafts={drafts}
            onEdit={c.editDep}
            onRebase={c.rebaseDep}
            onDiscard={c.discardDep}
            onSave={(cat) => void c.saveDep(cat)}
          />
        )}
        {tab === "readiness" && (
          <Readiness view={view} snapshot={snapshot} onChoose={(n) => void c.chooseReport(n)} />
        )}
      </div>
    </div>
  );
}

function Overview({
  view,
  drafts,
  onDetails,
  onDiscardDetails,
  onRebaseDetails,
  onSaveDetails,
  manifest,
  onFile,
  onPaste,
  onClear,
  attempt,
  onInspect,
}: {
  view: ImportView;
  drafts: Drafts;
  onDetails: (d: DetailsDraft) => void;
  onDiscardDetails: () => void;
  onRebaseDetails: () => void;
  onSaveDetails: () => void;
  manifest: ManifestDraft;
  onFile: (f: File) => void;
  onPaste: (text: string) => void;
  onClear: () => void;
  attempt: InspectAttempt | null;
  onInspect: (recover: boolean) => void;
}) {
  const w = view.workspace;
  const d = detailsShown(view, drafts.details);
  const status = drafts.detailsStatus;
  const latest = view.source.latest;
  const sending = attempt?.state === "sending";
  return (
    <div className="desk">
      <div>
        <section className="card">
          <h2>Source facts</h2>
          {latest ? (
            <FactsView facts={latest.facts} number={latest.number} at={latest.created_at} />
          ) : (
            <p className="muted">
              No manifest inspected yet. Add the product's package.json to see what it declares.
            </p>
          )}
        </section>
        <section className="card">
          <h2>{latest ? "Inspect an updated manifest" : "Inspect a manifest"}</h2>
          <p className="muted" style={{ fontSize: 14 }}>
            {view.scope}
          </p>
          <ManifestInput
            id="ws-manifest"
            draft={manifest}
            onFile={onFile}
            onPaste={onPaste}
            onClear={onClear}
          />
          {attempt && attempt.state !== "sending" && (
            <div
              className={attempt.state === "unknown" ? "notice" : "notice error"}
              role="alert"
              style={{ fontSize: 13.5 }}
            >
              <strong>
                {attempt.state === "unknown"
                  ? "An inspection got no answer."
                  : "That file wasn't inspected."}
              </strong>{" "}
              {attempt.message}
              {attempt.state === "unknown" && (
                <div style={{ marginTop: 6 }}>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => onInspect(true)}
                  >
                    Check on that inspection (sends the same request)
                  </button>{" "}
                  <span className="muted">
                    It was {attempt.manifest.file_name ?? "pasted text"},{" "}
                    {byteLength(attempt.manifest.content).toLocaleString()} bytes.
                  </span>
                </div>
              )}
            </div>
          )}
          <button
            type="button"
            className="btn btn-primary"
            disabled={!manifest.value || manifest.reading || Boolean(manifest.error) || sending}
            onClick={() => onInspect(false)}
          >
            {sending ? "Inspecting…" : "Inspect"}
          </button>
          {view.source.history.length > 0 && (
            <details style={{ marginTop: 16 }}>
              <summary className="muted">Inspection history ({view.source.history.length})</summary>
              <ul className="missing-list" style={{ marginTop: 8 }}>
                {view.source.history.map((h) => (
                  <li key={h.number} style={{ overflowWrap: "anywhere" }}>
                    Inspection {h.number}: {h.dependency_count} packages,{" "}
                    {h.input_bytes.toLocaleString()} bytes, by {h.by},{" "}
                    {new Date(h.created_at).toLocaleString()} ·{" "}
                    <span className="mono">{h.input_digest.slice(0, 12)}</span> · {h.inspector}@
                    {h.inspector_version}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      </div>
      <aside className="studio-side">
        <section className="card">
          <h2>The product, in your words</h2>
          <label className="field" htmlFor="ws-name">
            <span>Name</span>
            <input
              id="ws-name"
              className="input"
              maxLength={80}
              value={d.name}
              onChange={(e) => onDetails({ ...d, name: e.target.value })}
            />
          </label>
          <label className="field" htmlFor="ws-desc">
            <span>What it does</span>
            <textarea
              id="ws-desc"
              className="input"
              rows={4}
              maxLength={1000}
              value={d.description}
              onChange={(e) => onDetails({ ...d, description: e.target.value })}
            />
          </label>
          <KindSelect
            id="ws-kind"
            value={d.product_kind}
            onChange={(k) => onDetails({ ...d, product_kind: k })}
          />
          <StatusLine status={status} unsaved={Boolean(drafts.details)} />
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={!drafts.details || !d.name.trim() || status?.state === "saving"}
              onClick={onSaveDetails}
            >
              {status?.state === "saving" ? "Saving…" : "Save details"}
            </button>
            {drafts.details && status?.state === "conflict" && (
              <>
                <button type="button" className="btn btn-quiet btn-sm" onClick={onRebaseDetails}>
                  Keep my text (then save over theirs)
                </button>
                <button type="button" className="btn btn-quiet btn-sm" onClick={onDiscardDetails}>
                  Use the saved version
                </button>
              </>
            )}
            {drafts.details && status?.state !== "conflict" && status?.state !== "saving" && (
              <button type="button" className="btn btn-quiet btn-sm" onClick={onDiscardDetails}>
                Discard changes
              </button>
            )}
          </div>
        </section>
        <section className="card">
          <h2>Where it belongs</h2>
          <p style={{ margin: 0, fontSize: 14 }}>
            Part of <Link to={`/desk/${w.business.id}`}>{w.business.name}</Link>. Private: customers
            and buyers never see it here. If the business is sold, it moves to the new owner with
            the business.
          </p>
        </section>
      </aside>
    </div>
  );
}

function FactsView({ facts, number, at }: { facts: Facts; number: number; at: string }) {
  const p = facts.package;
  const builtWith = facts.detections.filter(
    (d) => d.category === "framework" || d.category === "tooling",
  );
  const rows: [string, string | null][] = [
    ["Package", p.name],
    ["Version", p.version],
    ["Licence", p.license],
    ["Node", p.node_engine],
    ["Package manager", p.package_manager],
    ["Module type", p.module_type],
    ["Private flag", p.private === null ? null : p.private ? "Yes" : "No"],
  ];
  return (
    <div>
      <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
        From inspection {number}, {new Date(at).toLocaleString()}. Everything below is what the file
        declares, not proof of how the product is built or who owns it.
      </p>
      <dl className="facts" style={{ gridTemplateColumns: "130px minmax(0, 1fr)" }}>
        {rows.map(([k, v]) => (
          <div key={k} style={{ display: "contents" }}>
            <dt>{k}</dt>
            <dd style={{ overflowWrap: "anywhere" }}>
              {v ?? <span className="muted">Not declared</span>}
            </dd>
          </div>
        ))}
        <dt>Packages</dt>
        <dd>
          {facts.counts.total} declared ({facts.counts.by_group.dependencies ?? 0} runtime,{" "}
          {facts.counts.by_group.devDependencies ?? 0} development)
          {facts.skipped.invalid_names > 0 &&
            `, ${facts.skipped.invalid_names} skipped: not valid package names`}
        </dd>
        <dt>Shape</dt>
        <dd>
          {
            {
              web_app: "Looks like a web app",
              api_service: "Looks like an API service",
              unknown: "Not recognized",
            }[facts.shape.guess]
          }{" "}
          <span className="muted">({facts.shape.basis}; a guess from package names)</span>
        </dd>
        <dt>Scripts</dt>
        <dd>{facts.package.scripts_count} present, not stored or run</dd>
        {p.repository_field && (
          <>
            <dt>Repository</dt>
            <dd>A repository field is present. It isn't used as evidence of who owns the code.</dd>
          </>
        )}
      </dl>
      <h3 style={{ fontSize: 15, margin: "16px 0 8px" }}>Built with (detected in manifest)</h3>
      {builtWith.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>
          No framework or tooling this inspector recognizes.
        </p>
      ) : (
        <div className="chips">
          {builtWith.map((d) => (
            <span key={d.label} className="pill blue" title={d.packages.join(", ")}>
              {d.label}
              {d.dev_only ? " (development only)" : ""}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function Dependencies({
  view,
  drafts,
  onEdit,
  onRebase,
  onDiscard,
  onSave,
}: {
  view: ImportView;
  drafts: Drafts;
  onEdit: (c: Category, d: DepDraft) => void;
  onRebase: (c: Category) => void;
  onDiscard: (c: Category) => void;
  onSave: (c: Category) => void;
}) {
  const detected = (c: Category) =>
    (view.source.latest?.facts.detections ?? []).filter((d) => d.category === c);
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <p className="notice info" style={{ margin: 0 }}>
        For each item, say what the product uses and who controls that account. What the manifest
        shows is labelled separately. Nothing becomes verified by being recorded here: that needs
        connected accounts, which come in a later step. Never paste keys or passwords.
      </p>
      {view.inventory.map((i) => {
        const item = view.report.live.items.find((x) => x.category === i.category);
        return (
          <DependencyRow
            key={i.category}
            entry={i}
            status={item?.status ?? "unknown"}
            detected={detected(i.category)}
            draft={depShown(view, i.category, drafts.deps[i.category])}
            unsaved={Boolean(drafts.deps[i.category])}
            rowStatus={drafts.depStatus[i.category] ?? null}
            onEdit={(d) => onEdit(i.category, d)}
            onRebase={() => onRebase(i.category)}
            onDiscard={() => onDiscard(i.category)}
            onSave={() => onSave(i.category)}
          />
        );
      })}
    </div>
  );
}

function DependencyRow({
  entry,
  status,
  detected,
  draft,
  unsaved,
  rowStatus: rs,
  onEdit,
  onRebase,
  onDiscard,
  onSave,
}: {
  entry: ImportView["inventory"][number];
  status: ItemStatus;
  detected: Detection[];
  draft: DepDraft;
  unsaved: boolean;
  rowStatus: RowStatus | null;
  onEdit: (d: DepDraft) => void;
  onRebase: () => void;
  onDiscard: () => void;
  onSave: () => void;
}) {
  const a = entry.assertion;
  const base = `dep-${entry.category}`;
  const saving = rs?.state === "saving";
  return (
    <section className="card" aria-labelledby={`${base}-h`}>
      <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
        <h3 id={`${base}-h`} style={{ margin: 0, fontSize: 17 }}>
          {entry.label}
        </h3>
        <span className={STATUS_PILL[status]}>{STATUS_LABEL[status]}</span>
        {unsaved && <span className="pill caution">Unsaved</span>}
      </div>
      {detected.length > 0 && (
        <ul className="missing-list" style={{ margin: "8px 0" }}>
          {detected.map((d) => (
            <li key={d.label}>
              Detected in manifest: {d.label} ({d.packages.join(", ")}
              {d.dev_only ? ", development only" : ""})
            </li>
          ))}
        </ul>
      )}
      {a && (
        <p className="muted" style={{ fontSize: 13, margin: "6px 0", overflowWrap: "anywhere" }}>
          Saved: {a.uses ? `used: ${a.note}` : `not used${a.note ? `: ${a.note}` : ""}`} (by {a.by},{" "}
          {new Date(a.at).toLocaleString()})
        </p>
      )}
      <fieldset className="seg wrap" style={{ marginTop: 8 }}>
        <legend className="sr-only">Does the product use this?</legend>
        {(
          [
            ["yes", "Used"],
            ["no", "Not used"],
            ["unsaid", "Not said"],
          ] as [Uses, string][]
        ).map(([v, label]) => (
          <button
            key={v}
            type="button"
            aria-pressed={draft.uses === v}
            onClick={() => onEdit({ ...draft, uses: v })}
          >
            {label}
          </button>
        ))}
      </fieldset>
      {draft.uses !== "unsaid" && (
        <label className="field" htmlFor={`${base}-note`} style={{ marginTop: 10 }}>
          <span>
            {draft.uses === "yes"
              ? "What is used, and who controls the account"
              : "Anything to add (optional)"}
          </span>
          <input
            id={`${base}-note`}
            className="input"
            maxLength={300}
            value={draft.note}
            onChange={(e) => onEdit({ ...draft, note: e.target.value })}
          />
        </label>
      )}
      <StatusLine status={rs} unsaved={unsaved} />
      <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={!unsaved || saving || (draft.uses === "yes" && !draft.note.trim())}
          onClick={onSave}
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {unsaved && rs?.state === "conflict" && (
          <button type="button" className="btn btn-quiet btn-sm" onClick={onRebase}>
            Keep my answer (then save over the newer one)
          </button>
        )}
        {unsaved && !saving && (
          <button type="button" className="btn btn-quiet btn-sm" onClick={onDiscard}>
            Discard
          </button>
        )}
      </div>
    </section>
  );
}

function Readiness({
  view,
  snapshot,
  onChoose,
}: {
  view: ImportView;
  snapshot: Snapshot;
  onChoose: (n: number | null) => void;
}) {
  const shown: { title: string; report: Report } | null =
    snapshot.selected === null
      ? { title: "Readiness now", report: view.report.live }
      : snapshot.state === "loaded"
        ? {
            title: `Saved report ${snapshot.selected} (from ${new Date(snapshot.created_at).toLocaleString()}, unchanged since)`,
            report: snapshot.report,
          }
        : null;
  return (
    <div className="desk">
      <div>
        <section
          className="card"
          aria-busy={
            snapshot.selected !== null && "state" in snapshot && snapshot.state === "loading"
          }
        >
          {shown ? (
            <>
              <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
                <h2 style={{ margin: 0 }}>{shown.title}</h2>
                <span className="spacer" />
                <Counts counts={shown.report.counts} />
              </div>
              {snapshot.selected !== null && (
                <p className="notice info" style={{ marginTop: 10 }}>
                  This is a saved report, kept as it was. Today's guidance is under "Now".
                </p>
              )}
              <p className="muted" style={{ fontSize: 13 }}>
                {shown.report.basis}
              </p>
              <ReportTable report={shown.report} />
            </>
          ) : snapshot.selected !== null && snapshot.state === "error" ? (
            <p className="error-text" role="alert">
              Report {snapshot.selected} couldn't be loaded: {snapshot.message}
            </p>
          ) : (
            <p className="muted" role="status">
              Loading report {snapshot.selected}…
            </p>
          )}
        </section>
      </div>
      <aside className="studio-side">
        <section className="card">
          <h2>One next action</h2>
          <p style={{ margin: 0 }}>{view.report.live.next_action.text}</p>
        </section>
        <section className="card">
          <h2>Saved reports</h2>
          <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
            One is saved with each inspection and never changes, so you can see what an updated
            manifest changed.
          </p>
          <div className="chips">
            <button
              type="button"
              className="btn btn-sm btn-secondary"
              aria-pressed={snapshot.selected === null}
              onClick={() => onChoose(null)}
            >
              Now
            </button>
            {view.report.history.map((h) => (
              <button
                key={h.number}
                type="button"
                className="btn btn-sm btn-quiet"
                aria-pressed={snapshot.selected === h.number}
                onClick={() => onChoose(h.number)}
              >
                Report {h.number}
              </button>
            ))}
          </div>
          {view.report.history.length === 0 && (
            <p className="muted">None yet: inspect a manifest to save the first.</p>
          )}
        </section>
      </aside>
    </div>
  );
}

function ReportTable({ report }: { report: Report }) {
  return (
    <Scroll label="Readiness items (scrolls sideways)" className="fin-table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">Item</th>
            <th scope="col">Evidence</th>
            <th scope="col">How it moves</th>
            <th scope="col">Next step</th>
          </tr>
        </thead>
        <tbody>
          {report.items.map((i) => (
            <tr key={i.category}>
              <td style={{ minWidth: 150 }}>
                <strong>{i.label}</strong>
                <div style={{ marginTop: 4 }}>
                  <span className={STATUS_PILL[i.status]}>{STATUS_LABEL[i.status]}</span>
                </div>
              </td>
              <td style={{ minWidth: 180, overflowWrap: "anywhere" }}>
                {i.evidence.length ? (
                  i.evidence.map((e) => (
                    <div key={e.text} style={{ fontSize: 13.5 }}>
                      {e.text}
                    </div>
                  ))
                ) : (
                  <span className="muted">None yet</span>
                )}
              </td>
              <td style={{ minWidth: 220, fontSize: 13.5 }}>
                {i.mechanism}
                <div className="muted" style={{ marginTop: 4 }}>
                  {i.risk === "high" ? "High risk" : "Medium risk"}: {i.risk_text} Who acts: {i.who}
                  .
                </div>
              </td>
              <td style={{ minWidth: 160, fontSize: 13.5 }}>{i.next_step}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Scroll>
  );
}

/** The business desk's list of its imported products. */
export function DeskImports({ businessId }: { businessId: string }) {
  const [rows, setRows] = useState<ImportSummary[] | null>(null);
  useEffect(() => {
    let live = true;
    importsApi
      .forBusiness(businessId)
      .then((r) => live && setRows(r.imports))
      .catch(() => live && setRows([]));
    return () => {
      live = false;
    };
  }, [businessId]);
  return (
    <section className="card">
      <div className="row" style={{ marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}>Imported products</h2>
        <span className="spacer" />
        <Link to="/import" className="btn btn-secondary btn-sm">
          Bring a product
        </Link>
      </div>
      {rows === null ? (
        <p className="muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>
          None yet. A product you already run can be recorded here, privately, with what handing it
          over would take.
        </p>
      ) : (
        rows.map((r) => (
          <Link key={r.id} to={`/import/${r.id}`} className="deal-row row">
            <strong style={{ overflowWrap: "anywhere" }}>{r.name}</strong>
            <span className="pill">{PRODUCT_KIND_LABEL[r.product_kind]}</span>
            <span className="spacer" />
            <span className="muted" style={{ fontSize: 13 }}>
              {r.unresolved} of 8 transfer items not verified · {ago(r.updated_at)}
            </span>
          </Link>
        ))
      )}
    </section>
  );
}
