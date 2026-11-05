# Fresh-customer purchase planning

Tony's original direction requires clients to use products and keep service through acquisition.
An existing funded fixture does not satisfy a customer arriving for the first time.

While Claude58217 corrects003wea, Astra inspected the actual v3 sponsor_shell, ft_on_transfer and
validate_buy implementations, customerRead/customerUse projections and current purchase helpers.
Added queued003web_fresh-customer-purchase.md as the next bounded child inside003we, before003wf.
No implementation changes or new Claude writer. JOBS/INDEX registration is deferred to a safe
handoff because Claude owns those active files. Register this pass then as well.

The plan retains shell/token registration, defensible storage quote, exact quantity/price/caps,
customer wallet consent, durable uncertain-outcome recovery and an actual fresh-customer browser
path. It explicitly avoids interpreting a sequence increment or outer transaction success as
proof of this purchase. Contract return/refund behavior and optional device installation need
their own evidence. Any quote-related contract work remains Claude's; no deployment authorized.

Changed only these two new planning files. Current1316-test passing checkpoint predates this
documentation-only addition; final checks remain required with implementation. No research read,
external call, existing credentials, host action, signing or Git writes. All six milestones remain.

## In-progress003web source review: registration identity at execution

At9d0ed26, Buy contains plan_id, units, purchase_seq and optional install, but no registration
identity. validate_buy finds the current (sender,plan) record and checks its next sequence.
unregister can remove an empty record; sponsor_shell creates a new registration with sequence0.
Consequently a wallet-approved buy for the prior empty shell at sequence1 appears able to execute
against a replacement shell with sequence0. Client fresh reads cannot make inclusion atomic.

This is a source-derived hypothesis, not a reproduced contract failure. Claude should first
characterize the exact interleaving in real Rust tests: prepare terms for registrationA, remove
that empty shell, recreateB, deliver the old ft_on_transfer buy. A successful outer FT transaction
and matching next sequence must not substitute for the reviewed registration. Preserve existing
customer authority; do not imply a different account can spend the customer's tokens.

If reproduced, decide the contract/client binding in003web's design before claiming exact
reviewed purchase identity: a supported guarded buy format/capability can refuse stale reg_id
with the full amount returned and no mutation. Keep older API compatibility explicit, with no
silent downgrade. Contract-produced acceptance/refund fixtures and the UI should carry that
identity through uncertainty recovery. No deployment or real transaction is authorized.

This review is independently grounded in the actual v3 Buy/validate_buy/unregister/sponsor_shell
source and the existing003web exact-registration requirement. It does not import external research.

After design0ed7557, see PurchaseDesignReview for receiver-rejection versus token-refund evidence,
receipt provenance/finality, unknown-payment abandonment and exact quote capability requirements.
These are source/design findings for003web, not a second dispatched job or completed test proof.
