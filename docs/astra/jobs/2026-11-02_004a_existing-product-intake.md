# Bring an existing digital product: inspect its source manifest

**Why (Tony's words):** “I see both” — building in Everstreet and bringing a product built
elsewhere. “AI tools, SaaS, websites, crypto solutions on NEAR, online services, agents”.

## What the person sees and does

Home's Bring a product opens a real, private import workspace. A founder selects an owned
business (or creates a named private one), describes the existing product, and supplies a
package.json file or its text. Explain exactly what is inspected: package metadata and declared
dependencies. The source code is not executed. The founder reviews detected framework/tooling
and corrects the product description and a dependency inventory: source ownership, hosting,
database, model provider, authentication, payments, domain and customer promises.

Show a persistent readiness report with per-item evidence and an actionable next step. A
dependency inferred from a package is “detected in manifest”; founder assertions are labelled;
runtime/account connections are pending until actually verified. No green all-ready score for
merely completing fields. The product remains private. Reopening it preserves edits and prior
inspection versions. Old reports remain viewable when an updated manifest changes dependencies.

Use the existing visual system: an import overview with source facts, dependencies and readiness
views, clear status and one next action. Make it work at1440/1280/390 and by keyboard. A new
product record belongs to the business and appears from its desk; acquisition preparation can
reference its unresolved transfer items without exposing private source metadata publicly.

## Underneath

Inspect existing products/store/continuity and private access fences first. Introduce a bounded,
provider-neutral ImportInspector interface with a genuine local package-manifest implementation.
This slice inspects supplied content; no remote connector is active. Build the seam for later
authorized repository/deployment providers. Do not pretend a repository URL establishes ownership.

- Accept at most64KiB of UTF-8 package JSON and bounded dependency counts/field lengths. Reject
  malformed/non-object input, prototype pollution keys, path traversal, unrelated file types,
  and explicit credential fields. No arbitrary filesystem reads, ZIP extraction, subprocesses,
  npm install, scripts, network fetches or code execution.
- Parse only explicit safe metadata fields. Do not persist scripts, arbitrary JSON, raw file
  content, embedded credentials or credential-bearing dependency URLs. Reject suspicious input
  with an actionable message before persistence; do not promise infallible secret scanning.
  Safely normalize dependency names and version/reference classifications. URLs are inert
  metadata, if retained at all; no backend fetch or credential collection.
- Store normalized inspection facts, input digest, inspector version, timestamps and provenance.
  Keep immutable inspection snapshots, editable mappings/assertions with optimistic versions,
  and an audit trail. Product/import/business creation is transactional and request-idempotent;
  replay with changed content conflicts, retries don't create duplicate businesses.
- Server enforces owner access on every read/write and after asynchronous inspection; use
  ownership generation to reject away-and-back responses. Browser scope resets with actor and
  business; stale loads can't restore private source data. Transferred business records follow
  new control; personal auth/credentials are never import assets.
- Persistent dependency records distinguish unknown, declared, detected and verified evidence.
  Verification is unavailable in this slice for external accounts. Each transfer item states
  the expected mechanism, continuity risk and who must act; reported facts never become verified
  by changing a checkbox. No fake preview, import-complete or deployment-ready status.
- Preserve existing build projects and original routes. Keep imported products distinguishable
  from studio-generated artifacts; no fabricated releases/evaluations/runtime records.

## Done when

Real API tests use fictional Next/React API/SaaS manifests, plain unknown tooling, malformed and
oversized input, credentials/URLs, unusual names/prototype keys, replay conflicts, version
conflicts, access loss during inspection, owner changes and public nondisclosure. Restart/reopen
proves persisted normalized facts and immutable report history; parser output changes readiness
facts, not just explanatory copy. Assert raw scripts/secret values are absent from database,
audit events and responses. Test detection as a bounded heuristic, not proof of architecture.

Check/web build pass. Report files, schema, exact supported inputs, tests and capability limits.
Astra reviews the browser before acceptance. Commit locally in bounded server/UI/report steps.

## Not in this job

Remote GitHub/cloud connectors, live access tokens, cloned code, execution/sandbox/hosting,
payments migration, source or IP ownership verification, actual external transfer, public
publishing or a completed M4 claim. These remain explicit later slices, not removed scope.

## Priority and size

P1 / M–L. First M4 slice; may run after the bounded runtime/finance/contract corrections.
Stop for Astra's review before remote connectors or runtime integration.
