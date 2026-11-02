# Build brief · Going Concern (working title) → public name **Everstreet**

Prepared for Tony and Claude · NEAR HACKATHON · November 2026 · v1. Received from Tony on
2026-11-01 (drafted with GPT). Tony chose the name **Everstreet** the same day; the text below
keeps the original working title. Product status: concept selected for detailed design. Public
name, launch decision, and production scope remain Tony's calls.

## Start here, Claude

Tony wants one platform where a person can start a business, people and organizations can find that business when it solves a problem, and a qualified buyer can eventually acquire it with continuity for its customers. Design it to be worth using for years even if the founder never sells. Think beyond software businesses. Start the first implementation with one working SaaS business because we can transfer and independently test a substantial part of its operations on testnet.

Tony is the founder and product owner. Astra is Tony's creative lead. Claude is the builder. Muse is the project manager. Astra owns concept development, product storytelling, naming exploration, interaction ideas, visual direction, and creative critique in partnership with Tony. Claude owns architecture, engineering choices, implementation, verification, and reproducible delivery. Muse coordinates priorities, timing, capacity, and handoffs. Tony decides brand, scope changes, external commitments, and public release. Claude should make normal engineering decisions without waiting. Bring major changes to the user promise or story to Tony and Astra with a concrete alternative.

This brief is the context to carry into the desktop builder session. A locally invoked Codex reviewer receives the material passed to it. Treat its technical review as a separate contribution from Astra's creative direction in Tony's conversation. At each playable milestone, give Tony a screenshot or recording, the exact action he can try from his phone, and one meaningful decision if there is one.

First builder deliverable: produce a runnable vertical slice in a new independent project. A customer discovers a solution, uses it, a founder rehearses a change of operator, a buyer acquires platform-managed control, and the customer completes an action purchased before the sale. Expand outwards from that slice. The specific names, numbers, stack, and fixture below are proposed defaults.

## 1. Why this business might matter

A founder starts with "I know somebody who needs this." Their early problems are choosing an offer, finding a customer, delivering the work, getting paid, and remembering what they promised. The earliest value we can deliver is a customer who finds their offer and successfully uses it. A founder who walks away with a generated business plan still has all the hard work ahead.

People looking for solutions approach from the opposite direction. Someone has a Saturday free and wants to learn printmaking. A studio owner has full classes and empty seats after cancellations. Neither arrives with a company name or a software category in mind. Both should be able to say what they need in ordinary language, inspect a small set of credible matches, and act.

A buyer sees a third view of the same business. With permission, they can inspect what customers use, what the business earns, where the founder is indispensable, and what obligations survive closing. The founder can correct those dependencies years before a sale. The accumulated evidence and the ability to rehearse a handoff are the commercial hypotheses that distinguish this product.

The hackathon thesis to prove: business ownership can change on NEAR while a customer continues using an entitlement issued under the previous owner. The commercial thesis to test later: ongoing help with discovery, fulfillment, and delegation is valuable enough for founders to keep their operating records here and voluntarily make selected evidence available to buyers.

## 2. One product, four entrances

| Entrance | Visitor's first question | First useful action | Success signal |
|---|---|---|---|
| Find a solution | Who can help me do this, under these constraints? | Compare matches, try a product, book a service, or request contact | A need becomes a completed action |
| Start a business | How do I turn this idea into an offer someone can use? | Publish a credible offer and deliver a first order or trial | An independent customer uses it |
| Run my business | What needs my attention today, and what can someone else handle? | Resolve an exception, delegate a task, rehearse an absence | A second operator completes a real task |
| Explore acquisitions | Which businesses fit my strategy, and could I operate one? | Search opted-in companies, obtain scoped access, test a handoff | The buyer can independently verify a material claim |

A person can hold multiple roles. A studio owner may buy software, offer a workshop, and later sell their own business. Give them one account with explicit transitions between personal activity and each business workspace. Browsing offers does not expose acquisition status. A company can sell products publicly while keeping its interest in an acquisition completely private.

## 3. Canonical fictional world

Use OpenSeat, a small SaaS service that independent studios use to fill cancelled class seats. Its first-class product is an embeddable booking page with finite capacity, a waitlist, cancellation, automatic promotion, and a downloadable calendar event. Build this service. It gives the platform something real to sell and the judge something useful to operate.

