// The founder's desk: what needs you today (replies and first-week tasks), the page's status,
// and a way back into the studio. Job 001h: a digital business opens the operating workspace
// (DeskWorkspace.tsx); the legacy (class/service) desk below is unchanged in content.

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type Desk } from "../api.ts";
import { api4, type DigitalDeskView } from "../api4.ts";
import { type DeskLoadState, deskLoader } from "../deskLoad.ts";
import { ago, type ProjectSummary, productsApi } from "../productsApi.ts";
import { Link, useRouter } from "../router.tsx";
import { useSession } from "../session.tsx";
import { type MyTeamEntry, teamApi } from "../teamApi.ts";
import { FAMILY_LABEL, OfferCard } from "../ui.tsx";
import { DealsList } from "./Deal.tsx";
import { DeskGrowth, DeskShare, DeskTeamIfPaid } from "./DeskGrowth.tsx";
import { DeskSelling } from "./DeskSale.tsx";
import { Checklist, DigitalWorkspace, Responses, TakeDown } from "./DeskWorkspace.tsx";
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
  // First-use review #58: a team member's businesses are part of their day too.
  const [teams, setTeams] = useState<MyTeamEntry[]>([]);
  useEffect(() => {
    if (person) {
      teamApi
        .mine()
        .then((r) => setTeams(r.teams))
        .catch(() => {});
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
        {rows.length > 0 && (
          <button type="button" className="btn btn-primary" onClick={() => go("/start")}>
            Start a business
          </button>
        )}
      </div>
      {teams.length > 0 && (
        <>
          <h2 className="section-title" style={{ marginTop: 24 }}>
            Businesses you work on
          </h2>
          <div className="biz-list" style={{ marginTop: 12 }}>
            {teams.map((t) => (
              <Link key={t.id} to={`/team/${t.business_id}`} className="card link biz-row">
                <div>
                  <h3 style={{ fontSize: 18, margin: 0 }}>{t.business_name}</h3>
                  <span className="muted" style={{ fontSize: 14 }}>
                    {t.role_label}
                  </span>
                </div>
                <span className="spacer" />
                <span className="btn btn-secondary">Open the board</span>
              </Link>
            ))}
          </div>
        </>
      )}
      {rows.length === 0 ? (
        teams.length === 0 && (
          <div className="card empty" style={{ marginTop: 24 }}>
            <h2>No businesses yet</h2>
            <Link to="/start" className="btn btn-primary">
              Start a business
            </Link>
          </div>
        )
      ) : (
        <div className="biz-list" style={{ marginTop: 24 }}>
          {rows.map((r) => (
            <Link
              key={r.id}
              to={r.published_at || r.product_studio ? `/desk/${r.business_id}` : `/studio/${r.id}`}
              className="card link biz-row"
            >
              <div>
                <h3 style={{ fontSize: 18, margin: 0 }}>{r.name}</h3>
                <span className="muted" style={{ fontSize: 14 }}>
                  {r.published_at ? "Published" : "Private draft, not published"}
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
  // First-use review (Nov 7, finding 43): supplier invoices awaiting the owner's approval are work
  // too. The allowance lives on a companion contract, read live, so it joins the list here.
  const [awaiting, setAwaiting] = useState<DigitalDeskView["work"]>([]);
  useEffect(() => {
    if (!person || digital?.kind !== "digital") return;
    let cancelled = false;
    (async () => {
      try {
        const has = await fetch(`/api/businesses/${id}/companions`, { credentials: "same-origin" });
        if (!has.ok || !((await has.json()) as { allowance?: boolean }).allowance) return;
        const r = await fetch(`/api/companions/${id}`, { credentials: "same-origin" });
        if (!r.ok) return;
        const v = (await r.json()) as {
          you_own_it?: boolean;
          allowance?: { awaiting?: unknown[] } | null;
        };
        const n = v.you_own_it ? (v.allowance?.awaiting?.length ?? 0) : 0;
        if (!cancelled)
          setAwaiting(
            n > 0
              ? [
                  {
                    key: "allowance_awaiting",
                    who: "you",
                    count: n,
                    label: `supplier invoice${n === 1 ? "" : "s"} await${n === 1 ? "s" : ""} your approval`,
                    link: { to: "allowance" },
                  },
                ]
              : [],
          );
      } catch {
        // the companion couldn't be read: the list shows the rest
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [person, digital?.kind, id]);
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
  const waiting = desk.inquiries.filter((i) => !i.reply);
  // Job 001h: a digital business gets the operating workspace; the legacy desk below is unchanged.
  if (digital?.kind === "digital")
    return (
      <DigitalWorkspace
        desk={desk}
        digital={
          awaiting.length > 0 ? { ...digital, work: [...digital.work, ...awaiting] } : digital
        }
        load={load}
        replies={replies}
        setReplies={setReplies}
      />
    );

  return (
    <div className="page">
      <div className="row" style={{ marginBottom: 4, flexWrap: "wrap" }}>
        <span className="pill">{FAMILY_LABEL[b.family]}</span>
        {b.published_at ? (
          <span className="pill">Published</span>
        ) : (
          <span className="pill caution">Private draft</span>
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
        {desk.project_id && (
          <Link to={`/studio/${desk.project_id}`} className="btn btn-secondary">
            Edit in studio
          </Link>
        )}
      </div>
      <p className="muted" style={{ fontSize: 18 }}>
        {waiting.length > 0
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

      <div className="desk">
        <div>
          <Checklist desk={desk} title="Today" load={load} />
          <Responses desk={desk} replies={replies} setReplies={setReplies} load={load} />
          <DeskProducts businessId={b.id} />
          <DeskImports businessId={b.id} />
          <DeskGrowth key={b.id + String(b.published_at)} desk={desk} withBooks />
        </div>
        <aside className="studio-side">
          <DeskShare desk={desk} />
          <DeskTeamIfPaid desk={desk} />
          {b.published_at && <DeskSelling businessId={b.id} />}
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
          <TakeDown desk={desk} load={load} />
        </aside>
      </div>
    </div>
  );
}
