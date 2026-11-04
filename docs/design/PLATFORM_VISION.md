# Everstreet: build, operate, discover, acquire

Authority: Tony's November 2, 2026 conversation with Astra. This updates the audience and
product direction in `docs/BRIEF.md`; `docs/AUTHORITY.md` still defines what the present
contracts actually enforce. Proposed capabilities below are a development mandate, not a
claim that they already exist.

## Product promise

Everstreet is the home for entrepreneurs building digital businesses in the AI economy.
Someone arrives with an idea and builds with AI inside the platform, or brings a product
built elsewhere. Clients discover and use it. Founders operate and grow it. An acquirer can
inspect and buy the business on NEAR while customers keep their service and entitlements.

AI tools, SaaS, APIs, agents, websites, NEAR applications and online services are the primary
world. Existing class fixtures remain regression evidence; they must not dictate the product
language, defaults or flagship experience. All sample people and businesses are fictional.

## Standing decisions from Tony

- Both creation inside Everstreet and importing an existing product are wanted.
- "One key function of Everstreet is the seamless purchase and transfer of business/product
  to the investor/acquirer, on NEAR. So, that has to stay central to this as well."
- "I want you to drive the development of that build with Claude as your builder."
- All six milestones and the proposed additional platform functions are in the roadmap.
- "We can use Claude Code usage and API credit." Prefer the authenticated Claude Code
  subscription for our development. Customer-facing model execution has its own provider
  configuration and usage accounting; never silently consume a personal login for users.
- "If we run out of Claude usage ... feel free to do some building yourself."
- Tony wants the first full creative walkthrough after the buildout. Internal design and
  verification continue throughout, without requiring approval of routine iterations.
- Seven to ten days is an initial horizon, not an agreed guarantee of a complete production
  platform. The existing hackathon capture/deadline remains a separate delivery milestone.

## Six connected experiences

1. Shape: an approachable conversation produces an editable business brief: customer,
   problem, product, scope, evidence, assumptions, price and costs. No prompting expertise
   or terminal is needed. The founder can correct any inferred detail.
2. Choose: supported foundations for an AI API, SaaS workflow, agent service or client portal.
   Explain what each can do and the services it needs. Extend the catalog as each is proven.
3. Build: a persistent studio with conversation, live preview, visible job progress, versions,
   changes and recovery. The preview is usable; clicking a pictured control must either do
   the advertised thing or explicitly identify an unavailable capability.
4. Test: customer journey checks and AI evaluations with test inputs, results and failures.
   Separate deterministic tests, model evaluations, manual checks and unknowns.
5. Prepare: price, compute budget, customer promises, payments, dependencies and release
   readiness. The founder understands what will run and what it costs before enabling it.
6. Launch and improve: public product profile, customer access, service runtime, usage,
   support, financials, revisions and acquisition readiness use the same business identity.

## Approved visual and interaction direction — November 4

Tony approved the complete UI replan and explicitly authorized implementation. Read
[EVERSTREET_UI_DIRECTION.md](EVERSTREET_UI_DIRECTION.md) before every UI pass; it is the durable
visual authority and supersedes the earlier dark navigation/mint-primary direction.

Everstreet is a premium creative workspace connected to a living marketplace. Luminous mineral
and paper surfaces, deep blue-black typography, cobalt actions and restrained warm highlights;
selective glass for navigation/tools, clear content surfaces, precise data type, meaningful motion
and a calm predictable experience. Distinct Discover, Studio, Operate, Acquire and customer
compositions share identity. Studio centers conversation plus a large working canvas and
contextual editing; operations shows useful charts; acquisition centers exact terms, evidence and
customer continuity on NEAR. No invented statistics or execution claims.

The accepted direction file records the complete influence hierarchy, five experiences,
navigation, internal visual review and rollout sequence. The November 4 no-building hold is
lifted by Tony's explicit approval. Proceed with bounded implementation and Astra review without
repeated routine design approval. Preserve the first full creative walkthrough after buildout.

## Architectural direction for Claude to validate

- Preserve valuable contract, payment, sale and customer-rights work. Extend it for digital
  products; don't rewrite working systems solely for a new appearance.
- A business owns its products, studio projects, releases, runtime records, entitlements and
  financial observations. Personal chats and unrelated credentials do not become sale assets.
- Persist provider-neutral build jobs, events, immutable revisions, evaluations and releases.
  Support cancellation, restart recovery, idempotency and cost limits. A model response is
  not a successful build; completion is based on the resulting artifact and checks.
- Keep a structured product plan separate from generated executable code. The earliest safe
  preview can render a validated schema. It must be called a prototype until it actually
  implements and runs the promised customer behavior.
- Arbitrary generated code runs only in an isolated worker/sandbox, never in the platform
  server or an unrestricted host process. Build workers cannot access platform secrets,
  another business's data, the owner's keys or the treasury. Preview has an isolated origin
  and restrictive messaging/content policy. Scope network and compute budgets.
- Development agents change code; operating agents serve customers. Their authority,
  billing, logs and failure recovery are separate.
- Production model calls use supported provider authentication. Tests use deterministic
  injected providers, clearly separated from live execution. A missing provider is an
  actionable unavailable state, never a silent fake completion.
- Managed operations follow NEAR ownership and revoke old administrative authority after a
  confirmed close, while customer access survives. Explicitly track external transfer items.
- Import starts by inspecting connected source and deployment metadata and reporting gaps;
  connecting a repository alone does not establish ownership or transfer readiness.

## Flagship acceptance journey

A founder builds an AI document-to-data service. A customer prepays for 100 uses and consumes
20. Those uses and compute costs appear in operating records. A buyer inspects scoped evidence,
accepts exact terms and buys the business on NEAR testnet. The customer continues with the
same access and 80 uses remaining. The former owner loses administrative control; the buyer
can serve customers and release a reviewed update. Test doubles and live testnet evidence
are separately labelled. External accounts are not called transferred until verified.

## Milestones and acceptance gates

| ID | Scope | Gate |
|---|---|---|
| M1 | New product system and persistent studio | A signed-in founder can create, reopen, edit and version a digital project; routes and existing workflows remain usable |
| M2 | Real AI creation and isolated execution | An idea becomes a tested working product with visible build events, recoverable errors and bounded usage |
| M3 | Digital commerce and NEAR acquisition | The flagship 100/20/80 entitlement journey passes across sale; no stale-owner authority |
| M4 | Existing-product import | Source, runtime, payments and dependencies can be connected with a truthful readiness report |
| M5 | Discovery, growth and operating network | Demand board, living profiles, financial intelligence, delegated operators, expert help and buyer portfolios function with persistent records |
| M6 | Expanded products and ownership | Additional product families, business integrations, team/co-op controls and transfer rehearsals pass equivalent lifecycle checks |

M2 and M3 are both central. Do not defer all acquisition work until the studio is "finished".
Implement coherent vertical slices. Open smaller jobs as the architecture becomes clear.

## Quality and scope management

Every milestone needs code checks, meaningful behavioral tests, visual/browser review and
an honest capability inventory. Static mockups, simulated builds and cosmetic screens do not
satisfy a functional milestone. Keep the entire roadmap; sequence additions rather than
silently removing them. Where production sign-in, hosting or third-party accounts are absent,
build and verify local capabilities and record the remaining integration gate.

No public release, remote push, mainnet, purchased service, top-up or submission is authorized.
Use existing credits within the work; do not change billing settings. Preserve Day One
separation. Astra directs/reviews; Claude implements, verifies and commits locally. Use one
writer per shared file set. Human brand, scope and external commitments remain Tony's calls.
