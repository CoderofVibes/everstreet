# Job 001 report: studio foundation (M1)

Builder: Claude. Date: 2026-11-02. Job: `docs/astra/jobs/2026-11-02_001_studio-foundation.md`.
Status: built and keyless-verified; browser review and acceptance are Astra's
(`docs/astra/ACCEPTANCE.md`, all M1 gates still pending there).

## Commits (local, not pushed)

| Commit | What |
|---|---|
| `ba2950e` | Astra's handoff docs reviewed and committed (vision, mandate, jobs 001–003, BRIEF/DECISIONS pointers); job 001 marked taken. `BUILD_STATE.md` left uncommitted. |
| `0e82986` | Server: product projects, immutable revisions, build boundary, 12 tests |
| `07d666e` | Web: new visual system, home, product studio, desk integration, README |
| (this commit) | `docs/design/BUILD_RUNTIME.md`, this report, JOBS.md |

Astra's later edits (`2026-11-02_BuildMandate.md` line, new `ACCEPTANCE.md`) and
`BUILD_STATE.md` were not touched or staged.

## What a founder can do now

1. **Home** (`/`): "What do you want to build?" composer with the four foundations; paths to
   Start building, Bring a product (the existing "I've already started" flow, labelled as
   such: code import comes later), Explore acquisitions, Find a solution; Continue building
   (own projects); software-first discovery of real published businesses with a kind filter
   (earlier class/service fixtures labelled as earlier examples); open needs from the need
   board; an accurate NEAR testnet ownership panel. A dark panel lists the six stages with
   "Works now / Partly" so the capability inventory is visible, not implied.
2. **Product studio** (`/build`): idea, foundation cards (what each is, what it needs),
   optional working name, and which business it belongs to (new private business, or one
   the founder owns; `/build?business=<id>` preselects from the desk). Lists own projects.
3. **Project workspace** (`/build/:id`):
   - Header: product name, business link, foundation, "Prototype" label, save state
     ("Revision 3 · saved 2 min ago" / "Unsaved changes, kept in this browser"), one primary
     action (Save revision N+1, else "Next: <first open check>" which focuses that field,
     else "Next: review continuity").
   - Step rail: Shape, Choose, Build (Not connected), Test (n/7 checks), Prepare, Launch
     (business desk).
   - Left: an "AI generation · Not connected" card with the server's reason; Brief editor
     (name, audience, problem, promised result, features with starter label, pricing model
     + amount + note) or Screens editor (add/remove forms, lists/boards, model steps; fields
     with types and choice options; stages; sources); revision note + Save; Discard.
   - Canvas tabs (arrow-key navigable): **Preview** renders the schema as a clickable app:
     forms add sample entries, lists show them, boards move them between stages, model steps
     say no model is connected and show the result shape; labelled "Prototype · not a
     working product", sample entries stay in the tab. **Brief** one-page document with
     undecided items marked. **Checks**: 7 deterministic rules on the saved revision;
     model evaluations and journey tests shown as Not available with reasons; manual checks
     and unknowns. **Versions**: every revision with note, author, time, restored-from,
     fingerprint; compare any revision with the current one; Restore as a new revision.
     **Continuity**: customer promises, dependencies (payments read from the business's real
     contract record, everything else "Not connected"), transfer readiness.
   - Recovery: unsaved edits are mirrored to `localStorage`; on reopen the studio offers
     "Bring them back" or "Discard". A save based on an older revision gets the server's 409
     message and a "Load the latest revision" button; the local draft survives for
     re-applying. Ctrl+S saves; leaving with unsaved edits asks first.
4. **Business desk** (`/desk/:id`): a Product projects card lists the business's projects
   and links to start another.

All existing routes are unchanged (`/start`, `/studio/:id` offer interview, `/desk…`,
`/b/:slug`, `/acquire…`, `/deal/:id`, …) and actor switching is untouched. The new look
comes from remapping the old token names (`--paper`, `--forest`, `--lime`, `--serif`…), so
existing pages adopt it without rewrites; the few inline serif headings were removed.

## Underneath

- Tables `product_projects`, `product_revisions` (+ two triggers that abort UPDATE/DELETE on
  revisions), one index. `CREATE … IF NOT EXISTS` only: additive, no reset, no seed, no
  change to existing tables. A test opens a database without them, adds a record, reopens it
  and confirms the tables appear and the record is intact.
