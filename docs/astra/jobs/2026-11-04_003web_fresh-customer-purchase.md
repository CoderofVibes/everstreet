# A new customer buys and uses the product

Selected for dispatch after003wea browser/lifetime acceptance at16ec3d4. Next child of
003we, then003wec guarded revocation, before003wf. P0/L; subdivide if needed, retaining
every acceptance item. Tony's platform must work for someone arriving without pre-seeded units.

## Grounding at 6773920 / 7f6fc0b

The existing purchase.ts prepares sponsor_shell and ft_transfer_call but has no purchase UI,
storage quote, token balance/registration reads or recovery controller. customerRead validates
purchase_seq already; deviceKeys' projection does not expose purchase prerequisites. The contract
sponsor_shell charges measured storage growth and records a registration id. validate_buy checks
the next sequence, exact amount, purchase/outstanding caps and optional key; ft_on_transfer returns
the whole amount for a refused purchase. A successful outer wallet transaction is not proof of
purchased units or a completed refund. A storage_byte_cost reading alone is not the total quote.

## What the customer sees

Open the product, sign in, choose a supported number of uses, see a clear token-denominated price
and any separate refundable storage deposit, review and approve necessary wallet steps, then see
confirmed available units. The product explains missing token funds or unavailable setup without
inventing a fiat value. Enable the device with reviewed limits and complete one real service use
through existing routes. The same product remains accessible after an ownership handover.

Keep technical fields available in readable transaction details; lead with the product, quantity,
total, fees/deposits, account and outcome. Distinguish checking, wallet approval, processing,
confirmed, refused/returned, and unknown. Reopening must recover an unanswered purchase before
offering another one. Do not silently repeat a payment or advance to a fresh sequence.

## Implementation and acceptance

1. Design the complete dependency/read/transaction/outcome sequence before code. Use the real
   v3 methods and pinned wallet API. Expose bounded, authenticated prerequisite inspection tied
   to exact network/business/offer/release/plan/customer and final block evidence. Keep plan/token
   metadata, symbol/decimals, balances, registration, purchase_seq, registration id and outstanding
   cap coherent; reject malformed/oversized/stale/mismatched reads. Display unknowns honestly.
2. Implement a defensible shell-storage quote. Validate against the contract's measured growth
   across relevant customer/payer/account lengths and current serialization. If a contract view or
   explicit versioned capability is required, Claude owns that implementation and local tests;
   do not deploy it. Distinguish an exact cost from a bounded maximum with excess refund and show
   the basis. Do not invent a magic deposit or treat a per-byte price as a complete quote. Preserve
   supported existing deployments with a clear unavailable/upgrade requirement when necessary.
3. Read the actual accepted FT's balance and storage registration/bounds. Construct registration
   if needed with exact receiver/account/deposit and plain explanation. A customer needs their own
   testnet tokens; do not fabricate a faucet, purchase funds, bridge, or consume another account's
   balance. Inspect required receiver registration too; missing business setup has an owner action.
4. Finish exact purchase preparation: u32/u64/u128 ranges, BigInt total, outstanding and per-purchase
   caps, sequence overflow, optional install constraints and registration identity. The current
   decimal regex is not a u128 upper-bound proof. Ensure all reviewed account/network/recipient/
   asset/amount/deposit/gas/terms survive validation immediately before a wallet request. Changes
   need renewed review. Preserve the customer's stored key through optional purchase-and-install;
   separate purchase then enrollment is supported, with no auto-enrollment or new account key.
5. Add persistent scoped purchase intent/recovery through normal composition and UI. Store only
   necessary public identifiers/terms/status (no private keys, customer documents or raw signatures).
   Retain the original sequence/registration/request when the wallet answer is lost, on reload,
   across tabs and after process restart. Do not equate any sequence increment with THIS purchase;
   another tab/device may buy. Correlate the exact transaction and receipts/readback where possible;
   otherwise preserve uncertainty, with a bounded explicit status check and a useful next step.
   Distinguish accepted units from FT-return/refund resolution. No automatic fresh-sequence retry.
6. Use the pinned wallet's actual response capabilities to obtain transaction evidence; preserve
   unknown when the adapter gives none. Do not invent universal wallet transaction hashes or infer
   chain finality from popup closure. Keep signing/transmission in the customer's wallet, with
   production server authority limited to verification/readback. No hidden server customer signer.
7. Tests start with no entitlement or device key. Through real routes/controllers, create the
   shell, register token storage if needed, buy100, enroll and execute/charge one use. The synthetic
   chain must apply these actual calls and contract rules, not seed the desired post-state after
   the click. Anchor transaction encoding, storage quote, limits, return behavior and optional
   install to actual contract tests/fixtures. Include insufficient funds, stale quote/terms,
   cancellation, accepted-but-lost response, rejected-and-returned transfer, malformed answers,
   concurrent same/different purchases, reload/restart, account switch and old-owner continuity.
8. Provide a finite browser harness for this new-customer journey at the wallet/network boundary,
   preserving the production controller/routes and explicit synthetic label. Review phone/desktop,
   keyboard, quantity/price clarity and recovery; no fake availability or completion. Run check and
   webbuild, report exact evidence and remaining gates, commit locally, stop for Astra review.

Full configured composition/maintenance/process concurrency and100/20/80 acquisition remain003wf;
this child must provide a working customer purchase path for that integration. Neither fixture
success nor this local gate proves live NEAR, M2/M3 or the full roadmap. Keep worker002f1, imports,
operating network and expanded products/ownership jobs. No scope cuts.

No real wallet/transaction/provider/deployment/host action, existing credential read, new spending,
push/publication/submission, research assessment or Day One access. Use fictional inputs and newly
generated ephemeral test keys only. Actual Claude Opus5.5/high subscription, one implementation
writer; Astra reviews. Any required external decision belongs to the concrete rehearsal packet.
