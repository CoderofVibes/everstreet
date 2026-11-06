// Job 001h: the digital business's operating workspace (docs/design/OPERATING_WORKSPACE.md).
// A compact identity header with ONE next action, stable local navigation (Overview,
// Performance, Products, Customers and growth; ?view= links, Back/Forward), and four views that
// stay mounted (only hidden), so drafts and loaded data survive switching. Every action the
// earlier single-page desk had is in one of the views; the legacy desk is unchanged (Desk.tsx).

import { type Dispatch, type SetStateAction, useEffect } from "react";
import { api, type Desk } from "../api.ts";
import type { DigitalDeskView } from "../api4.ts";
import {
  DESK_VIEWS,
  type DeskView,
  deskStatusLine,
  deskViewFromSearch,
  deskViewHref,
  nextAction,
  productFacts,
} from "../digitalDesk.ts";
import { Link, useRouter } from "../router.tsx";
import { FAMILY_LABEL, OfferCard } from "../ui.tsx";
import { type BooksHandle, BooksNotice, BooksPanel, useBooks } from "./DeskBooks.tsx";
import { ProductCards, ProductLines, WorkList } from "./DeskDigital.tsx";
import { DeskEconomics } from "./DeskEconomics.tsx";
import { DeskGrowth, DeskShare, DeskTeamIfPaid } from "./DeskGrowth.tsx";
import { OpsTiles, UsageChart } from "./DeskOperations.tsx";
import { DeskSelling } from "./DeskSale.tsx";
import { DeskImports } from "./Import.tsx";
import { WorkflowCaseBoard } from "./WorkflowCaseBoard.tsx";

