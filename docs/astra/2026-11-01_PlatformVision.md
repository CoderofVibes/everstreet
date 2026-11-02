# Everstreet: build a business that keeps going

Astra platform vision for Tony and Claude · 2026-11-01  
Proposal, not an implementation or release decision. Developed with divergent ideation, product and visual direction, and NEAR architecture seats.

## 1. The product in one page

**Everstreet is a place to turn an idea into a working business, find customers, keep what you promise them, and eventually give someone else the ability to run it.** A business accumulates a useful operating history as it works. Its founder uses that history to improve and delegate. Customers use selected evidence to choose confidently. A permitted buyer uses a deeper view to understand what they could acquire and operate.

The public invitation is **“Build a business that keeps going.”** Under it: “Start with an offer. Find your customers. Make the work easier to run.” The customer entrance is equally direct: **“What do you need?”** Acquisitions have their own deliberate entrance, “Find a business to own.”

The core loop is **Offer → Deliver → Improve → Repeat**:

1. Publish a specific offer that a person can use.
2. Bring a customer through a shared link, an embedded action, a referral, or Everstreet discovery.
3. Deliver the promised outcome; record the payment, entitlement, fulfillment and any exception separately.
4. See what worked, what remains owed, and what still depends on the founder.
5. Improve the offer or delegate a task, then serve the next customer with less effort.

This is why a founder returns even if they never sell: today's bookings, customer requests, renewals, delivery exceptions, money and delegated work are here. Sale readiness is a useful consequence of running a clearer business. A founder can disable acquisition discovery indefinitely and retain the entire operating product.

**The unifying object is the business record.** It connects an offer to a customer promise, that promise to payment and delivery, delivery to operating evidence, and that evidence to the people and systems responsible for it. Different audiences receive different authorized views. A studio can update capacity once; the storefront becomes more accurate, the operator can fill a cancellation, and a later buyer can inspect the operating history without seeing attendee identities.

This is the advantage over separately assembled tools. A website publishes claims. A marketplace brings an inquiry. A sale listing requests financials later. Everstreet carries the same offer, obligations, evidence and authority through the entire life of the business. It should still connect to existing websites, payments and operating software. Replacing every tool would make joining unnecessarily difficult.

There are three customers for the product:

| Audience | Immediate value | Value that compounds |
|---|---|---|
| Entrepreneur, including someone with only an idea | Make a credible offer, get a useful response, deliver the first outcome | Repeat customers, clearer books, reusable operations, less dependence on the founder |
| Person or business seeking a product or service | Find a suitable option and complete the action with clear terms | One place for bookings, subscriptions, purchases and unresolved promises |
| Individual buyer, strategic acquirer, small fund or cooperative | Find an opted-in business and inspect claims with permission | Understand earnings, dependencies and the work of taking over; rehearse a first shift |

NEAR earns its place by enforcing operating authority, protecting specifically registered funds, recording settlement and binding a sale to exact agreed terms. It makes some facts independently checkable and some actions enforceable. It does not make every business claim true. The large product promise is **“Know what you are buying, and what will keep working.”**

The first community should be independent creative studios and the small software and service businesses that support them. OpenSeat helps studios; Juniper Print Studio serves attendees. That creates a useful business-to-business and consumer loop in one bounded community. The platform's eventual scope includes digital services, appointments, professional services, physical commerce and succession. Each new business type earns admission through a working fulfillment model.

The commercial hypothesis is an operating subscription, with optional paid diligence workspaces and later clearly priced closing services. No one can buy organic ranking or a stronger evidence label. The founder's first useful distribution must work from their own shareable page before the marketplace has meaningful traffic.

The decisive test: **would a founder keep using Everstreet for a year if acquisition features disappeared?** Measure fulfilled outcomes, repeat customers, time saved and successful delegation. Page views and speculative business prices cannot answer that question.

## What this pass checked, and what it assumes

