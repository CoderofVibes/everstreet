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
import { DealPage } from "./pages/Deal.tsx";
import { DeskList, DeskPage } from "./pages/Desk.tsx";
import { DeskSale } from "./pages/DeskSale.tsx";
import { Explore } from "./pages/Explore.tsx";
import { Find } from "./pages/Find.tsx";
import { Helping } from "./pages/Helping.tsx";
import { Home } from "./pages/Home.tsx";
import { Inbox } from "./pages/Inbox.tsx";
import { Person } from "./pages/Person.tsx";
import { ProductStudio } from "./pages/ProductStudio.tsx";
import { Profile } from "./pages/Profile.tsx";
import { PublicPage } from "./pages/PublicPage.tsx";
import { Start } from "./pages/Start.tsx";
import { Studio } from "./pages/Studio.tsx";
import { Value } from "./pages/Value.tsx";
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
  const sale = match("/desk/:id/sale", path);
  if (sale) return <DeskSale id={sale.id as string} />;
  const helping = match("/help/:id", path);
  if (helping) return <Helping id={helping.id as string} />;
  const desk = match("/desk/:id", path);
  if (desk) return <DeskPage id={desk.id as string} />;
  if (path === "/inbox") return <Inbox />;
  if (path === "/explore") return <Explore />;
  if (path === "/activity") return <Activity />;
  const profile = match("/p/:id", path);
  if (profile) return <Person id={profile.id as string} />;
  if (path === "/find") return <Find />;
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

export function App() {
  const { person, environment, ready } = useSession();
  const [counts, setCounts] = useState({ inbox: 0 });
  const { path } = useRouter();
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
      <div className="shell">
        <nav className="rail" aria-label="Main">
          <Link to="/" className="wordmark">
            <img src="/favicon.svg" alt="" /> Everstreet
          </Link>
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
          <Nav to="/find" label="Find a solution" icon="search" />
          <Nav to="/acquire" label="Acquisitions" icon="handshake" />
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
