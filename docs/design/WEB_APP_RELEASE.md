# Web app releases: free access and access passes (job 006a)

Plan step 5 (CLAUDE_RESUME.md). Job: [006a](../astra/jobs/2026-11-04_006a_web-app-customer-lifecycle.md).
It builds on 002e ([EXECUTABLE_PRODUCTS.md](EXECUTABLE_PRODUCTS.md)): immutable `web_app_bundle/1`
versions, isolated logic checks, and a sandboxed owner preview.

**Status words:** as in 002e. The isolated worker is **unverified** until its conformance suite
passes on an authorized host. So **real releases stay closed**, and the only way through is a
labelled stand-in (below).

## 1. What people can do

- **Founder.** Takes a checked version of the web app (e.g. a fictional print-shop quote
  calculator). They choose how customers get it:
  - **Free access:** anyone opens it at the app's address, with no account and no charge.
  - **An access pass:** a customer pays one unit of the offer's plan and gets N days of access.
    The unit is charged when access starts.

  They review the customer terms and release it on purpose. Later they can release an update, roll
  back to an earlier release, or withdraw the app. Each is an explicit action.
- **Customer, free:** opens the app from the business's public page, at a stable address.
- **Customer, pass:** opens the offer and authorizes one unit, like any Everstreet product. The
  pass starts and the unit is charged once access is delivered. They get a private address for the
  app, valid for N days.
- **After a sale:** the buyer runs releases, the seller can't, and customers keep the app's
  address and their passes.

**What the app is, said on every customer surface:**
- it runs only in your browser, and its results are calculated there;
- it has no backend, takes no payments, and keeps nothing for you;
- a pass grants access, not a service result.

## 2. One more product kind in the existing machinery

A released web app is a **runtime release** of the `app` build's `web_app_bundle` artifact,
checked kind **`web_app`**. It uses the same:
- activation, rollback, owner-epoch fences and handover gates (releases.ts);
- customer offers, units, holds, settlement and maintenance (customerUse.ts);
- sale continuity.

Nothing is a parallel system, and nothing about extraction, workflow or analysis releases changes.

- **Artifact.** `ManagedRuntime.artifact()` also reads succeeded `app` jobs. Their checked spec is
  `{digest, name, description}`. A spec of one kind is never read as another.
- **Readiness policy `web-app-release/1`.** A "check" of a web app version is not a model run. It
  is the version's latest **passed isolated logic check** (app_checks) for that exact digest,
  copied into an evaluation run. A version can be released only when:
  1. the check is for this digest, and passed;
  2. the check's engine is **not a test double**, unless stand-in releases are on (§5);
  3. the version was built under the current owner;
  4. the access terms are given and their digest was reviewed;
  5. no handover is open.

  A double's check is never presented as isolation.
- **Access terms** sit in a small immutable row beside the release (`app_release_terms`), written
  in the activation's transaction. Rollback copies the earlier release's terms. They hold:
  - access: `free` or `pass`;
  - pass days: 1 to 365;
  - the limitations text shown to customers: fixed by the platform, plus the founder's own words;
  - a terms digest.
- **Withdraw** (web apps only) retires the active release. No release is then active:
  - the free address says the business withdrew the app;
  - offers for it can't admit new passes;
  - passes already started keep their pinned release until they expire (§3).

## 3. Serving to customers: a separate sandboxed site

- **The app origin** is configured apart from the platform origin. Locally it is `localhost` while
  the platform is opened at `127.0.0.1`, as for preview. Customer documents are served there with
  the preview's sandbox:
  - CSP `sandbox allow-scripts`;
  - nothing but the bundle's own files;
  - `connect-src 'none'`, `form-action 'none'`, `nosniff`, no cookies.

  They are top-level documents (the customer opens the app itself), so `frame-ancestors 'none'`.
- **Free:** `GET <app origin>/a/<app_id>/index.html` serves the project's **active** release if
  its access is `free`.
  - `app_id` is a stable random id per project, made at its first release. The address survives
    updates, rollbacks and a sale.
  - **No active release:** a plain "withdrawn" or "not released" page. Nothing older is served.
