// Everstreet's HTTP API. Sessions are a cookie; every workspace route resolves the person from
// it and the store checks ownership. Public routes read only published projections.

import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { Acquisitions, type Criteria, interpretAcquire } from "./acquire.ts";
import { Authoring } from "./authoring.ts";
import { type BookingProvider, Bookings } from "./bookings.ts";
import { BOOKS_BASIS, Books } from "./books.ts";
import type { BuildProvider } from "./build.ts";
import { Builds, proposalBudget } from "./builds.ts";
import type { Chain } from "./chain.ts";
import { Community, type Constraints, interpret } from "./community.ts";
import { type CustomerUseOptions, CustomerUses } from "./customerUse.ts";
import { Deals } from "./deals.ts";
import { Evaluations } from "./evaluations.ts";
import { type ImportInspector, Imports } from "./imports.ts";
import { ManagedRuntime } from "./invocations.ts";
import { Opportunities } from "./opportunities.ts";
import { Payments } from "./payments.ts";
import { Products } from "./products.ts";
import { Releases } from "./releases.ts";
import { HttpError, type Person, type Store } from "./store.ts";
import { V3Intents } from "./v3intents.ts";
import { V3Observations, type V3Options } from "./v3observe.ts";
import { type Overrides, Valuation } from "./value.ts";

const COOKIE = "es_session";

export interface AppOptions {
  /** Local preview: anyone at this computer may switch between fictional people. */
  localPreview: boolean;
  environment: string;
  /** The booking service class businesses publish their sessions to (OpenSeat). */
  bookingProvider?: BookingProvider;
  /** NEAR testnet, for payments. Without it, priced sessions are booked without payment. */
  chain?: Chain | null;
  /** Turns product revisions into builds. None is connected yet; the studio says so. */
  buildProvider?: BuildProvider | null;
  /** Build jobs; tests pass their own to share it with a worker. Built from the provider otherwise. */
  builds?: Builds;
  /** The operator's overall AI spending ceiling in cents (from the server's AI configuration). */
  operatorCeilingCents?: number | null;
  /** The managed runtime (job 002c); built unconnected if not given, and says so. */
  runtime?: ManagedRuntime;
  /** Import inspectors (job 004a); the local package.json inspector if not given. */
  importInspectors?: ImportInspector[];
  /**
   * Read-only business-v3 observations (job 003h): an injected view transport and the
   * operator's bindings. Unset: v3 reads are unavailable and no business is bound.
   */
  v3?: V3Options;
  /**
   * Customer use (job 003m): an injected read transport with block timestamps, a hold writer and
   * the platform's METERING account. Unset: customer use answers unavailable and does nothing.
   */
  customer?: CustomerUseOptions;
}

