// The Case Docket (design/sale-proof/attacks-b; Tony's choice): the public results of the attack
// suite (scripts/attack-suite.ts, data/evidence/attack-suite.json). Each case pairs its clean
// run with its attack run, the refusal it met and the protected values before and after.
// Fixture results are labelled as fixtures. Labels and values only.

import { useEffect, useState } from "react";
import { Link } from "../router.tsx";
import { SourceTag } from "./HandoffProof.tsx";

interface Protected {
  owner: string;
  generation: number;
  escrow: string;
  customer_units: string;
  pending_payouts: number;
  feed_controller?: string;
  supplier_budget?: string;
  verifier_balances?: string;
}
interface Case {
  group: number;
  name: string;
  clean: { what: string; result: string };
  attack: { what: string; refusal: string };
  protected: { before: Protected; after: Protected };
  unchanged: boolean;
  passed: boolean;
  /** The same attack refused on NEAR testnet (series 3), when it also ran there. */
  testnet?: {
    refusal: string;
    what: string;
    explorer: string | null;
    clean_explorer: string | null;
  };
}
export interface Suite {
  format: "everstreet.attack-suite";
  version: 1;
  commit: string;
  source: "synthetic" | "local_node";
  label: string;
  groups: { n: number; title: string }[];
  cases: Case[];
  planted: { fault: string; invariant: keyof Protected; caught: boolean }[];
  summary: { cases: number; passed: number; planted: number; caught: number; failures: string[] };
}

const VALUE_LABEL: Record<keyof Protected, string> = {
  owner: "Owner",
  generation: "Generation",
  escrow: "Escrow (base units)",
  customer_units: "Customer units",
  pending_payouts: "Pending payouts",
  feed_controller: "Feed controller",
  supplier_budget: "Supplier budget (base units)",
  verifier_balances: "Held in the intents verifier (base units)",
};

/** A protected value as text; the verifier's balances as "account token amount" pairs. */
function shown(k: keyof Protected, v: unknown) {
  if (k !== "verifier_balances") return String(v);
  try {
    const rows = JSON.parse(String(v)) as [string, [string, string][]][];
    const parts = rows.flatMap(([who, m]) =>
      m.map(
        ([id, amt]) => `${who.split(".")[0]} ${amt} ${id.replace(/^nep141:/, "").split(".")[0]}`,
      ),
    );
    return parts.length ? parts.join(", ") : "none";
  } catch {
    return String(v);
  }
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Unchanged; or, where the request legitimately went through once, exactly once. */
const valuesWord = (c: Case) =>
  !c.unchanged
    ? "changed"
    : JSON.stringify(c.protected.before) === JSON.stringify(c.protected.after)
      ? "unchanged"
      : "exactly once";

function CaseView({ c, source }: { c: Case; source: Suite["source"] }) {
  const keys = (Object.keys(VALUE_LABEL) as (keyof Protected)[]).filter(
    (k) => c.protected.before[k] !== undefined,
  );
  return (
    <article className="docket-case">
      <h3 className="docket-case-name">{c.name}</h3>
      <div className="docket-pair">
        <div className="docket-run docket-clean">
          <strong>
            <span aria-hidden="true">✓</span> Clean run
          </strong>
          <span>{c.clean.what}</span>
          <span className="muted">{c.clean.result}</span>
        </div>
        <div className="docket-run docket-attack">
          <strong>
            <span aria-hidden="true">✕</span> Attack run
          </strong>
          <span>{c.attack.what}</span>
        </div>
      </div>
      <div className="row docket-tags">
        <span className={c.passed ? "pill docket-refusal" : "pill caution"}>
          {c.passed ? c.attack.refusal : `Not refused: ${c.attack.refusal}`}
        </span>
        <SourceTag source={source} />
        <span className="pill">Fixture</span>
        {c.testnet &&
          (c.testnet.explorer ? (
            <a
              className="pill success"
              href={c.testnet.explorer}
              target="_blank"
              rel="noreferrer"
              title={c.testnet.what}
            >
              NEAR testnet · {c.testnet.refusal} ↗
            </a>
          ) : (
            <span className="pill success" title={c.testnet.what}>
              NEAR testnet · {c.testnet.refusal}
            </span>
          ))}
      </div>
      <details className="docket-values">
        <summary>Protected values · {valuesWord(c)}</summary>
        <dl className="proof-rows">
          {keys.map((k) => (
            <div className="proof-row" key={k}>
              <dt>{VALUE_LABEL[k]}</dt>
              <dd>
                <span className="mono wrap">
                  {shown(k, c.protected.before[k])} → {shown(k, c.protected.after[k])}
                </span>
              </dd>
            </div>
          ))}
        </dl>
      </details>
    </article>
  );
}

export function AttackDocket({ suite }: { suite: Suite }) {
  const byGroup = (n: number) => suite.cases.filter((c) => c.group === n);
  return (
    <div className="page docket">
      <header className="sale-head">
        <div className="eyebrow">Case docket · public results</div>
        <h1 className="display sale-title">What we tried to break</h1>
        <p className="row docket-summary">
          <span className="pill success">
            {suite.summary.passed} of {suite.summary.cases} attacks refused
          </span>
          <span className="pill success">
            {suite.summary.caught} of {suite.summary.planted} planted faults caught
          </span>
          <span className="pill">
            Commit <span className="mono">{suite.commit.slice(0, 7)}</span>
          </span>
        </p>
        <p className="muted proof-small">{suite.label}</p>
      </header>
      <div className="docket-layout">
        <nav className="card docket-nav" aria-label="Test groups">
          <h2 className="sale-h3">Test groups</h2>
          <ol>
            {suite.groups.map((g) => (
              <li key={g.n}>
                <a href={`#group-${g.n}`}>{g.title}</a>
              </li>
            ))}
          </ol>
        </nav>
        <div className="docket-groups">
          {suite.groups.map((g) => (
            <section
              key={g.n}
              id={`group-${g.n}`}
              className="card docket-group"
              aria-labelledby={`group-${g.n}-t`}
            >
              <div className="eyebrow">Group {pad(g.n)}</div>
              <h2 id={`group-${g.n}-t`} className="ledger-h">
                {g.title}
              </h2>
              {g.n === 9 ? (
                <ul className="docket-planted">
                  {suite.planted.map((p) => (
                    <li key={p.fault}>
                      <span>{p.fault}</span>
                      <span className={p.caught ? "pill docket-refusal" : "pill caution"}>
                        {p.caught ? `Caught: ${VALUE_LABEL[p.invariant]} check` : "Not caught"}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : byGroup(g.n).length === 0 ? (
                <p className="unknown">No case recorded</p>
              ) : (
                byGroup(g.n).map((c) => <CaseView key={c.name} c={c} source={suite.source} />)
              )}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

export function AttackDocketPage() {
  const [suite, setSuite] = useState<Suite | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/public/attacks")
      .then(async (r) => {
        if (!r.ok)
          throw new Error(((await r.json()) as { error?: string }).error ?? "Not available");
        setSuite((await r.json()) as Suite);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : "Not available"));
  }, []);
  if (err)
    return (
      <div className="page empty" role="alert">
        <h2>The attack results couldn't be shown</h2>
        <p>{err}</p>
        <Link to="/">Everstreet</Link>
      </div>
    );
  if (!suite)
    return (
      <div className="page muted" role="status">
        Loading the results…
      </div>
    );
  return <AttackDocket suite={suite} />;
}
