# Direct acquisition through each participant's own wallet

**DISPATCH NOW, November4 at21:50 Pacific.** Next003wf child after003wf1 lifecycle corrections passed
Astra review (ConfiguredLifecycleAccepted, final222e49f). Prior writer71521 exited and its exact
process is absent. P0/L. All parent003wf requirements,
Gated acquisition and six milestones remain; this child completes the Direct sale surface.

## Product outcome

Tony: "One key function of Everstreet is the seamless purchase and transfer of business/product
to the investor/acquirer, on NEAR. So, that has to stay central to this as well."

A founder prepares exact terms for a named buyer. The buyer reviews the business, the price,
customer obligations and the authority they will receive, funds escrow and accepts. The seller
accepts the same version. On a Direct contract the second matching acceptance closes the sale.
Everstreet verifies that exact outcome and reconciles its records; the buyer can operate the
business, the seller's management access ends and customers keep the same service and units.

This is a local implementation and synthetic verification job. It does not authorize any real
wallet use, transaction, deployment, payment or external service.

## Grounded starting point, November4 at662445a

- `contracts/business-v3/src/lib.rs` implements propose/revise/fund/unfund/accept/cancel/expire,
  Direct close and claim_party. `BUSINESS_V3_SALE.md` specifies exact semantics. Do not use v2.
- `server/src/v3intents.ts` records observed terms and reconciles a proven close; it explicitly
  never proposes, pays or accepts. Preserve its private, exact-version, once-only transition.
- `web/src/pages/DeskSale.tsx` hides v2 proposal controls for v3 and links to read/record/apply.
  `ACQUISITION_WORKSPACE.md` describes that existing observation-only journey.
- `web/src/wallet.ts` supplies verified account sign-in and a pinned single FunctionCall wallet
  boundary. `customerPurchase.ts` provides durable wallet intent and exact FINAL receipt recovery
  patterns. Reuse appropriate infrastructure without treating a purchase resolver as a sale one.
- propose/revise may create a buyer party record with measured storage cost (`ensure_party`).
  A guessed deposit or customer-shell quote is not a sale-party quote.
- acceptance binds sequence/version/digest. Current revise/cancel/unfund bind sequence but do
  not compare a reviewed version. A pre-send refresh cannot alone guarantee the reviewed version
  remains current at execution. Inspect and explicitly solve this where the UI promises that.

Reinspect after003wf1; these are source facts, not completed commerce evidence.

## NEAR implementation references supplied by Tony

Read [NEAR skill references](../2026-11-04_NEARSkillReferences.md). The complete official
near-smart-contracts, near-api-js and near-contract-audit packages are cached locally at the
recorded pinned revision, with all companion files and checksums. Read each selected SKILL.md
and its references before application; record what you used. Apply the relevant development
and review guidance within current repo permissions and pinned-version compatibility. This
does not authorize tool installation, wallet migration, external calls or contract deployment.

## Required implementation

1. **Design before code.** Map every visible action to exact v3 methods, deposits, source views,
   actor authority and durable state transitions. Explain transaction confirmation versus
   contract ownership versus local reconciliation, and prepare versus sent/unknown versus
   confirmed. Keep the approved calm acquisition composition and one useful next action.
2. **Exact proposal and review.** Implement seller proposal and revision for Direct businesses.
   Preserve immutable off-chain terms content and its hash, contract digest, buyer/seller,
   generation, manifest, price/asset, expiry, floor and explicit operator grants. Named metering
   authority in the terms supports continuity; omission needs an honest interruption and explicit
   buyer appointment path, not hidden reappointment. Reviewable buyer authority and external
   transfer limits stay visible. No private customer documents or acquisition details on storefronts.
3. **Wallet commerce.** Prepare exact immutable calls; connected wallet account must match the
   verified participant before send. Include funding through the actual FT transfer-call path,
   each party's acceptance, revision, cancellation, unfunding and expiry. Only matching affirmative
   final evidence establishes success. A successful token transfer is not proof escrow was
   retained: verify receipt graph, returned/used amounts and exact deal/version/price. All amounts
   use canonical base-unit strings and verified asset metadata; never Number for money.
