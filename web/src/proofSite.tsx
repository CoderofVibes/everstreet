// The static proof site (Nov 7, Tony): the recorded proof pages only, servable from any static host
// with no Everstreet server behind them. The pages are the app's own components; the two public
// reads they make are answered from JSON files written at build time from the same projections the
// server serves (scripts/build-proof-site.ts), so nothing here is recomputed or hand-written.
// Any other /api read answers 404: this copy holds no app, accounts or sign-in.

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Icon } from "./icons.tsx";
import { AttackDocketPage } from "./pages/AttackDocket.tsx";
import { RecordedProofPage } from "./pages/RecordedProof.tsx";
import { ExamplePage } from "./pages/Showcase.tsx";
import { Link, Router, useRouter } from "./router.tsx";
import "./styles.css";

/** The reads the proof pages make, and the build-time file that answers each. */
export const STATIC_READS: Record<string, string> = {
  "/api/examples/ledgerline": "/data/ledgerline.json",
  "/api/public/attacks": "/data/attacks.json",
};

const real = window.fetch.bind(window);
window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const path = new URL(url, window.location.origin).pathname;
  const file = STATIC_READS[path];
  if (file) return real(file, init);
  if (path.startsWith("/api/"))
    return Promise.resolve(
      new Response(JSON.stringify({ error: "Not part of this copy", code: "static" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      }),
    );
  return real(input, init);
};

const NAV = [
  { to: "/example/ledgerline?tab=acquire", label: "The recorded sale" },
  { to: "/proof/ledgerline", label: "Handoff proof" },
  { to: "/attacks", label: "What we tried to break" },
];

function Landing() {
  return (
    <div className="page">
      <section className="intact proof-site-hero">
        <div>
          <div className="eyebrow">Recorded on NEAR testnet</div>
          <h1>Built to change hands intact.</h1>
        </div>
      </section>
      <nav className="entries proof-entries" aria-label="What proves it">
        <Link to="/example/ledgerline?tab=acquire" className="entry">
          <Icon name="handshake" />
          <span>
            <strong>A recorded sale on NEAR testnet</strong>
            <span>Ledgerline changed hands; every transaction linked.</span>
          </span>
        </Link>
        <Link to="/proof/ledgerline" className="entry">
          <Icon name="shield" />
          <span>
            <strong>Handoff proof</strong>
            <span>Each sale at the close, the former owner refused, the customer's uses.</span>
          </span>
        </Link>
        <Link to="/attacks" className="entry">
          <Icon name="flask" />
          <span>
            <strong>What we tried to break</strong>
            <span>Attacks on the app and its contract rules, each refused or flagged.</span>
          </span>
        </Link>
      </nav>
    </div>
  );
}

function Routes() {
  const { path } = useRouter();
  if (path === "/proof/ledgerline") return <RecordedProofPage />;
  if (path === "/attacks") return <AttackDocketPage />;
  if (path.startsWith("/example/")) return <ExamplePage which={path.slice("/example/".length)} />;
  if (path === "/") return <Landing />;
  return (
    <div className="page empty">
      <h2>Not part of this copy</h2>
      <p>
        <Link to="/">The recorded proof</Link>
      </p>
    </div>
  );
}

export function ProofSite() {
  const { path } = useRouter();
  return (
    <>
      <div className="env-strip preview-strip" role="note">
        <span>
          <strong>Recorded proof</strong> · NEAR testnet · fictional people and test tokens
        </span>
      </div>
      <header className="site-header">
        <div className="site-header-inner">
          <Link to="/" className="wordmark">
            <img src="/favicon.svg" alt="" /> Everstreet
          </Link>
          <nav className="primary-nav proof-site-nav" aria-label="Proof">
            {NAV.map((n) => (
              <Link key={n.to} to={n.to} current={path === n.to.split("?")[0]}>
                {n.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="main">
        <Routes />
      </main>
      <footer className="site-foot">
        <span>Everstreet · a NEAR hackathon entry · fictional data, testnet only</span>
      </footer>
    </>
  );
}

const root = document.getElementById("root");
if (root)
  createRoot(root).render(
    <StrictMode>
      <Router>
        <ProofSite />
      </Router>
    </StrictMode>,
  );
