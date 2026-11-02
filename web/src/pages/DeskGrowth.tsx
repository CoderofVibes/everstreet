// The desk's Phase 2 panels: real sessions and who booked them, requests that fit, updates for
// followers, a share kit with a trackable link, and how people found the business.

import { type FormEvent, useCallback, useEffect, useState } from "react";
import { api, type Desk, type OwnerSession } from "../api.ts";
import { Link } from "../router.tsx";
import { money } from "../ui.tsx";
import { ago, when } from "../via.ts";
import { DeskMoney } from "./DeskMoney.tsx";
import { NeedCard } from "./Explore.tsx";

type Extras = Awaited<ReturnType<typeof api.extras>>;

const SOURCE_LABEL: Record<string, string> = {
  link: "Your own link",
  discovery: "Found on Everstreet",
  need: "From a request you answered",
  follow: "Followers",
  unknown: "Unknown",
};

function localInputValue(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function SessionsPanel({ desk }: { desk: Desk }) {
  const b = desk.business;
  const [sessions, setSessions] = useState<OwnerSession[] | null>(null);
  const nextSat = new Date();
  nextSat.setDate(nextSat.getDate() + ((6 - nextSat.getDay() + 7) % 7 || 7));
  nextSat.setHours(10, 0, 0, 0);
  const [form, setForm] = useState({
    starts_at: localInputValue(nextSat),
    duration: 90,
    capacity: desk.offer.capacity ?? 6,
  });
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(
    () =>
      api
        .ownerSessions(b.id)
        .then((r) => setSessions(r.sessions))
        .catch(() => setSessions([])),
    [b.id],
  );
  useEffect(() => {
    load();
  }, [load]);
  const open = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const r = await api.openSession(b.id, {
        starts_at: new Date(form.starts_at).toISOString(),
        duration_minutes: form.duration,
        capacity: form.capacity,
      });
      setSessions(r.sessions);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  };
  const ready = b.published_at && desk.missing.length === 0;
  return (
    <section className="card">
      <h2>Sessions and bookings</h2>
      <p className="muted" style={{ fontSize: 15 }}>
        Open a dated session and people can book a real place. Places, the waitlist and moving
        people up when someone cancels are handled by OpenSeat, the booking service; its waitlist
        worker's permission is checked against its contract on NEAR testnet.
      </p>
      {!ready ? (
        <p className="notice">
          {b.published_at
            ? `Finish the details first: ${desk.missing.join("; ")}.`
            : "Publish your page first."}{" "}
          Then you can open bookings.
        </p>
      ) : (
        <form className="row" onSubmit={open} style={{ alignItems: "end", marginBottom: 8 }}>
          <label className="field" style={{ margin: 0 }}>
            <span style={{ fontSize: 14 }}>Starts</span>
            <input
              className="input"
              type="datetime-local"
              value={form.starts_at}
              onChange={(e) => setForm({ ...form, starts_at: e.target.value })}
            />
          </label>
          <label className="field" style={{ margin: 0, width: 110 }}>
            <span style={{ fontSize: 14 }}>Minutes</span>
            <input
              className="input"
              inputMode="numeric"
              value={form.duration}
              onChange={(e) =>
                setForm({ ...form, duration: Number(e.target.value.replace(/\D/g, "")) || 0 })
              }
            />
          </label>
          <label className="field" style={{ margin: 0, width: 110 }}>
            <span style={{ fontSize: 14 }}>Places</span>
            <input
              className="input"
              inputMode="numeric"
              value={form.capacity}
              onChange={(e) =>
                setForm({ ...form, capacity: Number(e.target.value.replace(/\D/g, "")) || 0 })
              }
            />
          </label>
          <button className="btn btn-primary" type="submit">
            Open for booking
          </button>
        </form>
      )}
      {error && <p className="error-text">{error}</p>}
      {sessions === null ? (
        <p className="muted">Loading…</p>
      ) : sessions.length === 0 ? (
        <p className="muted" style={{ fontSize: 14 }}>
          No sessions yet.
        </p>
      ) : (
        sessions.map((s) => (
          <div className="message" key={s.id}>
            <div className="row">
              <strong>{when(s.starts_at)}</strong>
              <span className="spacer" />
              {s.class ? (
                <span className="muted" style={{ fontSize: 14 }}>
                  {s.class.capacity - s.class.seats_left} of {s.class.capacity} booked ·{" "}
                  {s.class.waitlisted} waiting
                </span>
              ) : (
                <span className="pill caution">Can't reach the booking service</span>
              )}
            </div>
            {s.attendees.length > 0 && (
              <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 15 }}>
                {s.attendees.map((a) => (
                  <li
                    key={`${a.attendee}-${a.booked_at}`}
                    style={{ color: a.status === "cancelled" ? "var(--ink-3)" : undefined }}
                  >
                    {a.attendee} ·{" "}
                    {a.status === "confirmed"
                      ? "booked"
                      : a.status === "waitlisted"
                        ? "waiting"
                        : "cancelled"}
                    {a.promoted_by && a.status === "confirmed"
                      ? ` (moved up from the waitlist by ${a.promoted_by})`
                      : ""}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))
      )}
    </section>
  );
}

export function DeskGrowth({ desk }: { desk: Desk }) {
  const b = desk.business;
  const [extras, setExtras] = useState<Extras | null>(null);
  const [update, setUpdate] = useState("");
  const load = useCallback(
    () =>
      api
        .extras(b.id)
        .then(setExtras)
        .catch(() => {}),
    [b.id],
  );
  useEffect(() => {
    load();
  }, [load]);
  return (
    <>
      <DeskMoney desk={desk} />
      {b.family === "class" && <SessionsPanel desk={desk} />}

      {b.published_at && extras && extras.needs.length > 0 && (
        <section className="card">
          <h2>Requests that might fit</h2>
          <p className="muted" style={{ fontSize: 15 }}>
            People posted these on Everstreet. Reply with how you could help; they choose whether to
            answer.
          </p>
          <div style={{ display: "grid", gap: 12 }}>
            {extras.needs.map((n) => (
              <NeedCard key={n.id} n={n} onAnswered={load} />
            ))}
          </div>
        </section>
      )}

      {extras && extras.need_replies.length > 0 && (
        <section className="card">
          <h2>Your replies to requests</h2>
          {extras.need_replies.map((r) => (
            <div className="message" key={r.id}>
              <div className="meta">
                To “{r.need_text}” as {r.business_name} · {ago(r.created_at)}
              </div>
              <blockquote>{r.message}</blockquote>
              {r.reply ? (
                <div className="reply">
                  <strong>They replied:</strong> {r.reply}
                </div>
              ) : (
                <p className="muted" style={{ fontSize: 14 }}>
                  No answer yet.
                </p>
              )}
            </div>
          ))}
        </section>
      )}

      {b.published_at && (
        <section className="card">
          <h2>Post an update</h2>
          <p className="muted" style={{ fontSize: 15 }}>
            One real change and what it means for people: a new date, a new sample, something you
            learned. Followers see it.
          </p>
          <textarea
            className="input"
            value={update}
            onChange={(e) => setUpdate(e.target.value)}
            placeholder="e.g. Added an evening session after three people asked."
          />
          <div className="row" style={{ marginTop: 10 }}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!update.trim()}
              onClick={async () => {
                const r = await api.postUpdate(b.id, update);
                setExtras(extras ? { ...extras, updates: r.updates } : extras);
                setUpdate("");
              }}
            >
              Post update
            </button>
          </div>
          {extras?.updates.map((u) => (
            <div className="message" key={u.id}>
              <div className="meta">{ago(u.created_at)}</div>
              <p style={{ margin: "4px 0 0", whiteSpace: "pre-wrap" }}>{u.body}</p>
            </div>
          ))}
        </section>
      )}
    </>
  );
}

export function DeskShare({ desk }: { desk: Desk }) {
  const b = desk.business;
  const [extras, setExtras] = useState<Extras | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  useEffect(() => {
    api
      .extras(b.id)
      .then(setExtras)
      .catch(() => {});
  }, [b.id]);
  if (!b.published_at) return null;
  const url = `${window.location.origin}/b/${b.slug}?via=link`;
  const price = desk.offer.first_free
    ? "The first one is free"
    : desk.offer.price_cents !== null
      ? `It's ${money(desk.offer.price_cents)} ${desk.offer.price_unit}`
      : "";
  const invitation = `Hi! I've started ${b.name}: ${desk.offer.title}${desk.offer.when_text ? `, ${desk.offer.when_text}` : ""}. ${price ? `${price}. ` : ""}I'd love to know if it's for you: ${url}`;
  const copy = async (text: string, what: string) => {
    await navigator.clipboard?.writeText(text).catch(() => {});
    setCopied(what);
  };
  const tally = (o: Record<string, number> | undefined) =>
    Object.entries(o ?? {})
      .map(([k, n]) => `${SOURCE_LABEL[k] ?? k}: ${n}`)
      .join(" · ") || "none yet";
  return (
    <>
      <div className="card" style={{ padding: 18 }}>
        <strong>Find your first customers</strong>
        <p className="muted" style={{ fontSize: 14 }}>
          Send this to a few people yourself. Responses that come through this link are counted as
          yours.
        </p>
        <textarea
          className="input"
          readOnly
          value={invitation}
          style={{ minHeight: 110, fontSize: 14 }}
        />
        <div className="row" style={{ marginTop: 8 }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => copy(invitation, "message")}
          >
            {copied === "message" ? "Copied" : "Copy message"}
          </button>
          <button type="button" className="btn btn-quiet" onClick={() => copy(url, "link")}>
            {copied === "link" ? "Copied" : "Copy link only"}
          </button>
        </div>
      </div>
      {extras && (
        <div className="card" style={{ padding: 18 }}>
          <strong>How people found you</strong>
          <p style={{ fontSize: 14, margin: "8px 0 4px" }}>
            <span className="muted">Messages:</span> {tally(extras.sources.responses)}
          </p>
          {b.family === "class" && (
            <p style={{ fontSize: 14, margin: "4px 0" }}>
              <span className="muted">Bookings:</span> {tally(extras.sources.bookings)}
            </p>
          )}
          <p style={{ fontSize: 14, margin: "4px 0 0" }}>
            <span className="muted">Followers:</span> {extras.sources.followers}
          </p>
          <p className="muted" style={{ fontSize: 12, margin: "8px 0 0" }}>
            “Unknown” means we couldn't tell, not that nobody came.{" "}
            <Link to="/explore">See how you look on Explore</Link>.
          </p>
        </div>
      )}
    </>
  );
}
