// The founder's desk: what needs you today (replies and first-week tasks), the page's status,
// and a way back into the studio.

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type Desk } from "../api.ts";
import { api4, type DigitalDeskView } from "../api4.ts";
import { type DeskLoadState, deskLoader } from "../deskLoad.ts";
import { deskStatusLine, productFacts, studioAction } from "../digitalDesk.ts";
import { ago, type ProjectSummary, productsApi } from "../productsApi.ts";
import { Link, useRouter } from "../router.tsx";
import { useSession } from "../session.tsx";
import { FAMILY_LABEL, OfferCard, STAGE_LABEL } from "../ui.tsx";
import { DealsList } from "./Deal.tsx";
import { DeskBooks } from "./DeskBooks.tsx";
import { OperatingSummary } from "./DeskDigital.tsx";
import { DeskGrowth, DeskShare, DeskTeamIfPaid } from "./DeskGrowth.tsx";
import { DeskSelling } from "./DeskSale.tsx";
import { DeskImports } from "./Import.tsx";

function SignInFirst({ reason }: { reason: string }) {
  const { requireSignIn } = useSession();
  return (
    <div className="page empty">
      <h2>{reason}</h2>
      <button type="button" className="btn btn-primary" onClick={() => requireSignIn(reason)}>
        Sign in or join
      </button>
    </div>
  );
}

