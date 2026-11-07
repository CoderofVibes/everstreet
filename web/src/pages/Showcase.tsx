// Showcase stage B (docs/design/SHOWCASE_SPEC.md): the public teaching layer.
// - SamplePanel: three of the product's own required test invoices, with results prepared in
//   advance by the labelled stand-in model through the product's own validation. It reads only
//   the bundled samples.json: no request, no analytics, nothing recorded.
// - ExampleBusinesses: the three example cards, structurally apart from real listings.
// - ExamplePage: /example/ledgerline reads the public projection of the VERIFIED testnet record
//   (one read, no sign-in).
// - RelaydeskSample: three fictional support requests decided by the REAL workflow engine in
//   advance (relaydesk.json, drift-tested); /example/relaydesk shows it. No request either.
// - SignalwatchSample: three fictional release notes answered by the labelled stand-in analyst
//   and checked by the product's own rules (signalwatch.json, drift-tested). No request.

import { useEffect, useId, useRef, useState } from "react";
import { usePublicRead } from "../actorRead.ts";
import { ApiError } from "../api.ts";
import { Link, useRouter } from "../router.tsx";
import relaydesk from "../showcase/relaydesk.json" with { type: "json" };
import samples from "../showcase/samples.json" with { type: "json" };
import signalwatch from "../showcase/signalwatch.json" with { type: "json" };
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
          {/* First-use review #8: one line, in plain words. */}
          <p className="sample-would">
            {shown.charged_on_a_real_run
              ? "A real run would charge one use for this result."
              : "A real run would charge nothing: a refusal is never charged."}
          </p>
          <div className="row sample-actions">
            <Link to="/example/ledgerline?tab=operate" className="btn btn-secondary btn-sm">
              See the owner's view
            </Link>
            <Link to="/example/ledgerline?tab=acquire" className="btn btn-secondary btn-sm">
              See the sale
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

// ---------- the Relaydesk sample (the real workflow engine, decided in advance) ----------

