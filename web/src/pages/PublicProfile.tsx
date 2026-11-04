// Job 001d: the owner's public profile editor. Edit a draft, save it, review the exact preview of
// what customers would see, and publish that reviewed version. Saving never changes the live
// profile. Unsaved edits survive reloads and conflicts; a former owner's view is never kept (the
// route is keyed by actor and business, and access loss drops everything).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { initialLoad, type LoadState, latestLoader } from "../latestLoad.ts";
import {
  afterSave,
  cleanDraft,
  isDirty,
  type ProfileDraft,
  type ProfileExample,
  type ProfileView,
  publicationApi,
  publishBlocked,
  savedMessage,
  unpublishOutcome,
} from "../publication.ts";
import { Link } from "../router.tsx";
import { useSession } from "../session.tsx";
import { DigitalStorefront } from "./DigitalStorefront.tsx";

const CHOICE_STATE: Record<ProfileView["choices"][number]["state"], string> = {
  in_development: "in development",
  released: "released, not offered",
  offered: "released and offered to customers",
};

/**
 * Job 001e: the owner-written illustrative example: one featured product, a fictional input and
 * a few result rows. Never filled from customer, evaluation or build data.
 */
function ExampleEditor({
  example,
  featured,
  limits,
  onChange,
}: {
  example: ProfileExample | null;
  featured: ProfileView["choices"];
  limits: ProfileView["limits"];
  onChange: (e: ProfileExample | null) => void;
}) {
  return (
    <fieldset className="field example-editor">
      <legend style={{ fontSize: 14 }}>Example (optional)</legend>
      <p className="muted" style={{ fontSize: 13, margin: "0 0 8px" }}>
        Show visitors what the product does with an example you write. Use invented content only:
        never paste a customer's document, a real result or anything private. It's shown as an
        illustration, not a live run.
      </p>
      {!example ? (
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={featured.length === 0}
          onClick={() =>
            onChange({
              product: featured[0]?.project_id ?? "",
              input: "",
              outputs: [{ label: "", value: "" }],
            })
          }
        >
          Add an example
        </button>
      ) : (
        <>
          <label className="field">
            <span>For which product</span>
            <select
              className="input"
              value={example.product}
              onChange={(e) => onChange({ ...example, product: e.target.value })}
            >
              {featured.map((c) => (
                <option key={c.project_id} value={c.project_id}>
                  {c.public_name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Example input (fictional, up to {limits.exampleInput} characters)</span>
            <textarea
              className="input"
              maxLength={limits.exampleInput}
              value={example.input}
              onChange={(e) => onChange({ ...example, input: e.target.value })}
            />
          </label>
          <div className="field">
            <span>Example result (up to {limits.exampleOutputs} rows)</span>
            {example.outputs.map((o, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: rows are edited in place; position is their identity
              <div key={i} className="row example-row">
                <input
                  className="input"
                  aria-label={`Result ${i + 1} label`}
                  placeholder="Label, e.g. Total"
                  maxLength={limits.exampleLabel}
                  value={o.label}
                  onChange={(e) =>
                    onChange({
                      ...example,
                      outputs: example.outputs.map((x, j) =>
                        j === i ? { ...x, label: e.target.value } : x,
                      ),
                    })
                  }
                />
                <input
                  className="input"
                  aria-label={`Result ${i + 1} value`}
                  placeholder="Value"
                  maxLength={limits.exampleValue}
                  value={o.value}
                  onChange={(e) =>
                    onChange({
                      ...example,
                      outputs: example.outputs.map((x, j) =>
                        j === i ? { ...x, value: e.target.value } : x,
                      ),
                    })
                  }
                />
                <button
                  type="button"
                  className="btn btn-quiet btn-sm"
                  aria-label={`Remove result ${i + 1}`}
                  disabled={example.outputs.length <= 1}
                  onClick={() =>
                    onChange({ ...example, outputs: example.outputs.filter((_, j) => j !== i) })
                  }
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              type="button"
              className="btn btn-quiet btn-sm"
              disabled={example.outputs.length >= limits.exampleOutputs}
              onClick={() =>
                onChange({ ...example, outputs: [...example.outputs, { label: "", value: "" }] })
              }
            >
              Add a result row
            </button>
          </div>
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => onChange(null)}>
            Remove example
          </button>
        </>
      )}
    </fieldset>
  );
}

export function PublicProfileEditor({ id }: { id: string }) {
  const { person, requireSignIn } = useSession();
  const [ls, setLs] = useState<LoadState<ProfileView>>(initialLoad);
  const [local, setLocal] = useState<ProfileDraft | null>(null);
  // 001d1: the latest local draft, for replies that arrive after the user kept typing.
  const localRef = useRef<ProfileDraft | null>(null);
  localRef.current = local;
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const loader = useMemo(
    () =>
      latestLoader<ProfileView>(
        () => publicationApi.view(id),
        (p) => setLs((prev) => ({ ...prev, ...p })),
      ),
    [id],
  );
  useEffect(() => {
    loader.open();
    return () => loader.close();
  }, [loader]);
  const load = useCallback(() => loader.load(), [loader]);
  useEffect(() => {
    if (!person) return;
    load();
  }, [person, load]);
  const view = ls.data;
  // A loaded draft fills the editor unless there are unsaved edits.
  useEffect(() => {
    if (!view) {
      if (ls.status === "refused") setLocal(null);
      return;
    }
    setLocal((cur) => (cur && isDirty(cur, view.draft) ? cur : view.draft));
  }, [view, ls.status]);

  if (!person)
    return (
      <div className="page empty">
        <h2>Sign in to edit this business's public profile.</h2>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => requireSignIn("Sign in to edit the public profile.")}
        >
          Sign in or join
        </button>
      </div>
    );
  if (!view && (ls.status === "refused" || ls.status === "failed"))
    return (
      <div className="page empty">
        <h2>{ls.error}</h2>
        {ls.status === "failed" && (
          <button type="button" className="btn" onClick={load}>
            Try again
          </button>
        )}
        <Link to="/desk">Your businesses</Link>
      </div>
    );
  if (!view || !local) return <div className="page muted">Loading…</div>;

  const dirty = isDirty(cleanDraft(local), view.draft);
  const blocked = publishBlocked(view, dirty);
  const set = (patch: Partial<ProfileDraft>) => setLocal({ ...local, ...patch });
  /** Applies a newer view from an action's reply; any read still in flight is older (001d1). */
  const applyReply = (v: ProfileView) => {
    loader.invalidate();
    setLs({ data: v, error: null, status: "ready" });
  };
  const save = async () => {
    setBusy(true);
    const sent = cleanDraft(local);
    try {
      const v = await publicationApi.save(id, view.draft_rev, sent);
      applyReply(v);
      // 001d1: text typed while the save was in flight is kept, not overwritten.
      const next = afterSave(localRef.current ?? sent, sent, v.draft);
      setLocal(next.local);
      setNote({ tone: "ok", text: savedMessage(v, next.typedAhead) });
    } catch (e) {
      // A conflict keeps the edits here; the latest saved draft is loaded alongside.
      setNote({ tone: "error", text: (e as Error).message });
      load();
    }
    setBusy(false);
  };
  const publish = async () => {
    setBusy(true);
    try {
      // 001d1: the reviewed revision and the identity of the preview shown with it.
      const v = await publicationApi.publish(id, view.draft_rev, view.review);
      applyReply(v);
      setNote({
        tone: "ok",
        text: v.already
          ? "This version was already live."
          : `Published version ${v.live_rev} on this site.`,
      });
    } catch (e) {
      setNote({ tone: "error", text: (e as Error).message });
      load();
    }
    setBusy(false);
  };
  const takeDown = async () => {
    if (!window.confirm("Take the page down? Customers keep their existing uses.")) return;
    setBusy(true);
    let failure: unknown = null;
    try {
      await publicationApi.unpublish(id);
    } catch (e) {
      failure = e;
    }
    const outcome = unpublishOutcome(failure);
    setNote({ tone: outcome.tone === "ok" ? "ok" : "error", text: outcome.text });
    // Whatever happened, read the actual state again (an uncertain answer is checked, not guessed).
    await load();
    setBusy(false);
  };
  const L = view.limits;
  return (
    <div className="page">
      <Link to={`/desk/${id}`}>← Back to the desk</Link>
      <div className="eyebrow" style={{ marginTop: 16 }}>
        Public profile
      </div>
      <h1 className="display" style={{ fontSize: 32, margin: "0 0 6px" }}>
        What customers see
      </h1>
      <p className="muted" style={{ maxWidth: "70ch" }}>
        Edit and save a draft, review exactly what it will show, then publish that version. Saving
        never changes what is live. Publishing shows this page on this site only; it doesn't list
        the business for sale or change any product, price or release.
      </p>
      <p style={{ fontSize: 14 }}>
        <strong>Live now:</strong>{" "}
        {view.live && view.page_published
          ? `version ${view.live_rev}, published ${view.live_published_at?.replace("T", " ").slice(0, 16)} UTC`
          : view.live
            ? "a published version exists but the page is taken down"
            : "nothing published yet"}
        {" · "}
        <strong>Draft:</strong> version {view.draft_rev}
        {dirty ? " (unsaved changes)" : ""}
        {/* Job 001e: straight to what customers see now. */}
        {view.live && view.page_published && (
          <>
            {" · "}
            <Link to={`/b/${view.slug}`}>View live page</Link>
          </>
        )}
      </p>
      {view.live_outdated && view.page_published && (
        <p className="notice">
          A featured product has a newer release than the one your live page shows. The live page
          keeps the version you reviewed; review the preview and publish again to show the new one.
        </p>
      )}
      {ls.status === "failed" && (
        <p className="notice">
          {ls.error}{" "}
          <button type="button" className="btn btn-quiet btn-sm" onClick={load}>
            Check again
          </button>
        </p>
      )}
      <div className="desk">
        <section className="card">
          <h2>Draft</h2>
          <label className="field">
            <span>Headline</span>
            <input
              className="input"
              maxLength={L.headline}
              value={local.headline}
              onChange={(e) => set({ headline: e.target.value })}
            />
          </label>
          <label className="field">
            <span>What it does</span>
            <textarea
              className="input"
              maxLength={L.summary}
              value={local.summary}
              onChange={(e) => set({ summary: e.target.value })}
            />
          </label>
          <label className="field">
            <span>Who it helps</span>
            <input
              className="input"
              maxLength={L.audience}
              value={local.audience}
              onChange={(e) => set({ audience: e.target.value })}
            />
          </label>
          <label className="field">
            <span>What it can do (one per line, up to {L.capabilities})</span>
            <textarea
              className="input"
              value={local.capabilities.join("\n")}
              onChange={(e) =>
                set({
                  capabilities: e.target.value
                    .split("\n")
                    .slice(0, L.capabilities)
                    .map((c) => c.slice(0, L.capability)),
                })
              }
            />
          </label>
          <fieldset className="field" style={{ border: 0, padding: 0 }}>
            <legend style={{ fontSize: 14 }}>Products to feature (up to {L.products})</legend>
            {view.choices.length === 0 && (
              <p className="muted" style={{ fontSize: 13 }}>
                No product projects yet. <Link to={`/build?business=${id}`}>Start one</Link>.
              </p>
            )}
            {view.choices.map((p) => (
              <label key={p.project_id} className="check">
                <input
                  type="checkbox"
                  checked={local.products.includes(p.project_id)}
                  disabled={
                    !local.products.includes(p.project_id) && local.products.length >= L.products
                  }
                  onChange={(e) =>
                    set({
                      products: e.target.checked
                        ? [...local.products, p.project_id]
                        : local.products.filter((x) => x !== p.project_id),
                    })
                  }
                />
                {/* 001d1: the name customers would see, its state, and the private brief name. */}
                <span>
                  {p.public_name}{" "}
                  <span className="muted" style={{ fontSize: 13 }}>
                    · {CHOICE_STATE[p.state]}
                    {p.brief_name && p.brief_name !== p.public_name
                      ? ` · brief: ${p.brief_name}`
                      : ""}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
          <ExampleEditor
            example={local.example}
            featured={view.choices.filter((c) => local.products.includes(c.project_id))}
            limits={L}
            onChange={(example) => set({ example })}
          />
          {note && (
            <p className={note.tone === "ok" ? "notice ok" : "error-text"} role="status">
              {note.text}
            </p>
          )}
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={busy || !dirty}
              onClick={save}
            >
              Save draft
            </button>
            {dirty && (
              <button
                type="button"
                className="btn btn-quiet"
                disabled={busy}
                onClick={() => setLocal(view.draft)}
              >
                Discard my changes
              </button>
            )}
          </div>
        </section>
        <aside className="studio-side" style={{ position: "static" }}>
          <div className="eyebrow">Publish</div>
          <p className="muted" style={{ fontSize: 13, margin: 0 }}>
            The preview below is saved version {view.draft_rev}, exactly as customers would see it.
            {dirty ? " Save your changes to update it." : ""}
          </p>
          {!view.eligibility.ok && (
            <ul className="muted" style={{ fontSize: 13 }}>
              {view.eligibility.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          )}
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || blocked !== null}
            onClick={publish}
          >
            Publish version {view.draft_rev}
          </button>
          {blocked && (
            <p className="muted" style={{ fontSize: 13 }}>
              {blocked}
            </p>
          )}
          {view.page_published && (
            <button type="button" className="btn btn-quiet" disabled={busy} onClick={takeDown}>
              Take the page down
            </button>
          )}
        </aside>
      </div>
      {/* Job 001e: the exact storefront the saved version would publish, full width. */}
      <section
        className="profile-preview"
        aria-label={`Preview of saved version ${view.draft_rev}`}
      >
        <div className="eyebrow">Preview of saved version {view.draft_rev}</div>
        <DigitalStorefront
          name={view.business_name}
          d={view.preview}
          family="Digital product"
          founder={null}
          preview
        />
      </section>
    </div>
  );
}
