// Home: build or bring a digital product, discover what is published, and see how a business
// changes hands on NEAR. Everything shown is real data from this computer; nothing is invented.

import { useEffect, useState } from "react";
import { api, type Need, type PublicBusiness } from "../api.ts";
import { Icon, type IconName } from "../icons.tsx";
import { type ProjectSummary, productsApi } from "../productsApi.ts";
import { Link, useRouter } from "../router.tsx";
import { useSession } from "../session.tsx";
import { FAMILY_LABEL, money, STAGE_LABEL } from "../ui.tsx";
import { Composer, ProjectCard } from "./Build.tsx";

const FAMILY_ICON: Record<string, IconName> = {
  software: "api",
  service: "user",
  class: "doc",
  product: "store",
  undecided: "layers",
};

export function BusinessTile({ b }: { b: PublicBusiness }) {
  return (
    <Link to={`/b/${b.slug}?via=discovery`} className="card link tile">
      <div className="tile-top">
        <span className={`glyph${b.family === "software" ? " mint" : ""}`}>
          <Icon name={FAMILY_ICON[b.family] ?? "layers"} />
        </span>
        <span className="pill">{STAGE_LABEL[b.stage]}</span>
      </div>
      <h3>{b.name}</h3>
      {b.offer && (
        <p style={{ margin: 0, fontSize: 14, color: "var(--text-2)" }}>{b.offer.title}</p>
      )}
      <div className="tile-meta">
        {FAMILY_LABEL[b.family]} · by {b.founder.display_name}
        {b.offer &&
          (b.offer.first_free
            ? " · first one free"
            : b.offer.price_cents !== null
              ? ` · ${money(b.offer.price_cents)} ${b.offer.price_unit}`
              : "")}
      </div>
    </Link>
  );
}

const STAGES: { icon: IconName; title: string; text: string; now: "now" | "partial" | "later" }[] =
  [
    {
      icon: "doc",
      title: "Shape",
      text: "An editable brief: audience, problem, promise, features, price",
      now: "now",
    },
    {
      icon: "layers",
      title: "Choose",
      text: "AI API, SaaS workflow, agent service or client portal",
      now: "now",
    },
    {
      icon: "spark",
      title: "Build",
      text: "Start from a brief and prototype; each project shows whether AI drafting and builds are available",
      now: "partial",
    },
    {
      icon: "flask",
      title: "Test",
      text: "Brief checks now; product tests and model evaluations come with builds",
      now: "partial",
    },
    {
      icon: "shield",
      title: "Prepare",
      text: "A continuity checklist of promises, dependencies and transfer items; runtime readiness is not verified yet",
      now: "partial",
    },
    {
      icon: "handshake",
      title: "Launch and hand over",
      text: "Public page, testnet payments and sale on NEAR testnet; digital products join later",
      now: "partial",
    },
  ];

const TAG: Record<"now" | "partial" | "later", string> = {
  now: "Works now",
  partial: "Partly",
  later: "Later",
};

const CATEGORIES: { id: string; label: string }[] = [
  { id: "all", label: "All" },
  { id: "software", label: "Software and AI" },
  { id: "service", label: "Services" },
  { id: "class", label: "Classes" },
  { id: "product", label: "Products" },
];

