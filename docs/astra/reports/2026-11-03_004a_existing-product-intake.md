# 004a report: bring an existing product (supplied-manifest intake)

Claude, 2026-11-03. Job: [004a](../jobs/2026-11-02_004a_existing-product-intake.md).

| Commit | What |
|---|---|
| `109fa40` | Server: `server/src/imports.ts`, schema in `db.ts`, routes in `app.ts`, `HttpError` gains 413, `server/test/imports.test.ts` |
| `f5b9fed` | UI: `web/src/importsApi.ts`, `web/src/pages/Import.tsx`, routes in `App.tsx`, Home path, desk section |
| this commit | This report and the JOBS row |

This is the first slice of M4, using only material the founder supplies. There are no remote
connectors, no access tokens, no cloned code and no execution. Nothing here verifies anything.

## What a founder sees

**Home.** "Bring a product" now leads to `/import`: "Inspect its package.json and see what handing
it over would take. Connecting accounts comes later." It used to point at the launch interview.

**`/import`** lists the founder's imported products with status counts. A new import needs:

- the business it belongs to: one they own, or a new private business they name;
- a product name, what it does in their words, and its kind (SaaS, API, AI tool, agent, website, online service, app on NEAR, or something else);
- optionally, a `package.json` file or its pasted text.

The page says exactly what is inspected. The request key is kept for retries and changes when the
form changes.

**`/import/:id`** is private and keyed by person and workspace. It has three keyboard tabs (arrow
keys move between them):

- **Overview.** Source facts from the latest inspection: package name, version, licence, Node engine, package manager, module type, the private flag, and declared package counts. It shows the shape guess, labelled a guess from package names, and "scripts present, not stored or run". If there is a repository field, it says the field isn't evidence of ownership. Detected framework and tooling chips carry "development only" where it applies. Below that: inspecting an updated manifest, inspection history (digest, bytes, inspector and version, author), and the product details, saved with optimistic versions.
- **Dependencies.** Eight items: source ownership, hosting, database, AI model provider, customer sign-in, payments, domain, and customer promises. Each shows its detected evidence separately from the founder's statement (used, with who controls the account; not used; or not said). It warns never to paste keys.
- **Readiness.** The headline is always "Not ready to transfer: nothing here is verified yet…". It shows counts (verified, detected, declared, unknown) and one next action. A table gives each item's evidence, how it moves to a new owner, its risk, who acts, and the next step. Earlier saved reports (one per inspection) can be opened unchanged.

**The business desk** gains an "Imported products" section, with "N of 8 transfer items not
verified" per product. It is owner-only. That is the acquisition-preparation reference: nothing
from an import appears on any public page, listing or search.

**Change of control.** The page resets its unsaved drafts when the business changes hands, using
the owner epoch. Stale loads and late writes can't overwrite a newer view: only the newest request
is applied.

## Underneath

**Inspector seam.**

- `ImportInspector { id, version, kind, inspect(input): Promise<facts> }` is asynchronous and provider-neutral.
- This slice's only implementation is `packageManifestInspector` (`package-json@1`). Later authorized repository or deployment providers plug in here.
- `AppOptions.importInspectors` is a test seam.

**Supported input:**

