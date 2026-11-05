# Configured process evidence must preserve contract and block identity

Astra reviewed the new in-progress server/test/lifecycleWorld.ts while86864 is sole writer.
Its explicit IPC-only network seam and actual transaction signature verification are useful,
but two boundary defects would let configured-process tests certify incorrect evidence.

At20:37, server/test/astra-lifecycle-rpc-review.test.ts reproduces2/2 failures:

1. Querying get_control for unrelated-synthetic.testnet returns the fixture business's state.
   The positive query for the actual BUSINESS succeeds too; the unknown-account query must
   refuse, not ignore account_id. Apply the same identity discipline to signed transactions:
   current apply decodes receiver but does not compare it before applying the business method.
2. After obtaining a block hash and reading its seller/control, a named afterSale fixture
   transition in a later block causes the SAME old-block query to return the buyer/generation2,
   still labelled with the old hash. Preserve a bounded historical snapshot, or honestly refuse
   an unavailable block. Never wrap current mutable views in a requested historical block label.

These are evidence-infrastructure failures, not a claim that the production RPC adapter accepts
mixed blocks. Correct them before relying on this seam for restart/ownership/freshness proof.
The parent003wf requires coherent synthetic state and relevant transaction validation.

Also harden decodeSigned/application against unsupported encodings: currently key/signature tags,
action count/kind, block hash, gas and deposit are skipped rather than validated. A correct signature
over wrong receiver or malformed action must not become an accepted fixture method. Validate the
relevant envelope/contract preconditions, refuse unknown destinations/methods, and add negative
cases; don't weaken production validation to fit the double. No need to emulate the whole chain,
but accurately declare what this bounded double can and cannot establish.

Astra added only this pass and separate tests. Claude owns lifecycleWorld and implementation;
please review, correct, verify, commit and record INDEX at handoff. Existing lifecycle shutdown
findings and all parent003wf requirements remain. No real transaction/provider/network/browser
permission action or research access; all keys and state are synthetic. All six milestones retained.

Required npm run check38187 completed exit1: types pass, two pre-existing in-progress lint
warnings (compose optional chain/composeChild unused portText),1431pass/2fail/1skip. Only the
two new RPC regressions fail. This snapshot does not establish the pending actual-process matrix.

At20:47 Astra independently reran both probes after the correction:2/2pass. Source now binds
queries and signed calls to chain.business, stores bounded historical state snapshots and refuses
unknown/pruned blocks, and validates the transaction's key/signature types, action count/kind,
receiver, known block, exact supported gas/deposit and trailing bytes. Reviewed negative tests
in lifecycle-rpc.test.ts; builder reports all5 including the two independent probes pass. The
actual-process matrix is being rerun on this corrected seam; no broader acceptance yet.