Juniper Print Studio is an OpenSeat customer. Its beginner linocut workshop is also an independently discoverable service on the platform. Northline Studio Tools is a fictional strategic buyer. Give one founder, one studio operator, two attendees, and the buyer separate identities. Provide an obvious actor switcher in judge mode. Normal users see only their authorized workspaces.

Seed and label a reproducible history. Six active studios at 20 demo credits per month yield a current recurring run rate of 120 demo credits per month. Show invoices paid, amounts outstanding, earned revenue, and prepaid customer obligations separately. Six current subscriptions alone do not establish historical revenue, retention, or profit. Create dated fixture events to support every historical claim displayed. Label seeded history, sandbox executions, and live testnet events individually.

Prepare one full class, one booked attendee, and one waiting attendee. A class seat is a customer obligation in the OpenSeat service. It is distinct from platform test money and distinct from the right to operate the company. A customer who booked under the seller must finish the workflow under the buyer using the same booking reference.

## 4. What to build for each user

### The solution finder

Start with a large prompt and three examples, including personal, business, and physical-product needs. Interpret intent into editable constraints such as desired outcome, date, budget, audience, location, remote availability, business type, and accessibility requirements. Ask one clarifying question when it would change the result. A plain form and keyword search must work if model inference is unavailable.

Create a catalog with at least a dozen diverse fictional offers across software, classes, services, and physical products. Include near misses and an empty-result case. Each offer needs a provider, availability source and timestamp, pricing unit, audience, fulfillment method, and action. Separate hard constraints from preferences. Filter on hard constraints first. Show the source-backed reason for each remaining match and mark unknown details explicitly. Let a user relax one constraint intentionally. Preserve the original query so they can undo the change.

- "I run a pottery studio. I lose seats to last-minute cancellations and can spend 25 credits a month." Show OpenSeat, its actual price, and a working sample class. A pricier product can appear only if the user expands the budget.
- "I want a beginner printmaking class this Saturday under 40 credits." Open the studio offer. Show the difference between a confirmed seat and a waitlist place. Let the person complete the booking or join the waitlist.
- "I want a left-handed carving kit delivered tomorrow." If delivery or handedness is unverified, explain what could not be matched. Offer an editable request the user may choose to share with providers. Keep contact information private until that choice.

A match card should answer "why this, how much, can I use it, and what happens next?" Measure an actual trial, confirmed booking, fulfilled request, or purchase separately from clicks. For demo physical goods, clearly label a simulated fulfillment event. Keep paid placement out of organic ranking in v1. Show founders aggregated unmet needs only when there is adequate consent and volume for that use.

### Founder launch and operating desk

Start with a guided interview covering the customer, problem, deliverable, evidence the founder already has, price, and how to fulfill the first customer action. Offer a software subscription, appointment/class, or physical-product template. Generate an editable offer, a storefront, and an achievable first-week checklist. The founder reviews factual claims and previews the customer experience before publishing.

The operating desk opens with three concrete items: a customer outcome, an exception needing attention, and a task another person or agent can perform. From a given booking, trace the original offer, current promise, responsible operator, related payment or entitlement, and what action is due next. Surface credentials and capabilities by role and identifier. Never expose secrets in the UI or export.

Make handoff rehearsal a repeatable feature. Let the founder step away in an isolated rehearsal using copied state and test identities. Ask a backup operator to complete customer support, deploy a release or replace a worker, and honor an existing customer obligation. Show what worked and where the founder was still needed. Resolve one dependency and rerun. Rehearsal has its own identifiers, chain contract or sandbox, and outbound adapters so it cannot send customer communications or mutate the live demo business.

### Buyer discovery, diligence, and closing

Let founders choose private, open to introductions, or listed for acquisition. Permit anonymous teasers with explicitly selected metrics. Buyers such as a strategic acquirer, a small investment firm, and a customer cooperative can save acquisition criteria. Keep investor criteria separate from consumer solution ranking.

The buyer asks for access with a named purpose and duration. The seller grants specific evidence categories. A diligence room groups financials, customer obligations, operating dependencies, transfer assets, and outstanding exceptions. Every figure links to its definition, period, source, and freshness. Use badges with literal meanings: founder supplied, derived from connected records, seeded demo, or verified on testnet. Explain that revoking access stops future access through the service and that downloaded copies can persist.

