// Everstreet's HTTP API. Sessions are a cookie; every workspace route resolves the person from
// it and the store checks ownership. Public routes read only published projections.

import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { Acquisitions, type Criteria, interpretAcquire } from "./acquire.ts";
import { AppChecks } from "./appChecks.ts";
import { AppVersions } from "./appVersions.ts";
import { Authoring } from "./authoring.ts";
import { type BookingProvider, Bookings } from "./bookings.ts";
import { BOOKS_BASIS, Books } from "./books.ts";
import type { BuildProvider } from "./build.ts";
import { Builds, proposalBudget } from "./builds.ts";
import type { Chain } from "./chain.ts";
import { Community, type Constraints, interpret } from "./community.ts";
import { customerAccess } from "./customerAccess.ts";
import { CustomerPurchases } from "./customerPurchase.ts";
import { type CustomerUseOptions, CustomerUses } from "./customerUse.ts";
import { HANDOVER_REFUSAL } from "./db.ts";
import { Deals } from "./deals.ts";
import { digitalDesk } from "./digitalDesk.ts";
import { Evaluations } from "./evaluations.ts";
import { StoppedError } from "./fence.ts";
import type { AccountSignIn } from "./identity.ts";
import { type ImportInspector, Imports } from "./imports.ts";
import { ManagedRuntime } from "./invocations.ts";
import { customerOperations } from "./operations.ts";
import { Opportunities } from "./opportunities.ts";
import { Payments } from "./payments.ts";
import { Products } from "./products.ts";
import { Publications } from "./publication.ts";
import { Releases } from "./releases.ts";
import { SaleActions } from "./saleActions.ts";
import { HttpError, type Person, type Store } from "./store.ts";
import { V3Intents } from "./v3intents.ts";
import { V3Observations, type V3Options } from "./v3observe.ts";
import { type Overrides, Valuation } from "./value.ts";
import type { WriterHistory } from "./writerHistory.ts";

const COOKIE = "es_session";
/** Job 003w-b: binds a sign-in challenge to the browser that asked for it. */
const SIGN_IN_COOKIE = "es_sign_in";

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
  /**
   * Job 003wf3: whether a managed Gated close is possible for a business now (the coordinator's
   * capability). Unset: never, so a Gated acceptance that would start closing is refused.
   */
  handover?: (businessId: string) => Promise<{ ready: boolean; reason: string | null }>;
  /**
   * Job 003wf slice 3 (WRITER_HISTORY.md): the operators' view of unresolved writer attempts.
   * Verified identity only; unset (or not an operator): the routes answer 404.
   */
  writerHistory?: WriterHistory;
  /** Job 002e: web app logic checks; tests and previews pass their own to share with a worker. */
  appChecks?: AppChecks;
  /**
   * Job 002e: where previews are served from (a different site from the platform, e.g.
   * http://localhost:PORT when the platform is opened at http://127.0.0.1:PORT) and the platform's
   * own origin (for frame-ancestors). Without both, preview answers unavailable.
   */
  previewOrigin?: string;
  platformOrigin?: string;
  /**
   * Job 003w-b: who may sign in. Preview (the default): name-only join and, with localPreview,
   * fictional actor switching; sessions are preview sessions. Verified: only a NEP-413-proven
   * account signs in; sessions expire on the server and preview sessions never authenticate.
   */
  identity?: { mode: "preview" } | { mode: "verified"; signIn: AccountSignIn };
  /**
   * Job 003w-e1: what the browser's wallet controller may use (verified identity only). `harness`
   * names the review harness's synthetic wallet module; null in every real composition.
   */
  wallet?: { network: "testnet"; available: boolean; harness: string | null } | null;
}

