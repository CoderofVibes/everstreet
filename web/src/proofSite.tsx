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

/** The repository's README on GitHub: the agent evidence and the claims table live there. */
export const README_URL = "https://github.com/CoderofVibes/everstreet";

/**
 * The route through the proof, in reading order (Anthony, Nov 9: a judge should be able to follow
 * one train of proof). Each page ends with a link to the next; the last two are README sections.
 */
export const ROUTE = [
  {
    to: "/proof/ledgerline",
    label: "Handoff proof",
    icon: "shield" as const,
    line: "Owner at generation 4, the former owner refused by the contract, the customer's 100 uses.",
  },
  {
    to: "/example/ledgerline?tab=acquire",
    label: "The recorded sale",
    icon: "handshake" as const,
    line: "What the buyer took over and what the customer kept, read from the record.",
  },
  {
    to: "/attacks",
    label: "What we tried to break",
    icon: "flask" as const,
    line: "Attacks on the app and its contract rules, each refused or flagged.",
  },
  {
    to: `${README_URL}#for-agents`,
    label: "Agents on NEAR testnet",
    icon: "agent" as const,
    line: "An agent pays over HTTP 402 from its own account; one business's agent buys from another.",
  },
];
const NAV = ROUTE.slice(0, 3);
const CLAIMS_URL = `${README_URL}#follow-the-proof`;
const external = (to: string) => to.startsWith("https://");

function Landing() {
  return (
    <div className="page">
      <section className="intact proof-site-hero">
        <div>
          <div className="eyebrow">Recorded on NEAR testnet</div>
          <h1>A launchpad and marketplace for the agentic economy, on NEAR.</h1>
        </div>
      </section>
      <nav className="entries proof-entries" aria-label="The proof, in order">
        {ROUTE.map((r, i) =>
          external(r.to) ? (
            <a key={r.to} href={r.to} className="entry" target="_blank" rel="noopener">
              <Icon name={r.icon} />
              <span>
                <strong>
                  {i + 1}. {r.label}
                </strong>
                <span>{r.line}</span>
              </span>
            </a>
          ) : (
            <Link key={r.to} to={r.to} className="entry">
              <Icon name={r.icon} />
              <span>
                <strong>
                  {i + 1}. {r.label}
                </strong>
                <span>{r.line}</span>
              </span>
            </Link>
          ),
        )}
      </nav>
      <p className="proof-claims-line">
        Then every claim, with its test and transaction:{" "}
        <a href={CLAIMS_URL} target="_blank" rel="noopener">
          the claims table in the README
        </a>
        .
      </p>
    </div>
  );
}

/** The next stop on the route after the page at `path`, shown at the bottom of each proof page. */
export function nextAfter(path: string) {
  const i = ROUTE.findIndex((r) => r.to.split("?")[0] === path);
  if (i < 0) return null;
  const n = ROUTE[i + 1];
  return n
    ? { step: i + 2, label: n.label, line: n.line, to: n.to }
    : {
        step: i + 2,
        label: "Every claim, with its test and transaction",
        line: "",
        to: CLAIMS_URL,
      };
}

function NextStep({ path }: { path: string }) {
  const n = nextAfter(path);
  if (!n) return null;
  const body = (
    <>
      <span className="proof-next-k">Next · step {n.step}</span>
      <strong>{n.label} →</strong>
      {n.line && <span className="proof-next-line">{n.line}</span>}
    </>
  );
  return (
    <nav className="page proof-next" aria-label="Next in the proof">
      {external(n.to) ? (
        <a href={n.to} target="_blank" rel="noopener">
          {body}
        </a>
      ) : (
        <Link to={n.to}>{body}</Link>
      )}
    </nav>
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
        <NextStep path={path} />
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
