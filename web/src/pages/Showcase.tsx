// Showcase stage B (docs/design/SHOWCASE_SPEC.md): the public teaching layer.
// - SamplePanel: three of the product's own required test invoices, with results prepared in
//   advance by the labelled stand-in model through the product's own validation. It reads only
//   the bundled samples.json: no request, no analytics, nothing recorded.
// - ExampleBusinesses: the three example cards, structurally apart from real listings.
// - ExamplePage: /example/ledgerline reads the public projection of the VERIFIED testnet record
//   (one read, no sign-in); /example/relaydesk and /example/signalwatch show labelled
//   illustrations until their engines run.

import { useEffect, useId, useRef, useState } from "react";
import { usePublicRead } from "../actorRead.ts";
import { ApiError } from "../api.ts";
import { Link, useRouter } from "../router.tsx";
import samples from "../showcase/samples.json" with { type: "json" };
import { readable } from "../TokenAmount.tsx";

// biome-ignore lint/suspicious/noExplicitAny: the bundled samples and a public projection, read field by field
type Json = Record<string, any>;

const OUTCOME_WORDS: Record<string, string> = {
  extracted: "Extracted",
  incomplete: "Incomplete",
  refused: "Refused",
  invalid: "Invalid",
};

// ---------- the sample panel ----------

