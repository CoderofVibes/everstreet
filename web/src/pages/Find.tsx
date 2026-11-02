// Find a solution: plain search over published offers, with the reason each one matched.
// No paid placement; an empty result says so and suggests a change.

import { type FormEvent, useEffect, useState } from "react";
import { api, type PublicBusiness } from "../api.ts";
import { BusinessTile } from "./Home.tsx";

const EXAMPLES = [
  "beginner printmaking class",
  "help with my bookkeeping",
  "a small tool for my studio",
];

export function Find() {
  const [q, setQ] = useState("");
  const [asked, setAsked] = useState("");
  const [results, setResults] = useState<PublicBusiness[] | null>(null);
  const run = async (query: string) => {
    setAsked(query);
    setResults((await api.discover(query)).businesses);
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: load everything once on open
  useEffect(() => {
    run("");
  }, []);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(q);
  };
  return (
    <div className="page">
      <div className="eyebrow">Find a solution</div>
      <h1 className="display" style={{ fontSize: 44 }}>
        What do you need?
      </h1>
      <form className="row" onSubmit={submit} style={{ maxWidth: 760 }}>
        <input
          className="input"
          style={{ flex: 1, fontSize: 18, minHeight: 52 }}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Describe it in your own words"
          aria-label="What do you need?"
        />
        <button className="btn btn-primary btn-lg" type="submit">
          Search
        </button>
      </form>
      <div className="row" style={{ margin: "12px 0 32px" }}>
        <span className="muted" style={{ fontSize: 14 }}>
          Try:
        </span>
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            className="pill"
            style={{ cursor: "pointer" }}
            onClick={() => {
              setQ(ex);
              run(ex);
            }}
          >
            {ex}
          </button>
        ))}
      </div>
      {results === null ? (
        <p className="muted">Loading…</p>
      ) : results.length === 0 ? (
        <div className="card empty">
          <h2>{asked ? `Nothing matches “${asked}” yet` : "Nothing published yet"}</h2>
          <p>Try fewer or different words. New businesses open here every week.</p>
        </div>
      ) : (
        <>
          <p className="muted">
            {asked
              ? `${results.length} ${results.length === 1 ? "match" : "matches"} for “${asked}”, ordered by how many of your words they mention.`
              : "Everything published so far, newest first."}{" "}
            Nobody pays to appear higher.
          </p>
          <div className="shelf">
            {results.map((b) => (
              <div key={b.slug}>
                <BusinessTile b={b} />
                {b.matched && b.matched.length > 0 && (
                  <p className="muted" style={{ fontSize: 13, margin: "6px 4px 0" }}>
                    Mentions: {b.matched.join(", ")}
                  </p>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
