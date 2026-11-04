# Everstreet UI system: first implementation packet (job 001f)

Claude, 2026-11-04. Authority: [EVERSTREET_UI_DIRECTION.md](EVERSTREET_UI_DIRECTION.md) (Tony
approved) and [001f](../astra/jobs/2026-11-04_001f_approved-identity-and-navigation.md).
Written before the broad edits. This is an internal design decision, not a request for approval.

## Tokens

Defined in `web/src/styles.css`. Contrast is **measured** by `web/test/tokens.test.ts`, which
reads the actual `:root` values: WCAG 2 ratio, AA 4.5:1 for text and 3:1 for large text and UI
edges.

| Role | Token | Value |
|---|---|---|
| Canvas (mineral) | `--canvas` | `#F4F6FB` |
| Paper | `--surface` | `#FFFFFF` |
| Quiet paper | `--surface-2` | `#F8F9FC` |
| Ink (blue-black type, dark tool surfaces) | `--ink`, `--text` | `#17243C` |
| Secondary text | `--text-2` | `#3B4860` |
| Tertiary text | `--text-3` | `#566178` |
| Fine rule / strong rule | `--line` / `--line-strong` | `#DCE1EB` / `#BCC4D4` |
| Cobalt action / hover | `--cobalt` / `--cobalt-hover` | `#3155D9` / `#2645BD` |
| Cobalt text (links, eyebrows) | `--cobalt-ink` | `#2846C4` |
| Cobalt tint / edge | `--cobalt-soft` / `--cobalt-line` | `#EBEFFD` / `#C7D2F7` |
| Warm highlight (accent fills only) | `--warm` | `#F3C49D` |
| Warm tint / text | `--warm-soft` / `--warm-ink` | `#FCEFE3` / `#7A3F10` |
| Text on ink / secondary / accent | `--on-ink`, `--on-ink-2`, `--accent-on-ink` | `#F2F5FB`, `#AEB8CC`, `#AFC2FF` |
| Success (semantic) | `--success`, `-soft`, `-line` | `#1E7A4C`, `#E5F3EB`, `#B5DCC5` |
| Warning / error (semantic) | unchanged | `#8A4B00` / `#B42318` |

**Older names stay mapped**, so every page inherits the system without a rewrite:
- `--mint*` now means the brand action, cobalt;
- positive states use the success tokens;
- warm is never used for text on paper.

**Type:**
- **Families:** the system UI sans for reading, with display weights for headings, and the
  system mono (`--mono`) for numbers, versions, ids and evidence.
- **Scale:** 13 / 15 (body) / 17 / 22 / 30 / 44 (display), with tighter tracking on display.
- **No remote fonts.**

**Shape, depth and motion:**
- **Radii:** 10 / 14 / 20 px (controls, surfaces, feature surfaces).
- **Depth:** two levels of soft shadow.
- **Glass:** `--glass`, translucent paper with blur, used only on the global header and floating
  tools. It falls back to opaque paper where `backdrop-filter` isn't supported and under
  `prefers-reduced-transparency`/high contrast.
- **Motion:** 160–220 ms, used only to explain a state change (a tab switch, a menu opening).
  `prefers-reduced-motion` removes it.

## Navigation

The dark left rail is replaced by a spacious, glass, sticky header.

**Primary destinations**, mapped to existing routes:

| Destination | Covers | Contextual links |
|---|---|---|
| **Discover** | `/`, `/explore`, `/find`, `/opportunities`, `/b/*`, `/p/*` | Home · Explore · Requests · Find a solution |
| **Build** | `/build*`, `/start`, `/import*`, `/studio/*` | Product studio · Bring a product · Start a business |
| **Operate** | `/desk*` (except sale and handover), `/help/*`, `/inbox` | My businesses · Inbox |
| **Acquire** | `/acquire*`, `/deal/*`, `/handovers`, `/desk/:id/sale`, `/desk/:id/handover` | Acquisitions · Handovers |

- **Utilities on the right:** My activity (customer history), Inbox with its count, and the
  acting-context menu (profile, local fictional-person switch, sign out).
- **Contextual secondary navigation:** a compact row under the header, shown for the active
  destination.
- **Mobile, ≤ 760 px:** the header keeps the wordmark, the four destinations as a labelled
  segmented row, and a **Menu** button that discloses the contextual links and utilities (focus
  moves in, Escape returns). Nothing overflows horizontally.
- **Routing:** every old route still resolves. Only the shell changes.

## Two compositions considered (Discover, Studio, Acquire)

**A, "Gallery".** An even, editorial grid:
- Discover is a large search band over equal product tiles;
- Studio keeps today's three panes, restyled;
- Acquire is a listing grid above a detail page.

It is consistent and low-risk, but it is the universal card-grid the direction rejects. Product
demonstrations get the same weight as everything else, and the three experiences read as one
template.

**B, "Stage and rail".** Each surface has one **stage**, the subject at large scale, with a
quieter **rail** of supporting facts:
- **Discover:** a featured digital product on stage, with its owner-written example and real Use
  action, a rail of honest discovery entries, then an editorial list (not a uniform grid) of
  published businesses by availability.
- **Studio:** the working preview is the stage, and conversation and brief are the rail. This
  matches the approved "canvas owns most of the space".
- **Acquire:** exact terms and evidence on stage, with continuity and transfer contents in the
  rail.

**Chosen: B.** It gives each experience its own hierarchy from one rule set (stage / rail /
fine-rule groups, mono for evidence), so the experiences are related without being identical.
It makes product demonstration the visual interest, as the direction asks, and it scales to
Studio's canvas and Acquire's evidence without a new grid per page.

**In this slice:** B applies to Discover (Home, Explore) and the digital storefront. Studio,
Operate, Acquire and customer use only inherit the tokens and shell, and get their own
composition jobs.

## The first slice

- **Shell and header**, as above.
- **Home (Discover):**
  - a large stage: "What do you want to build?" with the composer;
  - beside it, the featured published digital product, with its example tabs when present;
  - honest entries (Build, Bring a product, Explore acquisitions);
  - then a published-business list ordered by availability.

  No counts are invented.
- **Explore:** an editorial list with the availability, headline and first capability. An
  "Example included" marker appears only when an example is published.
- **Storefront (`/b/:slug`, digital):** the 001e header on a luminous stage (not the old dark
  card). The example is the stage; capabilities and products form the rail.
- **Unchanged:** the legacy, mixed, coming-soon, no-example and multi-product states from 001e
  are kept.
