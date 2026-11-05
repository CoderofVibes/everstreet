// Job 003wf3: the finite Gated configured-composition review harness (scripts/lib/
// configuredSaleHarness.ts `gated`) as a PROCESS test of the controls Astra's browser review uses
// (B-1, B-2, B-3): a customer use in flight with its provider answer held, the existing fixture
// customer's pause, returned unit and result, a close whose answer is lost and recovered from its
// own transaction, and an abort after the deadline with the escrow claim restored then paid. Only
// the harness's site and control listeners are used, as a browser and a reviewer would. Cara's
// existing fixture key signs (no enrollment). Ephemeral ports, one bounded child, all removed.

import { afterEach, describe, expect, it } from "vitest";
import {
  CONFIGURED_BUYER,
  CONFIGURED_SELLER,
  type ConfiguredSaleHarness,
  freePort,
  startConfiguredSaleHarness,
} from "../../scripts/lib/configuredSaleHarness.ts";
import type { Json } from "./customer-world.ts";
import { OP } from "./lifecycleWorld.ts";

let running: ConfiguredSaleHarness | null = null;
afterEach(async () => {
  const h = running;
  running = null;
  if (h) expect(await h.stop()).toEqual({ childExit: 0, forcedKill: false });
});

function browserOn(origin: string, account: string) {
  const jar = new Map<string, string>();
  const call = async (path: string, method = "GET", body?: unknown) => {
    const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    const res = await fetch(`${origin}${path}`, {
      method,
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const set of res.headers.getSetCookie()) {
      const [pair, ...attrs] = set.split(";");
      const [name, ...rest] = (pair as string).split("=");
      if (!rest.join("=") || attrs.some((x) => /^max-age=0$/i.test(x.trim())))
        jar.delete(name as string);
      else jar.set(name as string, rest.join("="));
    }
    return { status: res.status, body: (await res.json().catch(() => null)) as Json };
  };
  return Object.assign(call, { account });
}
type Browser = ReturnType<typeof browserOn>;
const ctl = async (h: ConfiguredSaleHarness, path: string, method = "POST") =>
  (await (await fetch(`${h.control}${path}`, { method })).json()) as Json;

async function signIn(h: ConfiguredSaleHarness, call: Browser) {
  await ctl(h, `/account/${call.account}`);
  const ch = (await call("/api/session/challenge", "POST")).body.challenge as Json;
  const signed = (
    await call("/__harness/sign-message", "POST", {
      message: ch.message,
      recipient: ch.recipient,
      nonce: ch.nonce,
      callbackUrl: ch.callback_url,
      state: null,
    })
  ).body;
  const v = await call("/api/session/verify", "POST", {
    account_id: signed.accountId,
    public_key: signed.publicKey,
    signature: signed.signature,
    nonce: ch.nonce,
  });
  expect([200, 201], JSON.stringify(v.body)).toContain(v.status);
}

/** One wallet action as the page's controller does it: preview, store, ask, wallet, hash, check. */
async function act(h: ConfiguredSaleHarness, call: Browser, kind: string, input: Json = {}) {
  const p = await call(`/api/sales/${h.business}/prepare`, "POST", { kind, input });
  expect(p.status, `${kind}: ${JSON.stringify(p.body)}`).toBe(200);
  const c = await call(`/api/sales/${h.business}/actions`, "POST", {
    kind,
    input: p.body.input,
    action_digest: p.body.action_digest,
    idempotency_key: `gated-${kind}-${Math.random().toString(36).slice(2, 10)}`,
  });
  expect(c.status, JSON.stringify(c.body)).toBe(201);
  const a = c.body.action as Json;
  await call(`/api/sales/actions/${a.id}/requested`, "POST", {});
  await ctl(h, `/account/${call.account}`);
  const sent = await call("/__harness/tx", "POST", {
    receiverId: a.call.receiverId,
    actions: [
      {
        methodName: a.call.methodName,
        args: JSON.stringify(a.call.args),
        gas: a.call.gas,
        deposit: a.call.deposit,
      },
    ],
  });
  expect(sent.status, JSON.stringify(sent.body)).toBe(200);
  await call(`/api/sales/actions/${a.id}/requested`, "POST", {
    tx_hash: sent.body.transaction.hash,
  });
  return (await call(`/api/sales/actions/${a.id}/check`, "POST", {})).body as Json;
}

const TERMS = {
  buyer_account: CONFIGURED_BUYER,
  price: "250000000",
  expires_in_days: 7,
  available_floor: "0",
  grants: [{ account: OP, caps: 1 }],
  exclusions: [],
  note: "",
};
/** Bounded wait on a read (the composition's own coordinator passes every second). */
async function until<T>(read: () => Promise<T>, ok: (v: T) => boolean, what: string, ms = 60_000) {
  const end = Date.now() + ms;
  let v = await read();
  while (!ok(v) && Date.now() < end) {
    await new Promise((r) => setTimeout(r, 300));
    v = await read();
  }
  expect(ok(v), `${what}: ${JSON.stringify(v).slice(0, 600)}`).toBe(true);
  return v;
}

async function gatedHarness() {
  const h = await startConfiguredSaleHarness({
    sitePort: await freePort(),
    controlPort: await freePort(),
    heapMb: 256,
    gated: true,
  });
  running = h;
  const seller = browserOn(h.origin, CONFIGURED_SELLER);
  const buyer = browserOn(h.origin, CONFIGURED_BUYER);
  await signIn(h, seller);
  await signIn(h, buyer);
  const handover = async () => (await seller(`/api/sales/${h.business}`)).body.handover as Json;
  return { h, seller, buyer, handover };
}

describe("003wf3 the Gated review harness's controls (actual child process)", () => {
  it("B-1/B-3: a use in flight finishes and is charged, a lost close answer is recovered from its own transaction, then the buyer's grants serve the next use", async () => {
    const { h, seller, buyer, handover } = await gatedHarness();
    // Cara (her fixture key): one use in flight (a customer has one hold at a time).
    const inFlight = await ctl(h, "/customer/start");
    expect(inFlight, JSON.stringify(inFlight)).toMatchObject({ status: 200, state: "reserved" });
    await ctl(h, "/hold-provider");
    expect(await ctl(h, `/customer/execute/${inFlight.use}`)).toMatchObject({ started: true });
    expect((await act(h, seller, "propose", TERMS)).resolution.kind).toBe("confirmed");
    for (const k of ["register", "fund", "accept"])
      expect((await act(h, buyer, k)).resolution.kind, k).toBe("confirmed");
    await ctl(h, "/lose-close-answer");
    expect((await act(h, seller, "accept")).resolution).toMatchObject({ result: "closing" });
    // While the provider answer is held, readiness waits and no order exists.
    const waiting = await until(
      handover,
      (x) => x?.state === "gated" && Boolean(x.waiting_for),
      "waiting",
    );
    expect(String(waiting.waiting_for)).toMatch(/holds_active|customers_/);
    expect(waiting.orders).toEqual([]);
    // The use in flight finishes: its result is kept and readable.
    await ctl(h, "/release-provider");
    const done = await until(
      () => ctl(h, `/customer/use/${inFlight.use}`, "GET"),
      (v) => v.background?.done === true,
      "the use in flight finished",
    );
    expect(done.background.status).toBe(200);
    expect(done.result.available).toBe(true);
    // The close's answer is lost; it is recovered from its own transaction, one order, one close.
    const final = await until(
      handover,
      (x) => x?.state === "released_to_buyer",
      "handed over",
      90_000,
    );
    expect(final.orders).toHaveLength(1);
    expect(final.orders[0].attempt.state).toBe("success");
    // The answer really was lost (once): the composition saw a failed reply, not a success.
    const usage = (await ctl(h, "/usage", "GET")).counters as Json;
    expect(usage.transport_failed).toBe(1);
    expect(String(usage.last_error)).toContain("the answer was lost");
    expect((await ctl(h, "/", "GET")).contract).toMatchObject({
      owner: CONFIGURED_BUYER,
      generation: 2,
    });
    // The next use runs under the buyer's grants.
    const next = await ctl(h, "/customer/start");
    expect(next.state).toBe("reserved");
    await ctl(h, `/customer/execute/${next.use}`);
    const served = await until(
      () => ctl(h, `/customer/use/${next.use}`, "GET"),
      (v) => v.background?.done === true,
      "the next use",
    );
    expect(served.result.available).toBe(true);
    const listed = await ctl(h, "/customer/uses", "GET");
    expect(listed.status).toBe(200);
  }, 240_000);

  it("B-2/B-3: a reserved use is paused and its unit returned, a new use refused with the exact message; the close held past its deadline; the buyer ends the closing; the late close is refused by the contract; the seller keeps the business; the buyer's escrow claim is restored, then paid", async () => {
    const { h, seller, buyer, handover } = await gatedHarness();
    // Cara reserves a use and leaves it unexecuted.
    const reserved = await ctl(h, "/customer/start");
    expect(reserved, JSON.stringify(reserved)).toMatchObject({ status: 200, state: "reserved" });
    expect((await act(h, seller, "propose", TERMS)).resolution.kind).toBe("confirmed");
    for (const k of ["register", "fund", "accept"])
      expect((await act(h, buyer, k)).resolution.kind, k).toBe("confirmed");
    await ctl(h, "/hold-close");
    expect((await act(h, seller, "accept")).resolution).toMatchObject({ result: "closing" });
    // B-2: the reserved use can't run now; its unit goes back (the drain), in Cara's own view.
    await until(
      () => ctl(h, `/customer/use/${reserved.use}`, "GET"),
      (v) => JSON.stringify(v.use).includes('"returned"'),
      "the reserved use's unit returned",
    );
    const mine = await ctl(h, `/customer/use/${reserved.use}`, "GET");
    expect(mine.result).toMatchObject({ available: false });
    // A new use is refused before anything is signed, with the exact message.
    const refused = await ctl(h, "/customer/start");
    expect(refused).toMatchObject({ status: 409, code: "handover_pause", use: null });
    expect(refused.error).toContain("Nothing was signed, held or charged");
    await until(handover, (x) => (x?.orders?.length ?? 0) === 1, "order 1 held in flight");
    // Past the deadline (the default 60-minute window), either party can end the closing.
    await ctl(h, "/advance/61");
    const ab = await act(h, buyer, "abort");
    expect(ab.resolution, JSON.stringify(ab)).toMatchObject({
      kind: "confirmed",
      result: "aborted",
    });
    await ctl(h, "/release-close"); // the held close reaches the contract only now
    const final = await until(
      handover,
      (x) => x?.state === "released_to_seller",
      "back to the seller",
      90_000,
    );
    expect(final.orders[0].attempt.state).not.toBe("success");
    expect((await ctl(h, "/", "GET")).contract).toMatchObject({
      owner: CONFIGURED_SELLER,
      generation: 1,
    });
    // The escrow is the buyer's claim: a failed payout restores it, then it's paid.
    expect((await buyer(`/api/sales/${h.business}`)).body.party.escrow_return_claim).toBe(
      TERMS.price,
    );
    await ctl(h, "/fail-next-payout");
    const first = await act(h, buyer, "claim", { category: 1 });
    expect(first.resolution, JSON.stringify(first)).toMatchObject({ result: "restored" });
    expect((await buyer(`/api/sales/${h.business}`)).body.party.escrow_return_claim).toBe(
      TERMS.price,
    );
    const paid = await act(h, buyer, "claim", { category: 1 });
    expect(paid.resolution).toMatchObject({ kind: "confirmed", result: "paid" });
    expect((await buyer(`/api/sales/${h.business}`)).body.party.escrow_return_claim).toBe("0");
    // The seller administers the business again.
    const rename = await seller(`/api/businesses/${h.business}`, "PATCH", { name: "Ledgerline" });
    expect(rename.status).toBe(200);
    // A harness limit, stated: /advance moved only the contract's clock, so from here the server
    // refuses customer uses as clock_uncertain (its own clock and NEAR's disagree); nothing runs.
    const again = await ctl(h, "/customer/start");
    expect(again, JSON.stringify(again)).toMatchObject({ status: 503, code: "clock_uncertain" });
  }, 240_000);
});
