// The shell: environment strip, the rail with the four entrances, the acting-context switcher,
// and the routes.

import { useEffect, useRef, useState } from "react";
import { api } from "./api.ts";
import { Icon, type IconName } from "./icons.tsx";
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
import { Start } from "./pages/Start.tsx";
import { Studio } from "./pages/Studio.tsx";
import { Value } from "./pages/Value.tsx";
import { previewLabel } from "./previewLabel.ts";
import { Link, match, useRouter } from "./router.tsx";
import { useSession } from "./session.tsx";
import { Avatar, SignInDialog } from "./ui.tsx";

function Nav({
  to,
  label,
  icon,
  count,
}: {
  to: string;
  label: string;
  icon: IconName;
  count?: number;
}) {
  const { path } = useRouter();
  const active = to === "/" ? path === "/" : path === to || path.startsWith(`${to}/`);
  return (
    <Link to={to} className={`nav${active ? " active" : ""}`}>
      <Icon name={icon} />
      <span className="label">{label}</span>
      {count ? <span className="count">{count}</span> : null}
    </Link>
  );
}

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
 * Job 001b: the narrow-screen navigation disclosure. Opening moves focus to the first link;
 * Escape closes and returns focus to the toggle; a route change closes it. On wide screens the
 * rail is always shown and the toggle is hidden by CSS, so the state has no effect there.
 */
function useMenu(path: string) {
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const linksRef = useRef<HTMLDivElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: path is a trigger: close on navigation
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (open) linksRef.current?.querySelector<HTMLElement>("a")?.focus();
  }, [open]);
  return {
    open,
    toggleRef,
    linksRef,
    toggle: () => setOpen((o) => !o),
    onKeyDown: (e: { key: string }) => {
      if (e.key === "Escape" && open) {
        setOpen(false);
        toggleRef.current?.focus();
      }
    },
  };
}

export function App() {
  const { person, environment, ready } = useSession();
  const [preview] = useState(previewLabel);
  const [counts, setCounts] = useState({ inbox: 0 });
  const { path } = useRouter();
  const menu = useMenu(path);
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
      <div className="shell">
        {/* Job 001b: on narrow screens the rail is a compact bar with a Menu disclosure; the
            links are not rendered as focusable until it is opened (display: none). */}
        <nav
          className={`rail${menu.open ? " open" : ""}`}
          aria-label="Main"
          onKeyDown={menu.onKeyDown}
        >
          <div className="rail-top">
            <Link to="/" className="wordmark">
              <img src="/favicon.svg" alt="" /> Everstreet
            </Link>
            <button
              ref={menu.toggleRef}
              type="button"
              className="menu-toggle"
              aria-expanded={menu.open}
              aria-controls="rail-links"
              onClick={menu.toggle}
            >
              <Icon name={menu.open ? "x" : "layers"} />
              <span>{menu.open ? "Close" : "Menu"}</span>
              {!menu.open && counts.inbox > 0 && <span className="count">{counts.inbox}</span>}
            </button>
          </div>
          <div className="rail-links" id="rail-links" ref={menu.linksRef}>
            <Nav to="/" label="Home" icon="home" />
            <div className="rail-label">Build and run</div>
            <Nav to="/build" label="Product studio" icon="studio" />
            <Nav to="/start" label="Start a business" icon="rocket" />
            <Nav to="/desk" label="My businesses" icon="briefcase" />
            <Nav to="/inbox" label="Inbox" icon="inbox" count={counts.inbox} />
            <div className="rail-label">As a customer</div>
            <Nav to="/activity" label="My activity" icon="activity" />
            <div className="rail-label">Discover</div>
            <Nav to="/explore" label="Explore" icon="compass" />
            <Nav to="/opportunities" label="Opportunities" icon="spark" />
            <Nav to="/find" label="Find a solution" icon="search" />
            <div className="rail-label">Buy and hand over</div>
            <Nav to="/acquire" label="Acquisitions" icon="handshake" />
            <Nav to="/handovers" label="Handovers" icon="history" />
          </div>
          <div className="rail-foot">Build it, run it, hand it over intact.</div>
        </nav>
        <div className="main">
          <header className="topbar">
            <ActingContext />
          </header>
          {ready ? <Routes /> : <div className="page muted">Loading…</div>}
        </div>
      </div>
      <SignInDialog />
    </>
  );
}
