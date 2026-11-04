# Everstreet UI direction — approved November 4, 2026

## Authority and durable memory

Tony said the current UI looks incredibly similar to another project and requested a replan.
Astra proposed the direction recorded here. Tony then explicitly approved it:

> "Can you remember all of this and start to implement it please? I like everything you just listed out"

This authorizes implementation and lifts the earlier no-building hold. This file supersedes
the former dark navigation/mint-primary visual direction, including conflicting visual details
in older job briefs. It does not replace PLATFORM_VISION's six milestones or AUTHORITY's actual
contract/transfer semantics. No new brand name, external commitments or publishing authority.
Read this with PLATFORM_VISION before any UI job. Astra directs and visually reviews; Claude
implements and locally commits. User approval of this direction is sufficient to proceed without
another routine design approval. Preserve the full creative walkthrough after buildout.

## Identity

A premium creative workspace connected to a living marketplace: welcoming to a first-time
founder, capable for an experienced builder, credible for acquisition. Distinctive identity must
come from composition, product demonstrations, typography and interaction, as well as color.
Do not inspect, reuse or imitate the separate project. Day One separation remains absolute.

The approved default is luminous and expressive. Pale mineral surfaces, deep blue-black type,
distinctive cobalt actions, restrained warm highlights. Dark canvases are local tools for focus
and previews where useful, not a mandatory dark shell. Establish exact accessible color tokens
in implementation; initial candidates: canvas #F4F6FB, paper #FFFFFF, ink #17243C, cobalt #3155D9,
warm highlight #F3C49D. These are candidates to contrast-test, not a claim of verified contrast.
Semantic success/warning/error colors remain separate from brand actions.

Strong type hierarchy and differences in scale; confident headings, readable human-oriented
body text, technical mono for numbers, versions, build activity and ownership evidence. Use
available/system or existing bundled fonts; no remote font dependency or spending. Precise fine
rules, disciplined grouping, roomy composition and large useful product previews. Use the
existing coherent icon vocabulary with visible labels for important actions.

Everstreet's name can inform an architectural sense of shared places and connections through
composition/navigation. No literal 3D city, street map obstacle course or decorative spatial UI.

## How the research becomes product rules

| Influence | Approved application |
|---|---|
| AI-native / agentic | Conversation alongside a working canvas, contextual editing tools, visible progress, proposals and undo; no prompting expertise needed |
| Calm | Readable content, breathing room, predictable navigation, clear next action, useful defaults |
| Liquid glass | Restrained translucent floating navigation/toolbars/temporary panels; opaque fallback and stable readable documents/charts/transaction details |
| Technical mono / grid | Precise data, versions, evidence and progress; warmer expressive typography for ordinary product use |
| Material 3 Expressive | Deliberate hierarchy, tactile feedback, purposeful color/shape; Everstreet's own components rather than a stock Material skin |
| Bento | Modular summaries when comparison benefits (operations/portfolios); not a universal template for every page |
| Spatial motion | Restrained depth and motion explaining a panel, version or transfer state change; no perpetual animation or hover-only information |
| Adaptive layouts | Tools adapt to goal/context/device; navigation and critical controls stay stable; user can reopen/dismiss panels and retain control |

No gaze tracking/camera requirement. No arbitrary rearranging under the pointer. Honor reduced
motion, keyboard access, high contrast and browser zoom. Glass must remain readable over all
underlying states and have an opaque fallback. Motion must explain an actual state change,
not imply a model ran, tests passed or a chain transaction confirmed when it did not.

References consulted during proposal: Apple materials guidance
https://developer.apple.com/design/human-interface-guidelines/materials and Google expressive
design research https://design.google/library/expressive-material-design-google-research.
These inform principles; do not copy their branded look or promise their measured results here.

## Five related experiences

### Discover

An engaging marketplace led by useful product demonstrations, examples and comparisons.
Clear entry for builders, clients and acquirers. Show real published content; no fabricated
activity, customer totals, revenue or proof. Example content is explicitly illustrative and
owner-reviewed; actual Use actions open the product. Coming-soon availability is truthful.

### Studio — flagship

The working product canvas owns most of the space. A conversational companion helps shape the
idea, proposes changes and explains decisions. Selecting a supported preview element exposes
contextual tools; unsupported actions say why instead of pretending. The founder can inspect
changes, test them, compare versions and undo without knowing coding-agent prompts. Persistent
drafts and recovery remain essential. AI availability, prototype, generated build, evaluated
artifact, released service and live execution stay distinct. Never invent backend capabilities.

### Operate

A focused business workspace with substantial visual accounts of revenue, use, cost and customer
obligations. Charts connect to explanations and actions, such as which product drives a cost
increase. Missing observations remain unknown, sources visible, units/currency exact. Reserve
modular summaries for useful comparisons; provide detailed readable tables alongside charts.

### Acquire

A composed, trustworthy environment with strong evidence, exact terms, transfer contents and
customer continuity. Distinguish preparation, approval, pending transaction and confirmed
ownership. Do not visually confirm a close from intent alone. Seller loses administrative control,
buyer takes over operations, customer service/units/history continue. Keep private acquisition
intentions and scoped evidence off customer storefronts. NEAR is central, not ornamental.

### Customer product

Direct, polished service use with clear input, result, entitlement/cost and recovery. The broader
platform stays reachable without overwhelming the immediate task. Existing results, customer
promises and access survive ownership changes. Never ask customers to understand platform
implementation details when they do not help a meaningful decision.

## Navigation and composition

Stable primary destinations: Discover, Build, Operate, Acquire. Use a spacious horizontal
desktop header as the initial implementation direction, with a compact contextual secondary
navigation only where needed. Profile, inbox and My activity remain reachable as utilities.
Preserve route deep links, multi-role use, current business/product identity and acting-context
clarity. Mobile has visible labelled access to the same destinations without horizontal overflow.
This replaces the omnipresent large dark left rail. Avoid nested navigation inside repeated cards.

Shared system, different compositions: editorial marketplace, expansive studio canvas, clear
operating overview, readable evidence/deal progression, focused customer workflow. Do not render
every experience as the same card grid. Use one coherent identity/promise/primary action per
surface, with supporting content visibly subordinate.

## Implementation and internal review sequence

1. Identity and navigation: codify tokens, typography, controls, depth and motion. Internally
   compare two compositions within the approved luminous direction on Discover/Studio/Acquire;
   select and document the stronger shared system. This is Astra/Claude design work, not another
   approval request or a reason to stall implementation.
2. First vertical slice: shared shell plus discovery and digital storefront, preserving and
   finishing useful interrupted001e product-example functionality. Make it coherent and testable.
3. Studio: conversation/canvas/context tools, clear build/test/release/version flows and recovery.
4. Operations and acquisition: distinct substantial layouts using existing data/authority, then
   customer experience and cross-journey polish. Keep import/network/portfolio/M6 entry points.
5. Carry one fictional digital business through idea -> build -> test -> publish -> customer use
   -> operating evidence -> acquisition, with consistent identity and truthful capability labels.
6. Astra reviews screenshots and real interactions each slice, including1440/1280/390, keyboard,
   reduced motion/zoom, empty/loading/failure states. Fix concrete issues before broad rollout.

Use bounded jobs and local commits. Keep working behavior and contracts; no speculative rewrite
of backend logic for visual uniformity. Visual approval does not satisfy functional milestone
gates. All six milestones remain open until independently verified. No push, external public
release, submission, mainnet, new spending, signing/deploying by Astra, real data or research
assessment. Local-only research must never enter tracked design docs or deliverables.
