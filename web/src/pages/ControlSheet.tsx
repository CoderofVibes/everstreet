// Job 003x: the buyer's control sheet (each statement with its basis and freshness, current kept
// apart from historical and pending-external), the portable record download, and a verifier
// page for a record file (the check reads only the supplied text).

import { useEffect, useId, useState } from "react";
import { Link } from "../router.tsx";
import { useSession } from "../session.tsx";

// biome-ignore lint/suspicious/noExplicitAny: a loosely typed projection, read field by field
type Json = Record<string, any>;
const KIND: Record<string, { label: string; tone: string }> = {
  current: { label: "Current", tone: "mint" },
  as_recorded: { label: "As recorded", tone: "blue" },
  historical: { label: "History", tone: "" },
  pending_external: { label: "Still to do", tone: "caution" },
};

export function ControlSheetPage({ businessId }: { businessId: string }) {
  const { person } = useSession();
  const [s, setS] = useState<Json | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing">("loading");
  useEffect(() => {
    if (!person) return;
    fetch(`/api/businesses/${encodeURIComponent(businessId)}/control-sheet`, {
      credentials: "same-origin",
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        setS((await r.json()) as Json);
        setState("ready");
      })
      .catch(() => setState("missing"));
  }, [person, businessId]);
  if (state === "loading") return <div className="page muted">Loading…</div>;
  if (state === "missing" || !s)
    return (
      <div className="page empty">
        <h2>Only the business's current owner can see its control sheet</h2>
        <Link to="/portfolio">Your portfolio</Link>
      </div>
    );
  return (
    <div className="page narrow">
      <p className="eyebrow">
        <Link to="/portfolio">Portfolio</Link> · Control sheet
      </p>
      <h1 className="display" style={{ fontSize: 36 }}>
        {s.business.name}
      </h1>
      <p className="lead">
        What you control now, what customers keep, and what still has to move outside NEAR.
      </p>
      {s.statements.map((g: Json) => (
        <section key={g.group} className="card" aria-label={g.group}>
          <h2>{g.group}</h2>
          <ul className="plain cs-list">
            {g.items.map((i: Json) => (
              <li key={i.text}>
                <span className={`pill ${KIND[i.kind]?.tone ?? ""}`}>
                  {KIND[i.kind]?.label ?? i.kind}
                </span>{" "}
                {i.text}
                <div className="muted small">
                  {i.basis}
                  {i.observed_at
                    ? ` · ${new Date(i.observed_at).toLocaleString()}`
                    : " · No observation time"}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <section className="card">
        <h2>Portable record</h2>
        <p>{s.record.note}</p>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <a
            className="btn btn-primary"
            href={`/api/businesses/${encodeURIComponent(businessId)}/handover-record`}
            download
          >
            Download the record
          </a>
          <Link to="/acquire/verify-record" className="btn btn-secondary">
            Verify a record
          </Link>
        </div>
      </section>
    </div>
  );
}

export function VerifyRecordPage() {
  const [text, setText] = useState("");
  const [v, setV] = useState<Json | null>(null);
  const [error, setError] = useState<string | null>(null);
  const uid = useId();
  const verify = (t: string) => {
    setError(null);
    fetch("/api/handover-records/verify", { method: "POST", credentials: "same-origin", body: t })
      .then(async (r) => setV((await r.json()) as Json))
      .catch((e: Error) => setError(e.message));
  };
  return (
    <div className="page narrow">
      <p className="eyebrow">Acquire · Verify a record</p>
      <h1 className="display" style={{ fontSize: 36 }}>
        Verify a handover record
      </h1>
      <p className="muted">
        Checks the file you supply: its format, that its bytes match its digests, that its
        identities agree, and that nothing mandatory is missing. Nothing is fetched or stored. You
        can also run{" "}
        <span className="mono">npx tsx scripts/verify-handover-record.ts record.json</span> offline.
      </p>
      <section className="card">
        <label htmlFor={`${uid}-f`}>Record file</label>
        <input
          id={`${uid}-f`}
          type="file"
          accept="application/json,.json"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            if (f.size > 1_048_576)
              return setError("That file is larger than 1 MB; it isn't read.");
            void f.text().then((t) => {
              setText(t);
              verify(t);
            });
          }}
        />
        <label htmlFor={`${uid}-t`}>Or paste its text</label>
        <textarea
          id={`${uid}-t`}
          className="input mono"
          rows={5}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button
          type="button"
          className="btn btn-primary"
          disabled={!text.trim()}
          onClick={() => verify(text)}
        >
          Verify
        </button>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </section>
      {v && (
        <section className="card" role="status" aria-label="Verification result">
          <h2>
            {v.ok
              ? "These bytes verify"
              : v.format.supported
                ? "This record doesn't verify"
                : "Not a supported record"}
          </h2>
          <p className="muted">{v.format.detail}</p>
          {(
            [
              ["Doesn't match", v.mismatched],
              ["Missing", v.missing],
              ["Inconsistent", v.inconsistent],
              ["Matches", v.matched],
              ["Needs a fresh observation", v.needs_fresh_observation],
              ["Can't be established by this file", v.cannot_establish],
            ] as [string, string[]][]
          )
            .filter(([, list]) => list.length > 0)
            .map(([title, list]) => (
              <div key={title}>
                <h3>{title}</h3>
                <ul className="plain small">
                  {list.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              </div>
            ))}
        </section>
      )}
    </div>
  );
}
