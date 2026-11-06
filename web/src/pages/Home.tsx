// Home: build or bring a digital product, discover what is published, and see how a business
// changes hands on NEAR. Everything shown is real data from this computer; nothing is invented.

import { useState } from "react";
import { useActorRead, usePublicRead } from "../actorRead.ts";
import { api } from "../api.ts";
import { featured } from "../discover.ts";
import { catalogView } from "../homeView.ts";
import { Icon, type IconName } from "../icons.tsx";
import { Link, useRouter } from "../router.tsx";
import { useSession } from "../session.tsx";
import { Composer, fetchProjects, ProjectCard, ReadFailed } from "./Build.tsx";
import { FeaturedProduct, MarketList } from "./Market.tsx";
import { ExampleBusinesses, SamplePanel } from "./Showcase.tsx";

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

const fetchShelf = () => api.discover().then((r) => r.businesses);
const fetchNeeds = () => api.needs().then((r) => r.needs.slice(0, 3));

export function Home() {
  const { go } = useRouter();
  const { person } = useSession();
  const [category, setCategory] = useState("all");
  // Job 001f2: each read settles into data or an honest retry; a failure is never shown as an
  // empty catalog. The recent projects belong to the signed-in account only.
  const shelf = usePublicRead(fetchShelf);
  const needs = usePublicRead(fetchNeeds);
  const mine = useActorRead(person?.id ?? null, fetchProjects);
  const recent = mine.state.data?.slice(0, 3) ?? null;

  // Digital products first (open ones first); earlier examples (classes, services) after them.
  const catalog = catalogView(shelf.state, category);
  const lead = featured(shelf.state.data ?? []);

  const paths: { icon: IconName; title: string; text: string; to?: string; primary?: boolean }[] = [
    {
      icon: "studio",
      title: "Start building",
      text: "Describe the idea; get a saved brief and prototype.",
      primary: true,
    },
    // First-use review #29: the route that gets a newcomer something to sell, one click away.
    {
      icon: "store",
      title: "Start a business",
      text: "Offer a service with a bookable page, in a few questions.",
      to: "/start",
    },
    {
      icon: "upload",
      title: "Bring a product",
      text: "An existing product: what it needs to launch or transfer.",
      to: "/import",
    },
    {
      icon: "handshake",
      title: "Explore acquisitions",
      text: "Businesses for sale.",
      to: "/acquire",
    },
  ];

  return (
    <div className="page">
      {/* Job 001f: one stage: the composer, and beside it a real published product (with its
          owner-written example) or, when nothing is published yet, what works today. */}
      <section className="home-stage">
        <div className="home-stage-main">
          <div className="eyebrow">Build, run and hand over digital businesses</div>
          <h1 className="home-title">What do you want to build?</h1>
          <p className="lede">
            AI tools, SaaS, APIs, agents and online services. Shape it here, open it to customers,
            and if you ever sell, hand it over on NEAR without breaking what customers were
            promised.
          </p>
          <Composer variant="hero" />
        </div>
        {/* Showcase (SHOWCASE_SPEC.md §2, Astra 1): the Ledgerline sample stays in the rail; it
            reads only the bundled samples, so it works even when the catalog read fails. */}
        <div id="try-ledgerline" className="home-stage-rail">
          <SamplePanel />
        </div>
      </section>

      <nav className="entries" aria-label="Ways in">
        {paths.map((p) =>
          p.to ? (
            <Link key={p.title} to={p.to} className="entry">
              <Icon name={p.icon} />
              <span>
                <strong>{p.title}</strong>
                <span>{p.text}</span>
              </span>
            </Link>
          ) : (
            <button
              key={p.title}
              type="button"
              className="entry primary"
              onClick={() => {
                const box = document.getElementById("idea-hero");
                if (box) {
                  box.focus();
                  box.scrollIntoView({ block: "center", behavior: "smooth" });
                } else go("/build");
              }}
            >
              <Icon name={p.icon} />
              <span>
                <strong>{p.title}</strong>
                <span>{p.text}</span>
              </span>
            </button>
          ),
        )}
      </nav>

      {/* Preview readiness, now a small disclosure (Astra's homepage note). */}
      <details className="readiness">
        <summary>What works today, from idea to handover</summary>
        <div className="lifecycle">
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
        </div>
      </details>

      <ExampleBusinesses />

      {/* Job 001f2: only the signed-in account's own projects, read for that account; nothing
          from a previous account is shown while the next one loads. */}
      {person && (recent === null || recent.length > 0) && (
        <section className="home-section" aria-busy={mine.state.status === "loading"}>
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
          {recent ? (
            <div className="project-grid">
              {recent.map((p) => (
                <ProjectCard key={p.id} p={p} />
              ))}
            </div>
          ) : mine.state.status === "loading" ? (
            <p className="muted">Loading your projects…</p>
          ) : (
            <ReadFailed what="your recent projects" error={mine.state.error} onRetry={mine.retry} />
          )}
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
        {catalog.kind === "loading" ? (
          <p className="muted">Loading what's published…</p>
        ) : catalog.kind === "failed" ? (
          <ReadFailed what="what's published" error={catalog.error} onRetry={shelf.retry} />
        ) : catalog.kind === "empty" ? (
          <div className="card empty">
            <h2>
              {catalog.software
                ? "No software products are published yet"
                : "Nothing published in this category yet"}
            </h2>
            <p>Start building above; a product page goes live only when you publish it.</p>
          </div>
        ) : (
          <>
            {catalog.earlierOnly && (
              <p className="notice info">
                No software products are published yet. These are the earlier examples.
              </p>
            )}
            {/* Real published products lead the live catalog (Astra 1). */}
            {lead && <FeaturedProduct b={lead} />}
            <MarketList list={catalog.shown} />
            {catalog.more && (
              <p style={{ marginTop: 12 }}>
                <Link to="/explore">See everything published on Explore</Link>
              </p>
            )}
          </>
        )}
      </section>

      {needs.state.data === null && needs.state.status === "failed" && (
        <section className="home-section">
          <p className="notice" role="alert">
            Open requests couldn't be loaded just now.{" "}
            <button type="button" className="btn btn-quiet btn-sm" onClick={needs.retry}>
              Try again
            </button>
          </p>
        </section>
      )}
      {(needs.state.data?.length ?? 0) > 0 && (
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
            {(needs.state.data ?? []).map((n) => (
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
          <li>
            Revenue on the books comes from the contract. Operating costs are what the founder
            enters; the AI cost of running a product is recorded from the provider's reported usage
            wherever a runtime is connected.
          </li>
          <li>A buyer sees scoped evidence the seller chooses to share, then the exact terms.</li>
          <li>Product projects and every revision belong to the business, so they move with it.</li>
          <li>Test dollars only. Nothing here moves real money.</li>
        </ul>
      </section>
    </div>
  );
}
