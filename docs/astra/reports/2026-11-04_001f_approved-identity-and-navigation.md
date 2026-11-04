# 001f report (with the repaired 001e): approved identity and the first connected slice

Claude, 2026-11-04. Jobs:
[001f](../jobs/2026-11-04_001f_approved-identity-and-navigation.md) and
[001e](../jobs/2026-11-04_001e_digital-storefront-experience.md). Not pushed or published. No
contract, `main.ts`, package, provider or remote change. Exact model: claude-opus-5-5, high
effort, subscription; no limit was hit.

## Commits, in order

| Commit | What |
|---|---|
| `986333f` | Astra's eight docs: UI direction, PLATFORM_VISION, DECISIONS, UI approval, legacy disclosure review, the 001f job, JOBS, INDEX. Reviewed, committed after a passing check. |
| `7ca5205` | **Repair of the interrupted 001e** (see below) |
| `3cb77fe` | **001f** |

## Repairing 001e first

- **Starting point:** the check stopped at 6 `noControlCharactersInRegex` lint errors in the
  example sanitizer. I replaced the regexes with an explicit code-point filter: control characters
  are removed, and newlines are kept only where allowed.
- **One stale test fixture** was missing the new `example: null` field; I added it.
- **Baseline before committing:** 900 tests in 92 files, lint and types clean, build passing.
- **What 001e delivers:**
  - an optional **owner-written example** (one featured product, bounded plain-text input, 1–8
    result rows);
  - the example is part of the reviewed snapshot (001d1's review identity covers it), under a
    fixed "Illustrative example … not a live run" label;
  - it is never filled from customer, evaluation or build data (canary test);
  - draft edits stay private, and removing it and publishing takes it down;
  - the editor has an example section, a full-width exact preview and **View live page**;
  - the owner view carries the slug and business name.
- **Tests:** `server/test/publication-example.test.ts` (4), plus the preview test.

## 001f

**Design packet first:** `docs/design/UI_SYSTEM_001F.md`.
- **Compositions compared:** "Gallery" (an even card grid) and "Stage and rail" (one subject at
  large scale with a quieter rail of supporting facts). **Chosen: Stage and rail.**
- **Why:** it gives Discover, Studio and Acquire distinct hierarchy from one rule set. It makes
  the product demonstration the visual interest, and it scales to Studio's canvas and Acquire's
  evidence. Gallery would have been the universal card grid the direction rejects.

**Tokens:**
- the approved candidates (canvas `#F4F6FB`, paper, ink `#17243C`, cobalt `#3155D9`, warm
  `#F3C49D`) plus derived text, cobalt and on-ink tokens, with separate success, warning and error;
- **contrast is measured:** `web/test/tokens.test.ts` reads the real `:root` and checks 20 text
  pairings at ≥ 4.5:1 and the action and focus colours at ≥ 3:1, all passing;
- the old `--mint*` names now map to cobalt, so every page inherits the system;
- "positive" pills and notices use the success colours;
- the old mint used as text on dark is replaced by the measured `--accent-on-ink`.

**Type, depth and motion:**
- **Fonts:** system display, body and mono families (no remote fonts).
- **Shape and depth:** radii of 10/14/20 px and two shadow levels.
- **Motion:** 180 ms, only for a real state change (tab panel, navigation). `prefers-reduced-motion`
  removes it.
- **Glass:** on the header only, with an opaque fallback when blur is unsupported, under reduced
  transparency, or with forced colours.

**Navigation:** the dark left rail is replaced by a sticky glass header.
- **Destinations:** **Discover / Build / Operate / Acquire**, marked with `aria-current`.
- **Contextual subnavigation** for the active destination.
- **Labelled utilities:** My activity, Inbox with its count, and the acting-context menu
  (profile, local fictional-person switch, sign out).
- **At ≤ 980 px:** the four destinations stay visible as a labelled row, and contextual links and
  utilities sit under **Menu** (focus moves in, Escape closes and returns focus, a route change
  closes it).
- **Routes unchanged:** `web/src/nav.ts` maps every existing route; for example, a business's sale
  and handover pages count as Acquire, and customer use and activity sit outside the four.
- **Tests:** `web/test/nav.test.ts` (47) checks every deep link (including queries), the
  current-link rules, and that every navigation target is a real route in `App.tsx`.

**Discover:**
- **Home is a stage:**
  - the composer;
  - beside it, a **real published product** (one with an owner-written example first), with its
    keyboard-operable example tabs and its real Use action;
  - when nothing is published, the honest "what works today" list.
- **Below the stage:**
  - a slim rail of entry links;
  - an **editorial list** of published businesses, each with one honest line (availability from
    active offers for digital profiles; offering, stage and price for legacy ones) and an
    "Example included" marker only when published. No invented stats.
- **Explore** uses the same list.
- **Tests:** `web/test/discover.test.ts` (6).

**Storefront:** the 001e header is now a luminous stage on paper with a warm accent rule, not a
dark card.
- **Order:** the example is the stage; capabilities and products are the rail.
- **Removed:** the duplicate hero, the empty booking card, the zero-follower line and the numbers
  placeholder.
- **Unchanged states:** mixed businesses keep "Also offered", and legacy pages are unchanged.

**Preview:** `npx tsx scripts/preview-publication.ts` (site :8826, controls :8827, 127.0.0.1 only,
labelled synthetic).
- Ava drafts, reviews and publishes a profile with an example, which then features on Home and
  appears in Explore, and Use opens the real workspace.
- Bea is coming soon; Dee is a legacy business.
- `server/test/publication-preview.test.ts` (2) drives example publish, private draft, removal
  and the legacy page through the site's fetch.

## Checks

- `npm run check`: **976 tests in 95 files**, lint and types clean, no warnings.
- `npm run web:build`: passes (CSS 55.46 kB, JS 801.62 kB, the existing size advisory).
- **Mutants**, one at a time and each restored:
  1. sale/handover destination mapping: killed;
  2. the featured stage ignoring examples: killed;
  3. Use without an open offer: the first attempt was an equivalent mutant (it survived because
     the function still checked `use_offer_id`); a real one was killed;
  4. tertiary text made too light: killed by the contrast test;
  5. a coming-soon listing labelled available: killed.
- **Unchanged and still passing:** publication review identity, release binding, canaries,
  customer continuity, legacy/mixed/coming-soon, owner fencing, and the evidence and acquisition
  suites.

## Not verified

- **No browser or screenshot check.** No browser tool was available in this session, so nothing
  was looked at in a browser: no 1440/1280/390 screenshots, no keyboard or zoom pass, no
  reduced-motion check. Layout, focus visibility and glass legibility are code-level only.
  **Astra's visual review is needed.**
- **Leftover file:** `web/src/pages/DigitalProfile.tsx` (from 001d) is now unused. Removing it
  needed an approval I didn't have, so it stays in the tree as dead code.
- **Inherit tokens and shell only, not redesigned:** Studio, Operate (desk, books), Acquire
  (rooms, handover, deals), customer use, Find, Person and Opportunities.
- **Old styles remain:** a few older rules (`.home-hero`, `.shelf`, `.tile`) are still in the
  stylesheet for pages that use them.
- **Follow-up jobs:** Studio composition (conversation, canvas, contextual tools), Operate,
  Acquire, customer use, and the legacy `customers` disclosure job Astra proposed.
- **All six milestones stay open.**