export function Home() {
  const { go } = useRouter();
  const { person } = useSession();
  const [shelf, setShelf] = useState<PublicBusiness[] | null>(null);
  const [needs, setNeeds] = useState<Need[]>([]);
  const [mine, setMine] = useState<ProjectSummary[]>([]);
  const [category, setCategory] = useState("all");
  useEffect(() => {
    api
      .discover()
      .then((r) => setShelf(r.businesses))
      .catch(() => setShelf([]));
    api
      .needs()
      .then((r) => setNeeds(r.needs.slice(0, 3)))
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (!person) return setMine([]);
    productsApi
      .list()
      .then((r) => setMine(r.projects.slice(0, 3)))
      .catch(() => setMine([]));
  }, [person]);

  // Software first; earlier examples (classes, services) stay visible after it.
  const ordered = [...(shelf ?? [])].sort(
    (a, b) => Number(b.family === "software") - Number(a.family === "software"),
  );
  const shown = ordered.filter((b) => category === "all" || b.family === category).slice(0, 6);
  const hasSoftware = ordered.some((b) => b.family === "software");

  const paths: { icon: IconName; title: string; text: string; to?: string; primary?: boolean }[] = [
    {
      icon: "studio",
      title: "Start building",
      text: "Describe the idea; get a saved brief and prototype.",
      primary: true,
    },
    {
      icon: "upload",
      title: "Bring a product",
      text: "Inspect its package.json and see what handing it over would take. Connecting accounts comes later.",
      to: "/import",
    },
    {
      icon: "handshake",
      title: "Explore acquisitions",
      text: "Businesses for sale, with numbers you can check.",
      to: "/acquire",
    },
    {
      icon: "search",
      title: "Find a solution",
      text: "Say what you need; see who offers it.",
      to: "/find",
    },
  ];

  return (
    <div className="page">
      <section className="home-hero">
        <div>
          <div className="eyebrow">Build, run and hand over digital businesses</div>
          <h1>What do you want to build?</h1>
          <p className="lede">
            AI tools, SaaS, APIs, agents and online services. Shape it here, open it to customers,
            and if you ever sell, hand it over on NEAR without breaking what customers were
            promised.
          </p>
          <Composer variant="hero" />
        </div>
        <aside className="lifecycle" aria-label="What works today">
          <h2>From idea to handover: what works today</h2>
          {STAGES.map((s) => (
            <div className="lifecycle-row" key={s.title}>
              <Icon name={s.icon} />
              <span>
                <strong>{s.title}</strong>
                <span className="muted">{s.text}</span>
              </span>
              <span className={`state-tag ${s.now}`}>{TAG[s.now]}</span>
            </div>
          ))}
        </aside>
      </section>

      <section className="paths" aria-label="Ways in">
        {paths.map((p) =>
          p.to ? (
            <Link key={p.title} to={p.to} className="card link path">
              <span className="icon-box">
                <Icon name={p.icon} />
              </span>
              <span>
                <h3>{p.title}</h3>
                <p>{p.text}</p>
              </span>
            </Link>
          ) : (
            <button
              key={p.title}
              type="button"
              className="card link path primary"
              onClick={() => {
                const box = document.getElementById("idea-hero");
                if (box) {
                  box.focus();
                  box.scrollIntoView({ block: "center", behavior: "smooth" });
                } else go("/build");
              }}
            >
              <span className="icon-box">
                <Icon name={p.icon} />
              </span>
              <span>
                <h3>{p.title}</h3>
                <p>{p.text}</p>
              </span>
            </button>
          ),
        )}
      </section>

      {mine.length > 0 && (
        <section className="home-section">
          <div className="section-head">
            <div>
              <h2>Continue building</h2>
              <p>Your most recent product projects.</p>
            </div>
            <span className="spacer" />
            <Link to="/build" className="btn btn-secondary btn-sm">
              All projects
            </Link>
          </div>
          <div className="project-grid">
            {mine.map((p) => (
              <ProjectCard key={p.id} p={p} />
            ))}
          </div>
        </section>
      )}

      <section className="home-section">
        <div className="section-head">
          <div>
            <h2>On Everstreet now</h2>
            <p>
              Published businesses on this computer, software first. Classes and services are
              earlier fictional examples.
            </p>
          </div>
          <span className="spacer" />
          <fieldset className="seg">
            <legend className="sr-only">Filter by kind</legend>
            {CATEGORIES.map((c) => (
              <button
                key={c.id}
                type="button"
                aria-pressed={category === c.id}
                onClick={() => setCategory(c.id)}
              >
                {c.label}
              </button>
            ))}
          </fieldset>
        </div>
        {shelf === null ? (
          <p className="muted">Loading…</p>
        ) : shown.length === 0 ? (
          <div className="card empty">
            <h2>
              {category === "software" || (category === "all" && !hasSoftware)
                ? "No software products are published yet"
                : "Nothing published in this category yet"}
            </h2>
            <p>Start building above; a product page goes live only when you publish it.</p>
          </div>
        ) : (
          <>
            {category === "all" && !hasSoftware && (
              <p className="notice info">
                No software products are published yet. These are the earlier examples.
              </p>
            )}
            <div className="shelf">
              {shown.map((b) => (
                <BusinessTile key={b.slug} b={b} />
              ))}
            </div>
          </>
        )}
      </section>

      {needs.length > 0 && (
        <section className="home-section">
          <div className="section-head">
            <div>
              <h2>What people are asking for</h2>
              <p>Open requests posted on the need board.</p>
            </div>
            <span className="spacer" />
            <Link to="/explore" className="btn btn-secondary btn-sm">
              Need board
            </Link>
          </div>
          <div className="shelf">
            {needs.map((n) => (
              <div className="card" key={n.id}>
                <p style={{ margin: "0 0 8px" }}>“{n.text}”</p>
                <span className="muted" style={{ fontSize: 13 }}>
                  {n.responses} {n.responses === 1 ? "response" : "responses"} · open until{" "}
                  {new Date(n.expires_at).toLocaleDateString()}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="intact">
        <div>
          <div className="eyebrow">Ownership on NEAR testnet</div>
          <h2>Built to change hands intact.</h2>
          <p style={{ color: "var(--on-ink-2)" }}>
            A business here can have its own contract on NEAR testnet. When it is sold, both sides
            accept the same exact terms on chain, and control moves to the buyer.
          </p>
          <Link to="/acquire">Explore acquisitions</Link>
        </div>
        <ul>
          <li>Customer money is held by the business's contract, not by the owner.</li>
          <li>Revenue on the books comes from the contract; costs are what the founder enters.</li>
          <li>A buyer sees scoped evidence the seller chooses to share, then the exact terms.</li>
          <li>Product projects and every revision belong to the business, so they move with it.</li>
          <li>Test dollars only. Nothing here moves real money.</li>
        </ul>
      </section>
    </div>
  );
}
