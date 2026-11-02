// The product studio's front door: describe an idea, choose a foundation, and get a saved
// project with an editable brief and prototype. Also the founder's list of product projects.

import { type FormEvent, type KeyboardEvent, useEffect, useState } from "react";
import { api } from "../api.ts";
import { FOUNDATION_ICON, Icon } from "../icons.tsx";
import {
  ago,
  type Foundation,
  type FoundationInfo,
  type ProjectSummary,
  productsApi,
} from "../productsApi.ts";
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
  const [idea, setIdea] = useState("");
  const [foundation, setFoundation] = useState<Foundation>("ai_api");
  const [name, setName] = useState("");
  const [business, setBusiness] = useState(businessId ?? "");
  const [foundations, setFoundations] = useState<FoundationInfo[] | null>(null);
  const [owned, setOwned] = useState<{ id: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    productsApi
      .foundations()
      .then((r) => setFoundations(r.foundations))
      .catch(() => setFoundations([]));
  }, []);
  useEffect(() => {
    if (!person || variant !== "full") return;
    api
      .projects()
      .then((r) => {
        const seen = new Map<string, string>();
        for (const p of r.projects) seen.set(p.business_id, p.name);
        setOwned([...seen].map(([id, n]) => ({ id, name: n })));
      })
      .catch(() => {});
  }, [person, variant]);

  const chosen = foundations?.find((x) => x.id === foundation);

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (busy) return;
    if (idea.trim().length < 3) {
      setError("Describe your idea in a sentence or two.");
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
                onChange={() => setFoundation(x.id)}
              />
              <span className="f-head">
                <Icon name={FOUNDATION_ICON[x.id] ?? "layers"} /> {x.label}
              </span>
              <p>{x.summary}</p>
              <span className="needs">Needs: {x.needs.join(", ").toLowerCase()}</span>
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
            </select>
          </label>
        </div>
      )}
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
                  onChange={() => setFoundation(x.id)}
                />
                <Icon name={FOUNDATION_ICON[x.id] ?? "layers"} size="sm" /> {x.label}
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
        <button type="submit" className="btn btn-primary" disabled={busy}>
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

export function BuildHome() {
  const { person, requireSignIn } = useSession();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const preset = new URLSearchParams(window.location.search).get("business") ?? undefined;
  useEffect(() => {
    if (!person) return setProjects([]);
    productsApi
      .list()
      .then((r) => setProjects(r.projects))
      .catch(() => setProjects([]));
  }, [person]);

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
        ) : projects === null ? (
          <p className="muted">Loading…</p>
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