- `Store.insertBusiness` (extracted from `startProject`, same behaviour) lets a project and
  its new business land in one transaction; `Store.tx` and `Store.ownedBusiness` became
  public for the new module.
- API (all owner-checked; "missing" and "not yours" are both 404):
  `GET /api/product-foundations`, `GET|POST /api/product-projects`,
  `GET /api/product-projects/:id`, `GET /api/product-projects/:id/revisions/:n`,
  `POST /api/product-projects/:id/revisions` (`base_revision`, `brief`, `prototype`, `note`;
  201 new / 200 unchanged / 409 stale), `POST /api/product-projects/:id/restore`.
- Validation rebuilds brief and prototype from checked parts (types, lengths, keys, choice
  options, sources, ≤6 screens, ≤12 fields, ≤8 features, integer non-negative cents);
  unknown properties are dropped; markup is stored and rendered as plain text.
- `server/src/build.ts`: provider-neutral `BuildProvider` / `BuildRequest` / `BuildEvent`;
  `AppOptions.buildProvider` (none configured → honest unavailable answer).
- `docs/design/BUILD_RUNTIME.md`: what exists (checked) and the M2 proposal: records, job
  lifecycle, provider boundary, isolation options, preview origin (cookies are not isolated
  by port), release identity, cancellation, two usage ledgers, transfer behaviour, open
  decisions.

## Commands and results

| Command | Result |
|---|---|
| `npm run check` at start | 52 tests passed |
| `npm run check` after server slice | lint clean, types clean, 64 tests passed (8 files) |
| `npm run check` final | lint clean, types clean, 64 tests passed |
| `npm run web:build` | built: 50 modules, CSS 32.8 kB, JS 475.8 kB (129.8 kB gzip) |

New tests (`server/test/products.test.ts`, 12): creation on a new private business with
starter brief and honest checks; save → reopen → earlier revision intact → identical save is
not a revision; stale base refused (409) with nothing written; restore as new revision,
unknown revision 404; storage-level immutability; another actor cannot read, save, restore,
fetch a revision, list, or attach to the business, anonymous gets 401; the project follows
the business to a new owner; attaching to an existing owned business; 13 malformed inputs
refused with plain reasons; markup kept as text and unknown properties dropped; build
unavailable by default and a provider double's own availability reported; additive
migration on an existing database.

Not run, by instruction: `npm run app`/`serve` (main.ts reads testnet keys from
`.near-credentials` and opens `data/runtime`), seed/setup/smoke/handoff. No transaction was
sent, no secret read or printed, no network service used.

## Limitations and honest gaps

- **No browser pass by me.** This session had no browser tool, and running the real app
  would read credential files. Layouts were written for 1440/1280 with breakpoints at 1240,
  1000 and 640px, but nothing was looked at. Astra's browser review is the first visual
  check; expect spacing/overflow fixes.
- **Formatting by hand.** `npm run format` (and `biome format --write`) needed a permission
  this session didn't have, so Biome's diffs were applied manually until `npm run check`
  passed. To allow it next time: `npm run format`.
- The starting brief is deterministic, not inferred: the idea becomes the problem, the
  foundation supplies starter features (labelled), everything else is empty and marked
  undecided. No conversation UI exists, deliberately, until a provider does.
- Foundations are a fixed catalog of four with fixed starter screens.
- The prototype's sample entries are per tab and not persisted; file fields take a name only.
- "Bring a product" reuses the existing offer flow; repository/deployment import is M4.
- Continuity's dependency states are coarse: payments is real, the rest is "Not connected"
  because no product runtime exists. Checks are rules on text presence, not quality.
- Local-preview identity only; no production auth claims.
- No new dependencies were added.

## Next integration point

Job 002 plugs a real provider and runner into `BuildProvider` and adds the M2 records in
`BUILD_RUNTIME.md` §2. Suggested first slice: `build_jobs`/`build_events` with lifecycle,
idempotency and restart recovery driven by a scripted test double, plus the studio's job
progress view, before any live provider or sandbox. Decisions needed first are listed in
§9 (provider account and budget, container runtime availability, preview host).
