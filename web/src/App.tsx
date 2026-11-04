// The shell (job 001f): environment strip, a glass header with the four destinations (Discover,
// Build, Operate, Acquire), contextual links and utilities, the acting-context switcher, and the
// routes (unchanged: every earlier deep link resolves).

import { useEffect, useRef, useState } from "react";
import { api } from "./api.ts";
import { Icon, type IconName } from "./icons.tsx";
import { DESTINATIONS, destinationOf, isCurrent, SUBNAV, UTILITIES } from "./nav.ts";
import { Acquire } from "./pages/Acquire.tsx";
import { AcquireListing } from "./pages/AcquireListing.tsx";
import { AcquireRoom } from "./pages/AcquireRoom.tsx";
import { Activity } from "./pages/Activity.tsx";
import { BuildHome } from "./pages/Build.tsx";
import { Continuity } from "./pages/Continuity.tsx";
import { CustomerProduct } from "./pages/CustomerProduct.tsx";
import { DealPage } from "./pages/Deal.tsx";
import { DeskList, DeskPage } from "./pages/Desk.tsx";
import { DeskSale } from "./pages/DeskSale.tsx";
import { Explore } from "./pages/Explore.tsx";
import { Find } from "./pages/Find.tsx";
import { HandoversPage, HandoverWorkspace } from "./pages/Handover.tsx";
import { Helping } from "./pages/Helping.tsx";
import { Home } from "./pages/Home.tsx";
import { ImportHome, ImportWorkspace } from "./pages/Import.tsx";
import { Inbox } from "./pages/Inbox.tsx";
import { Opportunities, OpportunityReview } from "./pages/Opportunities.tsx";
import { Person } from "./pages/Person.tsx";
import { ProductStudio } from "./pages/ProductStudio.tsx";
import { Profile } from "./pages/Profile.tsx";
import { PublicPage } from "./pages/PublicPage.tsx";
import { PublicProfileEditor } from "./pages/PublicProfile.tsx";
import { Start } from "./pages/Start.tsx";
import { Studio } from "./pages/Studio.tsx";
import { Value } from "./pages/Value.tsx";
import { previewLabel } from "./previewLabel.ts";
import { Link, match, useRouter } from "./router.tsx";
import { useSession } from "./session.tsx";
import { Avatar, SignInDialog } from "./ui.tsx";

/** Job 001f: a navigation link that says when it is the current page. */
function NavLink({
  to,
  children,
  current,
  className,
}: {
  to: string;
  children: React.ReactNode;
  current: boolean;
  className?: string;
}) {
  return (
    <Link to={to} className={className} aria-current={current ? "page" : undefined}>
      {children}
    </Link>
  );
}

const UTILITY_ICON: Record<string, IconName> = { activity: "activity", inbox: "inbox" };

function ActingContext() {
  const { person, setPerson, requireSignIn, localPreview } = useSession();
  const { go } = useRouter();
  const [open, setOpen] = useState(false);
  const [people, setPeople] = useState<{ id: string; display_name: string }[]>([]);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open && localPreview)
      api
        .people()
        .then((r) => setPeople(r.people))
        .catch(() => {});
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open, localPreview]);

  if (!person) {
    return (
      <button
        type="button"
        className="btn btn-secondary"
        onClick={() => requireSignIn("Join to start a business, follow one, or ask for a service.")}
      >
        Sign in or join
      </button>
    );
  }
  const switchTo = async (id: string) => {
    setPerson((await api.actAs(id)).person);
    setOpen(false);
    go("/");
  };
  return (
    <div className="acting" ref={ref}>
      <button
        type="button"
        className="acting-button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Avatar name={person.display_name} />
        <span>
          <span className="muted" style={{ fontSize: 13 }}>
            Acting as{" "}
          </span>
          <strong>{person.display_name}</strong>
        </span>
      </button>
      {open && (
        <div className="menu" role="menu">
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              go("/profile");
            }}
          >
            Your profile
          </button>
          {localPreview && people.filter((p) => p.id !== person.id).length > 0 && (
            <>
              <hr />
              <div className="menu-label">Local preview: switch to another fictional person</div>
              {people
                .filter((p) => p.id !== person.id)
                .map((p) => (
                  <button key={p.id} type="button" onClick={() => switchTo(p.id)}>
                    <Avatar name={p.display_name} /> {p.display_name}
                  </button>
                ))}
            </>
          )}
          <hr />
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              requireSignIn(
                "Join as a new person. You can switch back any time from this menu.",
                true,
              );
            }}
          >
            Join as someone new
          </button>
          <button
            type="button"
            onClick={async () => {
              await api.signOut();
              setPerson(null);
              setOpen(false);
              go("/");
            }}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

