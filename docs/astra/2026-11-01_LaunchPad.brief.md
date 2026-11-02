# Astra brief · Everstreet is a launch pad — re-center and go big

From Claude, for Tony. Effort: max. Seats: divergent ideation, product and visual direction,
NEAR architecture direction. Write your pass to `docs/astra/2026-11-01_LaunchPad.md` and add its
row to `docs/astra/INDEX.md`. Read `docs/ASTRA.md` first; its rules hold.

## Why this pass exists

Tony read your platform-vision pass (`docs/astra/2026-11-01_PlatformVision.md`) and said it went
in a different direction from his idea. It centered on operating and handing over established
businesses: books, reconciliation, continuity, legal gates. That was partly Claude's brief, which
pointed you at the original GPT document and the handoff code. **Tony wanted you to add depth to
his idea, not replace it.** This pass puts his idea at the center.

## Tony's idea, in his words (Nov 1)

> I was hoping for a launch pad for aspiring entrepreneurs, a place where investors or other
> businesses can make acquisitions and a place people can find services, all using NEAR protocol.

And earlier the same day:

> Think: entrepreneurs onboarding onto the platform and using it to start and build their
> business and advertise themselves and their ideas, business. Then also potential acquirers
> setting up their accounts on the platform and searching businesses that match what they're
> looking for based on different criteria (maybe who is looking to be purchased, potential
> valuations — this could be a feature as it's built on NEAR and financials are known!, etc.),
> and people looking for services. We also need to make sure NEAR works on the backend. Have
> Astra come up with ideas for how it wants you to build that out, what the UI will be, and
> please tell it to go big.

## The three pillars, in this order of weight

1. **Launch pad (the heart).** An aspiring entrepreneur arrives with an idea, or only the itch to
   start something, and Everstreet carries them to a live business: shaping the idea, a founder
   profile and idea page, getting early interest and feedback, a guided path to a first offer,
   storefront and first customer, promoting themselves and the business, and growing from there.
   Go deep and bold: what makes this the best place on the internet to start a business? What
   does the first hour, first week and first month feel like? Where do AI help, templates,
   community, and NEAR each make the launch faster or more credible?
2. **Acquisition marketplace.** Investors and other businesses set up accounts and search for
   businesses that match what they want: who is open to being bought, stage, category,
   traction, revenue, and **potential valuations, which Tony sees as a headline feature because
   the business runs on NEAR and its financials are known**. Design the valuation feature
   boldly and make it genuinely useful: what a founder and a buyer see, how the number is formed
   from on-chain activity, how it updates as the business grows. Keep it honest with clear
   labels, but do not let caveats swallow the feature.
3. **Service discovery.** People and businesses find services they need, and those services are
   the businesses launched on Everstreet. This is also how new founders get their first
   customers.

**Underneath all three: NEAR, really working.** Accounts people can use without understanding
wallets, payments and revenue that settle on NEAR so the numbers are real, the business identity
and ownership contract (already built, see below), and any other NEAR pieces that earn a place.

## What to reuse

Your previous pass has strong parts that fit: founder profiles and idea pages, honest traction
labels, demand-backed launches, the source labels (verified on NEAR / connected / founder
supplied / estimate), service matching, the acquirer search and evidence room, the NEAR contract
architecture, and the visual system. Pull them in where they serve the launch pad; drop or shrink
what does not. Do not re-explain legal and custody caveats at length: one short section naming
what must be decided before real money is enough.

What exists in code: `contracts/business/src/lib.rs` (one NEAR contract per business: owner,
operators, treasury, two-party sale; deployed on testnet, no keys), `services/openseat/` (a
sample booking business). No web UI yet.

## What we need from you

1. **The product in one page**, with the launch pad as the story and the other two pillars as how
   it pays off.
2. **The founder's journey, in depth**: from "I have an idea" (or "I want to start something but
   don't know what") to a growing business; first hour, first week, first month, first year.
   Screens, prompts, what AI drafts, what the founder decides, where they get seen.
3. **How founders advertise themselves and their ideas**: profiles, idea pages, launches,
   updates, a feed or showcase, credibility before revenue.
4. **The acquirer's journey and the valuation feature**, bold and concrete.
5. **The service seeker's journey**, and how it feeds new founders their first customers.
6. **NEAR underneath**: contracts and main methods, what is on and off chain, account creation
   without wallet pain, how revenue on NEAR becomes trustworthy numbers.
7. **The UI**: site map, key screens with ASCII wireframes, visual direction, mobile first.
   Build on your earlier visual system if you still like it.
8. **Wild ideas for the launch pad** (at least ten), marking the ones you would bet on.
9. **Build order**: phases Claude can build one after another, each ending in something Tony can
   use from his phone. Phase 1 should put the launch pad itself in his hand.
10. **Open questions for Tony**, few and important, each with your recommendation.

Fictional data in examples. Brand in the UI layer only. Long is fine; ambitious and concrete
beat cautious and abstract.
