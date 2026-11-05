// Job 004b: connect a configured read-only source to an import workspace, read it at a pinned
// commit, see what changed since the last read, and disconnect. Everything shown is labelled by
// kind: observed (read through a connection), claimed (a deployment record), never "verified".

import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  type ImportView,
  importsApi,
  type SourceComparison,
  type SourceProvenance,
  type SourceStatus,
} from "../importsApi.ts";

const FAILURE: Record<string, string> = {
  not_found_or_inaccessible:
    "Not found, or this connection can't see it. Nothing was saved. Check the ref, or the connection's access.",
  denied: "The connection was refused. Nothing was saved.",
  rate_limited:
    "The source's rate limit was reached. Nothing was saved; try again in a few minutes.",
  timed_out: "The source didn't answer in time. Nothing was saved; try again.",
  invalid_response: "The source's answer couldn't be understood. Nothing was saved.",
  too_large: "An answer was larger than this read allows. Nothing was saved.",
  budget_exhausted: "This read reached its call or size limit. Nothing was saved; try again.",
  unavailable: "The source is unavailable right now. Nothing was saved.",
};

const short = (sha: string | null | undefined) => (sha ? sha.slice(0, 12) : "unknown");

export function SourceProvenanceView({ p }: { p: SourceProvenance }) {
  return (
    <div className="source-prov">
      <p>
        <span className="pill">
          {p.connection.fixture ? "Fictional fixture" : "Read-only connection"}
        </span>{" "}
        <strong>{p.repository.full_name}</strong> at{" "}
        <span className="mono">{short(p.commit.sha)}</span> (from{" "}
        <span className="mono">{p.ref}</span>), read {new Date(p.read_at).toLocaleString()} through{" "}
        {p.connection.label}.
      </p>
      <dl className="source-dl">
        <dt>package.json</dt>
        <dd>
          {p.manifest.state === "read"
            ? `Read at this commit (${p.manifest.bytes ?? 0} bytes). Its text isn't kept; only the facts below.`
            : `Not read: ${p.manifest.detail ?? p.manifest.state}. Its dependencies are unknown, not none.`}
        </dd>
        <dt>Deployment records</dt>
        <dd>
          {p.deployments.state === "unread" ? (
            `Not read: ${p.deployments.reason}.`
          ) : p.deployments.records.length === 0 ? (
            "None name this commit. That doesn't mean it isn't deployed."
          ) : (
            <ul className="plain">
              {p.deployments.records.map((d) => (
                <li key={d.id}>
                  Claim: {d.environment || "no environment"} reports{" "}
                  <strong>{d.statuses[0]?.state ?? "no status"}</strong>
                  {d.matches_commit ? " for this commit" : ` for another commit (${short(d.sha)})`}.
                  An integration's record, not proof it runs now.
                </li>
              ))}
            </ul>
          )}
        </dd>
        <dt>Not read</dt>
        <dd>{p.unread.join("; ")}.</dd>
        <dt>Read used</dt>
        <dd>
          {p.usage.calls} calls, {Math.round(p.usage.bytes / 1024)} KB, {p.usage.ms} ms (API{" "}
          {p.api_version})
        </dd>
      </dl>
    </div>
  );
}