export function everstreetApi(store: Store, options: AppOptions) {
  const identity = options.identity ?? { mode: "preview" as const };
  // Fictional actor switching can never sit beside verified identity.
  if (identity.mode === "verified" && options.localPreview)
    throw new Error("app options: verified identity can't run with localPreview");
  const clock = identity.mode === "verified" ? identity.signIn.now : Date.now;
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
  const purchases = new CustomerPurchases(store.db, options.customer?.reader ?? null);
  // Job 003wf2: a Direct sale through each participant's own wallet (read and verify only).
  const sales = new SaleActions(store.db, store, v3, v3Intents, options.customer?.reader ?? null, {
    platformOperator: options.customer?.operatorAccount ?? null,
    handover: options.handover,
    serviceReadiness: (id, control) => customerUses.serviceReadiness(id, control),
    // Job 003wf4: the same serve policy as offers and customers, at every read.
    planUsability: (plan) => customerUses.planUsability(plan),
  });
  const publications = new Publications(store.db, store);
  const evaluations = new Evaluations(store.db, store, runtime);
  const releases = new Releases(store.db, store, runtime, evaluations);
  const books = new Books(store.db, store, options.chain ?? null);
  const valuation = new Valuation(store.db, store, books);
  const acquire = new Acquisitions(store.db, store, books, valuation, options.chain ?? null);
  const deals = payments
    ? new Deals(store.db, store, payments, acquire, options.chain ?? null)
    : null;
  // Job 002e: web app versions, isolated logic checks and preview capabilities.
  const appChecks = options.appChecks ?? new AppChecks(store.db, store);
  const appVersions =
    options.previewOrigin && options.platformOrigin
      ? new AppVersions(store, appChecks, {
          previewOrigin: options.previewOrigin,
          platformOrigin: options.platformOrigin,
          now: () => appChecks.now(),
        })
      : null;
  const versionsOrRead = () =>
    appVersions ?? new AppVersions(store, appChecks, { previewOrigin: "", platformOrigin: "" });
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
    // Job 003wf3: a database backstop refused new work for a business that is changing hands.
    if (
      !(error instanceof HttpError) &&
      String((error as Error)?.message).includes(HANDOVER_REFUSAL)
    )
      return c.json(
        {
          error: "This business is closing; changes are paused until the contract decides.",
          code: "handover_in_progress",
        },
        409,
      );
    if (error instanceof HttpError)
      return c.json(
        {
          error: error.message,
          ...(error.code ? { code: error.code } : {}),
          ...(error.detail ? { detail: error.detail } : {}),
        },
        error.status,
      );
    console.error(error);
    return c.json({ error: "Something went wrong on our side" }, 500);
  });

  app.use("*", async (c, next) => {
    c.set("person", store.personForToken(getCookie(c, COOKIE), identity.mode, clock()));
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
  /**
   * Job 003wf3 (MANAGED_HANDOVER.md §14.2): a synchronous owner write for `businessId`, with the
   * handover gate checked inside the SAME write transaction (store.tx is reentrant, so the
   * service's own statements join it).
   */
  const ownerWrite = <T>(businessId: string, fn: () => T): T =>
    store.tx(() => {
      store.requireNoHandover(businessId);
      return fn();
    });
  /** Job 003wf3: a legacy (v2) route is refused at entry while its business is changing hands. */
  const notDuringHandover = (businessId: string) => store.requireNoHandover(businessId);
  const body = async <T>(c: { req: { json: () => Promise<unknown> } }) =>
    ((await c.req.json().catch(() => ({}))) ?? {}) as T;
  const startSession = (
    c: Parameters<typeof setCookie>[0],
    token: string,
    maxAgeS = 60 * 60 * 24 * 90,
  ) =>
    setCookie(c, COOKIE, token, {
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
      maxAge: maxAgeS,
    });

  app.get("/api/env", (c) =>
    c.json({
      environment: options.environment,
      localPreview: options.localPreview,
      identity: identity.mode,
      wallet: identity.mode === "verified" ? (options.wallet ?? null) : null,
    }),
  );

  // ---------- account ----------

  // Job 003w-e1: a verified session also names the account it proved, so the browser can tell a
  // wallet's account from the session's and fence the other one's state.
  app.get("/api/me", (c) =>
    c.json({
      person: c.get("person"),
      account:
        identity.mode === "verified" && c.get("person")
          ? store.sessionAccount(getCookie(c, COOKIE))
          : null,
    }),
  );

  // ---------- job 003wf slice 3: unresolved writer history (configured operators only) ----------
  const operatorAccount = (c: Parameters<typeof getCookie>[0]) =>
    identity.mode === "verified" && options.writerHistory
      ? store.sessionAccount(getCookie(c, COOKIE))
      : null;
  app.get("/api/operator/writer-history", (c) => {
    if (!options.writerHistory) throw new HttpError(404, "Not found");
    me(c);
    return c.json(options.writerHistory.list(operatorAccount(c)));
  });
  app.post("/api/operator/writer-history/check", async (c) => {
    if (!options.writerHistory) throw new HttpError(404, "Not found");
    const person = me(c);
    return c.json(await options.writerHistory.check(operatorAccount(c), person.id, await body(c)));
  });

  app.post("/api/session", async (c) => {
    // 003w-b: a name alone is never an identity outside preview.
    if (identity.mode === "verified")
      throw new HttpError(403, "Sign in with your NEAR account", "verified_sign_in_required");
    const { name } = await body<{ name?: string }>(c);
    const { person, token } = store.createPerson(String(name ?? ""));
    startSession(c, token);
    return c.json({ person }, 201);
  });

  app.delete("/api/session", (c) => {
    const token = getCookie(c, COOKIE);
    if (token) store.endSession(token);
    deleteCookie(c, COOKIE, { path: "/" });
    // Job 003w-e1 (Astra's logout review): a sign-in this browser still has in progress is
    // cancelled too, so its verification, even one already awaiting the key read, starts nothing.
    if (identity.mode === "verified") {
      identity.signIn.cancel(getCookie(c, SIGN_IN_COOKIE));
      deleteCookie(c, SIGN_IN_COOKIE, { path: "/api/session" });
    }
    return c.json({ person: null });
  });

  // 003w-b: verified sign-in (NEP-413 challenge, then a signed answer). Absent in preview.
  app.post("/api/session/challenge", (c) => {
    if (identity.mode !== "verified") throw new HttpError(404, "Not available");
    // Job 003w-e1: a newer attempt from this browser replaces its earlier one (Astra's review).
    identity.signIn.cancel(getCookie(c, SIGN_IN_COOKIE));
    const { binding, challenge } = identity.signIn.challenge();
    setCookie(c, SIGN_IN_COOKIE, binding, {
      httpOnly: true,
      sameSite: "Lax",
      path: "/api/session",
      maxAge: Math.ceil(identity.signIn.challengeTtl / 1000),
    });
    return c.json({ challenge });
  });
  // Job 003w-e1: cancels this browser's sign-in still in progress (a wallet-side change), keeping
  // the current session. Only the attempt the binding cookie names; never another session.
  app.delete("/api/session/challenge", (c) => {
    if (identity.mode !== "verified") throw new HttpError(404, "Not available");
    identity.signIn.cancel(getCookie(c, SIGN_IN_COOKIE));
    deleteCookie(c, SIGN_IN_COOKIE, { path: "/api/session" });
    return c.json({ cancelled: true });
  });
  app.post("/api/session/verify", async (c) => {
    if (identity.mode !== "verified") throw new HttpError(404, "Not available");
    const out = await identity.signIn.verify(await body(c), getCookie(c, SIGN_IN_COOKIE));
    deleteCookie(c, SIGN_IN_COOKIE, { path: "/api/session" });
    // Job 003w-e1: signing in (perhaps as another account) replaces the session this browser
    // presented; the old one ends on the server rather than lingering behind a replaced cookie.
    const previous = getCookie(c, COOKIE);
    if (previous) store.endSession(previous);
    startSession(c, out.token, Math.floor(identity.signIn.sessionTtlMs / 1000));
    return c.json({ person: out.person, expires_at: new Date(out.expiresMs).toISOString() }, 201);
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
  // Job 003s: a participant's own handover receipts (seller or buyer), minimal and bounded.
  app.get("/api/me/v3/handovers", (c) => c.json(v3Intents.mine(me(c))));
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
  // Job 003r: the owner's readiness summary (local facts only) and the bounded plan inspector.
  app.get("/api/businesses/:id/customer-offer-readiness", (c) =>
    c.json(
      customerUses.offerReadiness(me(c), c.req.param("id"), c.req.query("project") || undefined),
    ),
  );
  // Job 003wf4 (OWNER_PLAN_SETUP.md §8): the three steps of "Set up customer access".
  app.get("/api/businesses/:id/customer-access", async (c) =>
    c.json(
      await customerAccess(
        sales,
        customerUses,
        me(c),
        c.req.param("id"),
        c.req.query("project") || undefined,
      ),
    ),
  );
  app.post("/api/businesses/:id/customer-offer-inspections", async (c) =>
    c.json(await customerUses.inspectOffer(me(c), c.req.param("id"), await body(c))),
  );
  // Job 003web (§10): a fresh customer's purchase: the prerequisite picture with an exact preview,
  // the durable reviewed intent, the wallet-asked mark, the bounded check and an explicit set-aside.
  app.get("/api/customer/offers/:offer/purchase-setup", async (c) => {
    const units = c.req.query("units");
    const install = c.req.query("install");
    let parsed: unknown = null;
    if (install) {
      try {
        parsed = JSON.parse(install);
      } catch {
        throw new HttpError(400, "install must be JSON");
      }
    }
    return c.json(
      await purchases.setup(me(c), c.req.param("offer"), {
        units: units === undefined ? undefined : Number(units),
        install: parsed as never,
      }),
    );
  });
  app.post("/api/customer/offers/:offer/purchases", async (c) => {
    const r = await purchases.create(me(c), c.req.param("offer"), await body(c));
    return c.json(r, r.created ? 201 : 200);
  });
  app.get("/api/customer/purchases", (c) =>
    c.json(purchases.list(me(c), c.req.query("offer") || undefined)),
  );
  app.post("/api/customer/purchases/:id/requested", async (c) =>
    c.json(purchases.requested(me(c), c.req.param("id"), await body(c))),
  );
  app.post("/api/customer/purchases/:id/check", async (c) =>
    c.json(await purchases.check(me(c), c.req.param("id"), await body(c))),
  );
  app.post("/api/customer/purchases/:id/abandon", async (c) =>
    c.json(purchases.abandon(me(c), c.req.param("id"))),
  );
  // Job 003wf2 (docs/design/DIRECT_SALE.md): the participant's picture at one final block, an
  // exact preview, the durable reviewed request, the wallet-asked mark, the bounded check by the
  // request's own transaction, and an explicit set-aside of a request never asked for.
  app.get("/api/me/sales", (c) => c.json(sales.mine(me(c))));
  app.get("/api/sales/:business", async (c) =>
    c.json(await sales.setup(me(c), c.req.param("business"))),
  );
  app.post("/api/sales/:business/prepare", async (c) => {
    const b = (await body(c)) as Record<string, unknown>;
    return c.json(
      await sales.prepare(
        me(c),
        c.req.param("business"),
        b.kind,
        (b.input as Record<string, unknown>) ?? {},
      ),
    );
  });
  app.post("/api/sales/:business/actions", async (c) => {
    const r = await sales.create(me(c), c.req.param("business"), await body(c));
    return c.json(r, r.created ? 201 : 200);
  });
  app.post("/api/sales/actions/:id/requested", async (c) =>
    c.json(sales.requested(me(c), c.req.param("id"), await body(c))),
  );
  app.post("/api/sales/actions/:id/check", async (c) =>
    c.json(await sales.check(me(c), c.req.param("id"), await body(c))),
  );
  app.post("/api/sales/actions/:id/abandon", async (c) =>
    c.json(sales.abandon(me(c), c.req.param("id"))),
  );
  // Job 003w-e2: a fresh readback of the caller's own key slots for an offer (device readiness).
  app.get("/api/customer/offers/:offer/keys", async (c) =>
    c.json(await customerUses.deviceKeys(me(c), c.req.param("offer"))),
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
  // Job 003q: public product offers (published businesses only) and the customer's own list.
  app.get("/api/public/businesses/:slug/customer-offers", (c) =>
    c.json(customerUses.publicOffers(c.req.param("slug"))),
  );
  app.get("/api/public/customer-offers/:offer", (c) =>
    c.json(customerUses.publicOffer(c.req.param("offer"))),
  );
  app.get("/api/customer/requests/by-key/:key", (c) =>
    c.json(customerUses.byKey(me(c), c.req.param("key"))),
  );
  app.get("/api/customer/uses", (c) =>
    c.json(customerUses.listUses(me(c), Number(c.req.query("limit") ?? 20))),
  );
  // Job 003o: the unit's settlement or release, decided only from contract readback.
  app.post("/api/customer/uses/:id/units/reconcile", async (c) =>
    c.json(await customerUses.reconcileUnit(me(c), c.req.param("id"))),
  );
  app.post("/api/customer/uses/:id/release", async (c) =>
    c.json(await customerUses.releaseUnit(me(c), c.req.param("id"))),
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

  // Job 002e: web app versions, isolated logic checks and previews (owner only; 404 otherwise).
  app.get("/api/product-projects/:id/app-versions", (c) =>
    c.json({
      ...versionsOrRead().list(me(c).id, c.req.param("id")),
      checks: appChecks.list(me(c).id, c.req.param("id")),
      preview_available: appVersions !== null,
    }),
  );
  app.get("/api/product-projects/:id/app-versions/:job", (c) =>
    c.json({ bundle: versionsOrRead().files(me(c).id, c.req.param("id"), c.req.param("job")) }),
  );
  app.post("/api/product-projects/:id/app-versions/:job/current", async (c) => {
    const b = await body<{ note?: unknown }>(c);
    return c.json(
      versionsOrRead().setCurrent(me(c).id, c.req.param("id"), c.req.param("job"), b.note),
    );
  });
  app.post("/api/product-projects/:id/app-versions/:job/checks", async (c) => {
    const b = await body<{ idempotency_key?: unknown }>(c);
    const { check, created } = appChecks.request(
      me(c).id,
      c.req.param("id"),
      c.req.param("job"),
      b.idempotency_key,
    );
    return c.json({ check }, created ? 201 : 200);
  });
  app.post("/api/app-checks/:id/cancel", (c) =>
    c.json({ check: appChecks.cancel(me(c).id, c.req.param("id")) }),
  );
  app.post("/api/product-projects/:id/app-versions/:job/preview", async (c) => {
    if (!appVersions)
      throw new HttpError(
        409,
        "Preview isn't available here: no separate preview origin is configured.",
      );
    const b = await body<{ unchecked?: unknown }>(c);
    return c.json(
      appVersions.issuePreview(me(c).id, c.req.param("id"), c.req.param("job"), b.unchecked),
      201,
    );
  });
  // Served by capability token alone: no cookie is read for authority and none is set.
  app.get("/preview/app/:token/*", (c) => {
    if (!appVersions) return c.text("Not found", 404);
    const token = c.req.param("token");
    const path = decodeURIComponent(c.req.path.slice(`/preview/app/${token}/`.length));
    const r = appVersions.serve(token, path);
    return new Response(r.body, { status: r.status, headers: r.headers });
  });
  app.get("/api/businesses/:id/build-budget", (c) =>
    c.json(builds.budget(me(c), c.req.param("id"))),
  );
  app.put("/api/businesses/:id/build-budget", async (c) => {
    const b = await body(c);
    return c.json(
      ownerWrite(c.req.param("id"), () => builds.setBudget(me(c), c.req.param("id"), b as never)),
    );
  });

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
    // A stop ending the loop (StoppedError) is not a failure; the next process recovers it.
    done.catch((e) => {
      if (!(e instanceof StoppedError))
        console.error("evaluation run failed", (e as Error).message);
    });
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
  app.put("/api/businesses/:id/runtime-budget", async (c) => {
    const b = await body(c);
    return c.json(
      ownerWrite(c.req.param("id"), () => runtime.setBudget(me(c), c.req.param("id"), b as never)),
    );
  });

  // ---------- the founder's business ----------

  app.get("/api/businesses/:id", (c) => c.json(store.business(me(c), c.req.param("id"))));
  app.patch("/api/businesses/:id", async (c) => {
    const b = await body(c);
    return c.json(
      ownerWrite(c.req.param("id"), () =>
        store.updateBusiness(me(c), c.req.param("id"), b as never),
      ),
    );
  });
  app.patch("/api/businesses/:id/offer", async (c) => {
    const b = await body(c);
    return c.json(
      ownerWrite(c.req.param("id"), () => store.editOffer(me(c), c.req.param("id"), b as never)),
    );
  });
  app.patch("/api/businesses/:id/idea", async (c) => {
    const b = await body(c);
    return c.json(
      ownerWrite(c.req.param("id"), () => store.editIdea(me(c), c.req.param("id"), b as never)),
    );
  });
  app.post("/api/businesses/:id/publish", (c) =>
    c.json(ownerWrite(c.req.param("id"), () => store.publish(me(c), c.req.param("id")))),
  );
  // Job 001d: the digital public profile (owner only): draft, exact preview, reviewed publish.
  app.get("/api/businesses/:id/public-profile", (c) =>
    c.json(publications.view(me(c), c.req.param("id"))),
  );
  app.put("/api/businesses/:id/public-profile/draft", async (c) =>
    c.json(publications.saveDraft(me(c), c.req.param("id"), await body(c))),
  );
  app.post("/api/businesses/:id/public-profile/publish", async (c) =>
    c.json(publications.publish(me(c), c.req.param("id"), await body(c))),
  );
  app.post("/api/businesses/:id/unpublish", (c) =>
    c.json(ownerWrite(c.req.param("id"), () => store.unpublish(me(c), c.req.param("id")))),
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
  app.post("/api/businesses/:id/sessions", async (c) => {
    notDuringHandover(c.req.param("id"));
    return c.json(
      { sessions: await needBookings().openSession(me(c), c.req.param("id"), await body(c)) },
      201,
    );
  });
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
    // Job 003wf3 (§14.2): a read, so a business changing hands still shows its owner its books.
    store.stillControls(p, epoch, { handover: "allow" });
    const costs = books.costs(p, id);
    return c.json({
      ...ledger,
      ...costs,
      now,
      spend: books.spend(id, n),
      // Job 003t: owner-only digital operations, from this app's own customer and runtime records.
      // 003t1: read as of one instant; the worker's health qualifies any "automatic" claim.
      operations: customerOperations(
        store.db,
        id,
        n,
        new Date(),
        customerUses.operationsService(id),
      ),
      basis: BOOKS_BASIS,
      period_months: n,
    });
  });
  // Job 001c: the digital business desk, owner only, read only, as of one instant.
  app.get("/api/businesses/:id/digital-desk", (c) => {
    const p = me(c);
    const id = c.req.param("id");
    const epoch = store.controlEpoch(p, id);
    const view = digitalDesk(store.db, id, new Date(), customerUses.operationsService(id));
    store.stillControls(p, epoch, { handover: "allow" }); // job 003wf3: a read
    return c.json(view);
  });
  app.post("/api/businesses/:id/costs", async (c) => {
    const b = await body(c);
    return c.json(
      ownerWrite(c.req.param("id"), () => books.addCost(me(c), c.req.param("id"), b as never)),
      201,
    );
  });
  app.delete("/api/businesses/:id/costs/:costId", (c) =>
    c.json(
      ownerWrite(c.req.param("id"), () =>
        books.endCost(me(c), c.req.param("id"), c.req.param("costId"), c.req.query("note") ?? ""),
      ),
    ),
  );

  app.get("/api/businesses/:id/value", async (c) => {
    const p = me(c);
    const id = c.req.param("id");
    const epoch = store.controlEpoch(p, id);
    const { months, chain_error } = await books.months(id, 12);
    // Job 003wf3 (§14.2): a read (nothing is written), allowed while the business changes hands.
    store.stillControls(p, epoch, { handover: "allow" });
    const estimate = await valuation.current(id, months);
    store.stillControls(p, epoch, { handover: "allow" });
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
  app.patch("/api/businesses/:id/value/settings", async (c) => {
    const b = await body(c);
    return c.json(
      ownerWrite(c.req.param("id"), () =>
        valuation.updateSettings(me(c), c.req.param("id"), b as never),
      ),
    );
  });
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
    notDuringHandover(c.req.param("id"));
    return c.json(
      { team: await needPayments().addHelper(me(c), c.req.param("id"), String(person_id ?? "")) },
      201,
    );
  });
  app.delete("/api/businesses/:id/team/:personId", async (c) => {
    notDuringHandover(c.req.param("id"));
    return c.json({
      team: await needPayments().removeHelper(me(c), c.req.param("id"), c.req.param("personId")),
    });
  });
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
  app.patch("/api/businesses/:id/listing", async (c) => {
    const b = await body(c);
    // Its write is synchronous (inside the gated transaction); its answer is a read afterwards.
    return c.json(
      await ownerWrite(c.req.param("id"), () =>
        acquire.updateListing(me(c), c.req.param("id"), b as never),
      ),
    );
  });
  app.get("/api/businesses/:id/listing/summary", (c) =>
    c.json(acquire.summary(me(c), c.req.param("id"))),
  );

  // ---------- deals: exact terms, both acceptances on NEAR, the handover ----------

  app.get("/api/deals", (c) => c.json({ deals: deals?.mine(me(c)) ?? [] }));
  app.post("/api/businesses/:id/deals", async (c) => {
    notDuringHandover(c.req.param("id"));
    return c.json(await needDeals().propose(me(c), c.req.param("id"), await body(c)), 201);
  });
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
  // Job 005b: support confirmed now (Everstreet's record and the contract), fenced across the
  // check, and never over an existing answer.
  app.post("/api/helping/:id/inquiries/:inquiryId/reply", async (c) => {
    const { text } = await body<{ text?: string }>(c);
    return c.json(
      await needPayments().helperReply(
        me(c),
        c.req.param("id"),
        c.req.param("inquiryId"),
        String(text ?? ""),
      ),
    );
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
      {
        updates: ownerWrite(c.req.param("id"), () =>
          community.postUpdate(me(c), c.req.param("id"), String(text ?? "")),
        ),
      },
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