export function DeskList() {
  const { person } = useSession();
  const { go } = useRouter();
  const [rows, setRows] = useState<Awaited<ReturnType<typeof api.projects>>["projects"] | null>(
    null,
  );
  const [helping, setHelping] = useState<{ business_id: string; name: string; slug: string }[]>([]);
  useEffect(() => {
    if (person) {
      api
        .projects()
        .then((r) => setRows(r.projects))
        .catch(() => setRows([]));
      api4
        .helping()
        .then((r) => setHelping(r.businesses))
        .catch(() => {});
    }
  }, [person]);
  if (!person) return <SignInFirst reason="Sign in to see your businesses." />;
  if (!rows) return <div className="page muted">Loading…</div>;
  return (
    <div className="page">
      <div className="row">
        <h1 className="display" style={{ fontSize: 40, margin: 0 }}>
          Your businesses
        </h1>
        <span className="spacer" />
        <button type="button" className="btn btn-primary" onClick={() => go("/start")}>
          Start another
        </button>
      </div>
      {rows.length === 0 ? (
        <div className="card empty" style={{ marginTop: 24 }}>
          <h2>Nothing here yet</h2>
          <p>Start with an idea, or let us help you find one.</p>
          <Link to="/start" className="btn btn-primary">
            Start a business
          </Link>
        </div>
      ) : (
        <div className="biz-list" style={{ marginTop: 24 }}>
          {rows.map((r) => (
            <Link
              key={r.id}
              to={r.published_at ? `/desk/${r.business_id}` : `/studio/${r.id}`}
              className="card link biz-row"
            >
              <div>
                <h3 style={{ fontSize: 18, margin: 0 }}>{r.name}</h3>
                <span className="muted" style={{ fontSize: 14 }}>
                  {r.published_at ? "Published" : "Private draft, not published"} ·{" "}
                  {STAGE_LABEL[r.stage]}
                </span>
              </div>
              <span className="spacer" />
              {r.inquiries > 0 && (
                <span className="pill lime">
                  {r.inquiries} {r.inquiries === 1 ? "response" : "responses"}
                </span>
              )}
              <span className="btn btn-secondary">{r.published_at ? "Open desk" : "Continue"}</span>
            </Link>
          ))}
        </div>
      )}
      <div style={{ marginTop: 24 }}>
        <DealsList title="Deals" />
      </div>
      {helping.length > 0 && (
        <>
          <h2 className="section-title" style={{ marginTop: 32 }}>
            Businesses you help
          </h2>
          <div className="biz-list" style={{ marginTop: 12 }}>
            {helping.map((h) => (
              <Link key={h.business_id} to={`/help/${h.business_id}`} className="card link biz-row">
                <h3 style={{ fontSize: 18, margin: 0 }}>{h.name}</h3>
                <span className="spacer" />
                <span className="btn btn-secondary">Open</span>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** The business's digital product projects, with a way to start another. */
function DeskProducts({ businessId }: { businessId: string }) {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  useEffect(() => {
    productsApi
      .list()
      .then((r) => setProjects(r.projects.filter((p) => p.business_id === businessId)))
      .catch(() => setProjects([]));
  }, [businessId]);
  return (
    <section className="card">
      <div className="row" style={{ marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}>Product projects</h2>
        <span className="spacer" />
        <Link to={`/build?business=${businessId}`} className="btn btn-secondary btn-sm">
          New product project
        </Link>
      </div>
      {projects === null ? (
        <p className="muted">Loading…</p>
      ) : projects.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>
          No digital product projects for this business yet. They belong to the business and move
          with it if it is sold.
        </p>
      ) : (
        projects.map((p) => (
          <div key={p.id} className="deal-row row desk-product">
            <Link to={`/build/${p.id}`}>
              <strong>{p.name}</strong>
            </Link>
            <span className="pill">{p.foundation_label}</span>
            <span className="muted" style={{ fontSize: 13 }}>
              Brief revision {p.revision} · {ago(p.updated_at)}
            </span>
            <span className="spacer" />
            {/* Job 001b: straight to the operating tasks, without searching the Service page. */}
            <Link to={`/build/${p.id}?view=service&task=evaluate`} className="btn btn-quiet btn-sm">
              Releases
            </Link>
            <Link
              to={`/build/${p.id}?view=service&task=customers`}
              className="btn btn-quiet btn-sm"
            >
              Customer access
            </Link>
          </div>
        ))
      )}
    </section>
  );
}

export function DeskPage({ id }: { id: string }) {
  const { person } = useSession();
  const [replies, setReplies] = useState<Record<string, string>>({});
  // Job 001c: the desk and the digital desk projection, loaded together and sequenced (only the
  // newest load lands; losing access clears both). The page is keyed by actor and business, so a
  // switch unmounts it and closes the loader.
  const [s, setS] = useState<DeskLoadState<Desk, DigitalDeskView>>({
    desk: null,
    digital: null,
    error: null,
    digitalError: null,
  });
  const loader = useMemo(
    () =>
      deskLoader<Desk, DigitalDeskView>(
        { desk: () => api.desk(id), digital: () => api4.digitalDesk(id) },
        (patch) => setS((prev) => ({ ...prev, ...patch })),
      ),
    [id],
  );
  useEffect(() => {
    loader.open();
    return () => loader.close();
  }, [loader]);
  const load = useCallback(() => loader.load(), [loader]);
  useEffect(() => {
    if (person) load();
  }, [person, load]);
  const { desk, error, digital, digitalError } = s;
  if (!person) return <SignInFirst reason="Sign in to open your desk." />;
  if (error)
    return (
      <div className="page empty">
        <h2>{error}</h2>
        <Link to="/desk">Your businesses</Link>
      </div>
    );
  // Wait for the projection too, so a digital business never flashes the legacy desk; if it
  // can't be read, the legacy desk shows with a notice rather than nothing.
  if (!desk || (!digital && !digitalError)) return <div className="page muted">Loading…</div>;
  const b = desk.business;
  const open = desk.tasks.filter((t) => !t.done_at);
  const done = desk.tasks.filter((t) => t.done_at);
  const waiting = desk.inquiries.filter((i) => !i.reply);
  const isDigital = digital?.kind === "digital";
  const studio = digital && isDigital ? studioAction(digital, b.id) : null;
  const showOffer = !isDigital || Boolean(digital?.legacy_offering.configured);

  return (
    <div className="page">
      <div className="row" style={{ marginBottom: 4, flexWrap: "wrap" }}>
        <span className="pill">{FAMILY_LABEL[b.family]}</span>
        {/* 001c: a digital business's state is its products', not the old page stage. */}
        {isDigital && digital ? (
          <span className="pill blue">{productFacts(digital)}</span>
        ) : (
          <span className="pill lime">{STAGE_LABEL[b.stage]}</span>
        )}
        {b.published_at ? (
          <span className="pill">{isDigital ? "Page published" : "Published"}</span>
        ) : (
          <span className="pill caution">{isDigital ? "Page private" : "Private draft"}</span>
        )}
      </div>
      <div className="row">
        <h1 className="display" style={{ fontSize: 40, margin: "8px 0" }}>
          {b.name}
        </h1>
        <span className="spacer" />
        {b.published_at && (
          <Link to={`/b/${b.slug}`} className="btn btn-secondary">
            View public page
          </Link>
        )}
        <Link to={`/desk/${b.id}/value`} className="btn btn-secondary">
          Value
        </Link>
        <Link to={`/desk/${b.id}/continuity`} className="btn btn-secondary">
          Ownership and continuity
        </Link>
        <Link to={`/desk/${b.id}/handover`} className="btn btn-secondary">
          Sale and handover
        </Link>
        {studio &&
          (studio.anchor ? (
            <a href={studio.to} className="btn btn-primary">
              {studio.label}
            </a>
          ) : (
            <Link to={studio.to} className="btn btn-primary">
              {studio.label}
            </Link>
          ))}
        {desk.project_id && (
          <Link to={`/studio/${desk.project_id}`} className="btn btn-secondary">
            {isDigital ? "Edit page and legacy offering" : "Edit in studio"}
          </Link>
        )}
      </div>
      <p className="muted" style={{ fontSize: 18 }}>
        {isDigital && digital
          ? deskStatusLine(digital)
          : waiting.length > 0
            ? `${waiting.length} ${waiting.length === 1 ? "person is" : "people are"} waiting for your reply.`
            : open.length > 0
              ? `${open.length} things to do this week.`
              : "You're all caught up."}
      </p>
      {digitalError && !digital && (
        <p className="notice" style={{ fontSize: 14 }}>
          The operating summary couldn't be read ({digitalError}). The rest of the desk is shown;
          nothing below is a product or customer status.
        </p>
      )}

      {/* 001c: the digital business's operating canvas, full width, before the legacy panels. */}
      {isDigital && digital && (
        <div className="desk-canvas">
          <OperatingSummary d={digital} businessId={b.id} />
          <DeskBooks desk={desk} />
        </div>
      )}

      <div className="desk">
        <div>
          <section className="card" id="desk-checklist">
            <h2>{isDigital ? "Checklist" : "Today"}</h2>
            {open.length === 0 && (
              <p className="muted">
                {isDigital
                  ? "Nothing open in your checklist."
                  : "Nothing open. Share your page with someone new."}
              </p>
            )}
            {open.map((t) => (
              <label key={t.id} className="task">
                <input
                  type="checkbox"
                  className="check"
                  style={{ width: 20, height: 20, accentColor: "var(--forest)" }}
                  checked={false}
                  onChange={async () => {
                    await api.setTask(t.id, true);
                    load();
                  }}
                />
                <span>
                  <div className="title">{t.title}</div>
                  {t.detail && <div className="detail">{t.detail}</div>}
                </span>
              </label>
            ))}
            {done.length > 0 && (
              <details style={{ marginTop: 12 }}>
                <summary className="muted">{done.length} done</summary>
                {done.map((t) => (
                  <label key={t.id} className="task done">
                    <input
                      type="checkbox"
                      style={{ width: 20, height: 20, accentColor: "var(--forest)" }}
                      checked
                      onChange={async () => {
                        await api.setTask(t.id, false);
                        load();
                      }}
                    />
                    <span className="title">{t.title}</span>
                  </label>
                ))}
              </details>
            )}
          </section>

          <section className="card" id="desk-inquiries">
            <h2>People who responded</h2>
            {desk.inquiries.length === 0 ? (
              <p className="muted">
                No responses yet.{" "}
                {b.published_at
                  ? "Send your page to three people who might want this."
                  : "Publish your page so people can respond."}
              </p>
            ) : (
              desk.inquiries.map((i) => (
                <div className="message" key={i.id}>
                  <div className="meta">
                    <strong style={{ color: "var(--ink)" }}>
                      {i.share_contact
                        ? i.from_name
                        : `${i.from_name.split(" ")[0]} (contact not shared)`}
                    </strong>{" "}
                    · {i.kind === "interest" ? "is interested" : "asked"} ·{" "}
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
                        onClick={async () => {
                          await api.reply(i.id, replies[i.id] ?? "");
                          load();
                        }}
                      >
                        Reply
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </section>
          {!isDigital && <DeskProducts businessId={b.id} />}
          <DeskImports businessId={b.id} />
          <DeskGrowth key={b.id + String(b.published_at)} desk={desk} withBooks={!isDigital} />
        </div>
        <aside className="studio-side">
          <DeskShare desk={desk} />
          <DeskTeamIfPaid desk={desk} />
          {b.published_at && <DeskSelling businessId={b.id} />}
          {/* 001c: an empty legacy offering never stands in for a digital product. */}
          {isDigital && showOffer && (
            <div className="eyebrow" style={{ marginBottom: -8 }}>
              Your page's legacy offering
            </div>
          )}
          {showOffer && <OfferCard offer={desk.offer} family={b.family} action={desk.action} />}
          {showOffer && desk.missing.length > 0 && (
            <div className="card" style={{ padding: 18 }}>
              <strong>Customers see these as not decided</strong>
              <ul className="missing-list" style={{ marginTop: 8 }}>
                {desk.missing.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </div>
          )}
          {b.published_at && (
            <button
              type="button"
              className="btn btn-quiet"
              onClick={async () => {
                if (
                  window.confirm(
                    "Take your page down? It stops being visible; your drafts and responses stay.",
                  )
                ) {
                  await api.unpublish(b.id);
                  load();
                }
              }}
            >
              Take the page down
            </button>
          )}
        </aside>
      </div>
    </div>
  );
}