function Routes() {
  const { path } = useRouter();
  const { person } = useSession();
  if (path === "/") return <Home />;
  if (path === "/start") return <Start />;
  if (path === "/build") return <BuildHome />;
  if (path === "/import") return <ImportHome key={person?.id ?? "anon"} />;
  const imported = match("/import/:id", path);
  // Keyed by who is acting, like the studio: switching people clears the private workspace.
  if (imported)
    return (
      <ImportWorkspace key={`${person?.id ?? "anon"}:${imported.id}`} id={imported.id as string} />
    );
  const product = match("/build/:id", path);
  // Keyed by who is acting: switching people unmounts the studio at once, clearing its private
  // state, and any response still in flight for the previous person lands nowhere.
  if (product)
    return (
      <ProductStudio key={`${person?.id ?? "anon"}:${product.id}`} id={product.id as string} />
    );
  const studio = match("/studio/:id", path);
  if (studio) return <Studio id={studio.id as string} />;
  const store = match("/b/:slug", path);
  if (store) return <PublicPage slug={store.slug as string} />;
  if (path === "/desk") return <DeskList />;
  const value = match("/desk/:id/value", path);
  if (value) return <Value id={value.id as string} />;
  const continuity = match("/desk/:id/continuity", path);
  // Keyed by who is acting and which business (job 003j): another person starts clean.
  if (continuity)
    return (
      <Continuity key={`${person?.id ?? "anon"}:${continuity.id}`} id={continuity.id as string} />
    );
  // Job 003s: keyed by who is acting, so a switch clears the workspace and late answers land nowhere.
  const handover = match("/desk/:id/handover", path);
  if (handover)
    return (
      <HandoverWorkspace
        key={`${person?.id ?? "anon"}:${handover.id}`}
        id={handover.id as string}
      />
    );
  if (path === "/handovers") return <HandoversPage key={person?.id ?? "anon"} />;
  // Job 001d: the public profile editor, keyed by who is acting and which business.
  const publicProfile = match("/desk/:id/public", path);
  if (publicProfile)
    return (
      <PublicProfileEditor
        key={`${person?.id ?? "anon"}:${publicProfile.id}`}
        id={publicProfile.id as string}
      />
    );
  const sale = match("/desk/:id/sale", path);
  // Job 003u1: keyed by who is acting and which business: a switch (or signing in) starts a fresh
  // page, so a former actor's listing and requests never remain and an earlier error never sticks.
  if (sale) return <DeskSale key={`${person?.id ?? "anon"}:${sale.id}`} id={sale.id as string} />;
  const helping = match("/help/:id", path);
  if (helping) return <Helping id={helping.id as string} />;
  const desk = match("/desk/:id", path);
  // Job 003t: keyed by who is acting and which business, so the books and their operations
  // figures are cleared on a switch and a late answer for the previous view lands nowhere.
  if (desk) return <DeskPage key={`${person?.id ?? "anon"}:${desk.id}`} id={desk.id as string} />;
  if (path === "/inbox") return <Inbox />;
  if (path === "/explore") return <Explore />;
  if (path === "/activity") return <Activity />;
  // Job 003q: a customer's product workspace, keyed by who is acting: switching people unmounts
  // it at once, clearing the document, the request and the result; late answers land nowhere.
  const useOffer = match("/use/:offer", path);
  if (useOffer)
    return (
      <CustomerProduct
        key={`${person?.id ?? "anon"}:offer:${useOffer.offer}`}
        offerId={useOffer.offer as string}
      />
    );
  const useRequest = match("/uses/:id", path);
  if (useRequest)
    return (
      <CustomerProduct
        key={`${person?.id ?? "anon"}:use:${useRequest.id}`}
        useId={useRequest.id as string}
      />
    );
  const profile = match("/p/:id", path);
  if (profile) return <Person id={profile.id as string} />;
  if (path === "/find") return <Find />;
  if (path === "/opportunities") return <Opportunities />;
  const review = match("/opportunities/:id/build", path);
  // Keyed by who is acting and which request: another person starts a fresh review.
  if (review)
    return (
      <OpportunityReview key={`${person?.id ?? "anon"}:${review.id}`} id={review.id as string} />
    );
  const deal = match("/deal/:id", path);
  if (deal) return <DealPage id={deal.id as string} />;
  if (path === "/acquire") return <Acquire />;
  const listing = match("/acquire/l/:id", path);
  if (listing) return <AcquireListing id={listing.id as string} />;
  const room = match("/acquire/room/:id", path);
  if (room) return <AcquireRoom id={room.id as string} />;
  if (path === "/profile") return <Profile />;
  return (
    <div className="page empty">
      <h2>That page does not exist</h2>
      <Link to="/">Go home</Link>
    </div>
  );
}