- One JSON object, the text of a file named exactly `package.json`, at most 64 KiB of UTF-8 (413 above that).
- Refused, each with an actionable message and nothing saved: any other file name; paths (`/`, `\`, `..`); NUL bytes; invalid JSON; non-objects; nesting deeper than 8; more than 4,000 keys; more than 300 packages per group or 600 in total.
- Keys named `__proto__`, `constructor` or `prototype` are refused anywhere.
- Explicit credential fields are refused, including `_authToken`, `_auth`, `password`, `token`, `apiKey`, `secret`, `privateKey` and `accessKey`.
- Values that look like secrets are refused: private-key blocks, GitHub, OpenAI/Anthropic-style, Stripe live, AWS, Slack, npm and Google key shapes. This is a best-effort screen, not a promise to catch every secret.
- URLs with a password, or with a user name other than `git`, are refused.

**Stored (normalized only):**

- package name (validated, lowercased), version, description, licence, the private flag, module type, Node engine and package manager;
- the number of scripts, and whether a repository field exists;
- dependencies as name, group and reference kind (`registry_range`, `tag`, `workspace`, `alias`, `git`, `url`, `file` or `other`);
- the range or tag text only for range, tag, workspace and alias references; git, URL and file references keep no text;
- invalid package names, as a count only.

Never stored, returned or logged: scripts, the raw file, repository or other URLs, and secret
values.

**Detection** matches about 55 package-name rules across framework, tooling, hosting, database,
model provider, authentication and payments (including NEAR libraries). It is a bounded heuristic,
labelled "Detected in manifest", with `dev_only` marked. The shape guess (web app, API service or
unknown) uses runtime (non-development) frameworks only.

**Schema** (`db.ts`, all STRICT):

| Table | Purpose |
|---|---|
| `import_workspaces` | Belongs to a business; product details; `version` for optimistic edits |
| `import_requests` | (person, key) → request hash and workspace |
| `import_inspections` | Inspector and version, input digest and bytes, normalized facts, per-workspace key. Immutable (UPDATE and DELETE triggers) |
| `import_reports` | One per inspection. Immutable |
| `import_dependencies` | Per category: uses, note, who, when, version |

Audit events (`import.created`, `import.inspected`, `import.edited`, `import.declared`) carry ids,
digests and counts only.

**Idempotency and versions:**

- Creation (with a new business, if asked) and its first inspection happen in one transaction.
- The same key with the same request returns the same workspace and creates no second business. The same key with a changed request gives 409.
- Inspections have their own keys: a replay gives 200, a different file under the same key gives 409.
- Stale product edits or item statements give 409 with nothing overwritten.
- `status`, `verified` and `detected` cannot be set by a statement (400).

**Access:**

- Every read and write requires the current owner of the business. Anyone else gets the same 404.
- Inspection takes the control epoch, awaits the inspector, re-checks ownership and generation after the await, then checks again inside the transaction.
- A former owner gets 404 and nothing is saved. Ownership that moves away and back during an inspection gives 409, and nothing is saved.
- A new owner gets the workspace with the business. A personal account or credential is never an import asset.

## Tests (`server/test/imports.test.ts`, 12 tests, real API routes, fictional manifests)

- **Next.js SaaS:**
  - Exact package facts; scripts counted and absent.
  - Detections for Next.js, React, TypeScript, Vercel (development only), Prisma, OpenAI and NextAuth.
  - Report counts are 0 verified, 4 detected, 0 declared and 4 unknown; the next action is source ownership.
  - The response text and a dump of every database table contain no script, script URL or repository URL.
  - It is listed from its business.
- **API service** (Hono, pg, Anthropic, NEAR) gives `api_service` and the matching evidence.
- **Plain, unknown tooling:** no detections, shape unknown, all 8 unknown. Every reference kind is classified, and no file, git or URL text is kept.
- **A bounded heuristic:** React and Stripe in development dependencies only give shape unknown, and the evidence says "development only".
- **Malformed and oversized input** (13 cases) is refused with the right status and message. The counts of businesses, workspaces and events are unchanged.
- **Credentials:**
  - Auth fields, a nested `publishConfig._authToken`, `apiKey`, secret-looking values and credential URLs are refused.
  - No secret appears in any response or anywhere in the database.
  - `git+ssh://git@…` is accepted.
- **Prototype keys** are refused, and `Object.prototype` is not polluted. Unusual names are normalized (`UPPER` → `upper`) or skipped (count 3, not echoed).
- **Replays:** the same creation twice gives one workspace and one business. Changed content gives 409. Inspection replay gives 200; a different file under the same key gives 409. Snapshots and reports refuse UPDATE and DELETE.
- **Versions and statements:**
  - Stale edits give 409.
  - An unknown product kind or category is refused.
  - Status and verified fields can't be set.
  - A note containing a key is refused.
  - Detected plus declared stays "detected", with both evidence kinds.
  - Declaring all 8 still gives 0 verified and "Not ready"; clearing a statement returns the item to unknown.
- **Access loss during inspection** (a gated real inspector):
  - Control moves to another person mid-inspection: 404, 0 inspections saved.
  - Away and back mid-inspection: 409, 0 saved.
  - An unheld inspection then succeeds.
  - Creating into an existing business is fenced the same way: 404, no workspace.
- **Owner change:** another person gets 404 on every route. After the transfer, the new owner reads and edits it, with owner epoch `<new>:1`. The former owner gets 404 and an empty list.
- **Public nondisclosure:** with an import under a published business, the public business page, discovery, search (by description and by package name) and explore show nothing from it.
- **Restart:**
  - With a database file and a new app and Store on the same cookie, the facts and statements survive.
  - A new manifest adding Stripe moves payments to detected (counts 5).
  - Report 1 still shows payments unknown (counts 4), and inspection 1 has no Stripe.
  - A missing report gives 404.
  - The throwaway database lives next to the test (`*.db` is ignored) and is deleted.

**Mutation check:** with the post-inspection generation fences removed, the access-loss test fails.
They were restored afterwards.

## Commands

```
npx biome check --write <changed files>
npx vitest run server/test/imports.test.ts   → 12 passed
npm run check        Test Files 32 passed (32); Tests 361 passed (361)
npm run web:build    built (existing chunk-size advisory only)
```

## Limits (not in this slice; scope kept, not removed)

- **Not built here:** remote GitHub, cloud or deployment connectors and tokens; cloning code; executing it or any sandbox; verifying source or IP ownership; moving accounts, domains, hosting or payments; a preview; import-complete or deployment-ready states; public publishing; a completed M4.
- **Verification** is not available for any item. The UI and the report say so, and nothing sets `verified`.
- **Detection** reads package names only. A dependency can be present and unused, or a service can be used without a package, which is why the founder's statement is a separate kind of evidence.
- **Secret screening** recognizes known shapes and explicit fields. It is not infallible, and the UI tells founders never to paste keys.
- **Browser review** (1440, 1280 and 390 widths, keyboard, actor switching) is Astra's. The UI was type-checked and built, not exercised in a browser by me.
- **Imported products** are separate from studio-generated projects. No releases, evaluations or runtime records are created for them.

M4 and every other milestone stay open. Stopping here for Astra's review.