export function SamplePanel({ headingLevel = 2 }: { headingLevel?: 2 | 3 }) {
  const uid = useId();
  const [choice, setChoice] = useState<string>(samples.samples[0]?.id ?? "");
  const [shown, setShown] = useState<Json | null>(null);
  const resultRef = useRef<HTMLHeadingElement>(null);
  const H = headingLevel === 2 ? "h2" : "h3";
  useEffect(() => {
    if (shown) resultRef.current?.focus();
  }, [shown]);
  const fields = samples.product.fields as Json[];
  return (
    <section className="sample-panel" aria-labelledby={`${uid}-h`}>
      <p className="example-eyebrow">Example business · sample data</p>
      <H id={`${uid}-h`} className="sample-title">
        Ledgerline <span className="muted">· AI invoice API</span>
      </H>
      <p className="small">Paste an invoice; get its fields back exactly, or an honest refusal.</p>
      {!shown ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setShown((samples.samples as Json[]).find((s) => s.id === choice) ?? null);
          }}
        >
          <fieldset className="sample-choices">
            <legend>Try a sample</legend>
            {(samples.samples as Json[]).map((s) => (
              <label key={s.id} className="sample-choice">
                <input
                  type="radio"
                  name={`${uid}-sample`}
                  value={s.id}
                  checked={choice === s.id}
                  onChange={() => setChoice(s.id)}
                />
                <span>
                  <strong>{s.title}</strong>
                  <span className="small muted">{s.why}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <button type="submit" className="btn btn-primary">
            Run the sample
          </button>
          <p className="small muted sample-note">
            Sample run: a fixed answer from Everstreet's stand-in model, prepared in advance and
            checked by our tests. Nothing is sent or recorded.
          </p>
        </form>
      ) : (
        <div className="sample-result" aria-live="polite">
          <p className="example-eyebrow">Sample run · stand-in model · nothing charged</p>
          <h3 ref={resultRef} tabIndex={-1} className="sample-result-title">
            {shown.title}
          </h3>
          <p>
            Outcome{" "}
            <span className={`outcome-pill ${shown.extraction.outcome}`}>
              {OUTCOME_WORDS[shown.extraction.outcome] ?? shown.extraction.outcome}
            </span>
          </p>
          {shown.extraction.fields?.length > 0 ? (
            <dl className="sample-fields">
              {fields.map((f) => {
                const v = (shown.extraction.fields as Json[]).find((x) => x.key === f.key);
                return (
                  <div key={f.key}>
                    <dt>{f.label}</dt>
                    <dd>{v?.value ?? <span className="muted">not on this invoice</span>}</dd>
                  </div>
                );
              })}
            </dl>
          ) : (
            <p className="muted">No fields: nothing is made up from text that isn't an invoice.</p>
          )}
          {shown.extraction.issues?.length > 0 && (
            <ul className="sample-issues">
              {(shown.extraction.issues as string[]).map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          )}
          <details className="sample-input">
            <summary>Show the invoice text</summary>
            <pre>{shown.input}</pre>
          </details>
          <div className="sample-would">
            <strong>What a real run would record</strong>
            <ul>
              <li>
                {shown.charged_on_a_real_run
                  ? "One unit reserved, then charged, because a result was delivered."
                  : "One unit reserved, then returned: a refusal is never charged."}
              </li>
              <li>
                The AI provider's compute cost, in USD, once it is reported. The stand-in has none.
              </li>
              <li>The result kept for the customer only, for the offer's retention period.</li>
            </ul>
            <p className="small muted">{samples.charging_rule}</p>
          </div>
          <div className="row sample-actions">
            <Link to="/example/ledgerline?tab=operate" className="btn btn-secondary btn-sm">
              Follow it into Operate
            </Link>
            <Link to="/example/ledgerline?tab=acquire" className="btn btn-secondary btn-sm">
              Follow it into Acquire
            </Link>
            <button type="button" className="btn btn-quiet btn-sm" onClick={() => setShown(null)}>
              Try another sample
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

// ---------- illustrations (not runs) ----------

const ILLUSTRATIONS: Record<string, { name: string; kind: string; steps: [string, string][] }> = {
  relaydesk: {
    name: "Relaydesk",
    kind: "Support workflow (SaaS)",
    steps: [
      ["Intake", 'A customer submits a support request: "The export button does nothing."'],
      ["Assignment", "The workflow's rule sends it to the right person, with its history."],
      ["Resolution", "It's resolved and closed; the customer sees every step."],
    ],
  },
  signalwatch: {
    name: "Signalwatch",
    kind: "Agent service",
    steps: [
      ["A changelog", "A customer submits a supplier's release notes."],
      ["Flags, and why", "The agent flags what could affect them, and says why each matters."],
      ["Proposed action", "Each flag comes with a proposed next step; nothing is done for them."],
    ],
  },
};

export function Illustration({ which }: { which: "relaydesk" | "signalwatch" }) {
  const it = ILLUSTRATIONS[which];
  if (!it) return null;
  return (
    <figure className="illustration">
      <figcaption className="example-eyebrow">Illustration, not a run</figcaption>
      <ol>
        {it.steps.map(([t, d]) => (
          <li key={t}>
            <strong>{t}</strong>
            <span className="small">{d}</span>
          </li>
        ))}
      </ol>
    </figure>
  );
}

// ---------- the example businesses section ----------

export function ExampleBusinesses() {
  return (
    <section className="home-section examples" aria-labelledby="examples-h">
      <div className="section-head">
        <h2 id="examples-h">Example businesses</h2>
      </div>
      <p className="muted small">
        Examples to learn from, apart from real listings. They are never offered for sale.
      </p>
      <div className="example-grid">
        <article className="example-card">
          <p className="example-eyebrow">Example business · sample data</p>
          <h3>Ledgerline</h3>
          <p className="small muted">AI invoice API · one unit per delivered read</p>
          <p className="small">Its history is a verified NEAR testnet run: built, used, sold.</p>
          <div className="row example-actions">
            <a href="#try-ledgerline" className="btn btn-primary btn-sm">
              Try a sample
            </a>
            <Link to="/example/ledgerline?tab=operate" className="btn btn-quiet btn-sm">
              Operate
            </Link>
            <Link to="/example/ledgerline?tab=acquire" className="btn btn-quiet btn-sm">
              Acquire
            </Link>
          </div>
        </article>
        {(["relaydesk", "signalwatch"] as const).map((k) => (
          <article key={k} className="example-card">
            <p className="example-eyebrow">Example business · sample data</p>
            <h3>{ILLUSTRATIONS[k]?.name}</h3>
            <p className="small muted">{ILLUSTRATIONS[k]?.kind}</p>
            <p className="small">
              <strong>Not tryable yet.</strong> Its engine isn't built, so the planned flow is shown
              as an illustration.
            </p>
            <div className="row example-actions">
              <Link to={`/example/${k}`} className="btn btn-quiet btn-sm">
                See the planned flow
              </Link>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

// ---------- /example/* ----------

const fetchLedgerline = async (): Promise<Json> => {
  const r = await fetch("/api/examples/ledgerline");
  const d = (await r.json().catch(() => ({}))) as Json;
  if (!r.ok) throw new ApiError(r.status, d.error ?? `HTTP ${r.status}`, d.code);
  return d;
};

const SOURCE_WORDS: Record<string, string> = {
  near_testnet_final: "NEAR testnet, final",
  near_testnet_tx: "NEAR testnet transaction",
  rehearsal_app_record: "the app's record of the run",
  stand_in_model: "stand-in model",
};
function Source({ s }: { s: string | undefined }) {
  return <span className="prov">{s ? (SOURCE_WORDS[s] ?? s) : "derived"}</span>;
}

export function ExamplePage({ which }: { which: string }) {
  const { search } = useRouter();
  if (which === "relaydesk" || which === "signalwatch") {
    const it = ILLUSTRATIONS[which];
    return (
      <div className="page narrow">
        <p className="example-eyebrow">Example business · sample data</p>
        <h1 className="display" style={{ fontSize: 36 }}>
          {it?.name}
        </h1>
        <p className="lead">{it?.kind}. Not tryable yet: its engine isn't built.</p>
        <Illustration which={which} />
        <p className="small muted">
          This shows the planned flow only. It becomes a sample you can run when the engine works.
        </p>
        <Link to="/">Back to Everstreet</Link>
      </div>
    );
  }
  if (which !== "ledgerline")
    return (
      <div className="page empty">
        <h2>That example doesn't exist</h2>
        <Link to="/">Back to Everstreet</Link>
      </div>
    );
  const tab = new URLSearchParams(search).get("tab") ?? "try";
  return <LedgerlineExample tab={["try", "operate", "acquire"].includes(tab) ? tab : "try"} />;
}

function LedgerlineExample({ tab }: { tab: string }) {
  const { go } = useRouter();
  const read = usePublicRead(fetchLedgerline);
  const x = read.state.data;
  const tabs: [string, string][] = [
    ["try", "Try"],
    ["operate", "Operate"],
    ["acquire", "Acquire"],
  ];
  const tok = x?.token as Json | null | undefined;
  const amount = (base: string | null | undefined) => {
    if (!base) return "unknown";
    const r = tok ? readable(base, tok.decimals) : null;
    return r ? `${r} ${tok?.symbol}` : `${base} base units`;
  };
  return (
    <div className="page example-page">
      <p className="example-eyebrow">
        Example business · its history is a verified NEAR testnet run
      </p>
      <h1 className="display" style={{ fontSize: 40 }}>
        Ledgerline
      </h1>
      <p className="lead">
        An AI invoice API, built, opened to customers and sold on NEAR testnet. What follows is read
        from that run's verified record; the AI results in it came from a labelled stand-in.
      </p>
      <div className="example-tabs" role="tablist" aria-label="Ledgerline example">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={`btn btn-sm ${tab === id ? "btn-secondary" : "btn-quiet"}`}
            onClick={() => go(`/example/ledgerline${id === "try" ? "" : `?tab=${id}`}`)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "try" && <SamplePanel />}
      {tab !== "try" && !x && read.state.status === "loading" && (
        <p className="muted">Reading the example's record…</p>
      )}
      {tab !== "try" && !x && read.state.status !== "loading" && (
        <div role="alert">
          <p className="error">
            The example's record couldn't be read just now
            {read.state.error ? ` (${read.state.error})` : ""}.
          </p>
          <button type="button" className="btn btn-secondary btn-sm" onClick={read.retry}>
            Try again
          </button>
        </div>
      )}
      {tab === "operate" && x && (
        <section aria-labelledby="op-h">
          <h2 id="op-h">Ledgerline, as its owner saw it</h2>
          <div className="example-figures">
            <div className="card">
              <span className="muted small">Prepaid by the customer</span>
              <strong>{amount(x.figures.prepaid.value)}</strong>
              <span className="small muted">
                100 uses at {amount(x.figures.unit_price.value)} each
              </span>
              <span className="prov">derived: contract views × the offer's price</span>
            </div>
            <div className="card">
              <span className="muted small">Earned (uses charged by the contract)</span>
              <strong>{amount(x.figures.earned_by_end.value)}</strong>
              <span className="small muted">uses the contract charged, at the end of the run</span>
              <span className="prov">derived: contract views × the offer's price</span>
            </div>
            <div className="card">
              <span className="muted small">Still owed to the customer at the sale</span>
              <strong>{x.figures.owed_at_close.value} uses</strong>
              <Source s={x.figures.owed_at_close.source} />
            </div>
            <div className="card">
              <span className="muted small">AI compute</span>
              <strong>not shown</strong>
              <span className="small muted">the run used a stand-in model, which has no cost</span>
              <Source s="stand_in_model" />
            </div>
          </div>
          <div className="scroll-x">
            <table className="table">
              <caption>The customer's uses at each checkpoint (contract views, final)</caption>
              <thead>
                <tr>
                  <th scope="col">Checkpoint</th>
                  <th scope="col">Free</th>
                  <th scope="col">Used</th>
                  <th scope="col">Owner</th>
                  <th scope="col">Block</th>
                </tr>
              </thead>
              <tbody>
                {(x.checkpoints as Json[]).map((c) => (
                  <tr key={c.name}>
                    <th scope="row">{c.name.replaceAll("_", " ")}</th>
                    <td>{c.free ?? "—"}</td>
                    <td>{c.consumed ?? "—"}</td>
                    <td>
                      {c.owner_role ?? "—"}
                      {c.generation !== null ? ` (generation ${c.generation})` : ""}
                    </td>
                    <td className="mono">{c.block ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {tab === "acquire" && x && (
        <section aria-labelledby="aq-h">
          <h2 id="aq-h">When Ledgerline was sold</h2>
          <div className="example-columns">
            <div className="card">
              <h3>The buyer took control of</h3>
              <ul>
                <li>
                  the business contract: owner {x.figures.control_before.role} (generation{" "}
                  {x.figures.control_before.generation}) → {x.figures.control_after.role}{" "}
                  (generation {x.figures.control_after.generation}){" "}
                  <Source s="near_testnet_final" />
                </li>
                <li>the product, its releases and the customer offer</li>
                <li>
                  and shipped a checked update a customer then used{" "}
                  <Source s="rehearsal_app_record" />
                </li>
              </ul>
              <p className="small">
                The former owner was refused afterwards:{" "}
                {(x.refusals as Json[]).map((r) => `${r.status}`).join(", ")}{" "}
                <Source s="rehearsal_app_record" />
              </p>
            </div>
            <div className="card">
              <h3>The customer kept</h3>
              <ul>
                <li>
                  {x.figures.owed_at_close.value} prepaid uses at the sale, exactly as the contract
                  held them <Source s="near_testnet_final" />
                </li>
                <li>
                  the same access: the next use under the buyer left{" "}
                  {x.figures.after_next_use.value}, a use on the buyer's update left{" "}
                  {x.figures.after_update.value} <Source s="near_testnet_final" />
                </li>
                <li>their earlier result, unchanged and readable only by them</li>
              </ul>
            </div>
          </div>
          <details className="example-txs">
            <summary>The transactions ({(x.transactions as Json[]).length})</summary>
            <ul className="plain">
              {(x.transactions as Json[]).map((t) => (
                <li key={t.hash}>
                  {t.step.replaceAll("_", " ")} · {t.role ?? "—"} ·{" "}
                  <a href={t.explorer} target="_blank" rel="noreferrer">
                    {t.hash.slice(0, 10)}…
                  </a>
                  {t.succeeded ? "" : " (refused by the contract)"}
                </li>
              ))}
            </ul>
          </details>
        </section>
      )}
      {x && tab !== "try" && (
        <p className="small muted">
          Check this record yourself: <span className="mono">{x.record.reproduce}</span>
        </p>
      )}
    </div>
  );
}