A deal contains parties, exact managed rights, proposed price in test units, protected obligations, provider-managed handoff items, exceptions, evidence snapshot, and an expiry. Material changes invalidate earlier acceptances. The buyer sees a preview of what they can immediately control after closing and what still requires third-party action. Give both parties an exportable closing packet and the buyer a first-shift checklist. Distinguish an onchain operating-rights transfer from separately documented ownership of a legal entity, IP, inventory, premises, or third-party accounts.

## 5. Architecture Claude can implement and extend

Proposed stack: TypeScript web app and server, relational database, durable job worker, Rust NEAR contract, and a small standalone OpenSeat service. Use the builder's familiar equivalents where they shorten delivery. Keep the example business separately runnable with its own service endpoint and customer-facing client. The platform should be able to lose a browser session without interrupting an existing OpenSeat booking. Use a monorepo if convenient with clear boundaries between the platform, example service, contract, adapters, fixtures, and end-to-end demo.

| Authority | Owns | Must check |
|---|---|---|
| Platform database | Profiles, listings, offers, search index, private rooms, evidence metadata, integration status | Tenant, role, purpose, visibility, expiry on every protected read |
| NEAR business contract | Business identity, current controlling account, authority generation, sale commitments, platform-managed test balances and reserves | Caller, sale terms, generation, solvency and replay rules |
| OpenSeat service | Capacity, bookings, queue order, promotions, customer entitlements, delivery results | Customer rights separately from current business operator rights |
| Evidence store | Encrypted source material, tagged fixture records, redacted snapshots, source lineage | Access grant, version, deletion rules, export history |
| Adapter workers | Authorized jobs, reconciliation, provider observations, transaction indexing | Idempotency, chain finality, recorded reconciliation state |
| Optional external-chain client | Independently checks a service identity and exercises a scoped service action | Network/domain binding, unique operation ID, expiry, confirmed receipt |

A practical data model includes User, Organization, Membership, Business, Offer, Need, Match, Fulfillment, Subscription, Obligation, Capability, Operator, EvidenceItem, EvidenceSnapshot, AccessGrant, RehearsalRun, TransferItem, Deal, Acceptance, ChainOperation, and AuditEvent. Use tenant-scoped identifiers, explicit UTC instants, integer amounts with asset and decimal metadata, unique operation IDs, and versioned records. Store source and confidence on individual claims. A digest proves bytes match a snapshot. It does not establish the truth of a seller's claim.

Use events such as offer published, booking confirmed, waitlist joined, attendee cancelled, next attendee promoted, evidence grant revoked, rehearsal failed, revised terms accepted, sale finalized, operator replaced, and provider handoff acknowledged. Emit database events through a transactional outbox. Derive search indexes and dashboards from rebuildable projections. Keep private names, class attendees, query text, customer lists, commercial documents, and personal identifiers off public ledgers. Use salted commitments or private proofs where guessing the contents of a digest would matter.

### NEAR ownership design and money flow

