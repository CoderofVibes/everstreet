// The studio's assistant: the business's product work log. A founder writes in plain words; a
// connected, budgeted AI drafts a proposal (brief and screens) that they review on the canvas.
// With no provider, it says so and points to the manual editors: there is no fake reply. A
// message keeps its request key until it is accepted, so a double click or a retry after an
// error is the same request. While a request runs the founder can keep typing; the view checks
// back with growing gaps (2 s up to 15 s), at most 60 times.

import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "../icons.tsx";
import {
  classify,
  type Outbox,
  retry,
  type SendResult,
  settle,
  start,
  takeBack,
} from "../outbox.ts";
import {
  type AiBudget,
  type BuildJob,
  type Conversation,
  isLive,
  productsApi,
  usd,
  type WorkLogMessage,
} from "../productsApi.ts";
import { mergeLog, olderCursor } from "../workLog.ts";
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
  const [stopError, setStopError] = useState<string | null>(null);
  const line = m.job ? jobLine(m.job) : null;
  return (
    // Scoped classes: the older `.founder` profile rule must not reach the work log.
    <li className={`msg msg-${m.role}`}>
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
                setStopError(null);
                try {
                  await productsApi.cancelBuild((m.job as BuildJob).id);
                  onChanged();
                } catch (e) {
                  setStopError(`Couldn't stop it: ${(e as Error).message}`);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {m.job.cancel_requested ? "Stopping…" : "Stop"}
            </button>
          )}
          {stopError && <span className="error-text">{stopError}</span>}
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
  /** The message in flight or unresolved; separate from the composer, which it never writes. */
  const [outbox, setOutbox] = useState<Outbox | null>(null);
  const inFlight = useRef(false);
  const [polls, setPolls] = useState(0);
  const seenProposal = useRef<string | null | undefined>(undefined);
  const listEnd = useRef<HTMLLIElement>(null);
  // Loads can overlap (polling, after a send); only the newest request's answer is shown.
  const loadSeq = useRef(0);
  /** Older pages the founder asked for; the polled tail is merged over them. */
  const [older, setOlder] = useState<WorkLogMessage[]>([]);
  const [olderMore, setOlderMore] = useState<boolean | null>(null);
  const [olderBusy, setOlderBusy] = useState(false);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  const load = useCallback(() => {
    const seq = ++loadSeq.current;
    return productsApi
      .conversation(projectId)
      .then((c) => {
        if (seq !== loadSeq.current) return;
        setConv(c);
        setLoadError(null);
      })
      .catch((e) => {
        if (seq === loadSeq.current) setLoadError((e as Error).message);
      });
  }, [projectId]);
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

  const newest = conv?.last_seq ?? 0;
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new latest message is the trigger
  useEffect(() => {
    listEnd.current?.scrollIntoView({ block: "nearest" });
  }, [newest]);

  const messages = conv ? mergeLog(older, conv.messages) : [];
  const hasOlder = olderMore ?? conv?.has_older ?? false;
  const loadOlder = async () => {
    const before = olderCursor(messages);
    if (!before || olderBusy) return;
    setOlderBusy(true);
    try {
      const page = await productsApi.conversation(projectId, before);
      if (!mounted.current) return;
      setOlder((prev) => mergeLog(page.messages, prev));
      setOlderMore(page.has_older);
    } catch (e) {
      if (mounted.current) setLoadError((e as Error).message);
    } finally {
      if (mounted.current) setOlderBusy(false);
    }
  };

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

  /** Sends one outbox entry; its text and key never change, whatever is typed meanwhile. */
  const dispatch = async (out: Outbox) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setOutbox(out);
    let result: SendResult;
    try {
      await productsApi.say(projectId, out.text, out.key);
      result = { kind: "accepted" };
    } catch (e) {
      result = classify(e);
    } finally {
      inFlight.current = false;
    }
    setOutbox(settle(out, result));
    if (result.kind === "accepted") {
      setPolls(0);
      await load();
    }
  };
  const send = () => {
    const out = start(outbox, text, newKey("msg"));
    if (!out || inFlight.current) return;
    setText(""); // the box is free for the next thought straight away
    dispatch(out);
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
      {hasOlder && (
        <button
          type="button"
          className="btn btn-quiet btn-sm"
          disabled={olderBusy}
          onClick={loadOlder}
        >
          {olderBusy ? "Loading…" : "Show earlier messages"}
        </button>
      )}
      {messages.length > 0 && (
        <ol className="msgs" aria-label={conv.log.label}>
          {messages.map((m) => (
            <Message key={m.id} m={m} onReview={onReview} onChanged={load} />
          ))}
          <li ref={listEnd} aria-hidden="true" className="msgs-end" />
        </ol>
      )}
      {outbox && (
        <div className={`msg msg-founder msg-outbox ${outbox.state}`} aria-live="polite">
          <div className="msg-head">
            <strong>You</strong>
            <span className="muted">
              {outbox.state === "sending"
                ? "Sending…"
                : outbox.state === "unknown"
                  ? "Not confirmed"
                  : "Not sent"}
            </span>
          </div>
          <p>{outbox.text}</p>
          {outbox.reason && <p className="error-text">{outbox.reason}</p>}
          {outbox.state === "unknown" && (
            <div className="row" style={{ gap: 6 }}>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  const again = retry(outbox);
                  if (again) dispatch(again);
                }}
              >
                Send again (it won't be sent twice)
              </button>
              <button
                type="button"
                className="btn btn-quiet btn-sm"
                onClick={() => {
                  setOutbox(null);
                  load();
                }}
              >
                Check the work log
              </button>
            </div>
          )}
          {outbox.state === "refused" && (
            <div className="row" style={{ gap: 6 }}>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={takeBack(outbox, text) === null}
                title={
                  takeBack(outbox, text) === null ? "Clear the box first to edit this" : undefined
                }
                onClick={() => {
                  const back = takeBack(outbox, text);
                  if (back === null) return;
                  setText(back);
                  setOutbox(null);
                }}
              >
                Edit it
              </button>
              <button
                type="button"
                className="btn btn-quiet btn-sm"
                onClick={() => setOutbox(null)}
              >
                Discard
              </button>
            </div>
          )}
        </div>
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
              disabled={Boolean(outbox) || !text.trim()}
              onClick={send}
            >
              {outbox?.state === "sending" ? "Sending…" : "Send"}
            </button>
            <span className="muted" style={{ fontSize: 12 }}>
              {outbox && outbox.state !== "sending"
                ? "Resolve the message above before sending another"
                : conv.per_request
                  ? `Each request holds up to ${usd(conv.per_request.reserve_cents)} of the budget until it settles`
                  : ""}
            </span>
          </div>
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
