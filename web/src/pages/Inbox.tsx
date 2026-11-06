import { useEffect, useState } from "react";
import { api, type Inquiry } from "../api.ts";
import { Link } from "../router.tsx";
import { useSession } from "../session.tsx";

export function Inbox() {
  const { person, requireSignIn } = useSession();
  const [box, setBox] = useState<{ received: Inquiry[]; sent: Inquiry[] } | null>(null);
  const [replies, setReplies] = useState<Record<string, string>>({});
  // First-use review #57: what waits on you across your businesses, from the same read as the
  // portfolio's "Needs you today", so the two never disagree.
  const [needs, setNeeds] = useState<{ business: string; text: string; link: string }[] | null>(
    null,
  );
  useEffect(() => {
    if (!person) return;
    api
      .inbox()
      .then(setBox)
      .catch(() => {});
    fetch("/api/me/dashboard?days=7", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (
          d: {
            businesses?: { name: string; attention: { text: string; link: string }[] }[];
          } | null,
        ) =>
          setNeeds(
            (d?.businesses ?? []).flatMap((b) =>
              b.attention.map((a) => ({ business: b.name, text: a.text, link: a.link })),
            ),
          ),
      )
      .catch(() => setNeeds(null));
  }, [person]);
  if (!person)
    return (
      <div className="page empty">
        <h2>Sign in to see your messages</h2>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => requireSignIn("Sign in to see your messages.")}
        >
          Sign in or join
        </button>
      </div>
    );
  if (!box) return <div className="page muted">Loading…</div>;
  return (
    <div className="page narrow">
      <h1 className="display" style={{ fontSize: 40 }}>
        Inbox
      </h1>
      {needs && needs.length > 0 && (
        <section className="card" aria-labelledby="inbox-needs">
          <h2 id="inbox-needs">Needs you</h2>
          <ul className="plain inbox-needs">
            {needs.map((n) => (
              <li key={`${n.business}-${n.text}`}>
                <span className="muted small">{n.business}</span> <Link to={n.link}>{n.text}</Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="card">
        <h2>Messages to your businesses</h2>
        {box.received.length === 0 && <p className="muted">No messages.</p>}
        {box.received.map((i) => (
          <div className="message" key={i.id}>
            <div className="meta">
              <strong style={{ color: "var(--ink)" }}>
                {i.share_contact
                  ? i.from_name
                  : `${i.from_name.split(" ")[0]} (contact not shared)`}
              </strong>{" "}
              {i.kind === "interest" ? "is interested in" : "asked"}{" "}
              <Link to={`/desk/${i.business_id}`}>{i.business_name}</Link> ·{" "}
              {new Date(i.created_at).toLocaleString()}
            </div>
            {i.message && <blockquote>{i.message}</blockquote>}
            {i.reply ? (
              <div className="reply">
                <strong>You replied:</strong> {i.reply}
              </div>
            ) : (
              <div className="row" style={{ marginTop: 8 }}>
                <input
                  className="input"
                  style={{ flex: 1 }}
                  placeholder="Write a reply"
                  value={replies[i.id] ?? ""}
                  onChange={(e) => setReplies({ ...replies, [i.id]: e.target.value })}
                />
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!replies[i.id]?.trim()}
                  onClick={async () => setBox(await api.reply(i.id, replies[i.id] ?? ""))}
                >
                  Reply
                </button>
              </div>
            )}
          </div>
        ))}
      </section>
      <section className="card">
        <h2>You sent</h2>
        {box.sent.length === 0 && (
          <p className="muted">
            Nothing yet. <Link to="/find">Find a solution</Link> and tell someone you're interested.
          </p>
        )}
        {box.sent.map((i) => (
          <div className="message" key={i.id}>
            <div className="meta">
              To <Link to={`/b/${i.slug}`}>{i.business_name}</Link> ·{" "}
              {new Date(i.created_at).toLocaleString()}
            </div>
            <blockquote>{i.message || (i.kind === "interest" ? "I'm interested." : "")}</blockquote>
            {i.reply ? (
              <div className="reply">
                <strong>Reply:</strong> {i.reply}
              </div>
            ) : (
              <p className="muted" style={{ fontSize: 14 }}>
                Waiting for a reply.
              </p>
            )}
          </div>
        ))}
      </section>
    </div>
  );
}
