// The product studio's front door: describe an idea, choose a foundation, and get a saved
// project with an editable brief and prototype. Also the founder's list of product projects.

import { type FormEvent, type KeyboardEvent, useEffect, useState } from "react";
import { useActorRead, usePublicRead } from "../actorRead.ts";
import { api } from "../api.ts";
import { composerReady } from "../homeView.ts";
import { FOUNDATION_ICON, Icon } from "../icons.tsx";
import { ago, type Foundation, type ProjectSummary, productsApi } from "../productsApi.ts";
import { Link, useRouter } from "../router.tsx";
import { useSession } from "../session.tsx";

export function Composer({
  variant,
  businessId,
}: {
  variant: "hero" | "full";
  businessId?: string;
}) {
  const { person, requireSignIn } = useSession();
  const { go } = useRouter();
  const who = person?.id ?? null;
  const [idea, setIdea] = useState("");
  const [foundation, setFoundation] = useState<Foundation>("ai_api");
  const [name, setName] = useState("");
  // Job 001f2: the chosen business belongs to the account that chose it; another account starts
  // from the link's business (if any) or a new private business, never the previous choice.
  const [picked, setPicked] = useState<{ who: string | null; id: string }>({
    who,
    id: businessId ?? "",
  });
  const business = picked.who === who ? picked.id : (businessId ?? "");
  const setBusiness = (id: string) => setPicked({ who, id });
  // Job 001f2: product types settle into a list or an honest retry; idea, name and choice stay.
  const types = usePublicRead(fetchFoundations);
  const foundations = types.state.data;
  // Job 001f2: the account's own businesses, bound to that account (late answers for anyone
  // else are dropped).
  const ownedRead = useActorRead(person && variant === "full" ? person.id : null, fetchOwned);
  const owned = ownedRead.state.data ?? [];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chosen = foundations?.find((x) => x.id === foundation);
  // Review #19: start from a kind that can be built here, until the person picks one themselves.
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (touched || !foundations || chosen?.build?.available !== false) return;
    const ok = foundations.find((x) => x.build?.available);
    if (ok) setFoundation(ok.id);
  }, [touched, foundations, chosen]);
  const pick = (id: Foundation) => {
    setTouched(true);
    setFoundation(id);
  };
  const ready = composerReady(types.state, foundation);
  const typesNote = !ready.canSubmit && (
    <div className="composer-note" role={types.state.status === "loading" ? undefined : "alert"}>
      <span>{ready.reason}</span>
      {types.state.data === null && types.state.status !== "loading" && (
        <button type="button" className="btn btn-secondary btn-sm" onClick={types.retry}>
          Try again
        </button>
      )}
    </div>
  );

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (busy) return;
    if (idea.trim().length < 3) {
      setError("Describe your idea in a sentence or two.");
      return;
    }
    if (!ready.canSubmit) {
      setError(ready.reason);
      return;
    }
    if (
      !person &&
      !(await requireSignIn(
        "Join to save your project. It stays private to you and your business until you publish.",
      ))
    )
      return;
    setBusy(true);
    setError(null);
    try {
      const view = await productsApi.create({
        idea: idea.trim(),
        foundation,
        name: name.trim() || undefined,
        business_id: business || undefined,
      });
      go(`/build/${view.project.id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
  };

  return (
    <form className="composer" onSubmit={submit} aria-label="Start a product project">
      <label className="sr-only" htmlFor={`idea-${variant}`}>
        Describe what you want to build
      </label>
      <textarea
        id={`idea-${variant}`}
        className="input"
        value={idea}
        maxLength={2000}
        onChange={(e) => setIdea(e.target.value)}
        onKeyDown={onKey}
        placeholder={
          chosen
            ? `Describe it in your words. For example: ${chosen.example}`
            : "Describe your idea"
        }
      />
      {variant === "full" && foundations && foundations.length > 0 && (
        <fieldset className="foundations" style={{ border: 0, padding: 0 }}>
          <legend className="mini-label" style={{ fontWeight: 650, fontSize: 13, marginBottom: 8 }}>
            What kind of product is it?
          </legend>
          {foundations.map((x) => (
            <label key={x.id} className="foundation">
              <input
                type="radio"
                name={`foundation-${variant}`}
                className="sr-only"
                checked={foundation === x.id}
                onChange={() => pick(x.id)}
              />
              <span className="f-head">
                <Icon name={FOUNDATION_ICON[x.id] ?? "layers"} /> {x.label}
              </span>
              <p>{x.summary}</p>
              <span className="needs">Needs: {x.needs.join(", ").toLowerCase()}</span>
              {x.build?.available === false && (
                <span className="fchip-off">Prototype only here</span>
              )}
            </label>
          ))}
        </fieldset>
      )}
      {variant === "full" && (
        <div className="grid-2" style={{ marginBottom: 4 }}>
          <label className="mini-field">
            <span className="mini-label">Working name (optional)</span>
            <input
              className="input"
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
              placeholder="You can name it later"
            />
          </label>
          <label className="mini-field">
            <span className="mini-label">Business it belongs to</span>
            <select
              className="input"
              value={business}
              onChange={(e) => setBusiness(e.target.value)}
            >
              <option value="">A new private business</option>
              {owned.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
              {/* The link's business while your businesses are still being read. */}
              {business && !owned.some((b) => b.id === business) && (
                <option value={business}>The business from your link</option>
              )}
            </select>
            {person && ownedRead.state.data === null && ownedRead.state.status !== "loading" && (
              <span className="composer-note" role="alert">
                <span>Your businesses couldn't be loaded, so only a new one is listed.</span>
                <button type="button" className="btn btn-quiet btn-sm" onClick={ownedRead.retry}>
                  Try again
                </button>
              </span>
            )}
          </label>
        </div>
      )}
      {typesNote}
      <div className="composer-foot">
        {variant === "hero" && (
          <fieldset className="foundation-chips" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="sr-only">What kind of product is it?</legend>
            {(foundations ?? []).map((x) => (
              <label key={x.id} className="fchip">
                <input
                  type="radio"
                  name={`foundation-${variant}`}
                  className="sr-only"
                  checked={foundation === x.id}
                  onChange={() => pick(x.id)}
                />
                <Icon name={FOUNDATION_ICON[x.id] ?? "layers"} size="sm" /> {x.label}
                {x.build?.available === false && <span className="fchip-off">prototype only</span>}
              </label>
            ))}
          </fieldset>
        )}
        {variant === "full" && (
          <span className="muted" style={{ fontSize: 13 }}>
            Saved privately with every revision. You start from an editable brief and prototype; the
            project shows whether AI drafting and builds are available here.
          </span>
        )}
        <span className="spacer" />
        <button type="submit" className="btn btn-primary" disabled={busy || !ready.canSubmit}>
          {busy ? "Creating…" : "Start building"} <Icon name="arrowRight" size="sm" />
        </button>
      </div>
      {error && (
        <p className="error-text" aria-live="polite">
          {error}
        </p>
      )}
    </form>
  );
}

export function ProjectCard({ p }: { p: ProjectSummary }) {
  return (
    <Link to={`/build/${p.id}`} className="card link project-card">
      <div className="row" style={{ gap: 8 }}>
        <span className="glyph mint">
          <Icon name={FOUNDATION_ICON[p.foundation] ?? "layers"} />
        </span>
        <span className="pill">{p.foundation_label}</span>
      </div>
      <h3>{p.name}</h3>
      <p className="muted" style={{ fontSize: 13.5, margin: 0 }}>
        {p.promise || "No promised result yet"}
      </p>
      <div className="meta">
        <span>{p.business_name}</span>·<span>Revision {p.revision}</span>·
        <span>{ago(p.updated_at)}</span>
      </div>
    </Link>
  );
}

const fetchFoundations = () => productsApi.foundations().then((r) => r.foundations);
const fetchOwned = () =>
  api.projects().then((r) => {
    const seen = new Map<string, string>();
    for (const p of r.projects) seen.set(p.business_id, p.name);
    return [...seen].map(([id, n]) => ({ id, name: n }));
  });
/** Job 001f2: the signed-in account's product projects (shared by Build and Home). */
export const fetchProjects = () => productsApi.list().then((r) => r.projects);

/** Job 001f2: a private list's failure, with a retry, never an empty claim. */
export function ReadFailed({
  what,
  error,
  onRetry,
}: {
  what: string;
  error: string | null;
  onRetry: () => void;
}) {
  return (
    <div className="card empty" role="alert">
      <h2>Couldn't load {what} just now</h2>
      <p>Nothing has changed; this page just couldn't read it.{error ? ` ${error}` : ""}</p>
      <button type="button" className="btn btn-secondary" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}

export function BuildHome() {
  const { person, requireSignIn } = useSession();
  const list = useActorRead(person?.id ?? null, fetchProjects);
  const projects = list.state.data;
  const preset = new URLSearchParams(window.location.search).get("business") ?? undefined;

  return (
    <div className="page">
      <div className="eyebrow">Product studio</div>
      <h1 className="display" style={{ fontSize: 32, margin: "0 0 6px" }}>
        Build a digital product
      </h1>
      <p className="muted" style={{ fontSize: 16, maxWidth: "70ch", marginBottom: 20 }}>
        Describe the idea, pick a foundation, and shape a brief and a working prototype. Every save
        is a revision you can return to, and the project belongs to your business, so it moves with
        the business if you ever sell.
      </p>
      <Composer variant="full" businessId={preset} />

      <section className="home-section" style={{ marginTop: 36 }}>
        <div className="section-head">
          <div>
            <h2>Your product projects</h2>
            <p>Private to you as the owner of each business.</p>
          </div>
        </div>
        {!person ? (
          <div className="card empty">
            <h2>Sign in to see your projects</h2>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => requireSignIn("Sign in to see your product projects.")}
            >
              Sign in or join
            </button>
          </div>
        ) : projects === null && list.state.status === "loading" ? (
          <p className="muted">Loading your projects…</p>
        ) : projects === null ? (
          <ReadFailed what="your projects" error={list.state.error} onRetry={list.retry} />
        ) : projects.length === 0 ? (
          <div className="card empty">
            <h2>No product projects yet</h2>
            <p>Describe an idea above to start your first one.</p>
          </div>
        ) : (
          <div className="project-grid">
            {projects.map((p) => (
              <ProjectCard key={p.id} p={p} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
