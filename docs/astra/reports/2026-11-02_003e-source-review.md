# business-v3 core review (job 003e)

I reviewed `contracts/business-v3/src/lib.rs` (1457 lines) and `src/tests.rs` (1293 lines) against the job, `BUSINESS_V3_CORE.md`, consolidated-candidate §2–3, addendum §8 and revision 2 §A. This was read-only: I wrote nothing, ran no commands and made no Git changes. None of the repro sequences below have been executed. Each one is a small unit test you could add to confirm it.

The core holds up well on the things the job stresses most. Purchases are checked in full before anything changes. Use batches are checked in two passes before any write. Every refund uses the plan's fixed price. Old or repeated callbacks are ignored because each one carries the payout id. A failed payout always becomes the claim of the account it was going to. I found no way to move money between buckets incorrectly through normal use. The findings below are ordered by importance.

## Core defects

### 1. Weak (small-order) use-keys are accepted, so anyone can forge holds and uses for them (P1)
- **Where:** `lib.rs:772` (`install_key`) and `lib.rs:1317` (key install inside a purchase) take any 32 bytes as a public key. The checks at `lib.rs:883` and `lib.rs:944` rely on `env::ed25519_verify`.
- **Why it matters:** I'm fairly sure nearcore's host function uses ed25519-dalek's ordinary `verify`, not `verify_strict`, which accepts weak keys. If so, for the identity key (`01` followed by 31 zero bytes), the signature `01 00…00 | 00…00` checks out against every message. The all-zero key is a weak key of order 4, so a forger needs only about 4 tries, varying the fingerprint or `serve_until`.
- **Consequence:** an operator can charge every unit with no customer involvement. The headline promise "no charge without a customer-signed HoldAuth and UseAuth" (consolidated §5) fails for that entitlement. It also makes signatures useless as evidence in a dispute, in either direction.
- **Likely trigger:** a client bug that installs a zeroed buffer, or a customer who installs a weak key deliberately in order to dispute charges later.
- **Repro:**
  1. CARA: `sponsor_shell(CARA, 1)`, then `buy{units:10, seq:1}` with no install.
  2. CARA (1 yocto): `install_key(1, 0, "01"+"00"*31, 10, 30)`.
  3. METER: `open_hold(CARA, 1, {hold_seq:1, units:10, serve_until:now+20min, key_slot:0, key_epoch:1}, "01"+"00"*63)` → expect `"opened"`.
  4. METER: `settle_hold(CARA, 1, 1, slots 0..10, any fingerprint, that same signature, close=true)` → expect 10 × `"charged"`.
- **Not yet confirmed:** the test mock runs nearcore's real verification logic, so this repro would settle the question either way.
- **Fix direction:** at both install paths, reject the known list of small-order key encodings (as libsodium does). A proof-of-possession signature does not help here, because a weak key can forge that too.

### 2. The entitlement view can't support the gateway's planned read-back (P2, misleading observation)
- **Where:** `EntitlementView` (`lib.rs:368-396`, `get_entitlement` at `1152-1180`).
- **What's missing:** it shows the `hold_used` bitmap but not `hold.slots` (the fingerprints). It also leaves out `hold.key_slot`, `hold.key_epoch`, `opened_at_ms`, and each key's `max_units_per_day` / `held_today`.
- **Why it matters:** consolidated §3.5, first row, needs `slots[slot] == fp` to tell "charged" apart from "a different signed use was charged in this slot". With only the bitmap, a gateway reading back an active hold would have to record a conflicting use as the customer's own charge. A client also can't tell which key epoch the active hold was opened under.
- **Repro:** after s03's first settle (slots 0–4 charged), `get_entitlement` offers no field to compare slot 3's fingerprint against.