function Comparison({ c }: { c: SourceComparison }) {
  const d = c.dependencies;
  const none = d && !d.added.length && !d.removed.length && !d.changed.length;
  return (
    <section className="card" aria-labelledby="source-diff-h">
      <h3 id="source-diff-h">Since read {c.from.number}</h3>
      <p>
        {c.commit_changed
          ? `Commit ${short(c.from.commit)} (${c.from.ref}) → ${short(c.to.commit)} (${c.to.ref}).`
          : `Same commit ${short(c.to.commit)}.`}
      </p>
      {d === null ? (
        <p className="muted">
          One of the two reads didn't include package.json, so dependencies can't be compared.
        </p>
      ) : none ? (
        <p className="muted">The declared dependencies are the same.</p>
      ) : (
        <table className="table">
          <caption className="sr-only">Dependency changes</caption>
          <thead>
            <tr>
              <th scope="col">Change</th>
              <th scope="col">Dependency</th>
              <th scope="col">Range</th>
            </tr>
          </thead>
          <tbody>
            {d.added.map((x) => (
              <tr key={`a-${x.key}`}>
                <td>Added</td>
                <td className="mono">{x.key.split(":")[1]}</td>
                <td className="mono">{x.ref}</td>
              </tr>
            ))}
            {d.removed.map((x) => (
              <tr key={`r-${x.key}`}>
                <td>Removed</td>
                <td className="mono">{x.key.split(":")[1]}</td>
                <td className="mono">{x.ref}</td>
              </tr>
            ))}
            {d.changed.map((x) => (
              <tr key={`c-${x.key}`}>
                <td>Changed</td>
                <td className="mono">{x.key.split(":")[1]}</td>
                <td className="mono">
                  {x.from} → {x.to}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

export function ImportSourcePanel({
  view,
  locked,
  onRead,
}: {
  view: ImportView;
  locked: boolean;
  onRead: () => void;
}) {
  const id = view.workspace.id;
  const [status, setStatus] = useState<SourceStatus | null>(null);
  const [connection, setConnection] = useState("");
  const [repository, setRepository] = useState("");
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "info"; text: string } | null>(null);
  const keyRef = useRef<{ ref: string; key: string } | null>(null);
  const messageRef = useRef<HTMLParagraphElement>(null);
  const uid = useId();
  const epoch = view.workspace.owner_epoch;
  // biome-ignore lint/correctness/useExhaustiveDependencies: the owner epoch is a trigger: reload when the business changes hands
  const load = useCallback(() => {
    importsApi
      .source(id)
      .then((s) => {
        setStatus(s);
        setConnection((c) => c || s.connections[0]?.id || "");
        setRepository((r) => r || s.active?.repository || s.connections[0]?.repositories[0] || "");
        setRef((x) => x || "main");
      })
      .catch(() => setStatus(null));
  }, [id, epoch]);
  useEffect(load, [load]);
  const say = (tone: "error" | "info", text: string) => {
    setMessage({ tone, text });
    setTimeout(() => messageRef.current?.focus(), 0);
  };
  const run = async (f: () => Promise<void>) => {
    setBusy(true);
    setMessage(null);
    try {
      await f();
    } catch (e) {
      say("error", (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (!status) return null;
  const latest = view.source.latest;
  const conn = status.connections.find((c) => c.id === connection);
  return (
    <section className="card" aria-labelledby={`${uid}-h`}>
      <h2 id={`${uid}-h`}>Connected source</h2>
      {!status.available ? (
        <p className="muted">{status.unavailable_reason}</p>
      ) : (
        <>
          <p className="muted" style={{ fontSize: 14 }}>
            {status.limits}
          </p>
          {status.active ? (
            <>
              <p>
                <span className="pill">
                  {status.active.connection.fixture ? "Fictional fixture" : "Connected"}
                </span>{" "}
                <strong>{status.active.repository}</strong> through {status.active.connection.label}
                , connected by {status.active.connected_by}.
              </p>
              {!status.active.usable_by_you && (
                <p className="notice warn">
                  This connection was made by someone else or before the business changed hands, so
                  it can't read for you. Connect your own below; earlier reports stay.
                </p>
              )}
              {status.active.usable_by_you && (
                <form
                  className="source-read"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void run(async () => {
                      if (keyRef.current?.ref !== ref)
                        keyRef.current = { ref, key: `source-${crypto.randomUUID()}` };
                      const r = await importsApi.readSource(id, ref, keyRef.current.key);
                      if (r.outcome && r.outcome.ok === false) {
                        say("error", FAILURE[r.outcome.failure] ?? r.outcome.detail);
                        if (!r.outcome.retryable) keyRef.current = null;
                      } else {
                        keyRef.current = null;
                        say(
                          "info",
                          r.created
                            ? "Read and saved as a new report."
                            : "Already read with this request.",
                        );
                        onRead();
                      }
                    });
                  }}
                >
                  <label htmlFor={`${uid}-ref`}>Branch, tag or commit to read</label>
                  <div className="row-actions">
                    <input
                      id={`${uid}-ref`}
                      className="input mono"
                      value={ref}
                      maxLength={200}
                      onChange={(e) => setRef(e.target.value)}
                      disabled={busy || locked}
                    />
                    <button
                      type="submit"
                      className="btn btn-primary"
                      disabled={busy || locked || !ref.trim()}
                    >
                      {busy ? "Reading…" : latest?.provenance ? "Read again" : "Read source"}
                    </button>
                    <button
                      type="button"
                      className="btn btn-quiet"
                      disabled={busy || locked}
                      onClick={() =>
                        void run(async () => {
                          setStatus(await importsApi.disconnectSource(id));
                          say("info", "Disconnected. Earlier reports keep where they came from.");
                        })
                      }
                    >
                      Disconnect
                    </button>
                  </div>
                </form>
              )}
            </>
          ) : (
            <p className="muted">
              Nothing connected. Earlier reports, if any, keep where they came from.
            </p>
          )}
          {(!status.active || !status.active.usable_by_you) && (
            <form
              className="source-connect"
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  setStatus(await importsApi.connectSource(id, connection, repository));
                  say("info", "Connected. Choose a ref and read it.");
                });
              }}
            >
              <label htmlFor={`${uid}-conn`}>Connection</label>
              <select
                id={`${uid}-conn`}
                className="input"
                value={connection}
                onChange={(e) => {
                  setConnection(e.target.value);
                  setRepository(
                    status.connections.find((c) => c.id === e.target.value)?.repositories[0] ?? "",
                  );
                }}
                disabled={busy || locked}
              >
                {status.connections.map((c) => (
                  <option key={c.id} value={c.id} disabled={!c.configured}>
                    {c.label}
                    {c.fixture ? " (fictional)" : ""}
                    {c.configured ? "" : " (credential not configured)"}
                  </option>
                ))}
              </select>
              <label htmlFor={`${uid}-repo`}>Repository</label>
              <select
                id={`${uid}-repo`}
                className="input mono"
                value={repository}
                onChange={(e) => setRepository(e.target.value)}
                disabled={busy || locked}
              >
                {(conn?.repositories ?? []).map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={busy || locked || !repository}
              >
                Connect
              </button>
            </form>
          )}
        </>
      )}
      {message && (
        <p
          ref={messageRef}
          tabIndex={-1}
          role={message.tone === "error" ? "alert" : "status"}
          className={message.tone === "error" ? "error" : "notice info"}
        >
          {message.text}
        </p>
      )}
      {latest?.provenance && <SourceProvenanceView p={latest.provenance} />}
      {view.source.comparison && <Comparison c={view.source.comparison} />}
    </section>
  );
}
