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
