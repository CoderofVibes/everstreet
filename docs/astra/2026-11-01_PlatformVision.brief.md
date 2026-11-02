# Astra brief · Platform vision — go big

From Claude, for Tony. Effort: max. Seats: divergent ideation, product and visual direction,
and NEAR architecture direction. Write your pass to
`docs/astra/2026-11-01_PlatformVision.md` and add its row to `docs/astra/INDEX.md`.
Read `docs/ASTRA.md` first; its rules hold.

## The goal

Tony wants us to spend a stretch building **the real platform**, not a demo staged for hackathon
judges. Design Everstreet as a product people would use for years. Tony's words: entrepreneurs
onboard, use it to start and build their business, and advertise themselves, their ideas and their
business; potential acquirers set up accounts and search for businesses that match what they want,
by criteria like who is open to being bought and **potential valuations — a feature because it is
built on NEAR and the financials are known**; and people looking for services find them. NEAR has
to really work underneath. Tony asked that you **go big**: the full vision first, then a build
order that gets there.

## What exists (read these, nothing else is needed)

- `docs/BRIEF.md` — the original brief (written as a hackathon plan; treat its product sections
  as input, its judge choreography as out of scope for this pass).
- `docs/AUTHORITY.md` and `docs/DECISIONS.md` — what gate 1 built and proved.
- `contracts/business/src/lib.rs` — one NEAR contract per business: owner, operators stamped with
  an authority generation, treasury with reserves for customer obligations, two-party sale by
  digest. Deployed on testnet with no keys (nobody can change it).
- `services/openseat/src/service.ts` and `command.ts` — the sample SaaS business: bookings,
  waitlist, promotion, operator commands signed with NEAR keys and checked against the contract.
- `data/evidence/handoff-testnet.json` — the recorded testnet sale.

There is no web UI yet. Everything you propose for the UI is new.

## What we need from you

1. **The product in one page.** What Everstreet is, for whom, and why it is better than a website
   builder plus a marketplace plus a business-for-sale listing site stitched together. Name the
   core loop that makes founders keep using it even if they never sell.
2. **Three audiences, end to end.** For each of (a) entrepreneurs, from "I have an idea" through
   launching, getting customers, running and growing; (b) acquirers (strategic buyers, small funds,
   individual owner-operators, maybe cooperatives); (c) people and businesses looking for a
   service or product: the journey step by step, what they see on each screen, what they do, and
   the moment the product earns their trust. One person can be all three; design the account and
   the switch between roles.
3. **Founders advertising themselves and their ideas.** Profiles, idea pages, storefronts,
   updates, traction shown honestly. How does an idea-stage founder look credible with no revenue
   yet? What can they publish, and what stays private?
4. **Acquirer search and valuations.** Search criteria, saved searches and alerts, how a business
   signals it is open to offers (privately, anonymously, publicly), and the valuation feature in
   detail: which figures are verified because the money moved through NEAR or a connected
   source, which are founder-supplied, how a valuation range is computed and explained, how
   confidence and freshness are shown, and how we avoid presenting an estimate as advice or a
   promise. Be bold about what verified financials make possible (live metrics a buyer can trust,
   instant diligence, offers that settle on chain) and precise about where the proof ends.
5. **Finding services.** How a need becomes a match and a completed action; ranking that cannot be
   bought; how the same businesses show up for customers and for acquirers without leaking one
   view into the other.
6. **NEAR underneath, for real.** Propose the on-chain architecture: what each business, payment,
   subscription, booking, revenue record, ownership change and operator permission looks like on
   NEAR; what stays off chain and why (privacy); how people use it without knowing about wallets
   (account creation, keys, recovery, gas); how revenue gets recorded so it can be trusted (e.g.
   payments settling through the business's contract, attested connectors); where Chain
   Signatures, intents, NEAR AI or other NEAR pieces earn a place, and where they would be
   decoration. Name the contracts and their main methods. Flag anything that needs the founder or
   buyer to hold their own keys.
7. **The UI.** Information architecture and site map; the key screens (home, search results,
   founder dashboard, business profile and storefront, acquirer search and business detail,
   valuation view, deal room, onboarding); for each, its job, what the eye hits first, the main
   actions and empty/loading/error states. Visual direction: tone, type, colour, density, how the
   proof (verified on NEAR) shows without crypto jargon. Mobile first. Describe it well enough that
   Claude can build it from your words; ASCII wireframes welcome.
8. **Wild ideas.** At least ten bold features we have not thought of, each with one line on why it
   could matter and what it would take. Mark the ones you would bet on.
9. **Build order.** Phases Claude can build one after another, each ending in something Tony can
   use from his phone. For each phase: what ships, what it needs underneath, what is real and what
   is still simulated (always labeled), and what to cut if time is short.
10. **Open questions for Tony**, numbered, each with your recommendation.

## Constraints

- Real product, not judge theatre. Testnet and demo credits for now; design so mainnet and real
  money are a later switch, with the honest caveats (custody, payments, securities and
  marketplace rules) named rather than solved.
- Every number a user sees points to where it came from. Labels for verified on NEAR, connected
  source, founder supplied, estimate.
- Keep the brand in the UI layer; contracts and data stay brand-neutral.
- Fictional data in examples.
- Long is fine. Concrete beats vague; if an idea is weak, say so.
