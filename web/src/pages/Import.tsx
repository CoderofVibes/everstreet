// Bring an existing product (job 004a). A private import workspace for one product: what its
// supplied package.json declares, an inventory of what it depends on, and a readiness report
// for handing it over. Nothing is fetched, installed or run, and nothing here is "verified":
// verifying accounts needs connections that come in a later step.

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api.ts";
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
import { ago } from "../productsApi.ts";
import { Link, useRouter } from "../router.tsx";
import { useSession } from "../session.tsx";
import { newKey } from "./Builds.tsx";

const SCOPE_SHORT =
  "We read the package.json you supply: its package details and the packages it declares. Your code isn't fetched, installed or run, scripts are ignored, and nothing that looks like a key or password is accepted.";

const STATUS_PILL: Record<ItemStatus, string> = {
  verified: "pill lime",
  detected: "pill blue",
  declared: "pill",
  unknown: "pill caution",
};

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

/** A package.json, chosen as a file or pasted. Checked here for size; the server decides. */
function ManifestInput({
  value,
  onChange,
  id,
}: {
  value: Manifest | null;
  onChange: (m: Manifest | null) => void;
  id: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [paste, setPaste] = useState(value && value.file_name === null ? value.content : "");
  return (
    <div>
      <label className="field" htmlFor={`${id}-file`}>
        <span>package.json file</span>
        <input
          id={`${id}-file`}
          type="file"
          accept=".json,application/json"
          className="input"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            setError(null);
            if (!f) return onChange(null);
            if (f.size > MAX_MANIFEST_BYTES) {
              setError("That file is larger than 64 KiB. Only the package.json file is needed.");
              return onChange(null);
            }
            if (f.name !== "package.json") {
              setError("Choose the file named package.json; other files aren't read.");
              return onChange(null);
            }
            setPaste("");
            onChange({ file_name: f.name, content: await f.text() });
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
          value={paste}
          spellCheck={false}
          onChange={(e) => {
            const t = e.target.value;
            setPaste(t);
            setError(
              byteLength(t) > MAX_MANIFEST_BYTES ? "That text is larger than 64 KiB." : null,
            );
            onChange(t.trim() ? { file_name: null, content: t } : null);
          }}
        />
      </label>
      {value && !error && (
        <p className="muted" style={{ fontSize: 13, marginTop: -8 }}>
          {value.file_name ? `Chosen: ${value.file_name}` : "Pasted text"} ·{" "}
          {byteLength(value.content).toLocaleString()} bytes
        </p>
      )}
      {error && (
        <p className="error-text" role="alert">
          {error}
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
  const [manifest, setManifest] = useState<Manifest | null>(null);
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
    setError(null);
    const fields = {
      ...(target === "new" ? { new_business_name: businessName.trim() } : { business_id: target }),
      name: name.trim(),
      description: description.trim(),
      product_kind: kind,
      ...(manifest ? { manifest } : {}),
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
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const ready = name.trim() && (target !== "new" || businessName.trim());
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
                <div>
                  <h3 style={{ fontSize: 18, margin: 0 }}>{i.name}</h3>
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
        <ManifestInput id="imp-manifest" value={manifest} onChange={setManifest} />
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
            {busy ? "Saving…" : manifest ? "Create and inspect" : "Create"}
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
  const [view, setView] = useState<ImportView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  // Only the newest answer is shown: an older one finishing late can't restore stale data.
  const seq = useRef(0);
  const epoch = useRef<string | null>(null);
  const [resetToken, setResetToken] = useState(0);

  const accept = useCallback((v: ImportView) => {
    // A change of control resets every unsaved draft on this page.
    if (epoch.current !== null && epoch.current !== v.workspace.owner_epoch)
      setResetToken((n) => n + 1);
    epoch.current = v.workspace.owner_epoch;
    setView(v);
  }, []);

  const load = useCallback(() => {
    const n = ++seq.current;
    importsApi
      .get(id)
      .then((v) => n === seq.current && accept(v))
      .catch((e) => {
        if (n !== seq.current) return;
        setView(null);
        setError((e as Error).message);
      });
  }, [id, accept]);

  useEffect(() => {
    if (person) load();
    return () => {
      seq.current++;
    };
  }, [person, load]);

  /** Applies a write's answer unless a newer load has started since. */
  const apply = useCallback(
    async (write: () => Promise<ImportView>) => {
      const n = ++seq.current;
      const v = await write();
      if (n === seq.current) accept(v);
    },
    [accept],
  );

  if (!person) return <SignIn reason="Sign in to open this import." />;
  if (error)
    return (
      <div className="page empty">
        <h2>{error}</h2>
        <Link to="/import">Your imported products</Link>
      </div>
    );
  if (!view) return <div className="page muted">Loading…</div>;
  const w = view.workspace;
  const tabs: { id: Tab; label: string; badge?: number }[] = [
    { id: "overview", label: "Overview" },
    { id: "dependencies", label: "Dependencies", badge: view.report.live.counts.unknown },
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
      <h1 className="display" style={{ fontSize: 36, margin: "6px 0" }}>
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
              const next = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : null;
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
            {t.badge ? <span className="badge">{t.badge} unknown</span> : null}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === "overview" && <Overview key={`o${resetToken}`} view={view} apply={apply} />}
        {tab === "dependencies" && (
          <Dependencies key={`d${resetToken}`} view={view} apply={apply} />
        )}
        {tab === "readiness" && <Readiness view={view} />}
      </div>
    </div>
  );
}

type Apply = (write: () => Promise<ImportView>) => Promise<void>;

function Overview({ view, apply }: { view: ImportView; apply: Apply }) {
  const w = view.workspace;
  const [name, setName] = useState(w.name);
  const [description, setDescription] = useState(w.description);
  const [kind, setKind] = useState<ProductKind>(w.product_kind);
  const [base, setBase] = useState(w.version);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [inspectError, setInspectError] = useState<string | null>(null);
  const attempt = useRef<{ key: string; digest: string } | null>(null);
  const dirty = name !== w.name || description !== w.description || kind !== w.product_kind;
  const latest = view.source.latest;

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
            key={view.source.history.length}
            id="ws-manifest"
            value={manifest}
            onChange={setManifest}
          />
          {inspectError && (
            <p className="error-text" role="alert">
              {inspectError}
            </p>
          )}
          <button
            type="button"
            className="btn btn-primary"
            disabled={!manifest || inspecting}
            onClick={async () => {
              if (!manifest) return;
              setInspectError(null);
              if (!attempt.current || attempt.current.digest !== manifest.content)
                attempt.current = { key: newKey("inspect"), digest: manifest.content };
              setInspecting(true);
              try {
                await apply(() =>
                  importsApi.inspect(w.id, {
                    idempotency_key: attempt.current?.key ?? newKey("inspect"),
                    ...manifest,
                  }),
                );
                attempt.current = null;
                setManifest(null);
              } catch (e) {
                setInspectError((e as Error).message);
              } finally {
                setInspecting(false);
              }
            }}
          >
            {inspecting ? "Inspecting…" : "Inspect"}
          </button>
          {view.source.history.length > 0 && (
            <details style={{ marginTop: 16 }}>
              <summary className="muted">Inspection history ({view.source.history.length})</summary>
              <ul className="missing-list" style={{ marginTop: 8 }}>
                {view.source.history.map((h) => (
                  <li key={h.number}>
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
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="field" htmlFor="ws-desc">
            <span>What it does</span>
            <textarea
              id="ws-desc"
              className="input"
              rows={4}
              maxLength={1000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <KindSelect id="ws-kind" value={kind} onChange={setKind} />
          {msg && (
            <p className={msg.ok ? "muted" : "error-text"} role={msg.ok ? "status" : "alert"}>
              {msg.text}
            </p>
          )}
          <button
            type="button"
            className="btn btn-secondary"
            disabled={!dirty || !name.trim()}
            onClick={async () => {
              setMsg(null);
              try {
                await apply(async () => {
                  const v = await importsApi.update(w.id, {
                    version: base,
                    name,
                    description,
                    product_kind: kind,
                  });
                  setBase(v.workspace.version);
                  return v;
                });
                setMsg({ ok: true, text: "Saved." });
              } catch (e) {
                setMsg({ ok: false, text: (e as Error).message });
              }
            }}
          >
            Save details
          </button>
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
      <dl className="facts" style={{ gridTemplateColumns: "130px 1fr" }}>
        {rows.map(([k, v]) => (
          <div key={k} style={{ display: "contents" }}>
            <dt>{k}</dt>
            <dd>{v ?? <span className="muted">Not declared</span>}</dd>
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

function Dependencies({ view, apply }: { view: ImportView; apply: Apply }) {
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
            id={view.workspace.id}
            entry={i}
            status={item?.status ?? "unknown"}
            detected={detected(i.category)}
            apply={apply}
          />
        );
      })}
    </div>
  );
}

function DependencyRow({
  id,
  entry,
  status,
  detected,
  apply,
}: {
  id: string;
  entry: ImportView["inventory"][number];
  status: ItemStatus;
  detected: Detection[];
  apply: Apply;
}) {
  const a = entry.assertion;
  const [uses, setUses] = useState<"yes" | "no" | "unsaid">(a ? (a.uses ? "yes" : "no") : "unsaid");
  const [note, setNote] = useState(a?.note ?? "");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const changed = uses !== (a ? (a.uses ? "yes" : "no") : "unsaid") || note !== (a?.note ?? "");
  const base = `dep-${entry.category}`;
  return (
    <section className="card" aria-labelledby={`${base}-h`}>
      <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
        <h3 id={`${base}-h`} style={{ margin: 0, fontSize: 17 }}>
          {entry.label}
        </h3>
        <span className={STATUS_PILL[status]}>{STATUS_LABEL[status]}</span>
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
        <p className="muted" style={{ fontSize: 13, margin: "6px 0" }}>
          Recorded by {a.by}, {new Date(a.at).toLocaleString()}
        </p>
      )}
      <fieldset className="seg wrap" style={{ marginTop: 8 }}>
        <legend className="sr-only">Does the product use this?</legend>
        {(
          [
            ["yes", "Used"],
            ["no", "Not used"],
            ["unsaid", "Not said"],
          ] as const
        ).map(([v, label]) => (
          <button key={v} type="button" aria-pressed={uses === v} onClick={() => setUses(v)}>
            {label}
          </button>
        ))}
      </fieldset>
      {uses !== "unsaid" && (
        <label className="field" htmlFor={`${base}-note`} style={{ marginTop: 10 }}>
          <span>
            {uses === "yes"
              ? "What is used, and who controls the account"
              : "Anything to add (optional)"}
          </span>
          <input
            id={`${base}-note`}
            className="input"
            maxLength={300}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
      )}
      {msg && (
        <p className={msg.ok ? "muted" : "error-text"} role={msg.ok ? "status" : "alert"}>
          {msg.text}
        </p>
      )}
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        style={{ marginTop: 8 }}
        disabled={!changed || (uses === "yes" && !note.trim())}
        onClick={async () => {
          setMsg(null);
          try {
            await apply(() =>
              importsApi.declare(id, entry.category, {
                version: entry.version,
                uses: uses === "unsaid" ? null : uses === "yes",
                note: uses === "unsaid" ? "" : note,
              }),
            );
            setMsg({ ok: true, text: "Recorded." });
          } catch (e) {
            setMsg({ ok: false, text: (e as Error).message });
          }
        }}
      >
        Save
      </button>
    </section>
  );
}

function Readiness({ view }: { view: ImportView }) {
  const [chosen, setChosen] = useState<number | null>(null);
  const [old, setOld] = useState<{ number: number; created_at: string; report: Report } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const id = view.workspace.id;
  useEffect(() => {
    if (chosen === null) {
      setOld(null);
      return;
    }
    let live = true;
    setError(null);
    importsApi
      .report(id, chosen)
      .then((r) => live && setOld(r))
      .catch((e) => live && setError((e as Error).message));
    return () => {
      live = false;
    };
  }, [id, chosen]);
  const report = old?.report ?? view.report.live;
  return (
    <div className="desk">
      <div>
        <section className="card">
          <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
            <h2 style={{ margin: 0 }}>
              {old
                ? `Report ${old.number} (saved ${new Date(old.created_at).toLocaleString()})`
                : "Readiness now"}
            </h2>
            <span className="spacer" />
            <Counts counts={report.counts} />
          </div>
          <p className="muted" style={{ fontSize: 13 }}>
            {report.basis}
          </p>
          {error && <p className="error-text">{error}</p>}
          <div className="fin-table-wrap">
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
                    <td style={{ minWidth: 180 }}>
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
                        {i.risk === "high" ? "High risk" : "Medium risk"}: {i.risk_text} Who acts:{" "}
                        {i.who}.
                      </div>
                    </td>
                    <td style={{ minWidth: 160, fontSize: 13.5 }}>{i.next_step}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
              aria-pressed={chosen === null}
              onClick={() => setChosen(null)}
            >
              Now
            </button>
            {view.report.history.map((h) => (
              <button
                key={h.number}
                type="button"
                className="btn btn-sm btn-quiet"
                aria-pressed={chosen === h.number}
                onClick={() => setChosen(h.number)}
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
            <strong>{r.name}</strong>
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
