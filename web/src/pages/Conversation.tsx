// The studio's assistant: the business's product work log. A founder writes in plain words; a
// connected, budgeted AI drafts a proposal (brief and screens) that they review on the canvas.
// With no provider, it says so and points to the manual editors: there is no fake reply. A
// message keeps its request key until it is accepted, so a double click or a retry after an
// error is the same request. While a request runs the founder can keep typing; the view checks
// back with growing gaps (2 s up to 15 s), at most 60 times.

import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "../icons.tsx";
import {
  type AiBudget,
  type BuildJob,
  type Conversation,
  isLive,
  productsApi,
  usd,
  type WorkLogMessage,
} from "../productsApi.ts";
import { BudgetPanel, MAX_POLLS, newKey, usageText } from "./Builds.tsx";

function jobLine(job: BuildJob): { text: string; tone: "" | "blue" | "mint" | "caution" } {
  if (job.state === "queued") return { text: "Waiting to start", tone: "blue" };
  if (job.state === "running") return { text: "Drafting a proposal…", tone: "blue" };
  if (job.state === "validating") return { text: "Checking the answer…", tone: "blue" };
  if (job.state === "succeeded") return { text: "Proposal ready", tone: "mint" };
  if (job.state === "cancelled") return { text: "Stopped", tone: "" };
  if (job.state === "needs_reconciliation")
    return { text: "Stopped; whether it ran is unknown", tone: "caution" };
  return { text: `Couldn't draft: ${job.failure?.detail ?? "it failed"}`, tone: "caution" };
}

function Message({
  m,
  onReview,
  onChanged,
}: {
  m: WorkLogMessage;
  onReview: (proposalId: string) => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const line = m.job ? jobLine(m.job) : null;
  return (
    <li className={`msg ${m.role}`}>
      <div className="msg-head">
        <strong>{m.author}</strong>
        <span className="muted">{new Date(m.created_at).toLocaleTimeString()}</span>
      </div>
      <p>{m.text}</p>
      {m.proposal_id && (
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => onReview(m.proposal_id as string)}
        >
          Review the proposal <Icon name="arrowRight" size="sm" />
        </button>
      )}
      {m.job && line && (
        <div className="msg-status">
          <span className={`pill ${line.tone}`}>{line.text}</span>
          {isLive(m.job.state) && (
            <button
              type="button"
              className="btn btn-quiet btn-sm"
              disabled={busy || m.job.cancel_requested}
              onClick={async () => {
                setBusy(true);
                try {
                  await productsApi.cancelBuild((m.job as BuildJob).id);
                  onChanged();
                } finally {
                  setBusy(false);
                }
              }}
            >
              {m.job.cancel_requested ? "Stopping…" : "Stop"}
            </button>
          )}
          {!isLive(m.job.state) && m.job.dispatched && (
            <span className="muted" style={{ fontSize: 12 }}>
              {usageText(m.job)}
            </span>
          )}
        </div>
      )}
    </li>
  );
}