I read [Astra's rules](../ASTRA.md) first, then the files named in the brief: [BRIEF](../BRIEF.md), [AUTHORITY](../AUTHORITY.md), [DECISIONS](../DECISIONS.md), the [business contract](../../contracts/business/src/lib.rs), [OpenSeat service](../../services/openseat/src/service.ts), [signed commands](../../services/openseat/src/command.ts), and the [recorded handoff](../../data/evidence/handoff-testnet.json). I also read the pass index. Initial git status was clean; none of those source files showed concurrent edits.

| Checked in the repository | Exact boundary |
|---|---|
| One business contract records owner, generation, operators, treasury reserves and two-party sale terms | Its money is an issuer-minted DEMO ledger. There is no customer checkout, token-backed commerce ledger, subscription billing or revenue accounting in this contract |
| Matching acceptances move internal demo balances and control in one contract execution | Legal entity ownership, IP, domains, hosting and external accounts do not automatically transfer |
| The record shows the buyer became owner, prior owner calls failed, a new worker acted, and the original waitlist reference became a confirmed booking | These are recorded observations, not a fresh chain inspection during this pass |
| OpenSeat uses transactional SQLite state, an outbox, customer booking references and signed operator commands | Bookings are off chain. Several “live testnet” evidence rows describe a local service checking NEAR authority, not an on-chain booking transaction |
| Current source has no upgrade or key-addition method; the decision log reports a deployment with zero keys | I did not inspect deployed keys or rerun setup. Source comments describe key deletion, while the decision log describes creation without a key; the recorded zero-key outcome is the relevant claim here |
| The handoff records treasury 45, reserved 20, available 25, and sale price 100 | All are demo credits; none is evidence of commercial income or a market valuation |
| Current operator grants and signed commands carry an authority generation | The hosting operator can still change its own database. Finality checks cannot reverse an external action already sent |

The handoff timestamps are November 2 UTC, corresponding to November 1 in Pacific time. There is no date inconsistency.

All screens, financial features, production custody choices, migration mechanisms and additional contracts below are **proposals**. No application UI was inspected because the brief states none exists. No code, test, deployment, transaction, publication or commit was performed for this pass. Official external references support protocol and financial distinctions where cited; they do not establish that the proposed integrations already work here.

Rough sizes throughout are planning judgments: **S** = a contained surface or schema addition; **M** = several screens with a service workflow; **L** = a new subsystem or substantial integration; **XL** = a product line or work needing specialist partners. They are relative scope, not delivery promises.

## 2. Three audiences, end to end

### One person, several acting contexts

Create one personal account. A person may belong to several businesses and buying organizations. A business is not a login; a buyer team is not a second identity.

The persistent account control says **“Acting as: Maya Reed”**, **“OpenSeat · Owner”**, or **“Northline · Buyer team.”** Opening it shows Personal, authorized business workspaces, and authorized buying teams. The URL and server authorization identify the workspace. Switching changes the workspace, inbox and permitted actions, and clears private page caches. It does not grant a new role. A direct link must still enforce access.

Personal navigation is **Discover / My activity / Inbox / Account**. A business workspace is **Today / Customers / Offers / Money / More**. A buyer workspace is **Search / Saved / Rooms / Team**. Desktop can show the complete navigation in a side rail. Do not squeeze all three products into one mobile tab bar.

An acquisition researcher can remain an ordinary customer of the same service. Their purchase history is not disclosed to the seller as buyer intelligence. Their employer or buying team is visible only in the introduction or grant they explicitly send. A storefront has no “interested buyer” badge beside a customer.

Authentication starts with an ordinary account experience, ideally a passkey with a recoverable sign-in path. Browsing needs no account; saving a booking or contacting a founder asks for only what that action needs. Creating a business and accepting ownership require additional authority setup, described in section 6. Signing into the website and controlling a NEAR account are separate facts.

Underneath: Person, Organization, Membership, Business, BuyerMandate, contextual authorization and separate inbox projections. **M**, before private financials or deal rooms.

### A. Entrepreneur: from an idea to a business that can run

| Step and screen | What they see and do | What changes underneath; trust earned |
|---|---|---|
| 1. Start | Choose “I have an idea,” “I already serve customers,” or “I am taking over a business.” Describe the customer and outcome in plain language | Create a private draft or import plan. No legal incorporation or public listing is implied |
| 2. Shape the offer | A short interview becomes an editable card: who it helps, what is delivered, current stage, price or pilot terms, capacity, cancellation policy, and next action | Save versioned claims. Missing claims remain questions; an assistant cannot invent credentials, demand or traction |
| 3. Prove what exists | Add a prototype, work sample, relevant experience, a consented reference, or an experiment result. Choose what to publish | Evidence has source and visibility. “Prototype using fictional data” is a credible starting point |
| 4. Launch preview | Preview the actual phone storefront and the action a customer will take. Compare Public, Invited people and Only me | Publication is explicit. An inquiry page can launch before payments or a business contract exists |
| 5. First customer | Share a page or embed a booking/trial button. Receive a request with useful constraints, accept it, and give a definite next step | A request becomes an order, trial or booking with a versioned promise. A lead is not counted as a fulfilled sale |
| 6. Today | See “Promises due,” “Needs attention,” and “Ready to hand off.” Open the next customer task, resolve a cancellation, or assign support | Customer action, operating evidence and responsibility stay connected |
| 7. Money | See collected, earned, owed back, reserved and available as different amounts. Connect or import records, explain unmatched transactions | The founder learns why cash received differs from money available to take out |
| 8. Grow | See which offers lead to completed outcomes, repeat purchase, unmet needs and capacity constraints. Revise an offer or publish a useful update | Changes are measured against attributed outcomes, with missing attribution visible |
| 9. Delegate | Choose a task and person, review permitted actions and expiry, then let the operator perform it. Run “Founder away” in an isolated rehearsal | An actual second operator completes work without receiving the owner's keys |
| 10. Optional ownership path | Privately inspect value scenarios and operating dependencies. Choose no buyer contact, invitations, anonymous discovery or a named acquisition profile | Declining this step has no penalty. Readiness helps the founder even without a sale |
| 11. Grow beyond one operator | Add staff, offers, locations or another business with its own authority and books. Keep cross-business comparisons private | A portfolio overview does not merge customer funds, permissions or legal responsibilities |

**First trust moment:** the first customer gets the exact promised action, and the founder can trace it without assembling messages and spreadsheets. **Deeper trust moment:** the founder takes an afternoon away and a properly authorized person handles a real exception.

An established business can start at import: choose existing storefront and providers, map products, inspect missing periods, reconcile opening obligations, then activate one integration. An imported history retains its original provenance. Importing a CSV never produces a “Verified on NEAR” revenue history.

Business formation belongs in the full vision as a jurisdiction-aware checklist and partner handoff: entity, permits, taxes, insurance and required terms. The product distinguishes “published an offer,” “created an operating account,” and “formed a legal business.” Do not silently combine them.

### B. Acquirer: from an investment or operating thesis to the first shift

| Step and screen | What they see and do | What changes underneath; trust earned |
|---|---|---|
| 1. Buyer onboarding | Choose individual owner-operator, strategic buyer, fund, or cooperative; state interests, available time, operating skills, budget basis and team | A private mandate guides search. Buyer identity and any funding evidence are distinct verification tasks |
| 2. Search | Filter by business type, earnings basis, valuation range or asking price, work required, location, transfer scope and willingness to talk | Search only seller-authorized acquisition projections. See unknowns and source age in results |
| 3. Save and compare | Save a mandate, compare a few candidates, and choose alerts for new matches or authorized changes | Alerts recheck access at delivery. No leaked business names in revoked or anonymous notifications |
| 4. Candidate overview | See what customers buy, why the seller is open, range basis, history coverage, founder work and transfer dependencies | Ask “Could I operate this?” before comparing a headline multiple |
| 5. Introduction | Send a named, purposeful request: requested evidence, intended use, team members and duration | The seller reviews the exact request. A generic account badge does not imply verified funds |
| 6. Evidence room | Open financial bridges, obligations, contracts, operating dependencies, exceptions and the transfer manifest | Reproduce a material metric; spot a missing source or unresolved external transfer |
| 7. Working day rehearsal | Run a fictional support request, a booking cancellation and a failed worker in an isolated copy | Discover what the buyer can do unaided and what still requires the founder or a provider |
| 8. Terms | Separate managed operating control from legal assets, price, retained reserves, consents and completion conditions | Both parties review the same snapshot and manifest. Nonbinding interest is clearly separate from executable acceptance |
| 9. Close | Review exact parties, network, asset, amount, rights and public-chain disclosures; accept the same digest | Internal settlement and control change have receipts. External tasks retain their own pending status |
| 10. First shift | See obligations due, customer exceptions, workers to authorize, provider transfers and support transition | The buyer completes a customer promise purchased before the sale |
| 11. Ongoing ownership | Use the ordinary founder workspace, with retained history and an attributed ownership timeline | The acquisition product hands over to the operating product instead of ending at a congratulatory screen |

**Trust moment:** the buyer independently recomputes an important claim, sees what is missing, and completes a rehearsal task. **Closing trust moment:** the former owner cannot perform a privileged action, while a pre-existing customer entitlement continues.

A cooperative starts as a buying organization with members, discussion, evidence access and a named authorized representative. Governance, pooled investment and fundraising require a separately designed legal and technical model; a team account does not create one.

### C. Customer: from a need to a completed outcome

| Step and screen | What they see and do | What changes underneath; trust earned |
|---|---|---|
| 1. Home | Enter “A beginner printmaking class on Saturday, under 40 demo credits” or “Help my studio fill cancellations” | An editable need is created; anonymous browsing works |
| 2. Confirm constraints | See date, budget and pricing unit, location, accessibility, audience and must-haves as editable chips | Hard constraints are explicit. Unknown accessibility does not silently become a match |
| 3. Results | See a small set with why it fits, price, availability source and next action | Ranking follows customer suitability. No acquisition price or willingness-to-sell information appears |
| 4. Offer | Inspect exactly what is provided, provider, policies, support, availability and relevant work or reviews | A real sample can be tried without creating an account when feasible |
| 5. Act | Book, join a waitlist, start a trial, request a quote, or purchase through a supported flow | Terms and offer version attach to the action. A request is not a booking; a waitlist is not a confirmed seat |
| 6. My activity | See current status, calendar item, next step, contact and cancel/refund options | Payment and fulfillment statuses are independent. A pending payment is not displayed as complete |
| 7. Resolve | Report a problem, receive a documented response, choose a remedy, and track it to resolution | The promise and relevant evidence follow the support case |
| 8. Return | Repeat the booking, renew, review an actual experience, or find a related provider | Reviews attach to the specific experience and date, not merely an account's existence |

**Trust moment:** when a class is full, the product truthfully gives a waitlist place; when capacity opens, the customer gets the seat once. After a business changes operator, the same booking reference still works and the customer knows who to contact.

Only material changes that affect customer terms or service require customer-facing explanation. Do not turn every ownership event into acquisition news in a customer's inbox. Never imply a legal notice is unnecessary where it is required.

## 3. Founders, ideas and honest advertising

### Four public objects, with different jobs

| Object | Content and primary action | What stays distinct |
|---|---|---|
| Person profile | Relevant experience, work samples, current projects, availability for collaboration; “Contact” or “Follow this project” | Identity checks, credentials and commercial success are separate claims |
| Idea page | Problem, intended customer, current stage, prototype, uncertainty, next experiment and a useful request; “Join a pilot” | An idea is neither an operating business nor an investment offering |
| Business profile | The enduring provider: current operator, offers, support, selected history and public updates; “Explore offers” | Customers see service history; private finances and acquisition intent have their own projections |
| Offer/storefront | A specific usable outcome with price unit, availability, fulfillment and terms; “Try,” “Book,” “Buy” or “Request a quote” | One business can have several offers; a generic profile cannot stand in for an actionable offer |

Person and idea can exist before a NEAR contract. The business record acquires a contract identity when it needs on-chain authority or money. Creation date, launch date, connected-history start and legal formation date are different fields.

An idea-stage page can look credible with no revenue:

> **QuietQueue · Prototype**  
> Helping rehearsal rooms fill last-minute cancellations.  
> Available today: a working prototype using fictional bookings.  
> What we know: three interviews, reported by the founder; no paying customers.  
> What we are testing: whether room operators will use a shared cancellation queue.  
> Looking for: one operator willing to try the workflow with test data.  
> **Request a pilot conversation**

Every number in this example is fictional design copy. In the product the interview count opens the underlying claim and date; private interview notes need not be public. The zero-revenue statement should be explicit when revenue is discussed, not replaced with an upward chart.

Offer a stage ladder: **Exploring / Prototype / Piloting / Taking customers / Established**. The founder selects a stage and sees the required explanation. Operational evidence can support the stage; it is not a universal quality certification.

Updates are short records with a useful action: “Released cancellation reminders—try it,” “Pilot taught us this—answer one question,” “Saturday capacity opened—book.” A product timeline is more useful than an endless founder feed. Show corrections and dated revisions; an old claim does not silently become today's truth.

### Traction without theater

Publish selected cards for **interest, usage, commercial activity and outcomes**:

| Claim | Required definition and evidence | Claim it must not become |
|---|---|---|
| Interested people | Unique opt-ins after spam filtering; period; source | Customers |
| Pilot participants | Invited, accepted and active shown separately | Paying subscribers |
| Active customers | Defined activity window, qualifying event, treatment of free and related-party accounts | A lifetime signup total |
| Receipts | Settled money in a named asset and period, with exclusions | Profit or earned revenue |
| Repeat customers | Cohort, qualifying fulfillment, window and denominator | Retention without enough history |
| Delivery reliability | Resolved outcomes and exceptions over a stated eligible set | A guarantee that the next order will succeed |

Customer names, logos, testimonials and work artifacts require permission appropriate to their use. A connected account proves connection, not permission to advertise that customer's endorsement. Flag incentives on reviews and separate transaction confirmation from a claim that the reviewer is independent.

Publication controls are field-level, but understandable: **Public / Invited people / Buyer room / Only our team**. “Preview as a customer,” “Preview the anonymous teaser,” and “Preview as this buyer” render actual permission projections. They are not CSS hiding a complete private record already sent to the browser.

Private by default: unpublished ideas, detailed financials, customers and attendee identities, raw interviews, staff records, contracts, supplier terms, acquisition status, buyer messages and credentials. A founder may make selected metrics public; disclosure is deliberate, versioned and revocable for future access. Already public chain activity and downloaded records cannot be recalled.

Underneath: versioned content, Claim, EvidenceItem, ConsentRecord, audience projections, moderation/reporting and artifact permissions. Profile and update basics **M**; reusable evidence publication **L**. Cut a social feed, follower leaderboards and elaborate theme customization first. Preserve work samples, a clear stage, one actionable offer and trustworthy publication preview.

## 4. Acquirer search and valuations

### Discovery is an explicit seller choice

Use separate settings for **willingness to talk** and **who may discover it**. They are not one “for sale” toggle.

| Mode | Seller experience | Buyer experience |
|---|---|---|
| Closed to approaches | Acquisition notifications off; no acquisition listing | No search result, no hint inferred from hidden counts |
| Private introductions | Invite named buyers or authorize a confidential matching service against selected criteria | Only an authorized recipient receives an introduction opportunity; identity disclosure still requires seller approval |
| Anonymous discovery | Publish a previewed teaser with coarse sector, range and operating information | A permitted teaser; send a named access request through the platform |
| Named acquisition profile | Publish chosen metrics, asking terms if any and openness: curious, open to offers, actively seeking a successor | A clear acquisition profile separate from the storefront |

Anonymity is a disclosure setting, not a guarantee. A distinctive niche, geography, metric combination or on-chain account can identify a company. Coarsen bands, suppress revealing small-group counts and allow omissions. The preview explains combinations that appear identifying. Hidden exact values must not be queryable through repeated min/max filters that reveal them by binary search.

A public acquisition profile does not automatically add an acquisition banner to the customer storefront. That cross-link is a separate choice. Conversely, “private” cannot hide known public NEAR payments, owner changes or current contract sale fields. Exploratory negotiations stay off chain; section 6 identifies the public commit point.

### Search criteria and useful results

| Dimension | Filters and comparisons |
|---|---|
| Fit | Sector, customer type, business model, location, remote operation, languages, skills or licenses required |
| Transaction intent | Open to introductions, actively seeking a buyer, transition timetable, named or anonymous disclosure, permitted buyer types |
| Price | Asking price; platform estimate where eligible; buyer scenario range. Separate filter modes, never one blended “value” field |
| Financial basis | Trailing revenue, normalized earnings, recurring revenue, margin, growth, asset/currency, period length |
| Evidence | Coverage of declared sources, months reconciled, freshness, unresolved exceptions, available independent review |
| Customer quality | Concentration, recurring versus one-off activity, cohort retention where supportable, related-party flags, refund and dispute patterns |
| Operating burden | Founder hours with source, tasks needing founder, staffing, provider dependencies, support load, successful rehearsal evidence |
| Transferability | Managed rights offered, included assets, third-party consents, outstanding obligations, transition support |

Default results emphasize fit and inspectability. A profitable service with demanding work can be a strong owner-operator fit and a poor passive-fund fit. Let users sort by the explicit field they care about; unknowns appear as unknown, not zero.

For price filtering, offer “estimated range overlaps my budget” and the stricter “upper estimate within my budget.” The default is overlap, visibly labeled. A range with missing inputs remains excluded from numeric estimate filters unless the user includes “unestimated.” Asking price always retains its separate label. Currency conversion uses a named rate and timestamp; demo credits have no dollar conversion.

A saved search stores filter version, metric basis, currency, source requirements and delivery preferences. Alerts cover new permitted candidates, a changed asking price, an authorized material financial update, or an improved operating dependency. Deduplicate by business and change. Recheck disclosure permission at send time and at open time. Anonymous teasers use only their published bands for indexing.

### What “verified financials” can honestly mean

**NEAR makes settlement observable; the product must establish what the settlement represents.** Income, market and asset approaches are distinct valuation methods, not interchangeable multiples. That broad distinction is reflected in the [SBA's business-sale guidance](https://legacy.sba.gov/business-guide/manage-your-business/close-or-sell-your-business). The method and thresholds below are product proposals, not valuation advice or market benchmarks.

Every quantitative claim carries two independent labels:

| Source label | Literal meaning | What it does not establish |
|---|---|---|
| **Verified on NEAR** | A stated amount, asset, account, event or state was checked against successful finalized NEAR outcomes | Economic purpose, independent customers, complete financials, legality, asset quality or future earnings |
| **Connected source** | A named integration or operating service supplied the record; show who attested and when | That a provider audited it, that all accounts are connected, or that delivery actually occurred outside the observed system |
| **Founder supplied** | The founder entered or uploaded it | Independent corroboration, even if its digest is later anchored on chain |
| **Estimate** | A calculation or assumption under a named method, with inputs and version | A promise, appraisal, recommended offer or verified future result |

Separately show **Live testnet / Seeded demo / Sandbox / Simulated / Recorded testnet** now. A future production environment gets its own explicit designation. Seeded business activity can be executed on live testnet; its source, synthetic origin and execution environment must all survive. A recording shows the date of the observed run. It is never a live status light.

Derived historical metrics say “Calculated from…” and retain input labels. Their arithmetic can be reproducible while their inputs remain partly founder supplied. A card cannot inherit a blanket NEAR badge because one constituent receipt is on chain. A platform-operated OpenSeat observation is a Connected source with the platform service named, not an independent third-party audit.

For every number, the evidence drawer shows:

- Definition, amount/unit, period and timezone.
- Origin records or a redacted authorized manifest, deduplication and exclusions.
- Formula and version for a derived figure.
- Source coverage with a denominator and missing sources or periods.
- Observed time, ingestion time, finalized block/receipt where relevant, and last reconciliation.
- Any correction, disputed classification or restatement.
- Who may inspect more and why the viewer cannot see a restricted record.

This applies to counts, prices, reviews, charts and search filters as well as revenue. Product measurements such as “three outstanding tasks” link to their filtered records; design constants such as a button's dimensions do not need provenance.

### Build books from events, not from a balance graph

Record separate events for invoice or order, payment, refund, dispute, delivery, subscription period earned, fee, tax, expense, owner contribution, borrowing, internal transfer and sale proceeds. Link them; do not count each link as new money.

Recognized revenue depends on the performance obligation, not simply the time money arrives; this is the relevant accounting distinction in the [IFRS 15 overview](https://www.ifrs.org/issued-standards/list-of-standards/ifrs-15-revenue-from-contracts-with-customers/). Everstreet's proposed management ledger does not by itself claim compliance with IFRS, local tax rules or audited reporting.

The reconciliation screen must answer these separately:

1. **What arrived?** Finalized receipts, refunds and unsettled items by asset.
2. **What was commercial?** Exclude owner funding, loans, transfers, demo issuance and sale proceeds; show uncertain classifications.
3. **What was earned?** Apply the disclosed delivery or subscription policy; retain prepaid amounts as obligations until earned.
4. **What did it cost?** Connected and entered costs, refunds, fees, taxes and owner adjustments, with known gaps.
5. **What remains owed?** Customer promises, payables and other declared liabilities; identify what is actually reserved on chain.
6. **What can be taken out?** Contract availability plus additional business obligations; chain-withdrawable is not necessarily economically prudent or legally distributable.

A payment provider charge, its payout and the receiving bank deposit are one economic flow. Match them with stable external identifiers and reconciliation links. Duplicate imports, refunds after period close and currency conversions generate corrections, not silent historical rewrites.

Six active subscriptions at 20 demo credits produce a **120-credit monthly run rate** if their current recurring terms support it. Twelve times that is a **1,440-credit annualized run rate**, not twelve months of earned revenue. The brief supplies this fictional example; no such revenue history was established by the handoff record.

Completeness is always relative to declared scope. “All connected accounts reconciled” cannot establish that the founder has no undisclosed account, debt or cash expense. Customer independence, circular payments and related parties require additional checks and declarations. A beautiful chain history can still describe manufactured demand.

### The valuation product: three separate outputs

**1. Asking price:** what the seller requests, with date, asset, scope and negotiability. Founder supplied.

**2. Scenario:** what a transparent set of user-selected assumptions produces. Available early; always Estimate, and marked “Scenario only.” It may help an owner consider how replacement labor, churn or concentration affects economics.

**3. Modeled range:** a versioned estimate grounded in sufficient operating history and a usable comparable or income model. Available only after the eligibility gate. It never becomes “Verified on NEAR.”

The initial platform should ship scenarios before claiming a calibrated market estimate. We have no licensed comparable-sales dataset, observed commercial history or validated estimation model in the named files. The full vision should build that capability rather than disguise invented multiples as one.

Proposed pipeline:

| Stage | Rule Claude can build |
|---|---|
| Scope | Specify exactly what is being valued: an operating asset bundle, managed rights, or a legal equity interest. Record included/excluded cash, debt, inventory, contracts and obligations |
| Eligibility | For the initial trailing-earnings model, require twelve complete months, reconciled declared material sources, usable cost history and no unresolved material reconciliation exception. These are proposed product gates, not universal valuation standards |
| Basis | Owner-operator businesses may use documented seller discretionary earnings; manager-run businesses may use adjusted EBITDA or cash earnings; subscription software may use a recurring-revenue basis only when suitable comparables support it. Show definitions and owner-labor treatment |
| Normalization | Reconcile reported results to recurring economics. List every add-back, personal expense, one-off item and replacement-role cost; never assume the founder's work is free |
| Model evidence | Use consented/licensed closed transactions with comparable scope and basis, or an explicit income scenario. Record date, cohort, exclusions, sample size and limitations; asking prices are not closed-sale comparables |
| Calculation | Compute low/base/high scenarios from explicit earnings and multiple or cash-flow assumptions. Keep risk changes visible; no hidden score that arbitrarily deducts value |
| Bridge | Separately bridge operating value to the proposed transaction consideration for included assets, cash, debt and working capital. Do not subtract the same customer obligation both through normalized working capital and again as debt |
| Review | Surface missing consents, owner dependence, concentration, disputed obligations and source gaps beside the range. Human corrections create a new version |
| Publish | Owner chooses the view and permitted audience. Search uses only that authorized range/version and its basis |

For short-history or loss-making businesses, show operating evidence and scenarios or an asset approach appropriate to the scope. For an idea with no customers, show experiments and costs of building, not an automatic business valuation. Replacement cost is itself an estimate and does not prove someone will buy the idea.

Illustrative calculation, **entirely fictional, Scenario only, demo credits**:

| Input | Amount | Source in this design example |
|---|---:|---|
| Trailing earned revenue | 120,000 | Seeded illustrative ledger, not the existing OpenSeat handoff |
| Recurring operating costs excluding founder labor | 65,000 | Seeded illustrative expense records |
| Replacement operator cost | 15,000 | Estimate entered for this scenario |
| Normalized annual operating surplus | 40,000 | Calculation: 120,000 − 65,000 − 15,000 |
| Assumed low/high multiple | 2× / 3× | Deliberately arbitrary scenario inputs, not market data |
| Operating value scenario | 80,000–120,000 | Calculation: 40,000 × the assumed multiples |

The interface reads: **“80,000–120,000 demo credits · Estimate · Scenario only.”** Beneath: “Uses assumed multiples and replacement labor. Transaction scope, cash, debt and working-capital adjustments are not included.” Do not label this a likely sale price, display it as a market comparable, or use it for a default automated valuation search.

A future comparable model can display its own assumptions and observed error. Until there is a tested statistical interpretation, the low/high interval is a scenario range, not a 95% confidence interval. Do not assign a made-up 92% valuation-confidence badge.

### Confidence, freshness and buyer usefulness

Show **evidence strength** and **model uncertainty** separately. Evidence strength uses visible dimensions: period completeness, source mix, reconciliation, cost coverage, customer concentration disclosure and independent review. Model uncertainty explains peer relevance, small samples, sensitivity and forecast dependence. Strong receipt evidence can coexist with very uncertain value.

Coverage examples must identify their denominator: “8 of 12 months reconciled” or “112 of 120 declared receipt units traced.” They do not mean 93% of the entire business is verified. A missing cost source can prevent an earnings estimate even when receipts are complete.

A fresh calculation based on old data is still stale. Show “calculated today; source current through September.” Proposed initial policies: recompute after reconciled changes; poll near-real-time chain settlement according to finality; reconcile connectors on their declared cadence; warn after a missed expected sync; remove a stale estimate from “current only” results. Put specific thresholds in a versioned freshness policy by source, not a universal green dot.

On model or input changes, show **“What changed?”** with the old and new version. An accepted deal stays bound to its agreed snapshot; a changed dashboard cannot silently rewrite sale terms. Material changes trigger renewed review through the deal's explicit rules.

The bold capabilities worth building are:

- **Live, reproducible metrics:** authorized buyers can trace a receipt total to finalized transactions and reconciled source records.
- **Immediate checks of narrow claims:** recompute a month's receipts, find duplicate entries, inspect registered reserves, and compare a live ledger to a frozen snapshot.
- **Continuous diligence:** missing periods, dependencies and liabilities are addressed during ordinary operations instead of first appearing at sale.
- **Offers tied to exact evidence:** terms name the model version, evidence snapshot, transfer manifest and permitted conditions.
- **On-chain closing of supported rights and funds:** pre-funded settlement and control change can be enforced together within one contract's accounting boundary.

Whole-business diligence is not instant. Legal title, commercial substance, people, omitted liabilities and external-provider transfer still need work. Keep a short sentence beside every range: **“An estimate based on the sources and assumptions shown. It is not an appraisal, advice, an offer, or a promised sale price.”** The explanation and missing-data behavior do more work than the disclaimer.

Underneath: source ingestion, a correction-capable management ledger, reconciliation, Claim and MetricDefinition, versioned models, scoped search projections, access grants and exportable evidence. **XL** for defensible automated valuation; **M** for an honest scenario calculator after the evidence foundation exists.

## 5. Finding services: a need becomes an outcome

### Matching rules that a customer can understand

The finder translates a sentence into editable fields. A conventional form and category browse work without an AI service. If the need is ambiguous, ask one question whose answer changes the eligible set. Do not force a conversation to book an ordinary class.

The ranking process is deliberately inspectable:

1. Exclude unpublished, unavailable, disallowed or incompatible offers.
2. Apply hard constraints: location or delivery area, date, total budget in the relevant unit, audience, required capabilities and accessibility.
3. Treat an unknown hard requirement as unconfirmed. Put those offers in a separate “May fit; needs confirmation” group only if the customer chooses it.
4. Rank eligible offers by explicit outcome fit, confirmed availability, relevant fulfillment evidence, responsiveness and the user's chosen preferences.
5. Allocate a small disclosed exploration opportunity to suitable new offers so a lack of history does not make entry impossible. Do not relax safety or eligibility requirements for exploration.
6. Explain the specific match from catalog facts: “Beginner class; Saturday; 35 demo credits total; two seats shown by the booking service.”

Prices, counts and timestamps in this section are fictional interface examples, not current availability. In a built product the final seat check occurs when reserving.

Ranking cannot be bought. Subscription tier, acquisition fees, estimated company value, willingness to sell and payments to Everstreet are prohibited ranking features. Keep the ranking version and a human-readable reason for an offer's eligibility. Publish the broad factors and provide a correction/appeal path. Anti-spam details may remain private; commercial favoritism may not.

Choose no sponsored placements initially. If sponsorship is ever added, it occupies a separately labeled surface and never changes organic order, filters or fit explanations. Do not sell a “verified” placement.

### Actions have different meanings

| Offer type | Completed customer action | Required operating support |
|---|---|---|
| Software | Working trial or activated subscription with stated access | Provisioning, renewal/cancellation, service support, entitlement status |
| Class or appointment | Confirmed booking, or an explicitly separate waitlist entry | Capacity, holds if paid, cancellation, promotion, reminders and calendar |
| Scoped professional service | Accepted scope, schedule and quote; later delivery acceptance | Availability, revisions, milestones, remedies and evidence of completion |
| Physical product | Order accepted with inventory and shipping terms; fulfillment confirmed later | Stock, shipping, tracking, returns, address privacy and dispute support |
| Idea-stage project | A pilot conversation or test enrollment | Consent, expectations, contact and cancellation; no invented purchase |

The first implementation has a real booking and software workflow. A physical-product example may be discoverable as an inquiry, with any fulfillment simulation labeled at the action. A “Buy” button without inventory, payment-state and remedy behavior is not physical-commerce support.

For a customer with no match, show the blocking constraints and offer one deliberate relaxation. Preserve the original query. A request board can let the customer publish a redacted need to relevant providers, after an explicit preview and choice. Do not automatically email a directory of businesses.

Founders receive aggregated unmet-demand information only with appropriate consent and sufficient volume. Suppress combinations that expose an individual person's situation. The initial demand board can work manually; the ambitious version helps founders launch an offer against a real gap in their community.

### The same business, different authorized projections

Maintain distinct indexes for public offers, published people/ideas, seller-approved acquisition teasers and grant-scoped evidence. Their data originates in a common business record, but each projection has a whitelist of fields and its own authorization.

That boundary includes facet counts, search suggestions, snippets, link previews, page titles, caches, analytics exports, emails and assistant retrieval. A customer request must never fetch a private business object and then hide the acquisition fields in the UI. Private records do not enter general-purpose embeddings or a public assistant context.

The customer-facing offer shows price, terms and availability. The buyer-facing business can show aggregate demand, economics and operations, subject to permission. A buyer who opens the storefront gets the same public offer as anyone else. A business's changing ownership cannot silently change the terms attached to an existing customer entitlement.

Underneath: Need, typed constraints, OfferVersion, availability adapters, a deterministic eligibility engine, consent-aware projections, action attribution and remedies. **L**. Cut natural-language interpretation, maps and recommendations before cutting reliable filters or a completed customer action.

## 6. NEAR underneath, for real

### The architecture and its trust boundaries

Keep **control, registered reserves, buyer funding and the seller's settlement claim in one contract per business**. This preserves the existing useful atomic boundary. Keep private customer operations and commercial interpretation in services that can be exported, audited and transferred.

~~~text
Phone / browser
  ├─ Personal identity and explicit acting context
  ├─ Public offers and private workspace APIs
  └─ User-approved signing or scoped routine commands
          │
          ├─ Platform database
          │    Profiles, offers, memberships, grants, deal drafts
          │
          ├─ Operating service, initially OpenSeat
          │    Capacity, bookings, customer rights, tasks, outbox
          │
          ├─ Evidence and accounting workers
          │    Source ingestion → reconciliation → metrics → scenarios
          │
          └─ NEAR business contract
               Owner + generation + scoped authority
               Asset ledgers + registered reserves
               Exact sale terms + internal settlement
                       │
                       └─ Finalized events → rebuildable projections

Encrypted evidence store ← restricted source records and documents
Provider adapters        ← payments, accounting, hosting and transfers
Optional later services  ← attestation registry, foreign-chain signing
~~~

The platform database is authoritative for publication and access grants. The business contract is authoritative for the on-chain owner, registered funds and accepted sale state. OpenSeat remains authoritative for its private booking state. The management ledger interprets financial events under declared policies. No one component can claim the powers of another.

The service host is a trusted operator with the ability to interrupt service or tamper with its database. Reduce that dependence through signed receipts, append-only exports, backups, restore drills, independently checkable histories and actual hosting transfer. Anchoring a log can reveal a later change; it does not stop a host from lying before anchoring, withholding data or going offline.

### Proposed contracts and main methods

Names below are brand-neutral logical modules. Claude can combine modules where it preserves clear authority. Do not build a contract for every product noun.

| Contract | Main methods or views | Authority and size |
|---|---|---|
| **business_factory** | create_business(owner, version, config_hash), get_deployment, get_supported_versions | Deploy reviewed code and initialize a new locked business. No power to replace existing child code or owners. Publish readiness only after successful creation/initialization and key inspection. **M–L** |
| **business_control_v2**, one per business | Existing control/sale methods; payment, reserve and subscription methods below; paginated views | Holds owner, generation, grants and one ledger per accepted asset. No arbitrary-call, generic upgrade or ownership bypass. **XL** |
| **evidence_registry**, optional | anchor_snapshot(root, period, manifest_hash), attest_claim, supersede_attestation, revoke_attestation, get_attestation | Records issuer, schema, commitment and chronology. Attestor enrollment/revocation powers are public and separate from business control. Can begin with service-signed manifests before adding this contract. **M–L** |
| **organization_controller**, later | propose_action, approve_action, execute_action, change_member, start_recovery, cancel_recovery | A threshold-controlled owner account for a fund or cooperative. Membership, limits, delay and recovery powers are disclosed; business ownership still belongs to its account. **L–XL** |

Do not start with a universal sale escrow contract separate from business control. Two independent contracts cannot be assumed to roll back together. If later requirements force separation, the locking, timeout and recovery protocol becomes a distinct reviewed subsystem.

The next business contract's interface should include these capabilities:

| Area | Proposed methods and behavior |
|---|---|
| Control | get_control, operator_check, appoint_operator, revoke_operator; grants can include capability, resource scope, expiry and limits, all bound to generation |
| Incoming funds | ft_on_transfer for a specifically allowed test token; optionally a distinct native-asset payment method later; get_payment and get_operation |
| Internal balances | pay_from_balance, fund_prepaid_balance, withdraw_customer_balance; distinguish order payment, prepaid customer money, owner capital and acquisition funding |
| Promises/reserves | register_entitlement or payment-time entitlement creation, request_refund, claim_refund, get_reserves; reserve release follows explicit original terms |
| Subscription mandate | authorize_subscription, charge_period, cancel_subscription; enforce period, total cap, per-period cap, expiry, balance and replay protection |
| Sale | propose_sale, revise_sale, accept_sale, cancel_sale, expire_sale, claim_released_hold, get_deal |
| Outgoing funds | withdraw_available, withdraw_proceeds, private completion callbacks, get_operation; reserve funds while pending |
| Optional evidence | commit_receipts or an external registry anchor, with opaque commitments and bounded batches |

Method names describe proposed behavior, not existing APIs. The current demo mint remains a test-only feature and cannot survive into a real-money asset ledger as unrestricted value creation.

**Reserve policy needs more design than “the operator said delivered.”** A service observation can support a revenue-recognition entry without giving an owner unlimited power to release protected money. Use deterministic cancellation windows, customer acknowledgments, time-based terms for appropriate services, or a named dispute process according to the product. An arbiter introduces trust and must have narrow, visible powers. Until a delivery type has an enforceable rule and remedy, describe the reserve protection narrowly. Do not turn an AI judgment or owner assertion into proof of physical fulfillment.

The existing contract binds a registered obligation to its beneficiary, but does not establish that the obligation is commercially legitimate or that all liabilities were registered. It also does not provide a general customer-triggered refund system. Those are new design tasks.

### What each business event looks like

| Object or event | On NEAR | Off chain, with reason |
|---|---|---|
| Business | Stable contract account for that deployment, owner, generation, supported asset/configuration, code version | Brand, description, legal identity documents and provider details; avoid publishing private documents |
| Payment | Accepted asset contract, integer base-unit amount, payer/account linkage, opaque order commitment, operation and final outcome | Invoice, tax interpretation, customer identity and commercial purpose; financial interpretation needs context |
| Subscription | A bounded prepaid authorization or funded mandate, period identifiers and charges where used | Plan copy, customer contact, service access, invoices and earned-revenue allocation |
| Booking | Optional payment/entitlement commitment, reserve and batched receipt root | Capacity, attendee, accessibility, waitlist, schedule and calendar. Frequent private operations do not need public per-person records |
| Revenue record | Receipt evidence and optionally a commitment to an accounting snapshot | Revenue classification, expenses, recognition policy and adjusted earnings. A hash proves a snapshot has not changed, not that it is true |
| Ownership change | Parties, accepted digest, settlement asset/amount, owner and generation transition | Negotiation, legal agreements, private evidence, provider consents and actual external transfer work |
| Operator permission | Account/capability/generation and future scope/limit/expiry | Human role, employment details, contact and service permissions. Every service still enforces its own resource checks |

A booking commitment does not enforce scarcity. The transactional booking service controls capacity. Do not call an off-chain seat “on-chain inventory” because its receipt hash appears in a batch.

Public-chain privacy is limited. Accounts, transfers, amounts and timing can be correlated. The current sale methods expose buyer, seller, price and expiry. The current fulfill_obligation call reveals the beneficiary and salt in transaction arguments; its memo is public too. Use opaque identifiers, high-entropy salted commitments and no personal or descriptive commercial text in public payloads. Salted hashes are not encryption, and redemptions can reveal linkages.

Before enabling direct on-chain payments, show the founder which records will be public. A connected payment provider with private source records and selective attestations is a different privacy tradeoff. A customer or seller who needs undisclosed financial flows must not be told that a private UI hides public settlement.

### A payment that actually funds a booking

Start with one accepted test fungible token in a new business version. Validate the calling token contract and the original payer, amount, asset, expiry, terms commitment and operation identifier. A token with the same display symbol must not be accepted as the allowed asset. NEAR's FT receiver pattern distinguishes the token contract caller from the sender and resolves unused funds through subsequent execution. [Official FT receiver guidance](https://docs.near.org/smart-contracts/security/cross-contract-calls/ft-transfer-call)

Proposed flow:

1. The booking service creates a short-lived capacity hold with an opaque ID and an immutable price/terms snapshot.
2. Checkout identifies the hold and chosen test asset; the customer's approved action funds the business contract.
3. The contract records a payment exactly once and allocates any customer reserve. An indexer verifies successful finalized outcomes.
4. An idempotent service transaction converts the hold into a confirmed booking and emits the customer receipt.
5. If money arrives after capacity expires, display “Payment received; seat unavailable” and create the supported refund path. Do not sell a waitlist place by accident.
6. If the service is unavailable after payment, retain “Payment received; booking confirmation pending.” Reconcile the operation before retrying.
7. Cancellation and refunds follow the recorded policy. Their payment state and seat state are visible independently.

There is no atomic database-plus-blockchain transaction. The flow is a recoverable sequence with explicit intermediate states. The free/current OpenSeat booking can ship first; adding payment changes its concurrency and remedy requirements.

### Subscriptions without fictional automation

Use a prepaid, capped mandate first. The customer approves business, plan version, asset, period limit, total limit, expiry and cancellation rules. A keeper submits a due charge; the contract enforces once-per-period charging and available funds. Contracts do not wake themselves on a schedule.

An ordinary function-call key does not authorize arbitrary withdrawals from a customer's wallet. Auto-renewing card subscriptions use the provider's mandate and source records, not an invented on-chain pull mechanism. Customer renewal status, settlement and earned revenue remain different records.

Ownership change does not expand the customer's original authorization. A new owner must appoint its workers; accepted existing customer terms and entitlement periods survive. A material change of plan, counterparty or payment mandate follows the required customer approval or notice process.

### Settlement: preserve the useful atomic boundary

The buyer pre-funds an internal claim in the same business contract and accepted asset. Both parties accept a digest containing network/domain, contract, deal/version, seller, buyer, asset, amount, expiry, generation and the commitments to scope and evidence.

The second matching acceptance can atomically:

- Validate the current parties, generation, terms and pre-funded amount.
- Credit the seller's internal proceeds claim.
- Change the owner and increment the generation.
- Preserve registered customer reserves and treasury accounting.
- Make competing deals ineligible and their buyer holds recoverable.

The correct success message is **“Managed control transferred. Proceeds available to withdraw.”** Withdrawal to another account or contract is a separate operation. A bank payout is another external process. NEAR cross-contract calls execute independently; their failures do not provide a global rollback of earlier successful calls. [Cross-contract execution](https://docs.near.org/smart-contracts/anatomy/crosscontract)

For outgoing payments, remove funds from available balance before sending and hold them as pending. Bind private callbacks to operation, asset, amount, recipient and prior state. A callback may complete a previously authorized operation after ownership changes; it must not treat the new owner as the old operation's beneficiary or silently strand an old pending payment by rejecting every prior generation.

Persist submitted transaction/operation identifiers. A timeout means “outcome unknown,” not permission to pay again. Verify finalized successful receipt outcomes, including required downstream resolutions. [NEAR finality guidance](https://docs.near.org/integrations/blocks-and-finality) Recovery from a failed callback or stuck operation needs a reviewed protocol; a server must not simply restore a balance because it did not receive a response.

### Revenue ingestion and attested connectors

The evidence pipeline is:

~~~text
Finalized chain outcomes / authenticated provider responses / founder entries
    → immutable source records with provenance
    → deduplication and reconciliation
    → versioned financial classifications
    → metric snapshot with coverage and exceptions
    → scenario or eligible valuation model
~~~

A connector attestation records issuer, provider, authenticated account scope, permission scope, covered period, observation time, pagination/completeness result, schema, record commitment and signature. Credentials remain in a restricted secret store, never a proof drawer.

If the platform signs an observation, the claim is “the platform retrieved these records from this connection.” It is not “the bank audited this business.” Key compromise, revoked source access and a corrected import have visible states. The registry's administrator can approve attestors, so the trust in that administrator must be stated.

Do not invent inaccessible provider signatures. Where a provider supplies no signed record, keep the attestation tied to the observing connector and its retrieval log. A later independent accountant can issue a separate attestation with a defined scope. Neither replaces omitted-source declarations.

### Account creation, keys, recovery and gas

The experience can be wallet-light while remaining honest about control:

| Moment | Experience | Actual authority |
|---|---|---|
| Browse, create an idea, make a free booking | Ordinary website and passkey/email sign-in as appropriate | No NEAR signing required for these off-chain actions |
| Create a business workspace | Choose name, offer and responsible people | App membership only until a business contract is provisioned |
| Activate on-chain control | “Set up who can approve money and ownership changes”; choose supported signing/recovery option | A controlling account with its own signer becomes owner of a separate keyless business contract |
| Routine operations | Approve a bounded task or use an authorized worker | Scoped commands, capability checks, resource limits, expiry, generation and nonce |
| Sale acceptance, withdrawal or powerful permission change | Human-readable review and fresh confirmation | Independently controlled, deposit-capable signing path or a reviewed organization controller |
| Lost device | Restore through the selected recovery policy; show delay and remaining approvers | Recovery for the controlling account, not a platform override of the business contract |

NEAR supports full-access and restricted function-call keys; ordinary function-call keys cannot attach NEAR. The current contract's one-yocto privileged methods therefore require a suitable deposit-capable path. Restricting a key by method does not express business-level amount, resource and expiry limits; those belong in the contract/service. [NEAR access-key permissions](https://docs.near.org/protocol/accounts-contracts/access-keys), [one-yocto boundary](https://docs.near.org/smart-contracts/security/one_yocto)

NEAR Auth is a candidate for social/passkey onboarding through its documented Auth0/MPC approach. It is not evidence that an ordinary browser passkey directly signs every current NEAR transaction. Its mainnet access and custody/recovery properties need integration review. Keep external user-controlled wallet support as a concrete alternative. [NEAR Auth tutorial](https://docs.near.org/web3-apps/tutorials/near-auth)

Gas sponsorship can use delegated transactions: the user signs the allowed action and a relayer pays execution costs. This does not remove account initialization, storage or relayer costs. Put sponsorship budgets, allowed methods and abuse limits in the service; validate the effective predecessor rather than treating the relayer signer as the owner. [NEAR meta transactions](https://docs.near.org/protocol/transactions/meta-tx)

**The founder and buyer need independently controlled signing and recovery authority before meaningful ownership or money moves.** That can be their own wallet/key or a clearly disclosed, reviewed distributed signing arrangement; it cannot be the platform silently retaining everyone's full-access keys. The current demo stores all fictional actors' keys on one machine and must keep that label.

Provide a second-device or separately held recovery option and an actual lost-device exercise. An email support agent must not be able to give a seller ownership back after a sale. A recovery policy for the seller's account restores that account, whose business rights have already ended. Organization recovery is another governance power the buyer must understand.

The business contract itself remains keyless. Its owner account holds authority by the contract's rules. These are different accounts and different recovery stories.

### Long-lived immutable contracts

The deployed v1 has no upgrade or migration method. A factory, registry alias or new frontend cannot move its obligations, balances or accepted terms.

Near term: deploy new versions for new activity; retain legacy obligations in their original contracts and display both in the business history. Explicitly reconcile any withdrawal/redeposit and make successor adoption visible. No claim is copied and forgotten in the old ledger. Existing DEMO credits do not become redeemable mainnet balances.

Future versions may include a narrow, audited successor protocol with consent, liability reconciliation, migration state, cancellation and recovery rules. That is substantial work, not a setting to add casually. An unrestricted upgrade key would materially weaken the current promise. The platform should disclose contract version, code hash and any migration or emergency powers in the evidence view.

Use paginated views, bounded operations, asset-specific arithmetic, storage budgets and event projections from the start of the next version. A company intended to run for years cannot require every historical deal to fit in one closing call.

Three source-level reliability observations need Claude's attention before expansion; this pass did not execute tests to reproduce them:

1. Current finalize iterates all operators and open deals. A new version should invalidate by generation and support bounded/lazy hold recovery, so scale cannot make closing unexecutable.
2. OpenSeat checks a previous op_id before asynchronous authority reads, then executes without rechecking the dedupe record inside its write transaction. Put deduplication and effect in one transaction and bind the ID to a command digest. This matters for concurrent deliveries, not just sequential replay.
3. A final-state authority read is not a lock over a later service mutation. Use an explicit handoff barrier for managed operations, drain/reconcile in-flight work and fence workers. An owner generation cannot retract an irreversible action already submitted to another system.

The next command envelope should bind protocol version, network, business, service audience, actor, capability, arguments digest, generation, operation nonce and expiry. Services should not treat possession of any key on an account as unlimited authority.

### Where the rest of NEAR earns a place

| Component | Worth doing when | Design boundary and recommendation |
|---|---|---|
| **Chain Signatures** | A business needs to control a foreign-chain service identity through an ownership change | Derive from the business contract, not a founder's personal account. Gate exact chain, destination, method, value, nonce, generation and expiry. Signature generation is separate from broadcast and confirmation. **Later L–XL** |
| **Intents** | A customer has a supported asset different from the business's accepted settlement asset | Present a bounded quote, fees, minimum delivery, expiry and remedy; consider the order funded only when the accepted asset arrives. Ordinary service search is not this protocol. **Later L** |
| **NEAR AI** | Private evidence summarization benefits from a selected confidential execution route | Use scoped retrieval, verify the relevant execution evidence, preserve source labels, and never silently fall back to a less private route. It cannot certify source truth or authorize a deal. **Optional M–L** |
| **NFT ownership** | A future interoperability need requires a transferable representation | Every transfer/approval route would have to preserve the sale and reserve invariants. Current controlled ownership already works. **Do not add now** |
| **Private cryptographic financial proofs** | Selective threshold disclosure becomes valuable enough to justify research | A proof over chosen records does not establish source authenticity or completeness. Ordinary salted hashes do not implement this. **Research XL** |

Chain Signatures uses a NEAR-controlled signing flow for other chains; the implementation and supported deployments must be verified when building. [Chain Signatures](https://docs.near.org/chain-abstraction/chain-signatures), [implementation reference](https://docs.near.org/chain-abstraction/chain-signatures/implementation)

An already-issued foreign-chain signature may remain usable after a NEAR ownership change. An ordinary external account transaction does not learn the new NEAR generation. Resolve or invalidate outstanding transactions before close, or use a receiving application with explicit epoch/expiry enforcement and a verified authority update. A new business account also changes account-derived foreign addresses. Do not promise effortless contract migration and permanent derived addresses without a design for both.

Intents belongs at asset conversion and settlement, with solver and completion dependencies shown. [NEAR Intents overview](https://docs.near.org/chain-abstraction/intents/overview) NEAR AI verification can support claims about a selected execution environment; route-specific terms and data treatment still matter. [NEAR AI verification](https://docs.near.ai/cloud/verification), [route terms](https://near.ai/terms-of-service)

The useful AI roles are drafting an offer, converting a need into editable constraints, explaining a source-linked metric, identifying missing evidence and drafting a runbook. None is a privileged decision-maker. Listings and uploaded documents are untrusted input, not instructions to reveal data, rank a seller or send money.

### Mainnet is an operating-model gate

Design network, asset, fees, custody adapter and environment labels as explicit configuration now. Production activation still requires reviewed contracts, independent keys, recovery, incident handling and a new deployment. It is not changing one environment variable.

Before real money or acquisitions, Tony needs a jurisdiction-specific decision with appropriate specialists on custody and payment responsibility, money transmission or equivalent obligations, refunds and chargebacks, marketplace rules, taxes, asset/entity sale scope, data protection, and any brokerage or securities role. These are named unresolved responsibilities, not claimed legal conclusions.

Cooperative investment, revenue-sharing interests and fractional business tokens can enter securities territory and require their own model. For example, US Regulation Crowdfunding involves a regulated intermediary and specific rules; a token or a “community” label does not substitute for that process. [SEC Regulation Crowdfunding overview](https://www.sec.gov/resources-small-businesses/exempt-offerings/regulation-crowdfunding)

Keep test balances nonredeemable and all examples fictional. A later legal and payment model should shape the production implementation; it must not be retroactively implied by the testnet experience.

## 7. The UI: a useful place to do business

**The interface should feel like a well-run street of independent businesses.** Public pages have the warmth of a shop window and the clarity of a good service counter. Workspaces are calm and practical. Financial and acquisition views are precise enough to inspect. A customer should recognize the same business in all three, while seeing only the information appropriate to their purpose.

The signature interaction is a small, understandable promise that opens into its history: what someone bought, what remains owed, what happened, who may act, and what happens next. The signature visual is a readable offer with a clear action. Neither needs a crypto aesthetic.

### Site map and navigation

These are proposed routes, not existing files. Internal entities and route identifiers stay brand-neutral.

~~~text
Public
  /                                  Home: find something useful
  /find                              Customer results and editable constraints
  /categories/:slug                  Curated category or local collection
  /offers/:slug                      A particular offer and customer action
  /businesses/:slug                  Public provider profile and storefront
  /people/:slug                      Published founder profile
  /ideas/:slug                       Published idea, experiment and invitation
  /start                             Start, import or take over a business

Personal account
  /activity                          Bookings, orders, trials and requests
  /activity/:id                       One promise, receipt, status and remedy
  /saved                             Offers, people, ideas and saved needs
  /inbox                             Conversations with explicit acting context
  /account                           Profile, sign-in, recovery and preferences
  /account/access                    Connected signing identities and devices

Business workspace
  /workspaces/:id/today               Promises due, exceptions, delegated work
  /workspaces/:id/ideas               Private ideas and experiments
  /workspaces/:id/offers              Drafts, published offers and availability
  /workspaces/:id/offers/:offerId      Editor, preview, versions and outcomes
  /workspaces/:id/customers           Customer relationships and commitments
  /workspaces/:id/operations          Tasks, runbooks, integrations and jobs
  /workspaces/:id/money               Receipts, earned amounts, costs, reserves
  /workspaces/:id/evidence            Sources, reconciliation and disclosure
  /workspaces/:id/team                Membership, authority and pending grants
  /workspaces/:id/continuity          Dependencies and founder-away rehearsals
  /workspaces/:id/acquisition         Visibility, introductions and sale settings
  /workspaces/:id/value               Private value scenarios and assumptions
  /workspaces/:id/settings            Identity, policies, exports and versions

Buying workspace
  /acquire/:teamId/search             Mandate and permitted candidates
  /acquire/:teamId/saved              Shortlist, comparisons and saved searches
  /acquire/:teamId/businesses/:id      Authorized acquisition detail
  /acquire/:teamId/businesses/:id/value
  /acquire/:teamId/team               Members, advisers and approval roles
  /deals/:id                          Room, scope, versions and closing state
  /deals/:id/rehearsal                Isolated first-shift exercise
  /deals/:id/handoff                  Outstanding transfers and first shift
~~~

Use the navigation from section 2: Personal has Discover, My activity, Inbox and Account; business has Today, Customers, Offers, Money and More; buyer has Search, Saved, Rooms and Team. Saved personal items remain reachable from Discover and Account. More opens a labeled sheet, not an unexplained icon grid.

The acting-context control is always visible at the top. A narrow screen shows the business or team name and role; tapping opens the full switcher. Keep unfinished drafts in their original workspace when switching. A protected deep link either opens in the authorized context or explains which account/team is required. It must never silently act as a different principal.

Acquisition detail is a separate route and server projection from the public business profile. A “View customer storefront” link opens the actual public page. It does not add private tabs to a public route. Every screen that can publish, disclose evidence, grant authority or accept terms repeats **who is acting for whom** beside its primary action.

### Layout and visual system

**Tone.** Specific, warm and competent. Prefer “Your booking is confirmed,” “This source is two days late,” and “Hosting transfer still needs the seller.” Avoid “transaction failed” when the application only lost its connection. Avoid slogans inside task flows.

**Type.** Start with Georgia for major public headlines and a system sans-serif stack for body text, controls and workspaces. This gives the brand an editorial character without adding a font dependency. Workspace headings use the sans-serif. Money uses tabular numerals; currency/unit labels never disappear. Proposed sizes: body 16/24 px, secondary copy 14/20, source labels at least 13/18, mobile public headline 32/36, workspace headline 28/34. Use sentence case. Do not shrink financial tables until they fit.

**Colour.** Proposed tokens:

| Role | Token | Use |
|---|---|---|
| Page paper | #F6F2E8 | Warm public background and quiet workspace surround |
| Surface | #FFFFFF | Forms, evidence, orders and reading surfaces |
| Primary ink | #202D2A | Main text and important numbers |
| Action forest | #245746 | Primary button and links |
| Pale lime | #D0E4AE | Small editorial accents and selected backgrounds, with dark text |
| Caution | #8B4B12 | Stale sources, unresolved prerequisites and unconfirmed availability |
| Error | #9C3029 | Failed actions, denied authority and blocking problems |
| Border | #D9DED5 | Dividers and grouping, not the sole indicator of control boundaries |

Claude should validate text, control and focus contrast in the implementation; these colours are direction, not a completed accessibility audit. Never communicate state by colour alone. A green check on a whole company is too broad. Evidence labels use text and a small consistent icon; “Verified on NEAR” names a specific fact.

**Density.** Public pages show fewer, richer offers. Founder Today shows a short priority list before summaries. Acquisition comparison can be denser because its task is deliberate inspection. Desktop gets a 240 px side rail, a main work area and an optional source panel. Use a maximum page width around 1,280 px and keep long explanatory text near 65–75 characters per line.

**Mobile.** Design at 360 px and support 320 px without horizontal page scrolling. Use 16 px side gutters, spacing in multiples of four, and 48 px primary touch targets. Put the next action above the bottom navigation and safe area; never cover the last content row. Filters and source details open as accessible bottom sheets with a full-screen expansion for long material. At desktop widths they can become side panels. Use explicit labels, visible focus, keyboard operation and a logical reading order. Preserve 200% text zoom and reduced-motion behavior.

**Images.** Use relevant work, products and places with permission. Fictional seed imagery is labeled as illustrative. Avoid generic founder portraits implying real people or a wall of invented customer logos. Until photography exists, a good title, honest sample and legible offer card are sufficient.

**Motion.** Small transitions can explain a changed status, but confirmed events drive them. No rising balance counters, celebratory confetti over unresolved transfers or automatic valuation tickers. A status timeline with timestamps is more useful than an animated chain diagram.

### Shared components Claude should build once

| Component | Required behavior |
|---|---|
| Acting-context header | Name, role, environment and switcher; repeated principal on consequential actions |
| Offer card | Outcome, provider, price/unit, availability source, fit reasons and one honest action |
| Quantitative claim | Value, unit/period, source access, freshness and environment; supports unavailable and restricted values |
| Promise card | Current entitlement, next step, responsible party, deadline, reference and remedy |
| Source drawer | Definition, source lineage, covered period, exclusions, freshness, limitations and authorized records |
| Status timeline | Independent payment, fulfillment, authority and external-transfer events; no single misleading completion badge |
| Review sheet | Exact publication/disclosure/permission/terms change, acting principal and explicit acceptance |
| Diff view | What changed since the last version; material differences cannot be hidden behind a summary |
| Evidence gap | Missing input, consequence and a useful next action; never a zero-value substitute |
| Async operation | Requested, submitted, pending, confirmed, failed or outcome unknown; persistent ID and safe reconciliation action |

No numeric placeholder should look like a real zero. Loading displays a skeleton or “Checking.” An unavailable value displays “Unavailable,” and a private one displays “Access required,” without leaking the underlying count. A seeded fixture value keeps its label in screenshots, exports and copied text.

Provide a quiet environment strip for the development product: **“Testnet · demo credits have no monetary value.”** A recorded evidence card still says **“Recorded testnet · observed [date]”**. Environment cannot be inferred from a different background colour.

### Key screen specifications

#### Home

**Job and first glance:** help someone express a need. The first screen has the Everstreet wordmark, context/sign-in control, “What do you need?”, a generous search field and three examples spanning personal, business and product needs. Secondary links are “Start a business” and “Find a business to own.” Below, show a small useful collection, not unverifiable marketplace totals.

**Actions:** search in plain language; browse a category; edit location when relevant; resume a saved need.

**States:** Empty catalog: explain the current community and show only available examples. Loading: keep the query editable while results load. Error: retain the query and offer ordinary form search if interpretation fails. Do not require location for a remote software need.

**Needs/size:** public offer projection, category taxonomy and deterministic search; **M**.

#### Customer search results

**Job and first glance:** compare eligible outcomes. Show the query and editable hard-constraint chips first, then result cards. Each card prioritizes outcome, total or unit price, current availability and why it fits. Put “Needs confirmation” offers in a separate group.

**Actions:** inspect a match explanation; change one constraint; compare a small selection; open the offer; save the need.

**States:** Empty: name the blocking constraint and offer a specific relaxation without applying it automatically. Loading: preserve constraints and the previous results as explicitly previous, not current. Error: mark unavailable source fields and disable instant confirmation when availability cannot be checked. A partial result set explains what could not be searched.

**Needs/size:** typed constraints, source-aware eligibility, availability adapters and ranking explanations; **L**.

#### Onboarding and the first offer

**Job and first glance:** get to the next useful object. Begin with “I have an idea,” “I already serve customers,” or “I am taking over.” Ask one purposeful cluster at a time: customer/outcome, current evidence, offer, fulfillment, public preview. Show named steps and save status, not a fake percentage of business success.

**Actions:** save a private draft; use a working template; import a declared source; preview; publish the selected fields; test the customer action.

**States:** Empty: a founder with no revenue can publish an honest prototype or pilot invitation. Loading: autosave is visible and does not block typing. Error: preserve field values, show the affected field and retry the save. If a payment or fulfillment adapter is missing, offer an inquiry flow rather than pretend checkout is ready.

**Needs/size:** drafts, offer versions, validation, publication permissions and template-specific readiness rules; **L**.

#### Founder profile and idea page

**Job and first glance:** make the person and current work understandable. The founder profile leads with relevant work and the current project. The idea page leads with the problem, stage, what exists now and the next experiment. Revenue is not required to look credible.

**Actions:** view a sample; request a pilot conversation; follow a project update; contact the founder; report a misleading claim.

**States:** Empty: “No paid customers yet” where relevant; omit absent credentials rather than show empty ratings. Loading: retain the last published version with its date. Error: mark a broken prototype or unavailable evidence link; do not remove the source caveat or invent a replacement. A completed experiment remains readable after enrollment closes.

**Needs/size:** profiles, idea versions, consented artifacts and request handling; **M**.

#### Founder Today

**Job and first glance:** keep customer promises. The top block is “Needs attention,” ordered by customer consequence and time. Next comes work already delegated and capacity that can be filled. A compact money summary follows; valuation does not.

An exception row answers: **what happened, which promise is affected, when action is due, who can act, and what to do next**. Opening it reveals the offer version, customer-facing terms, related payment, authority and event history.

**Actions:** resolve an exception; inspect a queued job; assign a bounded task; contact a customer through an authorized workflow; open the related promise; start a founder-away rehearsal.

**States:** Empty: test the offer and invite the first customer. Quiet day: “No actions due” with the source timestamp, not an empty analytics grid. Loading: separate cached history from current actionable state. Error: identify which service is unavailable; stale authority makes privileged actions unavailable until checked. Automated promotion normally appears as completed or pending; the UI asks for manual work only when needed.

**Needs/size:** task/obligation projection, OpenSeat adapter, authority-aware commands and outbox events; **L**.

#### Public business profile and storefront

**Job and first glance:** explain the provider and make an offer usable. The business profile leads with what it does, current operator/support identity and its offers. An individual storefront leads with the outcome, price, availability and primary action; the broader company story comes below.

**Actions:** try, book, buy or request a quote; view policies; inspect relevant experience; contact support. Each offer has one primary action with its actual meaning. A waitlist button says “Join waitlist.”

**States:** Empty: a published business without a usable offer says what is available, such as pilot inquiries, and does not appear in “Book now” results. Loading: show “Checking availability.” Error: preserve an existing order reference and check its state before a checkout retry. Sold out offers a real waitlist only where supported. Archived offers retain customer access to previously accepted terms.

**Needs/size:** public business projection, offer versions, capacity/order adapters, policy snapshots and customer receipts; **L**.

#### Customer activity and promise detail

**Job and first glance:** answer “What do I have, and what happens next?” Group upcoming and unresolved promises ahead of history. A detail page opens with status, date or deliverable, stable reference and the next customer action.

**Actions:** use an entitlement; download a calendar item; cancel; request a remedy; get support; repeat a completed purchase.

**States:** Empty: return to discovery without inventing recommendations. Loading: retain the reference and last known status, with a checking label. Error: distinguish payment pending, payment received/fulfillment pending, failed payment, and provider unavailable. Support remains reachable during a business handoff. A changed operator does not create a new booking reference.

**Needs/size:** customer identity, entitlements, separate payment/fulfillment states and support routing; **M–L**.

#### Money and evidence

**Job and first glance:** explain receipts, earnings and commitments. The initial summary shows collected, earned, owed back, reserved and available as distinct amounts in a stated period/asset. The next block highlights unreconciled items and missing sources.

**Actions:** inspect a metric; reconcile a transaction; connect/import a source; explain a classification; view obligations; export an authorized snapshot; manage withdrawal through a separate review.

**States:** Empty: “Connect a source or record your first transaction”; zero is used only when a complete query actually establishes zero. Loading: previous period data remains labeled while the new period loads. Error: freeze affected derived figures at their last valid version or mark them unavailable; a disconnected connector does not erase its historical gaps. Never let “last calculated today” hide old source data.

**Needs/size:** management ledger, reconciliation, source health, provenance and versioned metric definitions; **L–XL**.

#### Acquisition search

**Job and first glance:** match a buying mandate to opted-in businesses. Show the current mandate and the distinction between asking price, eligible modeled range and unestimated businesses. Result cards combine customer proposition, permitted financial basis, source coverage, workload and transfer scope.

**Actions:** edit the mandate; include unknown values deliberately; save a search; compare; request an introduction; choose alert cadence.

**States:** Empty: retain the mandate and show which filters constrain supply. Loading: do not expose stale private snippets from a prior team. Error or access loss: remove protected fields and explain that availability/access changed without naming a hidden seller. An anonymous result uses published bands for filtering and display.

**Needs/size:** seller opt-in, separate search projection, team authorization and alert delivery checks; **L**.

#### Acquisition business detail

**Job and first glance:** assess what the buyer would own and operate. Start with the proposition, disclosure mode, evidence coverage and scope of available rights. Tabs or sections are Overview, Financials, Customers in aggregate, Operations, Obligations and Transfer items.

**Actions:** reproduce a metric; request a specific evidence category; ask a scoped question; inspect dependencies; invite an authorized adviser; start a rehearsal; prepare terms.

**States:** Empty/limited grant: show which categories can be requested without revealing hidden counts or values. Loading: evidence panels load independently with their own source dates. Error: distinguish source outage from permission denial. Revocation removes future access and cached protected views; explain that already downloaded documents cannot be recalled.

**Needs/size:** grants, redacted evidence projections, snapshots and transfer inventory; **L**.

#### Valuation and private scenarios

**Job and first glance:** explain a range and its limits. The first block names the output: Asking price, Scenario only, or Modeled range. Place the asset/unit, valued scope, source period and estimate label beside the number. Immediately below, show the assumptions that most affect it.

**Actions:** inspect the calculation; adjust a private scenario; compare owner labor assumptions; see missing records; compare asking price; save or explicitly share a scenario version.

**States:** Empty: “Range unavailable” with the missing prerequisites; an idea-stage business gets an experiment/asset-cost view instead of a manufactured multiple. Loading: show the prior result as prior while recalculating. Error: mark affected inputs stale or unavailable and stop eligible-model publication when gates fail. A changed model has a visible version diff.

**Needs/size:** the model and eligibility rules in section 4, provenance and scope-aware sharing; **M** for scenarios after the ledger, **XL** for a defensible market model.

#### Deal room and handoff

**Job and first glance:** show the current agreement and the next responsible person. The header reads, for example, “Reviewing terms · waiting for buyer,” or “Managed control transferred · hosting pending.” The first panel names parties, rights, price/asset, obligations, snapshot version and expiry. A persistent list separates managed-control settlement from external transfer items.

**Actions:** inspect differences; request a correction; accept the exact version; fund the specified asset; cancel where allowed; check an unknown settlement outcome; export the closing packet; complete a provider handoff.

**States:** Empty: start with parties and scope. Loading: show current known state and operation ID; disable duplicate acceptance/submission while checking. Error: changed terms require new review; insufficient funds explains the missing amount; an uncertain receipt stays uncertain until reconciled. A failed external transfer does not undo or conceal completed internal settlement. The buyer's first-shift checklist stays open afterward.

**Needs/size:** deal versions, access grants, digest construction, settlement state, evidence snapshots and provider adapters; **L–XL**.

#### Team, authority and recovery

**Job and first glance:** answer “Who can do what?” Show people and workers with capability, resource, limits, expiry and status. Separately show app membership and on-chain authority; an invited teammate is not automatically an owner or signer.

**Actions:** invite; prepare a grant; review and authorize it; revoke; inspect why an action was refused; configure and test the recovery path.

**States:** Empty: explain the difference between a support operator and an owner. Loading: grants are “pending verification,” not active. Error: an unavailable RPC leaves privilege checks unresolved; revoked or prior-generation actors receive a specific denial. Recovery shows the real approvers/delay and cannot promise immediate restoration if the policy does not allow it.

**Needs/size:** membership, chain grants, scoped command validation, signing and recovery integration; **L**.

#### Founder-away and buyer rehearsal

**Job and first glance:** find what still depends on the founder. Begin with a task, designated operator, copied-state date and a persistent **“Isolated rehearsal”** label. Show the customer's promise alongside the actor trying to fulfill it.

**Actions:** run an approved scenario; assign a backup; inspect a blocked step; approve a runbook correction; repeat the failed step in a new run.

**States:** Empty: choose a supported exercise, such as cancellation and promotion. Loading: show steps and observed outcomes, never a fake progress score. Error: name the missing permission, provider or instruction and who can fix it. An unavailable external provider is either a declared stand-in or a blocked test, not a pass.

**Needs/size:** isolated state, distinct test identities, disabled or simulated outbound adapters, task evidence and runbook versions; **L**.

### Mobile wireframes

All counts and prices below are fictional design examples. In the product, each numeric cluster has a source control. Square brackets indicate controls; they are not implemented components.

~~~text
HOME / DISCOVER
+--------------------------------------+
| Everstreet                 Personal v|
| Testnet · no real-money purchases     |
|                                      |
| What do you need?                     |
| [A beginner class on Saturday      ] |
| [Search                            ] |
|                                      |
| Try: fill cancellations at my studio |
|      find a local workshop           |
|      source a materials kit          |
|                                      |
| Useful around you                    |
| [Class] [Business tools] [Services]   |
|                                      |
| Start a business                     |
| Find a business to own               |
+--------------------------------------+
| Discover | Activity | Inbox | Account |
+--------------------------------------+

RESULT / OFFER CARD
+--------------------------------------+
| < Results                   Personal v|
| [Saturday] [Beginner] [Under 40] [+]   |
|                                      |
| Beginner linocut                      |
| Juniper Print Studio                 |
| 35 demo credits · total          [i]  |
| 2 seats shown · checked [time]   [i]  |
|                                      |
| Fits: beginner, date and budget       |
| Accessibility: confirmation needed   |
| [See class and terms               ] |
|                                      |
| Availability is checked at booking    |
+--------------------------------------+

FOUNDER TODAY
+--------------------------------------+
| OpenSeat · Owner v             Inbox |
| Today                                |
|                                      |
| A customer promise needs attention   |
| A seat opened; promotion is blocked  |
| Waiting: operator authorization      |
| [Review the blocked task           ] |
|                                      |
| Ready to hand off                    |
| Support backup          Authorized   |
| Billing backup          Needs setup  |
| [Try a shift without me            ] |
|                                      |
| Money this period                    |
| [Collected] [Earned] [Reserved]       |
| See sources and missing records      |
+--------------------------------------+
| Today | Customers | Offers | Money |+ |
+--------------------------------------+

VALUATION / PERMITTED BUYER VIEW
+--------------------------------------+
| Northline · Analyst v      < OpenSeat |
| Value scenario                       |
| [range in declared units]            |
| Estimate · Scenario only             |
| Scope and source period          [i] |
|                                      |
| What drives this range               |
| Earnings basis                   [>] |
| Replacement operator cost        [>] |
| Assumed multiple                 [>] |
|                                      |
| What is still missing                |
| [Specific source or transfer gap]    |
|                                      |
| Asking price is shown separately     |
| [Inspect calculation               ] |
| [Save private scenario             ] |
+--------------------------------------+

DEAL / PARTIAL HANDOFF
+--------------------------------------+
| OpenSeat transfer             Room v |
| Managed control transferred          |
| Confirmed [time] · testnet        [i] |
|                                      |
| Completed                            |
| [done] Agreed control change         |
| [done] Seller's internal proceeds    |
| [done] Registered reserves retained  |
|                                      |
| Still needs action                   |
| Hosting transfer · Seller            |
| Provider acknowledgment missing      |
| [Review transfer task              ] |
|                                      |
| Customer promises                    |
| Original booking remains active [>] |
| [Open the buyer's first shift      ] |
+--------------------------------------+
~~~

An offer with unconfirmed accessibility belongs in the “Needs confirmation” group if accessibility was a hard constraint; it must not appear as a fully eligible match. The wireframe exposes the uncertainty rather than implying a silent pass.

The source drawer should have one consistent reading order:

~~~text
WHERE THIS COMES FROM
Claim                 [name and amount/unit]
Period                [start, end, timezone]
Definition            [plain-language calculation]
Source                [NEAR / connector / founder]
Origin and execution  [seeded / testnet / recording]
Coverage              [observed scope and gaps]
Freshness             [observed, ingested, reconciled]
Records               [authorized source links]
Does not establish    [specific limit of this claim]
[View calculation]    [Report a discrepancy]
~~~

### Interaction rules that protect comprehension

Draft editing may autosave. Publication, disclosure, a new authority grant and deal acceptance use explicit review. A “Continue” button must not conceal any of those actions.

Financial and ownership outcomes are never optimistically marked successful. A browser refresh resumes from the persisted operation. Offline mode can show a dated receipt and saved draft, but cannot claim current capacity, current authority or a completed payment. For ordinary text updates, retain the draft and reconcile when connected.

Every failure gives the person a next step appropriate to their role. A customer should see “We are checking your payment; your reference is…” rather than a raw RPC error. A technical evidence drawer may expose the transaction and error detail for someone who needs it.

Phone review should include small-screen and zoom layouts, keyboard/focus behavior, source-drawer access, a lost connection during checkout and a context switch while a private page is open. These are acceptance exercises for the product, not a separate visual-polish project.

## 8. Wild ideas worth considering

The core already includes search, storefronts, financial evidence, acquisition rooms and rehearsals. The ideas below extend that product rather than rename those features. **★ marks a bet I would fund earliest**, after the operating foundation works. All are proposals; a star is not approval to expand scope.

| Idea | What a person sees and does; why it could matter | What it takes; size |
|---|---|---|
| ★ **Demand-backed launches** | A founder proposes “I will run this workshop if enough people confirm interest”; customers make revocable, nonfinancial pledges and receive an invitation when it becomes a real offer. This tests demand before inventory or schedule commitment | Conditional offers, consent, unique opt-ins, expiry, anti-spam and a clear conversion from interest to a separately accepted booking; **L** |
| ★ **A living owner's manual** | Repeated successful work produces a draft procedure. An operator approves it; later rehearsals flag obsolete steps. The business documents itself while being run | Event-to-runbook drafting, human review, permissions, versioned steps and execution evidence; **M–L** |
| ★ **A business canary** | The founder sees whether a fictional customer can still discover, book and receive the expected entitlement after a release or provider change. A broken customer journey creates an operational task before customers report it | Isolated synthetic identities, no real charges or messages, scheduled checks, version attribution and evidence; **L** |
| ★ **Reusable procurement packs** | A small business answers a customer's security, service-continuity or supplier questionnaire from approved evidence, with scoped expiry. Evidence becomes useful for winning customers long before an acquisition | Claim templates, customer-specific disclosure, dated policies, redaction and revocation; **L** |
| **A relief-operator exchange** | “I need qualified cover next Thursday.” A substitute rehearses the necessary tasks and accepts a bounded shift, helping a founder take time away | Operator vetting, scoped authority, task matching, compensation and employment/insurance decisions; **XL** |
| **A customer rescue route** | When a provider cannot fulfill, the customer can choose a comparable alternative while preserving a clear refund and support trail | Provider consent, fresh customer consent, capacity checks, refunds/rebooking and no automatic customer-data transfer; **XL** |
| **A personal service passport** | A customer privately keeps receipts, preferences and recurring requirements, then chooses what to share with a new provider. Booking becomes easier without public behavioral profiling | User-controlled attributes, per-provider sharing, expiry, export and no cross-business tracking by default; **L** |
| **Business recipes** | An experienced founder licenses an operating template—offers, checklists and validated workflows—without exporting customers or secrets. A new founder starts with an executable pattern | Clean template exports, licensing, attribution, compatibility checks and clear limits on expected results; **L** |
| **A succession circle** | An owner privately invites employees, customers or local operators to learn the business over time. Interested successors can rehearse before a sale is urgent | Invitations, confidentiality, staged access, conflicts and eventual legal purchaser/governance design; **L–XL** |
| **Shared offers with visible responsibility** | A class, a materials kit and a follow-up service form one customer purchase plan. Each provider's deliverable, terms and support route remain visible | Multi-provider orders, allocation, asynchronous payment/refund rules, stock/capacity and partial-failure remedies; **XL** |
| **Proof subscriptions** | A permitted buyer or large customer receives a narrowly scoped monthly evidence update instead of repeatedly requesting the entire data room | Versioned claims, selective disclosure, access expiry, change notifications and a precise statement of what was observed; **L** |
| **Dependency early warnings** | “Your appointment service depends on an integration whose permission expires next week.” The founder gets a concrete replacement or renewal task before delivery breaks | Provider health/permission observations, dependency links, notification policy and false-positive control; **L** |
| **A continuity holdback** | Buyer and seller agree that a defined part of the consideration is released after a specific transfer or support milestone, rather than a vague promise to help | New escrow rules, objective evidence where possible, dispute resolution and legal scope; never automatic AI adjudication; **XL** |
| **Reputation with an ownership timeline** | Customers see that a service's delivery record spans several operators, with each review tied to its period. A successor inherits history without impersonating the founder or erasing problems | Attributed fulfillment/review events, moderation, change disclosures and defenses against reputation laundering; **L** |
| **A capacity-sharing network** | A full studio can offer its customer a compatible nearby provider's real opening, with the customer choosing the alternative. Idle capacity and unmet demand meet across businesses | Opt-in provider network, availability standards, referral attribution and fresh terms/consent; **L–XL** |
| **A platform-exit drill** | “Could this business keep serving customers if Everstreet were unavailable tomorrow?” The owner exports, restores and runs a permitted customer task in a separate environment | Documented export formats, independent runtime, encrypted backups, authority verification and a repeatable recovery exercise; **L–XL** |
| **Customer-organized continuity requests** | Customers of an important small service can privately express “we would help find a successor” and nominate operators, without committing money | Consent, interest groups, conflict management and founder-controlled disclosure; any investment mechanism is a separate later decision; **L** |
| **A buyer's private integration laboratory** | A strategic buyer tests how the business would fit its own operating model using synthetic data and declared assumptions before requesting sensitive customer records | Adapter contracts, isolated environments, sanitized schemas, cost/workload assumptions and no claimed synergies without evidence; **XL** |

My earliest bets are the living manual, business canary and procurement packs: each makes everyday operations or sales better, and each improves future diligence as a by-product. Demand-backed launches is the boldest acquisition-of-customers experiment; begin with nonfinancial interest so that a pledge never masquerades as revenue.

The relief-operator exchange and rescue route could become major services, but their human, commercial and dispute responsibilities are large. Shared offers are attractive and easy to underestimate: a single checkout does not remove multiple providers' failure modes. Keep these as separate product lines until one-business fulfillment is dependable.

I would reject a public “business value leaderboard,” automatic idea valuations, a generic founder popularity feed and a token issued merely to finance feature development. They would reward appearances, add unrelated obligations or distract from fulfilled customer outcomes.

## 9. Build order: durable slices Tony can use from his phone

Build in dependency order, with a useful stopping point after every phase. These are product phases, not a hackathon schedule. The existing source and recorded testnet proof are the starting point; none of the following UI or subsystem work is claimed complete.

Each phone milestone means an actual working private development URL accessible from Tony's phone, not a screenshot-only review. The route to that URL—local network or an explicitly authorized private deployment—is an implementation/release choice. Public hosting, real users, money, posting and submission still require Tony's explicit approval. Keep this project independent of Day One and let its priority constrain available capacity.

Every phase should come with: the exact phone action; a source-linked result; one representative failure/recovery case; a list of simulated adapters; and a statement of what remains outside the supported promise. A label is not permission to present an unfinished feature as operational.

### Phase 1 — Put the existing business in Tony's hand

**Ships:** the visual shell, explicit environment/source components, public OpenSeat/Juniper pages, deterministic customer search, one real class flow, customer activity and a small founder Today view. Use the existing service through a thin API boundary. Add a separate read-only view of the recorded handoff.

**Underneath:** public offer projection, customer identity/reference handling, service adapter, basic acting-context model, typed status responses and the reusable source drawer. No generalized marketplace is required.

**Tony's phone finish:** search for a class, open its actual availability, book or join the waitlist, keep the reference, cancel where permitted, and open the record showing what happened. A recorded sale can be inspected with its original date; it cannot masquerade as a new live close.

**Real:** local service booking, waitlist, cancellation and calendar behavior wired into the UI; read-only display of repository evidence. **Seeded/recorded:** fictional businesses and history, the existing sale recording. **Simulated:** outbound reminders or unsupported providers, explicitly labeled.

**Done when:** the UI distinguishes confirmed, waitlisted and cancelled; loading is not zero availability; a refresh preserves the booking; one failure has a useful next step; the source drawer works on the phone.

**Cut if short:** natural-language interpretation, maps, charts, animations and multiple categories. Preserve one customer outcome and the founder's corresponding task. **Size: L.**

### Phase 2 — Let a founder create something worth sharing

**Ships:** personal accounts and workspace switching; founder profiles; private idea drafts; a pilot/inquiry template; an offer builder; exact public preview; shareable storefront links; an in-app response inbox. Add an established-business import path that clearly labels supplied data.

**Underneath:** Person, Business, Membership, IdeaVersion, OfferVersion, publication projections, request/consent records and draft persistence. Published content needs reporting/moderation mechanics before an open public community.

**Tony's phone finish:** create a fictional founder and idea, publish a selected pilot invitation in the private development catalog, open the customer preview, send an inquiry from a separate personal context and answer it as the founder.

**Real:** drafts, permissions, publication within the development product, inquiry/response records and shareable routes. **Seeded:** any example traction. **Simulated:** notifications outside the app until their delivery and consent flow is explicitly enabled. No payment or legal-formation claim is implied.

**Done when:** a private idea cannot be found through public search, direct URLs or previews; switching contexts preserves drafts without revealing private data; no published offer claims an unsupported action.

**Cut if short:** themes, social feeds, formation-provider integrations and extra templates. Keep one pilot invitation and the existing working class/software offer. **Size: L.**

### Phase 3 — Make running and delegating useful every day

**Ships:** customer promises in Today; exception handling; task assignment; team/worker permissions; audit history; source-aware operating summaries; founder-away rehearsal. Begin a simple living manual with approved task instructions.

**Underneath:** the service reliability work identified in section 6, generation-aware signed commands, transactional deduplication, resource checks, contextual membership and an isolated rehearsal runner. Establish separate controlling/signing identities for the fictional founder and buyer; do not hide the original single-machine demo arrangement.

**Tony's phone finish:** inspect a blocked promotion, appoint or request the appropriate authorized operator through the supported flow, observe the task complete, and run a rehearsal in which a backup performs it without borrowing the founder's identity.

**Real:** scoped service actions, authority checks against the chosen environment, task evidence and a genuinely isolated rehearsal. **Seeded:** rehearsal customers and workloads. **Simulated:** provider actions with no live adapter. Every rehearsal screen says so.

**Done when:** stale or unauthorized actors cannot mutate the service through the supported interface; concurrent duplicate commands have one effect; rehearsal cannot contact real customers or mutate the active business; a failed step names its cause.

**Cut if short:** automated runbook drafting, broad workflow automation and a general operator marketplace. Keep one useful delegated task and one failure/recovery exercise. **Size: L.**

### Phase 4 — Make customer payments and remedies real on testnet

**Ships:** a new reviewed business-contract version for test commerce; one accepted test asset; funded checkout; payment receipts; protected amounts under a stated policy; cancellation/refund handling; pending-outcome reconciliation; human-readable signing reviews. Existing v1 remains separately identified.

**Underneath:** asset-specific accounting, validated incoming token calls, payment/booking state machine, capacity holds, private callbacks, operation persistence, finality indexing and independent signing/recovery. Provision only the accounts needed; a general factory UI can follow once the creation process is reliable.

**Tony's phone finish:** fund a fictional purchase with test units, see a confirmed booking only after the required outcome, cancel under the declared terms and trace the supported refund. Repeat a case where the connection drops after submission and the application finds the original result.

**Real:** testnet settlement and actual payment-to-booking reconciliation for the supported path. **Fictional:** participants and commerce; test assets have no monetary value. **Simulated:** card payments, bank payouts and unsupported delivery evidence.

**Done when:** late payment cannot overbook; duplicate notifications cannot create duplicate receipts; timeout cannot cause blind repayment; an unsupported token is rejected; funds remain accounted for through failure and recovery.

**Cut if short:** multiple assets, conversion, native-asset checkout, automatic recurring billing and physical products. Never cut the refund/reconciliation path from a paid flow. **Size: XL.**

### Phase 5 — Build useful books and recurring operations

**Ships:** the Money and Evidence workspaces; receipts-to-earnings bridge; costs and declared liabilities; one capped prepaid subscription workflow; a source health panel; import/reconciliation; exportable metric snapshots. Add one connector in a provider sandbox or authenticated test account where available.

**Underneath:** versioned accounting rules, raw source storage, event deduplication, correction entries, source coverage and once-per-period subscription execution. Keep invoice, payment, earned amount, refundable reserve and available balance separate.

**Tony's phone finish:** inspect a subscription period, see its test payment and earned allocation, reconcile a deliberately mismatched record, then open the before/after metric explanation. Cancel the subscription and verify that the next scheduled charge is not authorized.

**Real:** the accounting/reconciliation engine, supported test subscription and source lineage. **Seeded:** months of fictional operating history. **Connected sandbox:** only records actually obtained through a test connector. **Simulated:** providers that have only fixture adapters; they retain that label.

**Done when:** overlapping processor/bank/import records cannot double-count receipts; a missing cost source is visible; a correction does not rewrite an accepted prior snapshot; no seeded history is labeled as observed commercial revenue.

**Cut if short:** extra connectors, budgeting, tax reporting and automated expense inference. Keep one source plus founder entries, explicit gaps and reproducible arithmetic. **Size: L–XL.**

### Phase 6 — Open a useful acquisition product

**Ships:** buyer organizations and mandates; seller disclosure modes; named and anonymous acquisition projections; asking-price search; optional unestimated candidates; saved searches; in-app alerts; scoped access requests; a first evidence room; the transparent scenario calculator.

**Underneath:** separate acquisition indexes, category-level grants, expiry/revocation, protected snippets and counts, model versions, disclosure previews and snapshot exports. Scenarios remain separate from eligible market estimates.

**Tony's phone finish:** set a seller to private introductions, observe that ordinary customer search remains unchanged, accept a named buyer request, switch into the authorized buying context, reproduce a metric and save a private scenario. Revoke access and observe the protected view disappear.

**Real:** search, consent, grants, calculations and lineage over the available records. **Seeded:** fictional businesses, historical financials and any example asking prices. **Estimate/Scenario only:** calculated ranges. **Unavailable:** a calibrated commercial model until its prerequisites exist.

**Done when:** a different team or expired grant cannot obtain evidence through direct requests, exports, notifications or search counts; anonymous filters reveal only published bands; acquisition state never appears on the storefront without explicit publication.

**Cut if short:** email alerts, advanced comparisons, natural-language buyer search, automated matching and external adviser integrations. Keep a saved mandate, one access request and one independently reproducible claim. **Size: L.**

### Phase 7 — Close a supported transfer and run the next shift

**Ships:** terms and scope editor; evidence snapshot and transfer manifest; version diffs; exact acceptance review; funding/settlement UI; external transfer checklist; buyer first shift; exportable closing packet. Connect the founder rehearsal to a buyer's permitted exercise.

**Underneath:** reviewed digest construction, one-contract settlement boundary, competing-deal/hold recovery, in-flight operation fencing, generation change handling, provider adapters and authority-aware UI refresh.

**Tony's phone finish:** review the seller's terms on his phone while a separately controlled buyer identity reviews and accepts the same version. Observe testnet control change, inspect the seller's proceeds claim, appoint a new operator and complete a customer action using its pre-sale reference.

**Real:** supported managed-rights transfer and internal settlement in test units, with actual confirmed outcomes. **Still off chain:** private negotiations and service bookings. **Simulated unless integrated:** hosting/domain/provider transfers, clearly left pending or completed by the stand-in's own evidence. No legal company sale is claimed.

**Done when:** revised material terms invalidate prior acceptances; racing closes cannot settle twice; the old owner is denied; the customer's promise survives; “control transferred” and “external handoff complete” remain separate states.

**Cut if short:** earn-outs, financing, multi-asset settlement, provider automation and foreign-chain control. Keep one supported transfer, one visible outstanding external item and the buyer's first real operating task. **Size: L–XL.**

### Phase 8 — Make the marketplace useful beyond the first service

**Ships:** better discovery from actual supported offers; attributable referrals; saved customer needs; repeat purchase; experience-linked reviews; aggregate unmet-demand views; source health and moderation. Expand one fulfillment type at a time: scoped services first, then physical products only when their delivery and remedy flow works.

**Underneath:** template adapters with common offer/order/entitlement interfaces, availability freshness, fulfillment attribution, consented reviews, anti-abuse controls and provider-specific cancellation/return rules. Add a business canary for the supported journey.

**Tony's phone finish:** publish a second kind of fictional offer, find it through a relevant need, complete its supported action, resolve a simulated delivery exception through a real case workflow, and see an outcome-linked review. For physical products, the screen names simulated shipping until a real adapter exists.

**Real:** catalog, matching, supported workflow state, moderation and customer remedies in the development environment. **Seeded:** supply and demand examples. **Simulated:** physical shipment or unimplemented external service. Do not represent a directory inquiry as completed fulfillment.

**Done when:** each template has a defined completed outcome, failure remedy and provenance; adding a category does not change private acquisition exposure; paid tier and sale value cannot affect organic rank.

**Cut if short:** physical products, maps, recommendation models, cross-provider bundles and open community feeds. Keep one adjacent category with actual operational support. **Size: XL across several small releases.**

### Phase 9 — Earn the right to publish defensible valuation ranges

**Ships:** valuation eligibility gates; model versioning; source/cost completeness checks; supported business-type models; scenario sensitivity; comparable-data provenance; model evaluation; selective sharing; “what changed” alerts and a reusable procurement evidence pack.

**Underneath:** an appropriately licensed or consented comparable dataset with transaction scope and actual closed-price semantics, review of normalization rules, model evaluation across relevant cohorts, stale-model handling and an independent professional review path where useful.

**Tony's phone finish:** compare two fictional businesses with different evidence completeness; see one produce only a scenario and the other qualify for the configured test model; alter replacement labor and inspect the effect. Open a missing-data case and see the model refuse to publish an unsupported estimate.

**Real:** calculation, eligibility, provenance, evaluation machinery and permission flow. **Seeded/synthetic:** model demonstration and test cohorts while the project remains fictional-data-only. **Not yet established:** commercial predictive validity. A production range stays disabled until an authorized dataset and evaluation meet the declared gate.

**Done when:** model outputs retain scope and source dates; asking prices cannot enter the closed-sale training set unnoticed; sparse cohorts and missing costs cause appropriate withholding; a new model cannot change an accepted deal snapshot.

**Cut if short:** automated market estimates and elaborate statistical graphics. Keep a useful, honest scenario tool and “range unavailable” behavior. Incomplete evidence is not fixed by adding a disclaimer. **Size: XL.**

### Phase 10 — Prepare a durable operating service, then choose expansion

**Ships:** tested backup/restore and export; service operation independent of a particular browser; incident and support procedures; key/recovery drills; contract-version and legacy-obligation handling; documented custody/payment model; explicit production activation gates. Add one NEAR extension only when a supported use case requires it.

**Underneath:** independent security review, operating responsibility and jurisdiction-specific decisions from section 6, provider terms, privacy/deletion policies, dispute handling, accessible support, abuse response, cost monitoring and an approved deployment plan. Mainnet needs new deployment/configuration and acceptance of the operating model, not conversion of demo balances.

**Tony's phone finish:** run a fictional lost-device recovery, restore a sample business into a separate authorized environment, follow a customer promise through the outage, and inspect a production-readiness view where every unresolved gate is named. If a foreign-chain service is included, show its own confirmed result and outstanding-signature checks.

**Real:** the recovery/export drills, operational controls and any actually integrated testnet extension. **Simulated:** disaster scenarios and provider actions without implementation. **Not enabled without Tony's explicit approval:** production money, real customer records, public release or mainnet.

**Done when:** a recovery exercise demonstrates the documented powers; the platform cannot silently assume the seller's former rights; exports can be restored; a legacy obligation remains visible/claimable under its actual rules; unresolved production responsibilities block activation.

**Cut if short:** Chain Signatures, Intents, confidential-compute integration, the relief-operator exchange, cooperative fundraising and multi-provider commerce. Keep the operating/recovery work. **Size: XL.**

### Sequencing rules and deliberate stopping points

After phase 2, Tony has a real idea-to-inquiry product. After phase 3, he has an operating and delegation product. After phase 5, he has test commerce and inspectable books. After phase 7, he has a useful acquisition and continuity workflow. Later phases broaden and harden those products; they do not rescue an empty first experience.

Do not postpone all daily founder value until the new payment contract is complete. The existing booking service, clear offers, inquiries and delegation can be useful earlier. Conversely, do not attach a payment button to an immature fulfillment workflow merely because a token transfer works.

If capacity becomes tight, keep the smallest durable chain:

1. Publish one honest offer.
2. Complete one customer action.
3. Give the founder a useful task and a second operator a bounded role.
4. Inspect the source of one meaningful metric.
5. Share that evidence deliberately with one buyer.
6. Transfer supported control and fulfill an existing promise.

Cut breadth before breaking those connections. Remove AI interpretation before deterministic search; remove more business types before remedies; remove valuation automation before source lineage; remove cross-chain features before reliable NEAR settlement. Never cut privacy boundaries, accurate environment labels or safe handling of an unknown payment outcome.

Measure whether the product earns its next phase. Track first fulfilled customer action, repeat use, useful founder sessions, independently completed operator tasks, reconciliation gaps closed, buyer claims reproduced and post-handoff promises fulfilled. In the fictional environment these validate behavior, not market demand. Actual adoption and willingness to pay require a later approved pilot.

## 10. Open questions for Tony

These are product and release decisions, not blockers to Claude building the earlier reversible development slices. Each recommendation is a proposed default; Tony retains the decision.

1. **What should Everstreet lead with?**

    **Recommendation:** “Build a business that keeps going,” followed immediately by offers, customers and daily operations. Keep “Find a business to own” prominent as its own entrance. The public homepage should still lead with a customer's need.

2. **Which first community deserves depth?**

    **Recommendation:** independent creative studios and the small software/services supporting them. OpenSeat, Juniper and attendees give us both business and consumer journeys. Use a coherent fictional catalog now; choose any real pilot community only with your approval.

3. **What is the first reason a founder would pay?**

    **Recommendation:** managing customer commitments and delegating the work. Treat an operating subscription as the initial commercial hypothesis, optional diligence workspaces as a second, and closing fees as later. Do not charge for rank or sell stronger proof labels.

4. **How broad should launch support be?**

    **Recommendation:** idea/pilot invitations plus working software and class flows first. Add professional services and physical goods only with their full delivery/remedy behavior. A form that says “physical product” is not enough.

5. **How prominent should valuation be?**

    **Recommendation:** a private founder Value workspace and permitted acquisition views. Ship transparent scenarios early; publish modeled market ranges only after the evidence and model gate. Keep valuation out of the default founder Today screen and customer storefront.

6. **May an owner remain closed to buyers indefinitely?**

    **Recommendation:** yes, with no ranking or functional penalty. Founder retention must stand on operating value. Buyer outreach, disclosure and public acquisition cross-links are all explicit choices.

7. **How much anonymity should we promise?**

    **Recommendation:** promise controlled application disclosure, not perfect anonymity. Use coarse teasers and field previews; explain public-chain linkability before payment or deal publication. Offer a connector-based path where source privacy is more important than public transaction visibility.

8. **Which authority experience should we build first?**

    **Recommendation:** ordinary app sign-in for everyday use, with a clear user-controlled signing path for meaningful ownership and money actions. Prototype passkey/MPC onboarding as a candidate, but retain a direct wallet alternative and a tested independent recovery path.

9. **What exactly should the first acquisition product sell?**

    **Recommendation:** the managed operating rights the contract can enforce, plus an explicit inventory of separately transferred assets and dependencies. Do not broaden the language to “the whole company” until the legal and provider-transfer model supports it.

10. **How should we handle contract evolution?**

    **Recommendation:** preserve locked v1 obligations, use new deployments for new capabilities, and show lineage visibly. Have Claude design a constrained successor protocol before making long-term migration promises; avoid a hidden general upgrade key.

11. **Which large product bet should follow the foundation?**

    **Recommendation:** continuity as daily usefulness: a living owner's manual, business canary, useful delegation and an export/restore drill. Add demand-backed launches as the strongest separate customer-acquisition experiment.

12. **Should cooperatives be a first-class audience now?**

    **Recommendation:** yes for buying teams, evidence access, discussion and rehearsal. Defer pooled investment, fractional interests, fundraising and binding governance until their separate professional and technical model is agreed.

13. **What portability should we promise?**

    **Recommendation:** exportable business records, customer entitlement history, explicit contract versions and a documented way to operate supported services elsewhere. Validate the promise with a restore drill. Do not promise that third-party accounts or private credentials transfer automatically.

14. **What should the first payment scope be?**

    **Recommendation:** one accepted test asset in a new contract version, with a complete refund/reconciliation path. Keep DEMO ledger units and token-backed test units distinguishable. Add conversion or additional assets only after that path survives failure cases.

15. **Which current NEAR extensions deserve priority?**

    **Recommendation:** dependable NEAR authority and settlement first. Chain Signatures follows a specific foreign-chain service need; Intents follows an actual asset mismatch; confidential AI follows a defined private-evidence use case. None is required to decorate the first product.

16. **What must be true before we invite real businesses or handle real money?**

    **Recommendation:** approve the pilot scope and operating model explicitly after the recovery, privacy, payment, contract and support gates are reviewable. Keep the current build fictional and on testnet. Mainnet should be a deliberate product launch decision.

17. **How should this work fit around Day One?**

    **Recommendation:** let Day One retain its stated priority. Use the phone milestones as stopping points rather than expand work to fill a deadline. The next concrete build is phase 1, followed by founder publishing and useful delegation; no public commitment is needed to make that progress.

18. **What visual direction should Claude adopt now?**

    **Recommendation:** warm paper, dark green actions, an editorial public headline and a practical sans-serif workspace; offers and customer promises lead, proof stays one tap away. Approve that as a reversible starting system and review it on a phone before investing in custom illustration or a large theme system.
