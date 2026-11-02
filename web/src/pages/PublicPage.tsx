// A business's public page: who runs it, the idea, the offer, and one honest next action.

import { useEffect, useState } from "react";
import { api, type PublicBusiness } from "../api.ts";
import { Link } from "../router.tsx";
import { useSession } from "../session.tsx";
import { Avatar, FAMILY_LABEL, OfferCard, STAGE_LABEL } from "../ui.tsx";

export function StorefrontView({
  page,
  preview,
  onSent,
}: {
  page: PublicBusiness;
  preview?: boolean;
  onSent?: () => void;
}) {
  const { person, requireSignIn } = useSession();
  const [message, setMessage] = useState("");
  const [share, setShare] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    if (preview) return;
    if (
      !person &&
      !(await requireSignIn(
        `Join so ${page.founder.display_name} can reply to you. Your contact details stay private unless you choose to share them.`,
      ))
    )
      return;
    try {
      await api.inquire(page.slug, page.action.kind, message, share);
      setSent(true);
      onSent?.();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="storefront">
      <div>
        <div className="storefront-hero">
          <div className="row" style={{ marginBottom: 12 }}>
            <span className="pill">{FAMILY_LABEL[page.family]}</span>
            <span className="pill lime">{STAGE_LABEL[page.stage]}</span>
          </div>
          <h1>{page.name}</h1>
          {page.tagline && <p className="tagline">{page.tagline}</p>}
        </div>

        {page.idea && (page.idea.problem || page.idea.why_me || page.idea.evidence) && (
          <section className="card prose">
            <div className="eyebrow">The idea</div>
            {page.idea.problem && (
              <p style={{ fontSize: 18, color: "var(--ink)" }}>{page.idea.problem}</p>
            )}
            {(page.idea.why_me || page.idea.evidence) && (
              <>
                <h3 style={{ fontSize: 16, marginTop: 16 }}>
                  Why {page.founder.display_name.split(" ")[0]}
                </h3>
                <p>{page.idea.why_me || page.idea.evidence}</p>
              </>
            )}
            {page.idea.ask && (
              <p className="notice ok" style={{ marginTop: 12, marginBottom: 0 }}>
                <strong>Right now:</strong> {page.idea.ask}
              </p>
            )}
          </section>
        )}

        {page.about && (
          <section className="card prose">
            <div className="eyebrow">About</div>
            <p style={{ whiteSpace: "pre-wrap" }}>{page.about}</p>
          </section>
        )}

        <section className="card">
          <div className="eyebrow">Who runs it</div>
          <div className="founder">
            <Avatar name={page.founder.display_name} large />
            <div>
              <h3 style={{ marginBottom: 2 }}>{page.founder.display_name}</h3>
              {page.founder.headline && <p className="muted">{page.founder.headline}</p>}
              {page.founder.bio && <p style={{ whiteSpace: "pre-wrap" }}>{page.founder.bio}</p>}
            </div>
          </div>
        </section>

        <section className="card">
          <div className="eyebrow">Numbers</div>
          <p className="muted" style={{ margin: 0 }}>
            {page.interested > 0
              ? `${page.interested} ${page.interested === 1 ? "person has" : "people have"} responded so far. `
              : "No responses yet. "}
            Revenue, costs and performance appear here once this business takes payments through
            Everstreet.
          </p>
        </section>
      </div>

      <aside className="studio-side">
        {page.offer ? (
          <OfferCard
            offer={page.offer}
            family={page.family}
            footer={
              <div style={{ marginTop: 16, borderTop: "1px solid var(--border)", paddingTop: 16 }}>
                {page.viewer_is_owner && !preview ? (
                  <p className="notice ok" style={{ margin: 0 }}>
                    This is your page. <Link to="/desk">Go to your desk</Link>
                  </p>
                ) : sent ? (
                  <p className="notice ok" style={{ margin: 0 }}>
                    Sent. {page.founder.display_name.split(" ")[0]} will reply in your{" "}
                    <Link to="/inbox">inbox</Link>.
                  </p>
                ) : (
                  <>
                    <label className="field" style={{ marginBottom: 10 }}>
                      <span>
                        {page.action.kind === "interest"
                          ? "Anything you'd like to say? (optional)"
                          : "Your question or request"}
                      </span>
                      <textarea
                        className="input"
                        style={{ minHeight: 72 }}
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        placeholder={
                          page.action.kind === "interest"
                            ? "e.g. Saturdays work for me"
                            : "e.g. Can I book two places?"
                        }
                        disabled={preview}
                      />
                    </label>
                    <label className="check" style={{ fontSize: 14 }}>
                      <input
                        type="checkbox"
                        checked={share}
                        onChange={(e) => setShare(e.target.checked)}
                        disabled={preview}
                      />
                      <span>
                        Share my name and contact with {page.founder.display_name.split(" ")[0]}
                      </span>
                    </label>
                    {error && <p className="error-text">{error}</p>}
                    <button
                      type="button"
                      className="btn btn-primary"
                      style={{ width: "100%" }}
                      onClick={send}
                      disabled={preview}
                    >
                      {page.action.label}
                    </button>
                    {page.action.kind === "interest" && (
                      <p className="muted" style={{ fontSize: 13, marginTop: 8, marginBottom: 0 }}>
                        Not open for bookings yet. You'll hear when it is; nothing is charged.
                      </p>
                    )}
                  </>
                )}
              </div>
            }
          />
        ) : (
          <div className="card muted">No offer published yet.</div>
        )}
      </aside>
    </div>
  );
}

export function PublicPage({ slug }: { slug: string }) {
  const [page, setPage] = useState<PublicBusiness | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { person } = useSession();
  // biome-ignore lint/correctness/useExhaustiveDependencies: reload when the acting person changes (owner banner)
  useEffect(() => {
    api
      .page(slug)
      .then(setPage)
      .catch((e) => setError((e as Error).message));
  }, [slug, person]);
  if (error)
    return (
      <div className="page empty">
        <h2>{error}</h2>
        <p>It may still be a private draft.</p>
        <Link to="/find">Find something else</Link>
      </div>
    );
  if (!page) return <div className="page muted">Loading…</div>;
  return (
    <div className="page">
      <StorefrontView page={page} onSent={() => api.page(slug).then(setPage)} />
    </div>
  );
}
