import { useEffect, useState } from "react";
import { api, type PublicBusiness } from "../api.ts";
import { Link, useRouter } from "../router.tsx";
import { useSession } from "../session.tsx";
import { FAMILY_LABEL, money, STAGE_LABEL } from "../ui.tsx";

export function BusinessTile({ b }: { b: PublicBusiness }) {
  return (
    <Link to={`/b/${b.slug}`} className="card link">
      <div className="row" style={{ marginBottom: 8 }}>
        <span className="pill">{FAMILY_LABEL[b.family]}</span>
        <span className="pill lime">{STAGE_LABEL[b.stage]}</span>
      </div>
      <h3 style={{ fontFamily: "var(--serif)", fontWeight: 400, fontSize: 22, marginBottom: 4 }}>
        {b.name}
      </h3>
      {b.offer && <p style={{ marginBottom: 6 }}>{b.offer.title}</p>}
      <p className="muted" style={{ fontSize: 14, margin: 0 }}>
        by {b.founder.display_name}
        {b.offer &&
          (b.offer.first_free
            ? " · first one free"
            : b.offer.price_cents !== null
              ? ` · ${money(b.offer.price_cents)} ${b.offer.price_unit}`
              : "")}
      </p>
    </Link>
  );
}

export function Home() {
  const { go } = useRouter();
  const { person, requireSignIn } = useSession();
  const [shelf, setShelf] = useState<PublicBusiness[] | null>(null);
  useEffect(() => {
    api
      .discover()
      .then((r) => setShelf(r.businesses.slice(0, 6)))
      .catch(() => setShelf([]));
  }, []);

  const start = async () => {
    if (
      !person &&
      !(await requireSignIn(
        "Join to save your idea as you shape it. You can keep it private until you choose to publish.",
      ))
    )
      return;
    go("/start");
  };

  return (
    <div className="page">
      <section className="hero">
        <div>
          <div className="eyebrow">A launch pad for new businesses</div>
          <h1>Start your business here.</h1>
          <p className="lede">
            Shape your idea. Find your first customers. Build something worth owning.
          </p>
          <div className="row">
            <button type="button" className="btn btn-primary btn-lg" onClick={start}>
              Start a business
            </button>
            <Link to="/find" className="btn btn-secondary btn-lg">
              Find a solution
            </Link>
          </div>
        </div>
        <section className="hero-art" aria-label="How a business grows here">
          <div className="street">
            {[
              ["Shape", "Turn what you know into a clear offer", "First hour"],
              ["Test", "Publish a page and hear from real people", "First week"],
              ["Launch", "Take your first orders and deliver them", "First month"],
              ["Grow", "Real numbers, a team, and choices", "First year"],
            ].map(([stage, text, when]) => (
              <div className="street-row" key={stage}>
                <strong style={{ width: 64 }}>{stage}</strong>
                <span>{text}</span>
                <span className="stage pill">{when}</span>
              </div>
            ))}
          </div>
        </section>
      </section>

      <section className="entrances" aria-label="Ways in">
        <button type="button" className="card link entrance primary choice" onClick={start}>
          <h3>Start a business</h3>
          <p>From an idea, a skill, or just the wish to work for yourself.</p>
        </button>
        <Link to="/desk" className="card link entrance">
          <h3>Run my business</h3>
          <p>What needs you today, who replied, and what to do next.</p>
        </Link>
        <Link to="/find" className="card link entrance">
          <h3>Find a solution</h3>
          <p>Say what you need; find people who just started offering it.</p>
        </Link>
        <Link to="/acquire" className="card link entrance">
          <h3>Explore acquisitions</h3>
          <p>Find businesses worth owning, with numbers you can check.</p>
        </Link>
      </section>

      <section>
        <h2 className="section-title">Starting now</h2>
        <p className="muted">Businesses people opened on Everstreet, newest first.</p>
        {shelf === null ? (
          <p className="muted">Loading…</p>
        ) : shelf.length === 0 ? (
          <div className="card empty">
            <h2>Nobody has published yet</h2>
            <p>Be the first: your page can be live within the hour.</p>
            <button type="button" className="btn btn-primary" onClick={start}>
              Start a business
            </button>
          </div>
        ) : (
          <div className="shelf">
            {shelf.map((b) => (
              <BusinessTile key={b.slug} b={b} />
            ))}
          </div>
        )}
      </section>

      <section className="intact">
        <div>
          <div className="eyebrow" style={{ color: "var(--lime)" }}>
            Coming with payments on NEAR
          </div>
          <h2>Built to change hands intact.</h2>
          <p style={{ color: "#c9d2c8" }}>
            Every business started here will get its own account on NEAR: its treasury, its
            customers' prepaid balances, the people it pays, and the promises it keeps, whoever owns
            it.
          </p>
        </div>
        <ul>
          <li>
            Revenue, costs and profit come from what actually ran through the business, not a
            spreadsheet.
          </li>
          <li>Customers keep their balance and their price through any sale.</li>
          <li>
            A buyer can check the numbers before buying, and take over without breaking anything.
          </li>
          <li>Even the customers can buy the service they depend on.</li>
        </ul>
      </section>
    </div>
  );
}
