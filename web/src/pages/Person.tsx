// A founder's public profile: who they are, what they run, and what they have shared lately.

import { useEffect, useState } from "react";
import { api } from "../api.ts";
import { Link } from "../router.tsx";
import { Avatar } from "../ui.tsx";
import { ago } from "../via.ts";
import { Tile } from "./Explore.tsx";

export function Person({ id }: { id: string }) {
  const [p, setP] = useState<Awaited<ReturnType<typeof api.person>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api
      .person(id)
      .then(setP)
      .catch((e) => setError((e as Error).message));
  }, [id]);
  if (error)
    return (
      <div className="page empty">
        <h2>{error}</h2>
        <Link to="/explore">Explore</Link>
      </div>
    );
  if (!p) return <div className="page muted">Loading…</div>;
  return (
    <div className="page">
      <div className="founder" style={{ marginBottom: 28 }}>
        <Avatar name={p.display_name} large />
        <div>
          <h1 className="display" style={{ fontSize: 44, margin: 0 }}>
            {p.display_name}
          </h1>
          {p.headline && (
            <p className="muted" style={{ fontSize: 19, margin: "4px 0" }}>
              {p.headline}
            </p>
          )}
          <p className="muted" style={{ fontSize: 14 }}>
            On Everstreet since{" "}
            {new Date(p.member_since).toLocaleDateString(undefined, {
              month: "long",
              year: "numeric",
            })}
          </p>
        </div>
      </div>
      {p.bio && (
        <section className="card prose" style={{ maxWidth: 760 }}>
          <p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{p.bio}</p>
        </section>
      )}
      <h2 className="section-title" style={{ marginTop: 32 }}>
        Runs
      </h2>
      <div className="shelf" style={{ marginTop: 12 }}>
        {p.businesses.map((b) => (
          <Tile key={b.slug} b={b} />
        ))}
      </div>
      {p.updates.length > 0 && (
        <>
          <h2 className="section-title" style={{ marginTop: 32 }}>
            Lately
          </h2>
          <div className="card" style={{ maxWidth: 760 }}>
            {p.updates.map((u) => (
              <div className="message" key={u.id}>
                <div className="meta">
                  <Link to={`/b/${u.slug}`}>{u.business_name}</Link> · {ago(u.created_at)}
                </div>
                <p style={{ margin: "4px 0 0", whiteSpace: "pre-wrap" }}>{u.body}</p>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