export function RelaydeskSample() {
  const uid = useId();
  const list = relaydesk.samples as Json[];
  const [choice, setChoice] = useState<string>(list[0]?.id ?? "");
  const [shown, setShown] = useState<Json | null>(null);
  const resultRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (shown) resultRef.current?.focus();
  }, [shown]);
  const fields = relaydesk.product.fields as Json[];
  const stages = relaydesk.product.stages as Json[];
  return (
    <section className="sample-panel" aria-labelledby={`${uid}-h`}>
      <p className="example-eyebrow">Example business · sample data</p>
      <h2 id={`${uid}-h`} className="sample-title">
        Relaydesk <span className="muted">· support workflow (SaaS)</span>
      </h2>
      <p className="small">
        A customer fills in a support request; it becomes a case the team moves from{" "}
        {stages.map((s) => s.label).join(" to ")}.
      </p>
      {!shown ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setShown(list.find((s) => s.id === choice) ?? null);
          }}
        >
          <fieldset className="sample-choices">
            <legend>Try a sample request</legend>
            {list.map((s) => (
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
            Send the sample request
          </button>
          <p className="small muted sample-note">
            Sample run: decided in advance by Everstreet's real workflow engine (no AI model) and
            checked by our tests. Nothing is sent or recorded.
          </p>
        </form>
      ) : (
        <div className="sample-result" aria-live="polite">
          <p className="example-eyebrow">Sample run · workflow engine · nothing charged</p>
          <h3 ref={resultRef} tabIndex={-1} className="sample-result-title">
            {shown.title}
          </h3>
          <p>
            Outcome{" "}
            <span
              className={`outcome-pill ${shown.result.outcome === "accepted" ? "extracted" : "refused"}`}
            >
              {shown.result.outcome === "accepted" ? "Accepted" : "Refused"}
            </span>
          </p>
          <dl className="sample-fields is-stacked">
            {fields.map((f) => (
              <div key={f.key}>
                <dt>{f.label}</dt>
                <dd>{shown.fields[f.key] ?? <span className="muted">left empty</span>}</dd>
              </div>
            ))}
          </dl>
          {shown.result.outcome === "accepted" ? (
            <ol className="wf-steps" aria-label="Where the request would stand">
              {stages.map((s, i) => (
                <li
                  key={s.key}
                  className={i === 0 ? "is-current" : ""}
                  aria-current={i === 0 ? "step" : undefined}
                >
                  {s.label}
                </li>
              ))}
            </ol>
          ) : (
            <p className="notice info">{shown.result.reason}.</p>
          )}
          <p className="sample-would">
            {shown.charged_on_a_real_run
              ? `A real request would charge one use and open a case in ${stages[0]?.label ?? "its first stage"}.`
              : "A real request would charge nothing: a refused request is never charged."}
          </p>
          <div className="row sample-actions">
            <button type="button" className="btn btn-quiet btn-sm" onClick={() => setShown(null)}>
              Try another sample
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

// ---------- the Signalwatch sample (the stand-in analyst, checked by the product) ----------

export function SignalwatchSample() {
  const uid = useId();
  const list = signalwatch.samples as Json[];
  const [choice, setChoice] = useState<string>(list[0]?.id ?? "");
  const [shown, setShown] = useState<Json | null>(null);
  const resultRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (shown) resultRef.current?.focus();
  }, [shown]);
  const p = signalwatch.product;
  return (
    <section className="sample-panel" aria-labelledby={`${uid}-h`}>
      <p className="example-eyebrow">Example business · sample data</p>
      <h2 id={`${uid}-h`} className="sample-title">
        Signalwatch <span className="muted">· agent service</span>
      </h2>
      <p className="small">
        Paste a supplier's release notes and what you rely on; get flags back, each quoting the
        notes, with why it matters and a proposed next step. It proposes; it never acts.
      </p>
      {!shown ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setShown(list.find((x) => x.id === choice) ?? null);
          }}
        >
          <fieldset className="sample-choices">
            <legend>Try sample release notes</legend>
            {list.map((x) => (
              <label key={x.id} className="sample-choice">
                <input
                  type="radio"
                  name={`${uid}-sample`}
                  value={x.id}
                  checked={choice === x.id}
                  onChange={() => setChoice(x.id)}
                />
                <span>
                  <strong>{x.title}</strong>
                  <span className="small muted">{x.why}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <button type="submit" className="btn btn-primary">
            Check the sample notes
          </button>
          <p className="small muted sample-note">
            Sample run: a fixed answer from Everstreet's stand-in analyst, prepared in advance and
            checked by the product's own rules and our tests. Nothing is sent or recorded.
          </p>
        </form>
      ) : (
        <div className="sample-result" aria-live="polite">
          <p className="example-eyebrow">Sample run · stand-in analyst · nothing charged</p>
          <h3 ref={resultRef} tabIndex={-1} className="sample-result-title">
            {shown.title}
          </h3>
          <p>
            Outcome{" "}
            <span
              className={`outcome-pill ${shown.analysis.outcome === "analyzed" ? "extracted" : "refused"}`}
            >
              {shown.analysis.outcome === "analyzed" ? "Analyzed" : "Refused"}
            </span>
          </p>
          <dl className="sample-fields is-stacked">
            <div>
              <dt>{p.context_label}</dt>
              <dd>{signalwatch.relies}</dd>
            </div>
          </dl>
          {shown.analysis.outcome === "analyzed" ? (
            <>
              <p>
                <strong>{p.result_title}:</strong> {shown.analysis.summary}
              </p>
              {(shown.analysis.findings as Json[]).map((f) => (
                <div key={f.evidence} className="an-flag">
                  <div className="row">
                    <strong>{f.title}</strong>
                    <span className={`pill ${f.severity === "high" ? "caution" : ""}`}>
                      {f.severity} severity
                    </span>
                  </div>
                  <blockquote className="an-quote">{f.evidence}</blockquote>
                  <p className="small">{f.why}</p>
                  <p className="small">
                    <strong>Proposed next step:</strong> {f.proposed_action}
                  </p>
                </div>
              ))}
            </>
          ) : (
            <p className="notice info">{shown.analysis.reason}</p>
          )}
          <details className="sample-input">
            <summary>Show the release notes</summary>
            <pre>{shown.notes}</pre>
          </details>
          <p className="sample-would">
            {shown.charged_on_a_real_run
              ? "A real request would charge one use for this analysis."
              : "A real request would charge nothing: a refusal is never charged."}
          </p>
          <div className="row sample-actions">
            <button type="button" className="btn btn-quiet btn-sm" onClick={() => setShown(null)}>
              Try another sample
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

// ---------- the example businesses section ----------

export function ExampleBusinesses() {
  return (
    <section className="home-section examples" aria-labelledby="examples-h">
      <div className="section-head">
        <h2 id="examples-h">Example businesses</h2>
      </div>
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
              How it ran
            </Link>
            <Link to="/example/ledgerline?tab=acquire" className="btn btn-quiet btn-sm">
              How it was sold
            </Link>
          </div>
        </article>
        <article className="example-card">
          <p className="example-eyebrow">Example business · sample data</p>
          <h3>Relaydesk</h3>
          <p className="small muted">Support workflow (SaaS) · one unit per accepted request</p>
          <p className="small">Runs on Everstreet's workflow engine: no AI model is involved.</p>
          <div className="row example-actions">
            <Link to="/example/relaydesk" className="btn btn-primary btn-sm">
              Try a sample
            </Link>
          </div>
        </article>
        <article className="example-card">
          <p className="example-eyebrow">Example business · sample data</p>
          <h3>Signalwatch</h3>
          <p className="small muted">Agent service · one unit per delivered analysis</p>
          <p className="small">
            Flags supplier changes that affect you; it proposes and never acts.
          </p>
          <div className="row example-actions">
            <Link to="/example/signalwatch" className="btn btn-primary btn-sm">
              Try a sample
            </Link>
          </div>
        </article>
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
  if (which === "relaydesk")
    return (
      <div className="page narrow">
        <RelaydeskSample />
        <p className="small muted" style={{ marginTop: 16 }}>
          A sample with fictional requests. A real Relaydesk-style product is built, checked and
          released in Everstreet's Studio from a saved form and board.
        </p>
        <Link to="/">Back to Everstreet</Link>
      </div>
    );
  if (which === "signalwatch")
    return (
      <div className="page narrow">
        <SignalwatchSample />
        <p className="small muted" style={{ marginTop: 16 }}>
          A sample with fictional release notes. A real Signalwatch-style product is built, checked
          and released in Everstreet's Studio; its requests run on the AI runtime under the same
          checks.
        </p>
        <Link to="/">Back to Everstreet</Link>
      </div>
    );
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
          <p className="small muted">
            Every checkpoint below is a read of the contract on NEAR testnet at the block shown; the
            signed transactions, with explorer links, are under{" "}
            <Link to="/example/ledgerline?tab=acquire">Acquire · The transactions</Link>.
          </p>
          <div className="example-figures">
            <div className="card">
              <span className="muted small">Prepaid by the customer</span>
              <strong>{amount(x.figures.prepaid.value)}</strong>
              <span className="small muted">
                100 uses at {amount(x.figures.unit_price.value)} each
              </span>
            </div>
            <div className="card">
              <span className="muted small">Earned (uses charged by the contract)</span>
              <strong>{amount(x.figures.earned_by_end.value)}</strong>
              <span className="small muted">uses the contract charged, at the end of the run</span>
            </div>
            <div className="card">
              <span className="muted small">Still owed to the customer at the sale</span>
              <strong>{x.figures.owed_at_close.value} uses</strong>
              <Source s={x.figures.owed_at_close.source} />
            </div>
          </div>
          <div className="scroll-x">
            <table className="table">
              <caption>The customer's uses over time</caption>
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
                  the business contract: {x.figures.control_before.role} →{" "}
                  {x.figures.control_after.role} <Source s="near_testnet_final" />
                </li>
                <li>the product, its releases and the customer offer</li>
                <li>
                  and shipped a checked update a customer then used{" "}
                  <Source s="rehearsal_app_record" />
                </li>
              </ul>
              <p className="small">
                The former owner's {(x.refusals as Json[]).length} later attempts were refused{" "}
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
    </div>
  );
}
