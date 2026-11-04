// Job 001d: the owner's public profile editor. Edit a draft, save it, review the exact preview of
// what customers would see, and publish that reviewed version. Saving never changes the live
// profile. Unsaved edits survive reloads and conflicts; a former owner's view is never kept (the
// route is keyed by actor and business, and access loss drops everything).

import { useCallback, useEffect, useMemo, useState } from "react";
import { api4, type DeskProduct } from "../api4.ts";
import { initialLoad, type LoadState, latestLoader } from "../latestLoad.ts";
import {
  cleanDraft,
  isDirty,
  type ProfileDraft,
  type ProfileView,
  publicationApi,
  publishBlocked,
} from "../publication.ts";
import { Link } from "../router.tsx";
import { useSession } from "../session.tsx";
import { DigitalProfile } from "./DigitalProfile.tsx";

export function PublicProfileEditor({ id }: { id: string }) {
  const { person, requireSignIn } = useSession();
  const [ls, setLs] = useState<LoadState<ProfileView>>(initialLoad);
  const [local, setLocal] = useState<ProfileDraft | null>(null);
  const [products, setProducts] = useState<DeskProduct[]>([]);
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
    api4
      .digitalDesk(id)
      .then((d) => setProducts(d.products.shown))
      .catch(() => setProducts([]));
  }, [person, load, id]);
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
  const save = async () => {
    setBusy(true);
    try {
      const v = await publicationApi.save(id, view.draft_rev, cleanDraft(local));
      setLs({ data: v, error: null, status: "ready" });
      setLocal(v.draft);
      setNote({ tone: "ok", text: "Saved. Review the preview below; nothing is public yet." });
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
      const v = await publicationApi.publish(id, view.draft_rev);
      setLs({ data: v, error: null, status: "ready" });
      setNote({
        tone: "ok",
        text: v.already ? "This version was already live." : "Published on this site.",
      });
    } catch (e) {
      setNote({ tone: "error", text: (e as Error).message });
      load();
    }
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
      </p>
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
            {products.length === 0 && (
              <p className="muted" style={{ fontSize: 13 }}>
                No product projects yet. <Link to={`/build?business=${id}`}>Start one</Link>.
              </p>
            )}
            {products.map((p) => (
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
                <span>
                  {p.name ?? "Unnamed product"}{" "}
                  <span className="muted" style={{ fontSize: 13 }}>
                    · {p.status === "brief_only" ? "in development" : p.status.replace("_", " ")}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
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
          <div className="eyebrow">Preview of the saved draft (version {view.draft_rev})</div>
          <DigitalProfile d={view.preview} preview />
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
            <button
              type="button"
              className="btn btn-quiet"
              disabled={busy}
              onClick={async () => {
                if (!window.confirm("Take the page down? Customers keep their existing uses."))
                  return;
                await publicationApi.unpublish(id).catch(() => {});
                load();
              }}
            >
              Take the page down
            </button>
          )}
        </aside>
      </div>
    </div>
  );
}
