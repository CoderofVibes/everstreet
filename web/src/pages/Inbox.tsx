import { useEffect, useState } from "react";
import { api, type Inquiry } from "../api.ts";
import { Link } from "../router.tsx";
import { useSession } from "../session.tsx";

export function Inbox() {
  const { person, requireSignIn } = useSession();
  const [box, setBox] = useState<{ received: Inquiry[]; sent: Inquiry[] } | null>(null);
  const [replies, setReplies] = useState<Record<string, string>>({});
  useEffect(() => {
    if (person)
      api
        .inbox()
        .then(setBox)
        .catch(() => {});
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
      <section className="card">
        <h2>To your businesses</h2>
        {box.received.length === 0 && (
          <p className="muted">
            Nothing yet. When someone responds to your page, it arrives here and on your desk.
          </p>
        )}
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