1. Give the business a stable NEAR contract identity. Separate the controlling owner, appointed operators, and ordinary customers. Validate authorization inside each privileged method. Use restricted function-call keys where practical. Removing a role in a web UI cannot revoke a NEAR full-access key.
2. Start with an explicit contract-controlled transfer of operating rights. A transferable NFT interface is optional. Add it only if every transfer and approval path preserves the sale rules, access changes, and protected obligations. Claim the NFT track only for a working, demonstrated NFT.
3. Prove the authority model at deployment. Document who can replace contract code, rotate keys, recover the account, alter payout terms, or control a parent/factory. Remove bypass authority or name and constrain the trusted party. Include an independently runnable inspection. With an unrestricted founder deployment or upgrade key the founder-revocation claim fails.
4. For the first close, use one asset and one contract ledger on NEAR testnet. Prefund the buyer's demo balance. On the final matching acceptance, a single contract call validates price, parties, expiry, terms digest, reserved balance, and expected ownership generation. Debit the buyer, credit the seller's internal withdrawable balance, assign the buyer, and increment the generation in that call. Keep the business treasury distinct from sale proceeds. A second finalization cannot pay the seller again.
5. Preserve the business's existing liabilities. Example fixture: the business holds 45 demo units, 20 earmarked for promised credits, and 25 available. A sale at 100 uses the buyer's separate balance. The seller receives 100. The business still holds 45 and only 25 are available before further obligations. Derive monetary reserves from explicitly registered monetary promises. Track class reservations as service obligations separately. No "all liabilities protected" claim for unregistered external obligations.
6. Bind privileged operations and queued worker requests to an authority generation. At finalization, old operator authorizations expire. Reauthorize necessary workers under the buyer. A customer booking or prepaid entitlement belongs to its customer and service, so it survives the change. For irreversible provider actions already in flight, reconcile what actually happened before retrying. Display pending outcomes explicitly.
7. Treat withdrawals, cross-contract calls, and external-chain broadcasts as asynchronous. Track requested, submitted, confirmed, failed, and reconciled states. Reserve amounts while pending. Bind callbacks to the correct contract, operation and expected state. Compensate on confirmed failure and guard against duplicate or late callbacks.
8. Cross-chain proof, after the core close works: use NEAR Chain Signatures for a narrowly defined service action on a public EVM testnet. For example, let an independent entitlement client recognize the same service issuer before and after an ownership change. Restrict target contract, method, network, payload, nonce and expiry. Invalidate stale operator-controlled commands at the receiving application where needed. Do not expose arbitrary signing. Show both transaction receipts. Test signer availability, gas and faucet access early. If unavailable, ship the NEAR ownership proof plus a labeled local external-chain rehearsal. Report that distinction in the README and video.

Useful implementation references: NEAR access keys, cross-contract execution, Chain Signatures, testnet example. Verify network deployments against official documentation when the build begins.

### Agent actions and integrations

The launch assistant drafts offers and checklists. The finder translates a need into constraints and cites matching catalog fields. The operations agent handles assigned service work and proposes resolutions to exceptions. The diligence assistant explains metrics and identifies gaps. The handoff coordinator verifies prerequisites and proposes the next transfer action. These can be task modes of one agent service with distinct capabilities. Use separate agents only where their principals or permissions differ.

Give each tool a typed input, actor, allowed resources, idempotency key, expected version, and explicit effect. Treat listings, uploaded materials, and provider text as untrusted data. A malicious listing cannot make the finder reveal a private room or rank it first. A diligence document cannot authorize a payment. Humans explicitly approve publication, private disclosures, acceptance of deal terms, and closing. Show a preview with changed rights and amounts before acceptance. Never allow a model response alone to move funds or certify evidence.

Adapters should expose capabilities for reading, preparing a transfer, checking requirements, executing an authorized step, and independently verifying the result. A domain, code host, billing platform, physical inventory, and supplier agreement each need their own transfer procedure. In the hackathon, include at least one simulated external asset that stays pending after NEAR finality. Give it an owner, a required action, and separate evidence of completion. External systems must display simulated, sandbox, or live testnet at the point of use.

## 6. Creative direction and the judge experience

The public homepage should feel like a place to solve a problem, with a clear second entrance for "Start a business." Keep acquisition discovery one deliberate step away. Use familiar prices, availability, buttons, and readable sentences. Use a consistent visual identity across the company's storefront, operator desk, and diligence room so the audience recognizes the same business at each stage. Provide keyboard navigation, accessible contrast, mobile layouts, reduced motion, and a text alternative to animated state changes.

Astra's proposed signature scene is the handoff rehearsal. Put the customer booking on one side and the responsible operator on the other. Show the founder's access ending, the buyer appointing a worker, and the customer's pending booking completing. The meaningful animation follows the actual confirmed event. Delay or failure gets its own visual state. A quiet evidence drawer can expose role checks, account IDs, operation IDs, and transaction links.

### A three-minute film with a reproducible path

