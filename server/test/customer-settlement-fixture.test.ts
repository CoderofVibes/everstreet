// Job 003o: the settlement decision against the contract's own JSON
// (server/test/fixtures/v3/customer-settlement.json, produced by the business-v3 unit test
// customer_settlement_matches_server_fixture through the actual methods). This is evidence about
// the decision rules over real view JSON; it does not execute the contract. Two check_use answers
// the fixture doesn't record are derived from the recorded entitlement and labelled as such.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  decideSettlement,
  decodeEntitlement,
  decodeUseCheck,
  EMPTY_ROOT,
  oneSlotRoot,
} from "../src/customerRead.ts";

const here = dirname(fileURLToPath(import.meta.url));
const raw = JSON.parse(
  readFileSync(join(here, "fixtures", "v3", "customer-settlement.json"), "utf8"),
) as Record<string, string>;
const v = (k: string) => JSON.parse(raw[k] as string);
const ent = (k: string) => decodeEntitlement(v(k));
const chk = (k: string) => decodeUseCheck(v(k));
const fps = v("fingerprints") as Record<string, string>;
const T0 = "1793577600000";

const exp = (hold_seq: number, fingerprint = fps[`${hold_seq}.0`] as string) => ({
  reg_id: "1",
  key_slot: 0,
  key_epoch: 1,
  hold_seq,
  units: 1,
  serve_until_ms: "1793578800000",
  settle_until_ms: "1793579400000",
  accept_by_ms: "1793578740000",
  fingerprint,
});

describe("003o settlement decisions over contract-produced views", () => {
  it("roots: the contract's closed roots are recomputed exactly", () => {
    expect(ent("charge.closed.entitlement")?.last_hold_root).toBe(
      oneSlotRoot(fps["1.0"] as string),
    );
    expect(ent("released_unused.entitlement")?.last_hold_root).toBe(EMPTY_ROOT);
  });

  it("an open one-unit hold, unused: settleable until settle_until, not after", () => {
    expect(
      decideSettlement(exp(1), ent("charge.open.entitlement"), chk("charge.open.check_use"), T0),
    ).toEqual({
      kind: "unused_open",
      settleable: true,
    });
    // Derived (labelled): check_use for the expired open hold answers unused, as for any open hold.
    const unused = decodeUseCheck({ status: "unused", slot_used: false, closed_root: null });
    expect(
      decideSettlement(exp(5), ent("expired.open.entitlement"), unused, "1793579400001"),
    ).toEqual({
      kind: "unused_open",
      settleable: false,
    });
  });

  it("charged: closed with our root, or open with our fingerprint; another fingerprint is never ours", () => {
    expect(
      decideSettlement(
        exp(1),
        ent("charge.closed.entitlement"),
        chk("charge.closed.check_use"),
        T0,
      ),
    ).toEqual({
      kind: "charged",
      closed: true,
    });
    // check_use answers the same for an altered fingerprint; only the root tells them apart.
    expect(v("charge.closed.check_use_altered")).toEqual(v("charge.closed.check_use"));
    expect(
      decideSettlement(
        exp(1, fps["4.7"]),
        ent("charge.closed.entitlement"),
        chk("charge.closed.check_use_altered"),
        T0,
      ),
    ).toEqual({ kind: "unknown", reason: "root_mismatch" });
    expect(
      decideSettlement(exp(2), ent("charged_open.entitlement"), chk("charged_open.check_use"), T0),
    ).toEqual({
      kind: "charged",
      closed: false,
    });
    expect(v("charged_open.replay_answer")).toEqual(["already"]);
    expect(
      decideSettlement(exp(4), ent("conflict.entitlement"), chk("conflict.check_use"), T0),
    ).toEqual({
      kind: "conflict",
      reason: "other_fingerprint",
    });
    expect(
      decideSettlement(
        exp(4),
        ent("conflict.closed.entitlement"),
        chk("conflict.closed.check_use"),
        T0,
      ),
    ).toEqual({
      kind: "unknown",
      reason: "root_mismatch",
    });
  });

  it("returned: closed with nothing used, by the operator or by anyone after the deadline", () => {
    expect(
      decideSettlement(
        exp(3),
        ent("released_unused.entitlement"),
        chk("released_unused.check_use"),
        T0,
      ),
    ).toEqual({
      kind: "returned",
    });
    // Derived (labelled): check_use on a closed hold reports the recorded root.
    const e = ent("expired.released.entitlement");
    const closed = decodeUseCheck({
      status: "closed",
      slot_used: false,
      closed_root: e?.last_hold_root,
    });
    expect(decideSettlement(exp(5), e, closed, "1793579400001")).toEqual({ kind: "returned" });
  });

  it("history moved on, a changed registration, or a disagreement between views stay unknown", () => {
    const later = decodeUseCheck({ status: "unknown_hold", slot_used: null, closed_root: null });
    expect(decideSettlement(exp(1), ent("used_20.entitlement"), later, T0)).toEqual({
      kind: "unknown",
      reason: "history_lost",
    });
    const other = decodeUseCheck({
      status: "other_registration",
      slot_used: null,
      closed_root: null,
    });
    expect(
      decideSettlement({ ...exp(1), reg_id: "2" }, ent("used_20.entitlement"), other, T0),
    ).toEqual({
      kind: "unknown",
      reason: "registration_changed",
    });
    expect(
      decideSettlement(exp(1), ent("charge.closed.entitlement"), chk("charge.open.check_use"), T0),
    ).toEqual({
      kind: "conflict",
      reason: "views_disagree",
    });
    expect(
      decideSettlement(
        { ...exp(1), units: 2 },
        ent("charge.open.entitlement"),
        chk("charge.open.check_use"),
        T0,
      ),
    ).toEqual({
      kind: "unknown",
      reason: "not_one_unit",
    });
  });

  it("100 bought, 20 used, 80 left, across an actual sale; the successor's next use leaves 79", () => {
    expect(v("used_20.entitlement")).toMatchObject({
      purchased: "100",
      consumed: "20",
      free: "80",
    });
    expect(v("after_sale.entitlement")).toMatchObject({ consumed: "20", free: "80" });
    expect(v("after_sale.control")).toMatchObject({
      owner: "buyer.near",
      generation: 2,
      operators: [["meter.near", 1, 2]],
    });
    expect(v("after_sale.successor_charge.entitlement")).toMatchObject({
      consumed: "21",
      free: "79",
    });
  });
});