### 3. Monthly books and the `refunded` counter mislead (P2)
- `lib.rs:1093`: `_ => claims_paid` books customer claims (`KIND_CUSTOMER_CLAIM`) and owner/party claims (`KIND_PARTY_CLAIM`) into one counter. A month's books can't separate customer money returned from owner profit paid out.
- A refund that fails and is later paid through `claim_customer` never shows up in `refunds_paid`. Likewise, a failed withdrawal later paid through `claim_party` never shows up in `owner_withdrawals`. Repro: s05b ends with `refunds_paid == 0` even though 70P went back to the customer.
- `lib.rs:1007`: `e.refunded += units` happens when the refund is requested. After a failed refund, the view shows "70 refunded" while the money is still an unpaid claim. Unit balance (U1) still holds, but a UI showing `refunded` as "money returned" would be wrong.

### 4. Hold time limits are not bounded when the business is created (P2)
- **Where:** `new` (`lib.rs:597-600`) checks only `max_hold_units`. `max_hold_ttl_ms` and `max_settle_grace_ms` can be anything.
- **Lock-up:** a plan whose `settle_grace` is set to years (allowed by such rules) keeps held units locked for years. Before `settle_until`, only operators can release a hold (`985-987`), and the customer can't refund held units. The job's "bound holds / deadlines" is enforced only by numbers the owner picks.
- **Unchecked additions:** `lib.rs:887`, `888` and `907` (`serve_until + settle_grace`) don't use checked arithmetic. The release profile has `overflow-checks = true`, so values near `u64::MAX` make every `open_hold` on that plan fail.
- **Self-lock:** if `max_hold_ttl_ms` is under 60 s, `create_plan` can never succeed (`649`).
- **Repro:** `new(rules{max_settle_grace_ms: u64::MAX})`, then `create_plan{settle_grace_ms: u64::MAX}`, then any valid `open_hold` → overflow at line 907.
- **Fix direction:** fixed ceilings in the code, checked in `new`, plus checked additions.

### 5. Any one party can occupy all 16 payout slots and block customer refunds (P2, liveness)
- **Where:** `free_slot` (`1343-1347`) is first-come with no reservation. `withdraw_profit` (`1034-1045`) has no cap on how many withdrawals are in flight.
- **Repro:** FOUNDER calls `withdraw_profit(U128(1))` 16 times in one block, then CARA's `refund_units` → `E_BUSY`. Each slot clears 2–3 blocks later, but refilling them is cheap. The same applies to a buyer after a sale, or to one customer spread across 8+ plans (2 payouts per entitlement).
- **Effect:** customer money stays safe, but refunds can be blocked for as long as the attacker keeps going. Combined with gate G1 below, the blockage becomes permanent.
- **Fix direction:** reserve some slots for customer refunds and claims, or cap profit payouts in flight.

### 6. A stranded payout to an account whose party record was recreated can corrupt `pending_refs` (P3, theoretical)
- **Where:** `on_payout` calls `unref` whenever `has_record` is true (`1087-1088`, `1100`). For party payouts the only test is `party.contains_key` (`1082`), and `unref` uses `saturating_sub` (`1387`, `1392`).
- **Case:** a stranded party payout is re-sent after that account got a new party record (for example, a former owner who becomes owner again). The callback then decrements a counter that never included this payout. The undercount is hidden, so P1 can break silently: `release_party_slot` could succeed while a real payout is still in flight, and that payout would then strand.
- **Reachability:** only after a state that is already unreachable without corruption.
- **Fix direction:** mark re-sent stranded payouts so they never touch a record's counter, and stop hiding an underflow.

### 7. Minor defects (P3)
- **`open_hold` "already" skips the signature (`854-862`):** it returns before any signature check (`871-883`). Any METERING caller with a garbage signature gets `"already"` when the hold fields match. Nothing changes, but `"already"` is not proof that this signature was valid.
- **`appoint_operator` re-grant needs no deposit (`680-689`):** re-granting an existing operator attaches 0, while the addendum specifies 1 yocto. A function-call key with access to every method could therefore change an operator's capabilities.
- **`revoke_operator` keeps the storage deposit (`696-701`):** the freed storage isn't refunded, so the owner pays again on re-appointment.
- **`get_period` and month 00 (`488`):** `yyyymm % 100 - 1` underflows, so `get_period(0)` or `get_period(202600)` fails instead of returning `None`. Also, "no activity this month" and "month overwritten by the 24-month ring" both return `None`.
- **Sponsor race:** a sponsor can delete an untouched shell (`831`) between the customer sending a purchase and it landing. The purchase comes back in full, so this is griefing only.

