// Review evidence and presentation (Astra, Nov 5): readable token amounts come only from a valid
// ft_metadata read on the chain, recorded with its block; never a guessed scale; exact integers.

import { describe, expect, it } from "vitest";
import { openDb } from "../src/db.ts";
import { readableAmount, recordTokenMeta, tokenMetaOf } from "../src/tokenMeta.ts";
import { customerWorld } from "./customer-world.ts";

const TUSD = { symbol: "TUSD", name: "Fictional test dollar", decimals: 6 };

describe("token metadata as read on the chain", () => {
  it("records a read, ignores an older block, flags a disagreeing newer one, refuses a bad height", () => {
    const db = openDb(":memory:");
    expect(tokenMetaOf(db, "testnet", "tusd.near")).toBeNull(); // never read: no guess
    recordTokenMeta(db, "testnet", "tusd.near", TUSD, "100");
    expect(tokenMetaOf(db, "testnet", "tusd.near")).toMatchObject({
      symbol: "TUSD",
      decimals: 6,
      block_height: "100",
      changed: false,
    });
    // An older block never replaces a newer read.
    recordTokenMeta(db, "testnet", "tusd.near", { ...TUSD, decimals: 18 }, "99");
    expect(tokenMetaOf(db, "testnet", "tusd.near")?.decimals).toBe(6);
    // A newer read that disagrees is kept, and flagged.
    recordTokenMeta(db, "testnet", "tusd.near", { ...TUSD, decimals: 18 }, "101");
    expect(tokenMetaOf(db, "testnet", "tusd.near")).toMatchObject({ decimals: 18, changed: true });
    // The same asset on another network is a different token.
    expect(tokenMetaOf(db, "mainnet", "tusd.near")).toBeNull();
    recordTokenMeta(db, "testnet", "other.near", TUSD, "not-a-height");
    expect(tokenMetaOf(db, "testnet", "other.near")).toBeNull();
  });

  it("a disagreement says what changed; two reads at the same block that disagree are a conflict, kept apart", () => {
    const db = openDb(":memory:");
    recordTokenMeta(db, "testnet", "tusd.near", TUSD, "100");
    recordTokenMeta(db, "testnet", "tusd.near", { ...TUSD, decimals: 18 }, "200");
    expect(tokenMetaOf(db, "testnet", "tusd.near")?.reason).toMatch(
      /changed between reads: 6 decimals at block 100, 18 at block 200/,
    );
    const same = openDb(":memory:");
    recordTokenMeta(same, "testnet", "tusd.near", TUSD, "300");
    recordTokenMeta(same, "testnet", "tusd.near", { ...TUSD, decimals: 18 }, "300");
    const m = tokenMetaOf(same, "testnet", "tusd.near");
    expect(m).toMatchObject({ changed: true, decimals: 6 }); // the first read at that block stays
    expect(m?.reason).toMatch(/Two reads at block 300 disagreed/);
    // Agreeing again later doesn't clear a dispute: the scale of old records stays in doubt.
    recordTokenMeta(same, "testnet", "tusd.near", TUSD, "400");
    expect(tokenMetaOf(same, "testnet", "tusd.near")?.changed).toBe(true);
  });

  it("readable amounts are exact: zero, fractions, large values, 0 and 38 decimals, refusal of non-integers", () => {
    expect(readableAmount("0", 6)).toBe("0");
    expect(readableAmount("150000", 6)).toBe("0.15");
    expect(readableAmount("15000000", 6)).toBe("15");
    expect(readableAmount("1", 24)).toBe("0.000000000000000000000001");
    expect(readableAmount("340282366920938463463374607431768211455", 6)).toBe(
      "340282366920938463463374607431768.211455",
    );
    expect(readableAmount("42", 0)).toBe("42");
    expect(readableAmount("1", 38)).toBe(`0.${"0".repeat(37)}1`);
    expect(readableAmount("1.5", 6)).toBeNull();
    expect(readableAmount("-1", 6)).toBeNull();
    expect(readableAmount("1", 39)).toBeNull();
  });

  it("a customer's purchase setup reads the token; afterwards the owner's offers carry it (economics: flagship journey)", async () => {
    const w = await customerWorld();
    const offer = await w.offer();
    const owner = w.caller(w.f.ava.id);
    const before = await owner(`/api/businesses/${w.f.business}/customer-offers`);
    expect(before.body.offers[0].token).toBeNull(); // not read yet: exact base units are shown
    const setup = await w.dana(`/api/customer/offers/${offer}/purchase-setup`);
    expect(setup.status, JSON.stringify(setup.body)).toBe(200);
    const meta = setup.body.token;
    const after = await owner(`/api/businesses/${w.f.business}/customer-offers`);
    expect(after.body.offers[0].token).toMatchObject({
      symbol: meta.symbol,
      decimals: meta.decimals,
      changed: false,
    });
    // Economics carry it too: asserted in the flagship journey, where money actually moves.
  });
});