| Time | Judge action | Visible consequence |
|---|---|---|
| 0:00–0:25 | Founder turns "help studios fill cancelled seats" into a published OpenSeat offer | A working trial opens from its storefront |
| 0:25–0:55 | As the studio, search by problem and budget, activate OpenSeat, then switch to an attendee searching for a class | One search finds a business tool, the other finds a workshop. Join its waitlist and retain the reference |
| 0:55–1:20 | Advance through labeled fictional operating history and rehearse the founder's absence | A founder-only action fails. Delegate it and a replacement operator succeeds in the rehearsal |
| 1:20–1:50 | As Northline, discover the opted-in business and inspect the evidence room | Recompute the 120-unit run rate, inspect protected obligations, identify one external handoff item |
| 1:50–2:20 | As seller and buyer, accept the same terms and close on NEAR testnet | Owner and withdrawable sale proceeds change. The customer obligation survives. External provider transfer shows pending |
| 2:20–2:50 | Use the former founder's credentials to attempt a privileged action. Then have the booked attendee cancel | Privileged action is refused. The service promotes the original waitlisted attendee once under the buyer's operator |
| 2:50–3:00 | Return to the attendee's original reference | A confirmed seat and calendar download. Optional evidence drawer shows the actual testnet close |

Also ship a self-guided path with seeded checkpoints and a local reset. Let the judge change the search budget, decline a grant, or test an expired sale. For the AI screeners, document exact actions and expected outputs, one offline deterministic run, one observed testnet run, and the specific external dependencies each needs. Never use a playback animation as the sole proof of a state change.

## 7. Build sequence and release gates

Plan relative to the existing deadline. Protect Day One's Nov 13 freeze and reserve Nov 14–15 for NASA. Target a captured, independently reproducible second entry by Nov 12. Tony owns publication, mainnet payout account setup, the X post, and form submission. The hackathon closes Nov 14, 2026 at 3:59 p.m. Pacific. Use its own public repo and X demo. Both project READMEs must disclose the other project. Use fictional data and NEAR testnet. Keep project sources, data, demos, and deployments independent. Official event and submission requirements apply.

| Gate | Deliverable | Exit condition |
|---|---|---|
| First 48 hours | Two buyers/customers in separate roles, one runnable service, one NEAR ownership transfer, early signer probe | Confirm a pre-sale entitlement after sale, reject a real former-owner transaction, and inspect remaining privileged keys |
| Next 2 days | Founder launch, public catalog, working search, OpenSeat booking flow | Two different audiences find and use the right offer from natural language or a form |
| Next 2 days | Operations, evidence, scoped buyer room, seller opt-in | Revenue figures recompute. Unauthorized and expired reads fail through the API |
| Next 2 days | Rehearsal, deal terms, protected balances, async failure recovery, independent client | Run the full chain of events from a clean seed, including a failed operation and safe retry |
| Remaining runway through Nov 12 | Usability, creative review, real testnet evidence, capture, clean clone | A second person can follow the README. Tony can see the story on a phone. Record test results and limitations |

If capacity tightens, preserve the real customer action, founder rehearsal, private evidence grant, NEAR sale, and post-sale fulfillment. Remove expansive catalog tooling, extra templates, animated analytics, and the external-chain extension in that order as necessary. Keep one consumer and one business search. Keep a clearly labeled physical-product offer to test the broader proposition. Ship a working demonstration before extending provider integrations.

## 8. Acceptance tests and failure cases

| Trigger | Required observation |
|---|---|
| Search includes a strict price limit or a missing required attribute | No unsupported recommendation. The user can inspect or change constraints |
| Founder saves an idea or private draft | Public search and buyer discovery reveal nothing about it |
| Public business has acquisition discovery switched off | Its offer stays discoverable to shoppers and its private deal information stays restricted |
| Buyer swaps an organization or snapshot ID in a direct API request | Denial. No counts, names, URLs, or partial private fields leak |
| Evidence is stale or supplied by the founder | The original label and date survive export, summary, and agent paraphrase |
| A malicious description asks the finder to reveal another business's records | No disclosure, privileged tool call, or ranking override |
| Two attendees attempt to take the final seat concurrently | One reservation succeeds, the other gets a truthful waitlist or sold-out response |
| The same cancellation or promotion event is redelivered | Exactly one entitlement change and notification record |
| Seller edits the price or transfer manifest after buyer acceptance | Earlier acceptance is invalidated and closing requires matching terms |
| Buyer has insufficient funds, or two closes race | No partial local settlement. At most one new owner and one seller credit |
| Founder retained an old app session, API token, queued command, or direct contract caller | Privileged actions fail at the authority boundary after close, even through a stale UI |
| Customer requests fulfillment using a pre-sale reference | The correct entitlement survives and can be consumed exactly once |
| Seller attempts to withdraw reserved customer funds | The contract rejects the amount and exposes the available balance |
| NEAR succeeds and external provider handoff fails | Show both states, identify next responsible person, reconcile and retry without repeating settlement |
| Model service, signer, or relay is unavailable | Deterministic search and local reproduction work. Every affected proof identifies its execution mode |