/** The checklist (first-week tasks), shared by the legacy desk and the workspace. */
export function Checklist({ desk, title, load }: { desk: Desk; title: string; load: () => void }) {
  const open = desk.tasks.filter((t) => !t.done_at);
  const done = desk.tasks.filter((t) => t.done_at);
  return (
    <section className="card" id="desk-checklist">
      <h2>{title}</h2>
      {open.length === 0 && (
        <p className="muted">
          {title === "Checklist"
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
  );
}

/** People who responded, with reply drafts held by the page (they survive view switches). */
export function Responses({
  desk,
  replies,
  setReplies,
  load,
}: {
  desk: Desk;
  replies: Record<string, string>;
  setReplies: Dispatch<SetStateAction<Record<string, string>>>;
  load: () => void;
}) {
  const b = desk.business;
  return (
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
                  aria-label={`Reply to ${i.from_name.split(" ")[0]}`}
                  value={replies[i.id] ?? ""}
                  onChange={(e) => setReplies((r) => ({ ...r, [i.id]: e.target.value }))}
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
  );
}

/** Take the published page down (kept with its confirmation). */
export function TakeDown({ desk, load }: { desk: Desk; load: () => void }) {
  const b = desk.business;
  if (!b.published_at) return null;
  return (
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
  );
}

/**
 * The overview's figures, from the shared books read. Job 001h1: the same notice as Performance
 * when the figures aren't the period asked for or a refresh failed; an error is never zero.
 */
export function OverviewFigures({ books, businessId }: { books: BooksHandle; businessId: string }) {
  const ops = books.data?.operations ?? null;
  if (ops && ops.state === "recorded")
    return (
      <div className="card ws-glance">
        <h2 className="ws-h">Customers and running cost</h2>
        <BooksNotice books={books} />
        <OpsTiles ops={ops} />
        <UsageChart months={ops.months} />
        <Link to={deskViewHref(businessId, "performance")}>
          Every chart, cost and table in Performance
        </Link>
      </div>
    );
  if (!books.data && books.state.status !== "loading")
    return (
      <div className="card ws-glance">
        <h2 className="ws-h">Customers and running cost</h2>
        <BooksNotice books={books} />
      </div>
    );
  if (!books.data)
    return (
      <div className="card ws-glance">
        <p className="muted">Loading the figures…</p>
      </div>
    );
  return (
    <div className="card ws-glance">
      <h2 className="ws-h">Customers and running cost</h2>
      <BooksNotice books={books} />
      <p className="muted">No customer product yet.</p>
    </div>
  );
}

export function DigitalWorkspace({
  desk,
  digital,
  load,
  replies,
  setReplies,
}: {
  desk: Desk;
  digital: DigitalDeskView;
  load: () => void;
  replies: Record<string, string>;
  setReplies: Dispatch<SetStateAction<Record<string, string>>>;
}) {
  const b = desk.business;
  const { search } = useRouter();
  const view = deskViewFromSearch(search);
  const books = useBooks(b.id);
  const next = nextAction(digital, b.id);
  // A link to a section (#desk-inquiries) shows its view first, then brings the section into view.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the view (from search) is the trigger
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (!hash) return;
    const t = window.setTimeout(
      () => document.getElementById(hash)?.scrollIntoView({ block: "start" }),
      0,
    );
    return () => window.clearTimeout(t);
  }, [view, search]);

  const panel = (id: DeskView) => ({
    id: `desk-view-${id}`,
    hidden: view !== id,
    "aria-labelledby": `desk-nav-${id}`,
  });
  const showOffer = digital.legacy_offering.configured;

  return (
    <div className="page ws">
      <header className="ws-head">
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          <span className="pill">{FAMILY_LABEL[b.family]}</span>
          <span className="pill blue">{productFacts(digital)}</span>
          {b.published_at ? (
            <span className="pill">Page published</span>
          ) : (
            <span className="pill caution">Page private</span>
          )}
        </div>
        <div className="ws-title-row">
          <h1 className="display ws-title">{b.name}</h1>
          <Link to={next.to} className="btn btn-primary ws-next">
            {next.label}
          </Link>
        </div>
        <p className="ws-status">{deskStatusLine(digital)}</p>
        <nav className="ws-links" aria-label="This business">
          {b.published_at && <Link to={`/b/${b.slug}`}>Public page</Link>}
          <Link to={`/desk/${b.id}/value`}>Value</Link>
          <Link to={`/desk/${b.id}/team`}>Team</Link>
          <Link to={`/desk/${b.id}/continuity`}>Ownership and continuity</Link>
          <Link to={`/desk/${b.id}/handover`}>Sale and handover</Link>
          {digital.rehearsable && <Link to={`/desk/${b.id}/rehearsal`}>Successor rehearsal</Link>}
        </nav>
      </header>

      <nav className="ws-nav" aria-label="Operating workspace">
        {DESK_VIEWS.map((v) => (
          <Link
            key={v.id}
            to={deskViewHref(b.id, v.id)}
            className={`ws-tab${view === v.id ? " active" : ""}`}
            current={view === v.id}
          >
            <span id={`desk-nav-${v.id}`}>{v.label}</span>
          </Link>
        ))}
      </nav>

      {/* Overview: what needs action, what customers receive, what it costs, first. */}
      <section {...panel("overview")} className="ws-panel">
        <div className="ws-overview">
          <div className="ws-main">
            <OverviewFigures books={books} businessId={b.id} />
          </div>
          <aside className="ws-rail">
            <section className="card">
              <h2 className="ws-h">Waiting now</h2>
              <WorkList d={digital} businessId={b.id} />
            </section>
            <section className="card">
              <h2 className="ws-h">Products</h2>
              <ProductLines d={digital} businessId={b.id} />
            </section>
          </aside>
        </div>
      </section>

      {/* Performance: the books and digital operations, every figure with its source. */}
      <section {...panel("performance")} className="ws-panel">
        <BooksPanel books={books} deliberate />
        <DeskEconomics businessId={b.id} />
      </section>

      {/* Products: identity (released apart from draft), status, offers, every product action. */}
      <section {...panel("products")} className="ws-panel">
        <div className="card">
          <ProductCards d={digital} businessId={b.id} />
          <div className="row ws-product-links">
            <Link to={`/desk/${b.id}/public`} className="btn btn-secondary btn-sm">
              Public profile
            </Link>
            <Link
              to={`/experts?business=${encodeURIComponent(b.id)}`}
              className="btn btn-quiet btn-sm"
            >
              Find expert help
            </Link>
            {desk.project_id && (
              <Link to={`/studio/${desk.project_id}`} className="btn btn-quiet btn-sm">
                Edit page and legacy offering
              </Link>
            )}
          </div>
        </div>
        <WorkflowCaseBoard businessId={b.id} />
        <DeskImports businessId={b.id} />
        {showOffer && (
          <div className="ws-legacy-offer">
            <div className="eyebrow">Your page's legacy offering</div>
            <OfferCard offer={desk.offer} family={b.family} action={desk.action} />
            {desk.missing.length > 0 && (
              <div className="card" style={{ padding: 18 }}>
                <strong>Customers see these as not decided</strong>
                <ul className="missing-list" style={{ marginTop: 8 }}>
                  {desk.missing.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Customers and growth: people, reach, team and selling. */}
      <section {...panel("growth")} className="ws-panel">
        <div className="desk">
          <div>
            <Checklist desk={desk} title="Checklist" load={load} />
            <Responses desk={desk} replies={replies} setReplies={setReplies} load={load} />
            <DeskGrowth key={b.id + String(b.published_at)} desk={desk} withBooks={false} />
          </div>
          <aside className="studio-side">
            <DeskShare desk={desk} />
            <DeskTeamIfPaid desk={desk} />
            {b.published_at && <DeskSelling businessId={b.id} />}
            <TakeDown desk={desk} load={load} />
          </aside>
        </div>
      </section>
    </div>
  );
}