## Deployment and integration gates (deferred by the job, but consequential)

- **G1. Callback gas is unmeasured.** `CALLBACK_GAS` and `TRANSFER_GAS` are fixed at 10 Tgas each (`62-63`, `1370-1379`), and nothing requires a minimum of attached gas. v1 §6 specified "Methods that start a payout require `prepaid_gas ≥ PAYOUT_MIN_GAS`", and nothing I read clearly drops that rule.
  - The caller controls leftover gas, so a tight-gas `refund_units` gives `on_payout` exactly 10 Tgas. If the worst case of `on_payout` exceeds that, the transfer succeeds, the callback fails, and the slot stays in flight forever.
  - With no reconciliation (deferred), two such failures permanently block that customer's refunds and claims (`E_PENDING_REFS`). Sixteen block the whole business.
  - The worst case to measure includes a month rollover and a 64-character `to` account.
  - If the token's `ft_transfer` ever needs more than 10 Tgas, every payout fails into a claim that can never be paid. There is no setting to raise it.
- **G2. `#[init] new` is not `#[private]`** (`594-595`). Anyone can initialize first unless deploy and init go in one batch. v2 has the same pattern.
- **G3. Underfunded `sponsor_shell` and `create_plan`** write before they fail (`716-718`, `654-667`). On chain the whole receipt reverts; the tests only show the panic. The design note already says this.
- **G4. Treasury `held` can be wrong** after a failed callback, and tokens sent with a plain `ft_transfer` are never counted. Both depend on the deferred reconciliation.

## Design limits worth stating in the report (not defects)

- **Key revocation:** after a revoke, the contract still accepts *newly* signed uses for the active hold until `settle_until`. Exposure is at most that hold's remaining units (revision 2 point 4). `serve_until` is never enforced on chain.
- **Daily cap:** it resets at the UTC day boundary, so up to twice the cap can be held within one 24-hour span.
- **Retry after close:** retrying a settle after a closing batch returns `E_HOLD_CLOSED`, not `"already"`. That matches "close-after-close fails" in consolidated §3.5.

## Test gaps

- No test of weak or non-canonical keys. The only bad-signature cases are zero or foreign signatures against a valid key.
- No test that the entitlement view supports the §3.5 read-back.
- No test of how the monthly books classify a refund that failed and was later paid as a claim.
- No test of extreme rules (huge ttl or grace, ttl under 60 s), `get_period(0)`, slot starvation, or a hold that straddles midnight.
- The random sequence covers only plan 1 at one price, key slot 0 at epoch 1, and one owner. It never revokes or reinstalls keys, changes owner, unregisters and re-registers, re-sends stranded payouts, or uses two plans at different prices. Its stale callbacks only ever use `pid-1` (`tests.rs:1250`).
- The test state snapshot (`tests.rs:213-227`) leaves out plan contents, `rules` and `name`, and only covers the listed accounts.
- Underfunded storage tests are should-panic only (`tests.rs:1020-1034`), as G3 notes.
- Nothing models a callback that *runs and fails*. In the unit VM that looks the same as a missing callback.

## Coverage and limits

- I read both files in full, and the parts of the job, design note, consolidated candidate §1–3 and §5–8, addendum §8, revision 2 §A and v2 that bear on this.
- I did not check near-sdk 5.29.1's source or nearcore's `ed25519_verify` code. Finding 1's behaviour is high-confidence but unverified until the repro test runs.
- I didn't verify any gas, on-chain storage cost, real FT receipt order or physical balance, and the unit tests don't show those either.
- Deals, close and the gateway are outside this review.
