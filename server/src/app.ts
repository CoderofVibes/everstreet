// Everstreet's HTTP API. Sessions are a cookie; every workspace route resolves the person from
// it and the store checks ownership. Public routes read only published projections.

import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { type BookingProvider, Bookings } from "./bookings.ts";
import { Community, type Constraints, interpret } from "./community.ts";
import { HttpError, type Person, type Store } from "./store.ts";

const COOKIE = "es_session";

export interface AppOptions {
  /** Local preview: anyone at this computer may switch between fictional people. */
  localPreview: boolean;
  environment: string;
  /** The booking service class businesses publish their sessions to (OpenSeat). */
  bookingProvider?: BookingProvider;
}

export function everstreetApi(store: Store, options: AppOptions) {
  const app = new Hono<{ Variables: { person: Person | null } }>();
  const community = new Community(store.db, store);
  const bookings = options.bookingProvider
    ? new Bookings(store.db, store, options.bookingProvider)
    : null;

  app.onError((error, c) => {
    if (error instanceof HttpError) return c.json({ error: error.message }, error.status);
    console.error(error);
    return c.json({ error: "Something went wrong on our side" }, 500);
  });

  app.use("*", async (c, next) => {
    c.set("person", store.personForToken(getCookie(c, COOKIE)));
    await next();
  });

  const me = (c: { get: (k: "person") => Person | null }) => {
    const p = c.get("person");
    if (!p) throw new HttpError(401, "Sign in first");
    return p;
  };
  const body = async <T>(c: { req: { json: () => Promise<unknown> } }) =>
    ((await c.req.json().catch(() => ({}))) ?? {}) as T;
  const startSession = (c: Parameters<typeof setCookie>[0], token: string) =>
    setCookie(c, COOKIE, token, {
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 90,
    });

  app.get("/api/env", (c) =>
    c.json({ environment: options.environment, localPreview: options.localPreview }),
  );

  // ---------- account ----------

  app.get("/api/me", (c) => c.json({ person: c.get("person") }));

  app.post("/api/session", async (c) => {
    const { name } = await body<{ name?: string }>(c);
    const { person, token } = store.createPerson(String(name ?? ""));
    startSession(c, token);
    return c.json({ person }, 201);
  });

  app.delete("/api/session", (c) => {
    const token = getCookie(c, COOKIE);
    if (token) store.endSession(token);
    deleteCookie(c, COOKIE, { path: "/" });
    return c.json({ person: null });
  });

  app.get("/api/people", (c) => {
    if (!options.localPreview) throw new HttpError(404, "Not available");
    return c.json({
      people: store.people().map((p) => ({ id: p.id, display_name: p.display_name })),
    });
  });

  app.post("/api/session/as/:id", (c) => {
    if (!options.localPreview) throw new HttpError(404, "Not available");
    const token = store.sessionFor(c.req.param("id"));
    startSession(c, token);
    return c.json({ person: store.person(c.req.param("id")) });
  });

  app.patch("/api/me", async (c) =>
    c.json({ person: store.updatePerson(me(c).id, await body(c)) }),
  );

  // ---------- launch studio ----------

  app.get("/api/projects", (c) => c.json({ projects: store.projects(me(c)) }));

  app.post("/api/projects", async (c) => {
    const { route, name } = await body<{ route?: string; name?: string }>(c);
    if (route !== "idea" && route !== "find" && route !== "started")
      throw new HttpError(400, "Choose how you want to start");
    return c.json(store.startProject(me(c), route, name), 201);
  });

  app.get("/api/projects/:id", (c) => c.json(store.project(me(c), c.req.param("id"))));

  app.post("/api/projects/:id/explore", async (c) =>
    c.json(store.explore(me(c), c.req.param("id"), await body(c))),
  );

  app.post("/api/projects/:id/choose", async (c) => {
    const { index } = await body<{ index?: number }>(c);
    return c.json(store.chooseDirection(me(c), c.req.param("id"), Number(index)));
  });

  app.patch("/api/projects/:id/answers", async (c) =>
    c.json(store.answer(me(c), c.req.param("id"), await body(c))),
  );

  app.post("/api/projects/:id/step", async (c) => {
    const { step } = await body<{ step?: string }>(c);
    return c.json(store.setStep(me(c), c.req.param("id"), String(step ?? "")));
  });

  // ---------- the founder's business ----------

  app.get("/api/businesses/:id", (c) => c.json(store.business(me(c), c.req.param("id"))));
  app.patch("/api/businesses/:id", async (c) =>
    c.json(store.updateBusiness(me(c), c.req.param("id"), await body(c))),
  );
  app.patch("/api/businesses/:id/offer", async (c) =>
    c.json(store.editOffer(me(c), c.req.param("id"), await body(c))),
  );
  app.patch("/api/businesses/:id/idea", async (c) =>
    c.json(store.editIdea(me(c), c.req.param("id"), await body(c))),
  );
  app.post("/api/businesses/:id/publish", (c) => c.json(store.publish(me(c), c.req.param("id"))));
  app.post("/api/businesses/:id/unpublish", (c) =>
    c.json(store.unpublish(me(c), c.req.param("id"))),
  );
  app.patch("/api/tasks/:id", async (c) => {
    const { done } = await body<{ done?: boolean }>(c);
    return c.json({ tasks: store.setTaskDone(me(c), c.req.param("id"), Boolean(done)) });
  });

  // ---------- inbox ----------

  app.get("/api/inbox", (c) => c.json(store.inbox(me(c))));
  app.post("/api/inquiries/:id/reply", async (c) => {
    const { text } = await body<{ text?: string }>(c);
    return c.json(store.reply(me(c), c.req.param("id"), String(text ?? "")));
  });

  // ---------- public ----------

  app.get("/api/public/discover", (c) =>
    c.json({ businesses: store.discover(c.req.query("q") ?? "") }),
  );
  app.get("/api/public/businesses/:slug", async (c) => {
    const slug = c.req.param("slug");
    const page = store.publicBusiness(slug);
    const viewer = c.get("person");
    const { id } = community.businessIdForSlug(slug);
    return c.json({
      ...page,
      viewer_is_owner: viewer ? store.isOwner(viewer, slug) : false,
      sessions: bookings ? await bookings.publicSessions(id) : [],
      bookings_connected: Boolean(bookings),
      updates: community.updatesFor(id),
      followers: community.followers(id),
      following: community.isFollowing(viewer, id),
    });
  });
  app.post("/api/public/businesses/:slug/inquiries", async (c) => {
    const { kind, message, share_contact, source } = await body<{
      kind?: string;
      message?: string;
      share_contact?: boolean;
      source?: string;
    }>(c);
    if (kind !== "interest" && kind !== "question") throw new HttpError(400, "Unknown request");
    return c.json(
      store.inquire(
        me(c),
        c.req.param("slug"),
        kind,
        String(message ?? ""),
        Boolean(share_contact),
        String(source ?? "unknown"),
      ),
      201,
    );
  });
  app.post("/api/public/businesses/:slug/follow", async (c) => {
    const { on } = await body<{ on?: boolean }>(c);
    return c.json(community.follow(me(c), c.req.param("slug"), on !== false));
  });

  // ---------- bookings (through the booking service) ----------

  const needBookings = () => {
    if (!bookings) throw new HttpError(409, "Bookings are not connected in this environment");
    return bookings;
  };
  app.get("/api/businesses/:id/sessions", async (c) =>
    c.json({ sessions: await needBookings().ownerSessions(me(c), c.req.param("id")) }),
  );
  app.post("/api/businesses/:id/sessions", async (c) =>
    c.json(
      { sessions: await needBookings().openSession(me(c), c.req.param("id"), await body(c)) },
      201,
    ),
  );
  app.post("/api/public/sessions/:id/book", async (c) => {
    const { source } = await body<{ source?: string }>(c);
    return c.json(
      await needBookings().book(me(c), c.req.param("id"), String(source ?? "unknown")),
      201,
    );
  });
  app.post("/api/activity/bookings/:id/cancel", async (c) =>
    c.json(await needBookings().cancel(me(c), c.req.param("id"))),
  );
  app.get("/api/activity/bookings/:id/calendar.ics", async (c) =>
    c.body(await needBookings().calendar(me(c), c.req.param("id")), 200, {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": 'attachment; filename="everstreet-booking.ics"',
    }),
  );

  // ---------- my activity ----------

  app.get("/api/activity", async (c) => {
    const p = me(c);
    return c.json({
      bookings: bookings ? await bookings.myBookings(p) : [],
      needs: community.myNeeds(p),
      sent: store.inbox(p).sent,
      following: community.following(p),
      feed: community.feed(p),
    });
  });

  // ---------- search, needs, explore, profiles ----------

  app.get("/api/public/search", (c) => {
    const q = c.req.query("q") ?? "";
    const auto = c.req.query("interpret") === "1";
    const interpreted = auto ? interpret(q) : { words: [], constraints: {} as Constraints };
    const constraints: Constraints = auto ? interpreted.constraints : {};
    const family = c.req.query("family");
    if (family === "class" || family === "service" || family === "product" || family === "software")
      constraints.family = family;
    if (family === "any") delete constraints.family;
    const max = c.req.query("max");
    if (max === "none") delete constraints.max_price_cents;
    else if (max && Number.isFinite(Number(max)))
      constraints.max_price_cents = Math.round(Number(max) * 100);
    const online = c.req.query("online");
    if (online === "1") constraints.online = true;
    if (online === "0") delete constraints.online;
    if (c.req.query("confirmed") === "1") constraints.confirmed_only = true;
    return c.json(community.search(q, constraints));
  });

  app.get("/api/public/needs", (c) => c.json({ needs: community.openNeeds() }));
  app.post("/api/needs", async (c) =>
    c.json({ needs: community.postNeed(me(c), await body(c)) }, 201),
  );
  app.post("/api/needs/:id/close", (c) =>
    c.json({ needs: community.closeNeed(me(c), c.req.param("id")) }),
  );
  app.post("/api/needs/:id/respond", async (c) => {
    const { business_id, message } = await body<{ business_id?: string; message?: string }>(c);
    return c.json(
      community.respond(me(c), c.req.param("id"), String(business_id ?? ""), String(message ?? "")),
      201,
    );
  });
  app.post("/api/need-responses/:id/reply", async (c) => {
    const { text } = await body<{ text?: string }>(c);
    return c.json({
      needs: community.replyToResponse(me(c), c.req.param("id"), String(text ?? "")),
    });
  });

  app.get("/api/businesses/:id/extras", (c) => {
    const p = me(c);
    const id = c.req.param("id");
    return c.json({
      updates: community.updatesFor(id),
      needs: community.needsForBusiness(p, id),
      sources: community.sources(p, id),
      need_replies: community.sentResponses(p),
    });
  });
  app.post("/api/businesses/:id/updates", async (c) => {
    const { body: text } = await body<{ body?: string }>(c);
    return c.json(
      { updates: community.postUpdate(me(c), c.req.param("id"), String(text ?? "")) },
      201,
    );
  });

  app.get("/api/public/explore", (c) => c.json(community.explore()));
  app.get("/api/public/people/:id", (c) => c.json(community.profile(c.req.param("id"))));
  app.post("/api/public/reports", async (c) => {
    const { kind, subject, reason } = await body<{
      kind?: string;
      subject?: string;
      reason?: string;
    }>(c);
    return c.json(
      community.report(me(c), String(kind ?? ""), String(subject ?? ""), String(reason ?? "")),
      201,
    );
  });

  return app;
}