/**
 * Job 001b/001f: the compact-screen Menu disclosure (contextual links and utilities). Opening moves
 * focus to the first link; Escape closes and returns focus to the toggle; a route change closes
 * it. On wide screens the toggle is hidden by CSS, so the state has no effect there.
 */
function useMenu(path: string) {
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const linksRef = useRef<HTMLDivElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: path is a trigger: close on navigation
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    linksRef.current?.querySelector<HTMLElement>("a")?.focus();
    // Escape closes the open menu and returns focus to its toggle.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      toggleRef.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  return { open, toggleRef, linksRef, toggle: () => setOpen((o) => !o) };
}

export function App() {
  const { person, environment, ready } = useSession();
  const [preview] = useState(previewLabel);
  const [counts, setCounts] = useState({ inbox: 0 });
  const { path } = useRouter();
  const menu = useMenu(path);
  const dest = destinationOf(path);
  // biome-ignore lint/correctness/useExhaustiveDependencies: path is a trigger: recount unanswered messages on every navigation
  useEffect(() => {
    if (!person) return setCounts({ inbox: 0 });
    api
      .inbox()
      .then((r) => setCounts({ inbox: r.received.filter((i) => !i.reply).length }))
      .catch(() => {});
  }, [person, path]);

  return (
    <>
      <div className="env-strip" role="note">
        <span>
          <strong>{environment}</strong> · fictional businesses and people · no real money moves
        </span>
        <span>NEAR testnet only · test dollars, no value</span>
      </div>
      {preview && (
        <div className="env-strip preview-strip" role="note">
          <span>
            <strong>{preview.label}</strong>
            {preview.detail && ` · ${preview.detail}`}
          </span>
        </div>
      )}
      {/* Job 001f: a spacious glass header with the four destinations, contextual links for the
          current one, and the utilities. Compact screens keep the four as a labelled row and
          disclose the rest under Menu (not focusable until opened). */}
      <header className="site-header">
        <div className="site-header-inner">
          <Link to="/" className="wordmark">
            <img src="/favicon.svg" alt="" /> Everstreet
          </Link>
          <nav className="primary-nav" aria-label="Main">
            {DESTINATIONS.map((d) => (
              <NavLink key={d.id} to={d.to} current={dest === d.id}>
                {d.label}
              </NavLink>
            ))}
          </nav>
          <div className="utilities">
            {UTILITIES.map((u) => (
              <NavLink key={u.id} to={u.to} current={isCurrent(u.to, path)} className="util">
                <Icon name={UTILITY_ICON[u.id] ?? "layers"} />
                {u.label}
                {u.id === "inbox" && counts.inbox > 0 && (
                  <span className="count">
                    {counts.inbox}
                    <span className="sr-only"> unanswered</span>
                  </span>
                )}
              </NavLink>
            ))}
            <ActingContext />
          </div>
          <button
            ref={menu.toggleRef}
            type="button"
            className="menu-toggle"
            aria-expanded={menu.open}
            aria-controls="mobile-panel"
            onClick={menu.toggle}
          >
            <Icon name={menu.open ? "x" : "layers"} />
            <span>{menu.open ? "Close" : "Menu"}</span>
            {!menu.open && counts.inbox > 0 && <span className="count">{counts.inbox}</span>}
          </button>
        </div>
        {dest && (
          <nav className="subnav" aria-label={`${DESTINATIONS.find((d) => d.id === dest)?.label}`}>
            {SUBNAV[dest].map((l) => (
              <NavLink key={l.to} to={l.to} current={isCurrent(l.to, path)}>
                {l.label}
              </NavLink>
            ))}
          </nav>
        )}
        <div
          className={`mobile-panel${menu.open ? " open" : ""}`}
          id="mobile-panel"
          ref={menu.linksRef}
        >
          {dest && (
            <>
              <div className="group">{DESTINATIONS.find((d) => d.id === dest)?.label}</div>
              {SUBNAV[dest].map((l) => (
                <NavLink key={l.to} to={l.to} current={isCurrent(l.to, path)}>
                  {l.label}
                </NavLink>
              ))}
            </>
          )}
          <div className="group">You</div>
          {UTILITIES.map((u) => (
            <NavLink key={u.id} to={u.to} current={isCurrent(u.to, path)}>
              <Icon name={UTILITY_ICON[u.id] ?? "layers"} />
              {u.label}
              {u.id === "inbox" && counts.inbox > 0 && (
                <span className="count">{counts.inbox}</span>
              )}
            </NavLink>
          ))}
          <ActingContext />
        </div>
      </header>
      <main className="main">
        {ready ? <Routes /> : <div className="page muted">Loading…</div>}
      </main>
      <SignInDialog />
    </>
  );
}