- **Pass:** `GET <app origin>/p/<token>/index.html`.
  - The token is the customer's capability, 256 bits. Only its SHA-256 is stored, with the
    request, the person, the **pinned release and digest**, and the expiry.
  - **Pinning.** A pass serves the release it was bought on until it expires, whatever is
    activated, rolled back or withdrawn meanwhile. That is the agreed version, and its files are
    immutable.
  - **Expired:** the page says so.

## 4. The pass engine (the customer-use path)

`run()` for kind `web_app` is deterministic, with no model and zero usage.
- **Granted.** The request's terms say `pass`, and the release is the one the offer admits. The
  result is `{outcome: "granted", pass_days, starts_at, expires_at, release_id, digest, url}`. The
  URL carries the new token.
- **Kept privately.** The result is kept through the protection seam, so only the customer reads
  it, and the token's hash row is written in the **same transaction** that records delivery. A
  late or discarded result therefore leaves no working token.
- **Charged when access starts.** `granted` is fulfilled, so one unit is charged on delivery.
  Anything else is refused and never charged.
- **Not allowed:**
  - owner trials of a web app are refused (owners use the preview);
  - a free release can't have an offer (there is nothing to charge for).

## 5. Stand-in releases (labelled)

Real isolation evidence doesn't exist yet. So a release built on a test-double check is allowed
only when the composition sets `appReleases.standIn: true`.
- **Where it's allowed:** in tests and the local review harness, never with
  `environment: production`.
- **Labels:** every release view, offer, customer page and app page is marked "Stand-in release:
  its logic checks ran on a test double, not an isolated worker".
- **The check run** records the engine. If stand-in releases are turned off, such a release stops
  being current and can't serve.

## 6. Evidence planned

- API and composition tests:
  - create, check, release (free and pass), customer use (pass);
  - update, rollback, withdrawal;
  - restart, lost answers, wrong project or digest, current authority;
  - the test-double gate with stand-in on and off.
- The synthetic acquisition (the same reconciler as the main app) transfers a released app: the
  seller is refused, the buyer administers, and the customer's address, pass and pinned version
  persist.
- Browser, on the released customer routes:
  - working calculations, at phone width and by keyboard;
  - withdrawn, expired and unavailable states;
  - an update, and continuity after a sale.
- No public hosting, real engine or live chain is claimed.

## 7. As built (Nov 5, late)

- **Server.** `webApp.ts` (terms, pass engine, serving); tables in `db.ts` (`app_release_terms`,
  `web_apps`, `app_passes`, all immutable rows); `releases.ts` (`appTerms` review digest,
  activation writes terms in its transaction, rollback copies the earlier release's terms,
  `withdraw`); `evaluations.ts` (`web-app-release/1` run from the latest passed app check of the
  digest; a double's check only with stand-ins on; stale when they are turned off);
  `customerUse.ts` (pass offers only, retention at least the pass length, the token's hash written
  in the delivery transaction, free apps listed on the published page); routes `/a/:app/*`,
  `/p/:token/*`, `POST .../releases/app-terms` and `.../releases/withdraw` (both handover-gated).
- **Composition.** The app site is `origins.preview`; `appStandIn` is a `ComposeDeps` field for the
  review harness and tests only (never a config field). The capability inventory says "Released
  web apps: unavailable" unless both are set.
- **Web.** Studio web app view: "Release to customers" (access, days, own limitations, review the
  exact terms, release; withdraw; roll back). Customer page: pass offer summary, what the app is,
  stand-in label, "Open the app" until the pass ends. Public business page: "Open an app" for
  free releases.
- **Evidence.** `server/test/web-app-release.test.ts` (free lifecycle with update, rollback,
  withdrawal; reviewed terms; pass bought, pinned through an update and a withdrawal, expired;
  unchecked version; stand-in gate on and off across a restart; change of owner),
  `server/test/web-app-sale.test.ts` (passes through a Direct sale over the same reconciler),
  `web/test/webAppPass.test.tsx`. Harness: `npx tsx scripts/sale-harness.ts --product quote-app`.
- **Not covered.** A real isolated worker (stand-ins only); public hosting; the sale's terms
  document doesn't yet list the web app separately (it transfers as the business's product).