export function ConversationPanel({
  projectId,
  businessId,
  idea,
  prefill,
  onReview,
  onManual,
}: {
  projectId: string;
  businessId: string;
  idea: string;
  /** Text to put in the composer (e.g. "ask again"); `n` changes each time it is offered. */
  prefill: { text: string; n: number } | null;
  onReview: (proposalId: string) => void;
  onManual: () => void;
}) {
  const [conv, setConv] = useState<Conversation | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [key, setKey] = useState(() => newKey("msg"));
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [polls, setPolls] = useState(0);
  const seenProposal = useRef<string | null | undefined>(undefined);
  const listEnd = useRef<HTMLLIElement>(null);

  const load = useCallback(
    () =>
      productsApi
        .conversation(projectId)
        .then((c) => {
          setConv(c);
          setLoadError(null);
        })
        .catch((e) => setLoadError((e as Error).message)),
    [projectId],
  );
  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (prefill) setText(prefill.text);
  }, [prefill]);

  // A new proposal arriving opens it on the canvas (not on first load).
  const latest = conv?.proposals[0]?.id ?? null;
  useEffect(() => {
    if (!conv) return;
    if (seenProposal.current !== undefined && latest && latest !== seenProposal.current)
      onReview(latest);
    seenProposal.current = latest;
  }, [conv, latest, onReview]);

  const count = conv?.messages.length ?? 0;
  // biome-ignore lint/correctness/useExhaustiveDependencies: the message count is the trigger
  useEffect(() => {
    listEnd.current?.scrollIntoView({ block: "nearest" });
  }, [count]);

  const live = Boolean(conv?.pending);
  useEffect(() => {
    if (!live || polls >= MAX_POLLS) return;
    const delay = Math.min(15_000, 2_000 * 1.5 ** Math.min(polls, 6));
    const t = window.setTimeout(() => {
      if (document.visibilityState === "visible") load();
      setPolls((n) => n + 1);
    }, delay);
    return () => window.clearTimeout(t);
  }, [live, polls, load]);

  const send = async () => {
    const said = text.trim();
    if (!said || sending) return;
    setSending(true);
    setError(null);
    try {
      await productsApi.say(projectId, said, key);
      setText("");
      setKey(newKey("msg"));
      setPolls(0);
      await load();
    } catch (e) {
      // Kept as written, with the same key: sending again cannot make a second request.
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      send();
    }
  };

  if (loadError && !conv) return <p className="error-text">{loadError}</p>;
  if (!conv) return <p className="muted">Loading the work log…</p>;
  const available = conv.availability.available;
  const budgetSet = conv.budget.limit_cents !== null;

  return (
    <div className="conversation">
      <p className="muted" style={{ fontSize: 12.5, margin: "0 0 10px" }}>
        <strong>{conv.log.label}.</strong> {conv.log.note}
      </p>
      {conv.messages.length > 0 && (
        <ol className="msgs" aria-label={conv.log.label}>
          {conv.messages.map((m) => (
            <Message key={m.id} m={m} onReview={onReview} onChanged={load} />
          ))}
          <li ref={listEnd} aria-hidden="true" className="msgs-end" />
        </ol>
      )}
      {live && polls >= MAX_POLLS && (
        <p className="muted" style={{ fontSize: 13 }}>
          Stopped checking automatically.{" "}
          <button
            type="button"
            className="btn btn-quiet btn-sm"
            onClick={() => {
              setPolls(0);
              load();
            }}
          >
            Check now
          </button>
        </p>
      )}

      {!available ? (
        <div className="notice">
          <strong>AI drafting isn't connected here.</strong> {conv.availability.reason}
          <div style={{ marginTop: 8 }}>
            <button type="button" className="btn btn-secondary btn-sm" onClick={onManual}>
              Edit the brief yourself
            </button>
          </div>
        </div>
      ) : !budgetSet ? (
        <>
          <p style={{ fontSize: 14 }}>
            Set an AI budget for this business to start. Nothing is spent until you send a message.
          </p>
          <BudgetPanel
            businessId={businessId}
            budget={conv.budget}
            onChanged={(b: AiBudget) => setConv({ ...conv, budget: b })}
          />
        </>
      ) : (
        <div className="composer-box">
          {conv.messages.length === 0 && !text && (
            <button
              type="button"
              className="btn btn-quiet btn-sm"
              style={{ marginBottom: 6 }}
              onClick={() => setText(idea)}
            >
              <Icon name="spark" size="sm" /> Start from your idea
            </button>
          )}
          <label className="sr-only" htmlFor={`say-${projectId}`}>
            Tell the assistant what you want
          </label>
          <textarea
            id={`say-${projectId}`}
            className="input"
            value={text}
            maxLength={2000}
            placeholder={
              conv.messages.length
                ? "Ask for a change, e.g. Also return the invoice date"
                : "Describe what you want to build, in your own words"
            }
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKey}
          />
          <div className="row" style={{ gap: 8, marginTop: 6 }}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={sending || !text.trim()}
              onClick={send}
            >
              {sending ? "Sending…" : "Send"}
            </button>
            <span className="muted" style={{ fontSize: 12 }}>
              {conv.per_request
                ? `Each request holds up to ${usd(conv.per_request.reserve_cents)} of the budget until it settles`
                : ""}
            </span>
          </div>
          {error && (
            <p className="error-text" aria-live="polite">
              {error}
            </p>
          )}
          <details className="advanced">
            <summary>Budget</summary>
            <BudgetPanel
              key={String(conv.budget.limit_cents)}
              businessId={businessId}
              budget={conv.budget}
              onChanged={(b: AiBudget) => setConv({ ...conv, budget: b })}
            />
          </details>
        </div>
      )}
    </div>
  );
}