Test business invariants with contract-level cases, concurrency and replay tests, service integration tests, and a browser journey that crosses all four entrances. Produce a clean-clone run script, environment template without secrets, seed/reset commands, testnet deployment manifest with account IDs and code hashes, recorded receipts, and a short limitations section. A recorded testnet run may be replayed offline only when labeled as a recording.

## 9. Operating beyond the hackathon

Pilot one, founder usefulness. Recruit a small cohort of digital service founders with actual customer workflows. Watch each publish and fulfill their first offer. Measure time to first fulfilled customer action, customers returning, founder hours per week, and the number of tasks a second operator can finish unaided. Ask founders who decline acquisition discovery whether the product is still worth using. That is an early retention test.

Pilot two, solution demand. Choose a bounded vertical and geography where useful supply exists before inviting shoppers. Distinguish qualified inquiries from fulfillments. Track constraint failures, response times, false availability, repeat use, and whether a founder can attribute a customer to discovery. Interview users who left with no match. Add verified availability and fulfillment connectors where manual staleness costs actual customers.

Pilot three, buyer confidence. Work with a few strategic buyers and owner-operators. Ask each to assess an opted-in company from its evidence room, reproduce a financial claim, and run a handoff exercise. Record which information they still request outside the platform. Measure time to obtain evidence, unresolved transfer risks, and whether the rehearsal changes a real decision. Avoid proxying interest with page views.

Commercial experiments: founder operating subscription, optional paid diligence workspace, and a later closing-service fee. Test each against a measurable customer outcome. Keep search placement independent of deal fees. Model costs per active founder, fulfilled discovery request, completed handoff, and inference-heavy workflow. Establish what works economically before setting prices.

Expansion: go from SaaS to digital services, then appointment businesses, then physical goods. Each expansion needs working fulfillment, returns or cancellations, business-specific evidence, and real provider handoffs. Consider franchise succession, employee buyouts, and customer cooperatives only after the core handoff has survived a real pilot. Existing businesses should be able to import records with provenance and missing periods visible.

Before handling production money or live acquisitions, establish a jurisdiction-specific operating model with appropriate professional partners. Resolve custody and payment responsibilities, asset versus entity sales, contracts and consents, data retention and deletion, incident recovery, access revocation, fraud reports, moderation, and independent security review. Use a staged rollout with reversible integrations. The hackathon proof makes a narrow, verifiable claim about managed operating rights.

## 10. Naming workshop for Tony and Astra

Decided 2026-11-01: **Everstreet**. The original exploration (Going Concern, Openstead, Marketwright, Commonworks, Nextkeeper) is kept in Tony's conversation. Keep the public brand configurable in one place. Keep contract interfaces, database identifiers, and business templates brand-neutral. Domain, trademark, public listing, and hackathon name availability remain to be checked.

## 11. Handoff rhythm and first instruction

Claude, begin with the first 48-hour gate. Write down your proposed authority model, exact assets covered by the sale, and which parts of the demo are fixture, sandbox, or live testnet. Build the smallest independently runnable OpenSeat service that can exercise the ownership transition. Return a short decision log and evidence of the successful customer action and failed founder action. Flag any assumption that weakens the central product promise. Make a sensible reversible choice on routine implementation details.

For creative review, show Astra via Tony the opening screen, a real match explanation, the founder's rehearsal failure, and the customer's experience after closing. For project review, give Muse milestones, dependencies, and outstanding Tony decisions. For technical review, use the locally authorized Claude Code/Codex workflow as available and supply this brief explicitly. Keep secrets, private repositories, personal information, and employer details out of public artifacts.

Reference points for product discovery: Stripe Atlas for founder formation workflows, Acquire.com buyer workflow for diligence and discovery, and Acquire.com asset transfer guide for the provider-dependent work of handing over an existing SaaS business. They are adjacent products to study, with no integration or partnership assumed.