export function everstreetApi(store: Store, options: AppOptions) {
  const app = new Hono<{ Variables: { person: Person | null } }>();
  const community = new Community(store.db, store);
  const bookings = options.bookingProvider
    ? new Bookings(store.db, store, options.bookingProvider)
    : null;
  const payments = bookings ? new Payments(store.db, store, bookings, options.chain ?? null) : null;
  const builds =
    options.builds ??
    new Builds(store.db, store, options.buildProvider ?? null, {
      operatorCeilingCents: options.operatorCeilingCents ?? null,
    });
  const products = new Products(store.db, store, options.buildProvider ?? null, () =>
    builds.availability(),
  );
  const authoring = new Authoring(store.db, store, products, builds, () =>
    proposalBudget(builds.provider),
  );
  const imports = new Imports(store.db, store, options.importInspectors);
  const opportunities = new Opportunities(store.db, store, community, products);
  const v3 = new V3Observations(store.db, store, options.v3);
  const v3Intents = new V3Intents(store.db, store, v3);
  const runtime = options.runtime ?? new ManagedRuntime(store.db, store, null);
  const customerUses = new CustomerUses(store.db, store, v3, options.customer, runtime);
  const evaluations = new Evaluations(store.db, store, runtime);
  const releases = new Releases(store.db, store, runtime, evaluations);
  const books = new Books(store.db, store, options.chain ?? null);
  const valuation = new Valuation(store.db, store, books);
  const acquire = new Acquisitions(store.db, store, books, valuation, options.chain ?? null);
  const deals = payments
    ? new Deals(store.db, store, payments, acquire, options.chain ?? null)
    : null;
  const needDeals = () => {
    if (!deals)
      throw new HttpError(409, "Deals need payments on NEAR, which aren't connected here");
    return deals;
  };
  const pricedAndPaid = (businessId: string) => {
    const offer = store.offerOf(businessId);
    return Boolean(
      payments?.businessPayments(businessId) && offer.price_cents && !offer.first_free,
    );
  };

  app.onError((error, c) => {
    if (error instanceof HttpError)
      return c.json(
        error.code ? { error: error.message, code: error.code } : { error: error.message },
        error.status,
      );
    console.error(error);
    return c.json({ error: "Something went wrong on our side" }, 500);
  });

  app.use("*", async (c, next) => {
    c.set("person", store.personForToken(getCookie(c, COOKIE)));
    // Job 003p: API answers depend on who is asking and what they may see right now (evidence
    // rooms, exports, scenarios, books, value, deal terms). None may be stored by a browser or
    // proxy and replayed after access ends. Set first, so refusals carry it too.
    if (c.req.path.startsWith("/api/")) c.header("Cache-Control", "no-store");
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

  // ---------- bringing an existing product (job 004a): private import workspaces ----------

  app.get("/api/imports", (c) => c.json({ imports: imports.list(me(c)) }));
  app.post("/api/imports", async (c) => {
    const { created, view } = await imports.create(me(c), await body(c));
    return c.json({ ...view, created }, created ? 201 : 200);
  });
  app.get("/api/imports/:id", (c) => c.json(imports.view(me(c), c.req.param("id"))));
  app.patch("/api/imports/:id", async (c) =>
    c.json(imports.update(me(c), c.req.param("id"), await body(c))),
  );
  app.post("/api/imports/:id/inspections", async (c) => {
    const { created, view } = await imports.inspect(me(c), c.req.param("id"), await body(c));
    return c.json({ ...view, created }, created ? 201 : 200);
  });
  app.get("/api/imports/:id/inspections/:n", (c) =>
    c.json(imports.inspection(me(c), c.req.param("id"), Number(c.req.param("n")))),
  );
  app.get("/api/imports/:id/reports/:n", (c) =>
    c.json(imports.report(me(c), c.req.param("id"), Number(c.req.param("n")))),
  );
  app.put("/api/imports/:id/dependencies/:category", async (c) =>
    c.json(imports.declare(me(c), c.req.param("id"), c.req.param("category"), await body(c))),
  );
  app.get("/api/businesses/:id/imports", (c) =>
    c.json({ imports: imports.list(me(c), c.req.param("id")) }),
  );

  // ---------- read-only business-v3 observations (job 003h): owner only ----------

  app.get("/api/businesses/:id/v3", (c) => c.json(v3.view(me(c), c.req.param("id"))));
  app.post("/api/businesses/:id/v3/refresh", async (c) =>
    c.json(await v3.refresh(me(c), c.req.param("id"), await body(c))),
  );
  // Job 003k: exact acquisition intents (owner) and a participant's deliberate reconciliation.
  app.get("/api/businesses/:id/v3/intents", (c) =>
    c.json(v3Intents.list(me(c), c.req.param("id"))),
  );
  app.post("/api/businesses/:id/v3/intents", async (c) => {
    const r = v3Intents.record(me(c), c.req.param("id"), await body(c));
    return c.json(r, r.created ? 201 : 200);
  });
  app.get("/api/businesses/:id/v3/intents/:intent", (c) =>
    c.json(v3Intents.read(me(c), c.req.param("id"), c.req.param("intent"))),
  );
  app.post("/api/businesses/:id/v3/intents/:intent/reconcile", async (c) =>
    c.json(await v3Intents.reconcile(me(c), c.req.param("id"), c.req.param("intent"))),
  );

  // Job 003m: customer offers (the owner) and a customer's own preparations and reservations.
  app.get("/api/businesses/:id/customer-offers", (c) =>
    c.json(customerUses.listOffers(me(c), c.req.param("id"))),
  );
  app.post("/api/businesses/:id/customer-offers", async (c) => {
    const r = await customerUses.createOffer(me(c), c.req.param("id"), await body(c));
    return c.json(r, r.created ? 201 : 200);
  });
  app.post("/api/businesses/:id/customer-offers/:offer/retire", (c) =>
    c.json(customerUses.retireOffer(me(c), c.req.param("id"), c.req.param("offer"))),
  );
  app.post("/api/customer/offers/:offer/prepare", async (c) => {
    const r = await customerUses.prepare(me(c), c.req.param("offer"), await body(c));
    return c.json(r, r.created ? 201 : 200);
  });
  app.get("/api/customer/uses/:id", (c) => c.json(customerUses.status(me(c), c.req.param("id"))));
  app.post("/api/customer/uses/:id/confirm", async (c) =>
    c.json(await customerUses.confirm(me(c), c.req.param("id"), await body(c))),
  );
  app.post("/api/customer/uses/:id/cancel", (c) =>
    c.json(customerUses.cancel(me(c), c.req.param("id"))),
  );
  app.post("/api/customer/uses/:id/reconcile", async (c) =>
    c.json(await customerUses.reconcile(me(c), c.req.param("id"))),
  );
  // Job 003n: executing a reserved request, and the customer's own private result.
  app.post("/api/customer/uses/:id/execute", async (c) =>
    c.json(await customerUses.execute(me(c), c.req.param("id"), await body(c))),
  );
  app.post("/api/customer/uses/:id/execution/cancel", (c) =>
    c.json(customerUses.cancelExecution(me(c), c.req.param("id"))),
  );
  app.get("/api/customer/uses/:id/result", async (c) =>
    c.json(await customerUses.result(me(c), c.req.param("id"))),
  );

  // ---------- product studio: digital product projects and their revisions ----------

  app.get("/api/product-foundations", (c) => c.json(products.foundations()));
  app.get("/api/product-projects", (c) => c.json({ projects: products.mine(me(c)) }));
  app.post("/api/product-projects", async (c) =>
    c.json(products.create(me(c), await body(c)), 201),
  );
  app.get("/api/product-projects/:id", (c) => c.json(products.view(me(c), c.req.param("id"))));
  app.get("/api/product-projects/:id/revisions/:n", (c) =>
    c.json(products.revision(me(c), c.req.param("id"), Number(c.req.param("n")))),
  );
  app.post("/api/product-projects/:id/revisions", async (c) => {
    const { created, view } = products.save(me(c), c.req.param("id"), await body(c));
    return c.json({ ...view, created }, created ? 201 : 200);
  });
  app.post("/api/product-projects/:id/restore", async (c) => {
    const { created, view } = products.restore(me(c), c.req.param("id"), await body(c));
    return c.json({ ...view, created }, created ? 201 : 200);
  });

  // ---------- build jobs (owner only; current ownership checked on every call) ----------

  app.get("/api/product-projects/:id/builds", (c) => {
    const intent = c.req.query("intent");
    return c.json(
      builds.list(
        me(c),
        c.req.param("id"),
        intent === "build" || intent === "propose" ? intent : null,
      ),
    );
  });

  // ---------- guided authoring: the product work log and AI proposals ----------

  app.get("/api/product-projects/:id/conversation", (c) =>
    c.json(
      authoring.conversation(me(c), c.req.param("id"), {
        before: Number(c.req.query("before") ?? 0),
        after: Number(c.req.query("after") ?? 0),
      }),
    ),
  );
  app.post("/api/product-projects/:id/conversation", async (c) => {
    const out = authoring.send(me(c), c.req.param("id"), await body(c));
    return c.json(out, out.created ? 201 : 200);
  });
  app.get("/api/product-projects/:id/proposals/:pid", (c) =>
    c.json(authoring.proposal(me(c), c.req.param("id"), c.req.param("pid"))),
  );
  app.post("/api/product-projects/:id/proposals/:pid/apply", (c) => {
    const out = authoring.apply(me(c), c.req.param("id"), c.req.param("pid"));
    return c.json(out, out.applied.created ? 201 : 200);
  });
  app.post("/api/product-projects/:id/builds", async (c) => {
    const { job, created } = builds.request(me(c), c.req.param("id"), await body(c));
    return c.json({ job, created }, created ? 201 : 200);
  });
  app.get("/api/builds/:id", (c) => c.json({ job: builds.get(me(c), c.req.param("id")) }));
  app.get("/api/builds/:id/events", (c) =>
    c.json(
      builds.events(
        me(c),
        c.req.param("id"),
        Number(c.req.query("after") ?? 0),
        Number(c.req.query("limit") ?? 100),
      ),
    ),
  );
  app.post("/api/builds/:id/cancel", (c) =>
    c.json({ job: builds.cancel(me(c), c.req.param("id")) }),
  );
  app.post("/api/builds/:id/retry", async (c) => {
    const { job, created } = builds.retry(me(c), c.req.param("id"), await body(c));
    return c.json({ job, created }, created ? 201 : 200);
  });
  app.get("/api/businesses/:id/build-budget", (c) =>
    c.json(builds.budget(me(c), c.req.param("id"))),
  );
  app.put("/api/businesses/:id/build-budget", async (c) =>
    c.json(builds.setBudget(me(c), c.req.param("id"), await body(c))),
  );

  // ---------- running the product (job 002c): owner-only private trials before M3 ----------

  app.get("/api/product-projects/:id/runtime", (c) =>
    c.json(runtime.list(me(c), c.req.param("id"))),
  );
  app.post("/api/product-projects/:id/runtime/invocations", async (c) => {
    const b = await body<Record<string, unknown>>(c);
    const { invocation, created, done } = runtime.start(
      me(c),
      c.req.param("id"),
      b,
      b.release === true ? "release" : "trial",
    );
    // Waits for the answer (bounded by the runtime's time limit); a repeat with the same key
    // returns the same record, still running or finished.
    const final = invocation.state === "running" || created ? await done : invocation;
    // Authority is checked again after the final await, for new and repeated requests alike.
    return c.json({ invocation: runtime.answerFor(me(c), final), created }, created ? 201 : 200);
  });
  app.get("/api/runtime/invocations/:id", (c) =>
    c.json({ invocation: runtime.get(me(c), c.req.param("id")) }),
  );
  app.post("/api/runtime/invocations/:id/cancel", (c) =>
    c.json({ invocation: runtime.cancel(me(c), c.req.param("id")) }),
  );
  app.get("/api/product-projects/:id/test-cases", (c) =>
    c.json(evaluations.fixtures(me(c), c.req.param("id"))),
  );
  app.post("/api/product-projects/:id/test-cases", async (c) =>
    c.json(evaluations.saveFixtures(me(c), c.req.param("id"), await body(c)), 201),
  );
  app.get("/api/product-projects/:id/evaluations", (c) =>
    c.json({ runs: evaluations.list(me(c), c.req.param("id")) }),
  );
  app.post("/api/product-projects/:id/evaluations", async (c) => {
    const { run, done } = evaluations.start(me(c), c.req.param("id"), await body(c));
    // Runs in the background; the page follows it. Failures are recorded on the run.
    done.catch((e) => console.error("evaluation run failed", (e as Error).message));
    return c.json({ run }, 202);
  });
  app.get("/api/evaluations/:id", (c) =>
    c.json({ run: evaluations.get(me(c), c.req.param("id")) }),
  );
  app.get("/api/product-projects/:id/releases", (c) =>
    c.json(releases.view(me(c), c.req.param("id"))),
  );
  app.post("/api/product-projects/:id/releases", async (c) =>
    c.json(releases.activate(me(c), c.req.param("id"), await body(c)), 201),
  );
  app.post("/api/product-projects/:id/releases/:rid/rollback", (c) =>
    c.json(releases.rollback(me(c), c.req.param("id"), c.req.param("rid"))),
  );
  app.get("/api/businesses/:id/runtime-budget", (c) => {
    store.ownedBusiness(me(c), c.req.param("id"));
    return c.json(runtime.budgetFor(c.req.param("id")));
  });
  app.put("/api/businesses/:id/runtime-budget", async (c) =>
    c.json(runtime.setBudget(me(c), c.req.param("id"), await body(c))),
  );

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
      payments: payments?.businessPayments(id) ?? null,
      numbers: await valuation.publicNumbers(id).catch(() => null),
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
    const session = store.db
      .prepare("SELECT business_id FROM sessions_offered WHERE id = ?")
      .get(c.req.param("id")) as { business_id: string } | undefined;
    if (session && pricedAndPaid(session.business_id))
      throw new HttpError(409, "This session is paid; use Pay and book");
    return c.json(
      await needBookings().book(me(c), c.req.param("id"), String(source ?? "unknown")),
      201,
    );
  });
  app.post("/api/activity/bookings/:id/cancel", async (c) => {
    const p = me(c);
    const paid = payments ? await payments.cancelPaid(p, c.req.param("id")) : null;
    if (paid)
      return c.json({ ...(await needBookings().myBooking(p, c.req.param("id"))), payment: paid });
    return c.json(await needBookings().cancel(p, c.req.param("id")));
  });
  app.get("/api/activity/bookings/:id/calendar.ics", async (c) =>
    c.body(await needBookings().calendar(me(c), c.req.param("id")), 200, {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": 'attachment; filename="everstreet-booking.ics"',
    }),
  );

  // ---------- payments on NEAR testnet ----------

  const needPayments = () => {
    if (!payments) throw new HttpError(409, "Payments are not connected in this environment");
    return payments;
  };
  app.get("/api/payments/info", (c) => c.json(payments?.info() ?? { enabled: false }));
  app.get("/api/wallet", async (c) => {
    const p = me(c);
    return c.json({
      wallet: payments?.existingWallet(p) ? await needPayments().wallet(p) : null,
      info: payments?.info() ?? { enabled: false },
    });
  });
  app.post("/api/wallet", async (c) => c.json({ wallet: await needPayments().wallet(me(c)) }, 201));
  app.post("/api/wallet/top-up", async (c) =>
    c.json({ wallet: await needPayments().topUp(me(c)) }),
  );
  app.post("/api/businesses/:id/payments/activate", async (c) =>
    c.json(await needPayments().activate(me(c), c.req.param("id"), await body(c)), 201),
  );
  app.get("/api/businesses/:id/money", async (c) =>
    c.json(await needPayments().money(me(c), c.req.param("id"))),
  );
  app.post("/api/businesses/:id/withdraw", async (c) => {
    const { cents } = await body<{ cents?: number }>(c);
    return c.json(await needPayments().withdraw(me(c), c.req.param("id"), Number(cents)));
  });
  app.post("/api/payments/:id/deliver", async (c) =>
    c.json(await needPayments().deliver(me(c), c.req.param("id"))),
  );
  app.post("/api/public/sessions/:id/pay", async (c) => {
    const { source } = await body<{ source?: string }>(c);
    return c.json(
      await needPayments().payAndBook(me(c), c.req.param("id"), String(source ?? "unknown")),
      201,
    );
  });
  app.get("/api/payments/:id", (c) => c.json(needPayments().receipt(me(c), c.req.param("id"))));
  app.post("/api/payments/:id/reconcile", async (c) =>
    c.json(await needPayments().reconcile(me(c), c.req.param("id"))),
  );
  app.post("/api/payments/:id/retry", async (c) =>
    c.json(await needPayments().retry(me(c), c.req.param("id"))),
  );

  // ---------- books and value (owner only) ----------

  app.get("/api/businesses/:id/books", async (c) => {
    const p = me(c);
    const id = c.req.param("id");
    const epoch = store.controlEpoch(p, id); // owner check before reading
    const n = Math.min(24, Math.max(1, Math.round(Number(c.req.query("months") ?? 12)) || 12));
    const [ledger, now] = await Promise.all([books.months(id, n), books.now(id)]);
    // Checked again after the reads: a sale (or a sale and return) while they ran returns nothing.
    store.stillControls(p, epoch);
    const costs = books.costs(p, id);
    return c.json({
      ...ledger,
      ...costs,
      now,
      spend: books.spend(id, n),
      basis: BOOKS_BASIS,
      period_months: n,
    });
  });
  app.post("/api/businesses/:id/costs", async (c) =>
    c.json(books.addCost(me(c), c.req.param("id"), await body(c)), 201),
  );
  app.delete("/api/businesses/:id/costs/:costId", (c) =>
    c.json(
      books.endCost(me(c), c.req.param("id"), c.req.param("costId"), c.req.query("note") ?? ""),
    ),
  );

  app.get("/api/businesses/:id/value", async (c) => {
    const p = me(c);
    const id = c.req.param("id");
    const epoch = store.controlEpoch(p, id);
    const { months, chain_error } = await books.months(id, 12);
    store.stillControls(p, epoch); // still in control after the read, before anything is written
    const estimate = await valuation.current(id, months);
    store.stillControls(p, epoch);
    return c.json({
      estimate,
      settings: valuation.settings(id),
      what_changed: valuation.whatChanged(id),
      history: valuation.history(id),
      scenarios: valuation.scenarios(p, id),
      months,
      chain_error,
    });
  });
  app.patch("/api/businesses/:id/value/settings", async (c) =>
    c.json(valuation.updateSettings(me(c), c.req.param("id"), await body(c))),
  );
  app.post("/api/businesses/:id/value/try", async (c) =>
    c.json(await valuation.scenario(me(c), c.req.param("id"), await body<Overrides>(c))),
  );
  app.post("/api/businesses/:id/value/scenarios", async (c) => {
    const { name, overrides } = await body<{ name?: string; overrides?: Overrides }>(c);
    return c.json(
      {
        scenarios: await valuation.saveScenario(
          me(c),
          c.req.param("id"),
          String(name ?? ""),
          overrides ?? {},
        ),
      },
      201,
    );
  });

  // ---------- team: one scoped delegation, enforced by the business's contract ----------

  app.get("/api/businesses/:id/team", (c) =>
    c.json({ team: needPayments().team(me(c), c.req.param("id")) }),
  );
  app.post("/api/businesses/:id/team", async (c) => {
    const { person_id } = await body<{ person_id?: string }>(c);
    return c.json(
      { team: await needPayments().addHelper(me(c), c.req.param("id"), String(person_id ?? "")) },
      201,
    );
  });
  app.delete("/api/businesses/:id/team/:personId", async (c) =>
    c.json({
      team: await needPayments().removeHelper(me(c), c.req.param("id"), c.req.param("personId")),
    }),
  );
  // ---------- acquisitions: buying profiles, the seller's listing, search, rooms ----------

  app.get("/api/acquire/meta", (c) => c.json(acquire.meta()));
  app.post("/api/acquire/interpret", async (c) => {
    const { text } = await body<{ text?: string }>(c);
    return c.json({ criteria: interpretAcquire(String(text ?? "")) });
  });
  app.post("/api/acquire/search", async (c) => {
    const b = await body<{
      criteria?: Criteria;
      buyer_id?: string;
      mandate_id?: string;
      sort?: string;
    }>(c);
    const viewer = c.get("person");
    return c.json(
      await acquire.search(viewer, b.criteria ?? {}, {
        buyerId: viewer ? b.buyer_id : undefined,
        mandateId: b.mandate_id,
        sort: b.sort,
      }),
    );
  });
  app.get("/api/acquire/listings/:id", async (c) => {
    const viewer = c.get("person");
    return c.json(
      await acquire.candidate(
        viewer,
        c.req.param("id"),
        viewer ? c.req.query("buyer_id") : undefined,
      ),
    );
  });
  app.get("/api/acquire/buyers", (c) => c.json({ buyers: acquire.myBuyers(me(c)) }));
  app.post("/api/acquire/buyers", async (c) =>
    c.json(await acquire.createBuyer(me(c), await body(c)), 201),
  );
  app.get("/api/acquire/buyers/:id", async (c) =>
    c.json(await acquire.workspace(me(c), c.req.param("id"))),
  );
  app.patch("/api/acquire/buyers/:id", async (c) =>
    c.json(await acquire.updateBuyer(me(c), c.req.param("id"), await body(c))),
  );
  app.post("/api/acquire/buyers/:id/members", async (c) => {
    const { person_id, role } = await body<{ person_id?: string; role?: string }>(c);
    return c.json(
      await acquire.addMember(
        me(c),
        c.req.param("id"),
        String(person_id ?? ""),
        role as "research",
      ),
    );
  });
  app.delete("/api/acquire/buyers/:id/members/:personId", async (c) =>
    c.json(await acquire.removeMember(me(c), c.req.param("id"), c.req.param("personId"))),
  );
  app.post("/api/acquire/buyers/:id/mandates", async (c) =>
    c.json(await acquire.saveMandate(me(c), c.req.param("id"), await body(c))),
  );
  app.delete("/api/acquire/buyers/:id/mandates/:mandateId", async (c) =>
    c.json(await acquire.deleteMandate(me(c), c.req.param("id"), c.req.param("mandateId"))),
  );
  app.post("/api/acquire/buyers/:id/shortlist", async (c) => {
    const { listing_id, on } = await body<{ listing_id?: string; on?: boolean }>(c);
    return c.json(
      await acquire.setShortlist(me(c), c.req.param("id"), String(listing_id ?? ""), on !== false),
    );
  });
  app.get("/api/acquire/buyers/:id/compare", async (c) =>
    c.json(
      await acquire.compare(
        me(c),
        c.req.param("id"),
        (c.req.query("ids") ?? "").split(",").filter(Boolean),
      ),
    ),
  );
  app.post("/api/acquire/listings/:id/requests", async (c) => {
    const b = await body<{
      buyer_id?: string;
      categories?: string[];
      purpose?: string;
      days?: number;
    }>(c);
    return c.json(
      { request: acquire.requestAccess(me(c), String(b.buyer_id ?? ""), c.req.param("id"), b) },
      201,
    );
  });
  app.post("/api/acquire/requests/:id/withdraw", (c) =>
    c.json({ request: acquire.withdraw(me(c), c.req.param("id")) }),
  );
  app.post("/api/acquire/requests/:id/decide", async (c) =>
    c.json({ request: acquire.decide(me(c), c.req.param("id"), await body(c)) }),
  );
  app.post("/api/acquire/requests/:id/revoke", (c) =>
    c.json({ request: acquire.revoke(me(c), c.req.param("id")) }),
  );
  app.get("/api/acquire/rooms/:id", async (c) =>
    c.json(await acquire.room(me(c), c.req.param("id"))),
  );
  app.get("/api/acquire/rooms/:id/export", async (c) => {
    const snapshot = await acquire.exportRoom(me(c), c.req.param("id"));
    c.header(
      "content-disposition",
      `attachment; filename="evidence-${c.req.param("id").slice(0, 8)}.json"`,
    );
    return c.json(snapshot);
  });
  app.post("/api/acquire/rooms/:id/try", async (c) => {
    const { overrides } = await body<{ overrides?: Overrides }>(c);
    return c.json(await acquire.tryScenario(me(c), c.req.param("id"), overrides ?? {}));
  });
  app.post("/api/acquire/rooms/:id/scenarios", async (c) => {
    const { name, overrides } = await body<{ name?: string; overrides?: Overrides }>(c);
    return c.json({
      scenarios: await acquire.saveScenario(
        me(c),
        c.req.param("id"),
        String(name ?? ""),
        overrides ?? {},
      ),
    });
  });
  app.get("/api/businesses/:id/listing", async (c) =>
    c.json(await acquire.listing(me(c), c.req.param("id"))),
  );
  app.patch("/api/businesses/:id/listing", async (c) =>
    c.json(await acquire.updateListing(me(c), c.req.param("id"), await body(c))),
  );
  app.get("/api/businesses/:id/listing/summary", (c) =>
    c.json(acquire.summary(me(c), c.req.param("id"))),
  );

  // ---------- deals: exact terms, both acceptances on NEAR, the handover ----------

  app.get("/api/deals", (c) => c.json({ deals: deals?.mine(me(c)) ?? [] }));
  app.post("/api/businesses/:id/deals", async (c) =>
    c.json(await needDeals().propose(me(c), c.req.param("id"), await body(c)), 201),
  );
  app.get("/api/businesses/:id/deals/snapshot", async (c) =>
    c.json(
      await needDeals().snapshotPreview(
        me(c),
        c.req.param("id"),
        String(c.req.query("buyer_id") ?? ""),
      ),
    ),
  );
  app.get("/api/deals/:id", async (c) => c.json(await needDeals().view(me(c), c.req.param("id"))));
  app.post("/api/deals/:id/revise", async (c) =>
    c.json(await needDeals().revise(me(c), c.req.param("id"), await body(c))),
  );
  app.post("/api/deals/:id/fund", async (c) =>
    c.json(await needDeals().fund(me(c), c.req.param("id"))),
  );
  app.post("/api/deals/:id/test-dollars", async (c) =>
    c.json(await needDeals().testDollars(me(c), c.req.param("id"))),
  );
  app.post("/api/deals/:id/withdraw-hold", async (c) =>
    c.json(await needDeals().withdrawHold(me(c), c.req.param("id"))),
  );
  app.post("/api/deals/:id/accept", async (c) => {
    const { digest } = await body<{ digest?: string }>(c);
    return c.json(await needDeals().accept(me(c), c.req.param("id"), String(digest ?? "")));
  });
  app.post("/api/deals/:id/cancel", async (c) =>
    c.json(await needDeals().cancel(me(c), c.req.param("id"))),
  );
  app.post("/api/deals/:id/claim", async (c) =>
    c.json(await needDeals().claim(me(c), c.req.param("id"))),
  );
  app.post("/api/deals/:id/former-owner-check", async (c) =>
    c.json(await needDeals().formerOwnerCheck(me(c), c.req.param("id"))),
  );
  app.post("/api/deals/:id/items/:key", async (c) => {
    const { note } = await body<{ note?: string }>(c);
    return c.json(
      await needDeals().markItem(me(c), c.req.param("id"), c.req.param("key"), String(note ?? "")),
    );
  });

  app.get("/api/helping", (c) => c.json({ businesses: payments?.helping(me(c)) ?? [] }));
  app.get("/api/helping/:id", async (c) =>
    c.json(await needPayments().helperDesk(me(c), c.req.param("id"))),
  );
  app.post("/api/helping/:id/inquiries/:inquiryId/reply", async (c) => {
    const p = me(c);
    const id = c.req.param("id");
    const check = await needPayments().helperCheck(p, id, "support");
    if (!check.authorized)
      throw new HttpError(
        403,
        `The business's contract says you can't answer for it: ${check.reason}`,
      );
    const { text } = await body<{ text?: string }>(c);
    store.replyAsHelper(p, c.req.param("inquiryId"), id, String(text ?? ""));
    return c.json(await needPayments().helperDesk(p, id));
  });

  // ---------- my activity ----------

  app.get("/api/activity", async (c) => {
    const p = me(c);
    return c.json({
      bookings: bookings
        ? (await bookings.myBookings(p)).map((b) => ({
            ...b,
            payment: payments?.forBooking(b.id) ?? null,
          }))
        : [],
      wallet: payments?.existingWallet(p) ?? null,
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

  // ---------- opportunities: requests into private product projects (job 005a) ----------

  app.get("/api/opportunities", (c) => c.json(opportunities.list(c.get("person"))));
  app.get("/api/opportunities/:id", (c) =>
    c.json(opportunities.one(c.get("person"), c.req.param("id"))),
  );
  app.post("/api/opportunities/:id/projects", async (c) => {
    const r = opportunities.createProject(me(c), c.req.param("id"), await body(c));
    return c.json(r, r.created ? 201 : 200);
  });
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