4. **On-chain review guarantees.** Validate source/capability and storage requirements at pinned
   bounded reads. If guarded methods or a party-storage capability/quote are necessary, implement
   them in Claude-owned contract work with measured Rust tests and compatibility evidence. Do not
   downgrade silently on older code. Stale generation, manifest, version or changed account must
   not execute a different action from what the person reviewed. State precisely any deliberate
   guarantee narrower than exact terms and obtain Astra review before implementation.
5. **Durable recovery.** Persist preparations and record a wallet ask before invoking the wallet.
   Keep the exact original operation across reload, account switching, lost replies and restart.
   Recover by original transaction identity and authoritative receipts/state; a later lookalike
   sale is not this intent. Unknown stays unknown. No fresh automatic send because time elapsed,
   a nonce was used or a result is missing. Prove admission/CAS when tabs or processes contend.
   A safely abandoned unsent preparation differs from an uncertain sent transaction.
6. **Claims and close.** Reconcile through existing authority code, not direct ownership SQL.
   The buyer and seller each retain only their permitted receipt/history. Sale proceeds and
   escrow returns are owed claims until an actual payout is proven; distinguish pending, failed,
   restored claim and paid. Provide the correct claim category action and exact evidence recovery.
   Show a closed sale even when proceeds collection is pending, without claiming money was paid.
7. **Coherent local journey.** Extend the supported synthetic wallet/network boundary to apply
   actual encoded calls in one state model anchored to contract-produced fixtures/Rust tests.
   Start from explicit bootstrap prerequisites, then propose/fund/accept/close through real APIs
   and controllers. Never replace sale transitions with a fixture toggle. Read current contract
   rules, including grants, floor, revisions, escrow returns and outcome identity. Refuse unexpected
   contracts, methods, malformed envelopes and unsupported destinations. No real fetch fallback.
8. **Review harness.** Supply a finite normal-composition browser harness for seller and buyer,
   including labelled synthetic wallet actions, lost replies, reload and stale review. Astra will
   inspect1440/1280/390, keyboard/focus, readable exact terms, errors and buyer/seller aftermath.
   Keep all existing customer UI permission gates; don't route around a blocked action. Prepare
   browser cases while independent keyless controller/process tests proceed.

## Acceptance evidence

Meaningful tests must prove Direct close and customer continuity, plus changed terms/accounts,
funded revision (same and changed price), cancel/expiry/unfund and claims, wallet loss/reload,
fresh versus unknown intent handling, wrong transaction/receiver/deal/receipt and duplicate
actions. Include appropriate actual-process restart and contention tests through production
composition; preserve003wf's wider purchase/provider/close/nonce/migration matrix for explicit
remaining children. Narrow evidence cannot close that parent.

Run required Rust checks for contract changes, npm run check and web build; supply requirement
matrix, exact local commits, capability limitations and finite browser instructions. Stop for
Astra review. Completion requires functional implementation and independent behavior/UI review,
not a successful mockup or a typed adapter alone.

## Scope retained and boundaries

Gated close needs its actual closer/drain/continuity integration in a separate bounded child;
do not call it functional from contract fixtures or route it through Direct controls. Owner
plan/operator setup, unresolved-writer recovery, complete100/20/80/79 configured journey,
broader concurrency and prepared-only external rehearsal remain explicit003wf obligations.
The approved003x/005e/006b/006c additions follow their dependencies. No roadmap cuts.

Claude owns contract/scripts/config work and all local commits; Astra directs/reviews. Exact
Opus5.5/high subscription, no duplicate writers, no API budget or model substitution. No real
wallet/provider/transaction, credentials, deployment, spending, public release/push/submission,
research contents, Day One or worker-host work. All tests bounded and synthetic/keyless; all
previews/processes finite with exact cleanup. No research assessment or source copying.

