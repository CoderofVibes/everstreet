// Job 003wf3 (MANAGED_HANDOVER.md §10.4 P-1, P-2, P-3, P-5; Astra 03:21): managed handovers in
// ACTUAL child processes running the normal entry (entryChild.ts -> serve.ts -> composeApplication)
// on one disposable installation. Every network request a child makes reaches THIS process over
// IPC (lifecycleWorld.ts SyntheticRpc and SyntheticModel), so this process is the deterministic
// barrier: before answering each of child A's requests it checks a condition on the shared
// database (a durable step committed), and from that point A's requests are never answered; A is
// then killed (SIGKILL, OS exit awaited) and B takes over under the actual lease rules. No test
// hook exists in the children or in production. Fictional accounts, ephemeral keys, 256 MiB
// children with hard deadlines, temporary directories removed.

import { type ChildProcess, fork } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDb } from "../src/db.ts";
import { CUSTOMER, type Json } from "./customer-world.ts";
import { BUYER, PRICE, prepareHandover } from "./handoverWorld.ts";
import {
  API_KEY_ENV,
  BIZ,
  BIZ2,
  bootstrap,
  FICTIONAL_KEY,
  FOUNDER,
  FOUNDER2,
  OP,
  type SyntheticModel,
  type SyntheticRpc,
  sendMethodOf,
  signInAs,
} from "./lifecycleWorld.ts";

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});
const freePort = () =>
  new Promise<number>((resolve) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });
const until = async (cond: () => boolean | Promise<boolean>, what: string, ms = 40_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`timed out waiting for ${what}`);
};

/**
 * A request from a child, seen by this process before it is answered: `answer` (normally),
 * `hold` (never answered: A is cut here), or `lose_reply` (applied by the synthetic chain, its
 * reply never sent: an accepted close whose answer is lost).
 */
type Cut = (req: {
  channel: string;
  body: string;
  url?: string;
}) => "answer" | "hold" | "lose_reply" | "defer";

/** A child's barrier: `cut` is read on every request (set it when the cut should begin). */
type Control = {
  cut?: Cut;
  /** Requests held one by one ("defer"): each answers when called (the child keeps running). */
  deferred?: (() => void)[];
};

function child(configFile: string, rpc: SyntheticRpc, model: SyntheticModel, ctl: Control = {}) {
  const proc: ChildProcess = fork(join("server", "test", "entryChild.ts"), [configFile], {
    execArgv: ["--import", "tsx", "--max-old-space-size=256"],
    env: { ...process.env, [API_KEY_ENV]: FICTIONAL_KEY },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  let out = "";
  proc.stdout?.on("data", (d) => (out = (out + d).slice(-16_384)));
  proc.stderr?.on("data", (d) => (out = (out + d).slice(-16_384)));
  const state = { cut: false, held: 0, requests: 0 };
  proc.on(
    "message",
    (m: { type?: string; channel?: string; id?: number; url?: string; body?: string }) => {
      if (m?.type !== "fetch") return;
      state.requests++;
      if (state.requests > 20_000) return; // a bounded session: never answered past its budget
      void (async () => {
        const decision = state.cut
          ? "hold"
          : (ctl.cut?.({
              channel: String(m.channel),
              body: String(m.body),
              url: String(m.url ?? ""),
            }) ?? "answer");
        if (decision === "hold") {
          state.cut = true;
          state.held++;
          return;
        }
        if (decision === "defer") {
          await new Promise<void>((go) => {
            ctl.deferred ??= [];
            ctl.deferred.push(go);
          });
        }
        const r =
          m.channel === "rpc"
            ? { status: 200, body: await rpc.answer(String(m.body)) }
            : await model.answer(String(m.url), JSON.parse(String(m.body || "{}")));
        if (decision === "lose_reply") {
          state.cut = true;
          return;
        }
        if (proc.connected) proc.send({ type: "reply", id: m.id, ...r });
      })().catch(() => {});
    },
  );
  const exited = new Promise<number | null>((r) => proc.once("exit", (code) => r(code)));
  const deadline = setTimeout(() => proc.kill("SIGKILL"), 120_000);
  cleanups.push(async () => {
    clearTimeout(deadline);
    if (proc.exitCode === null && proc.signalCode === null) proc.kill("SIGKILL");
    await exited;
  });
  return {
    proc,
    exited,
    state,
    out: () => out,
    ready: () =>
      until(() => out.includes("listening on"), "the child listening").catch((e) => {
        throw new Error(`${(e as Error).message}: ${out.slice(-800)}`);
      }),
    kill: async () => {
      proc.kill("SIGKILL");
      await exited;
      return { exitCode: proc.exitCode, signal: proc.signalCode };
    },
    shutdown: () => {
      if (proc.connected) proc.send({ type: "shutdown" });
      return exited;
    },
  };
}

function browser(port: number) {
  const jar = new Map<string, string>();
  return async (path: string, method = "GET", body?: unknown) => {
    const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const set of res.headers.getSetCookie()) {
      const [pair, ...attrs] = set.split(";");
      const [name, ...rest] = (pair as string).split("=");
      const value = rest.join("=");
      if (!value || attrs.some((x) => /^max-age=0$/i.test(x.trim()))) jar.delete(name as string);
      else jar.set(name as string, value);
    }
    return { status: res.status, body: (await res.json().catch(() => null)) as Json };
  };
}

async function installation(o: { model?: boolean; second?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "handover-matrix-"));
  cleanups.push(() =>
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }),
  );
  const [portA, portB] = [await freePort(), await freePort()];
  const b = await bootstrap(
    dir,
    portA,
    {
      interval_ms: 1_000,
      batch: 5,
      pass_budget_ms: 3_000,
      op_deadline_ms: 2_000,
      stop_timeout_ms: 5_000,
    },
    { second: o.second },
  );
  const prep = prepareHandover(b, dir, {
    handover: { interval_ms: 1_000, pass_budget_ms: 1_000, op_deadline_ms: 800 },
  });
  const base = { ...JSON.parse(readFileSync(b.configFile, "utf8")), handover: prep.handover };
  if (o.model === false) delete base.model;
  const fileA = join(dir, "config-a.json");
  const fileB = join(dir, "config-b.json");
  writeFileSync(fileA, JSON.stringify({ ...base, listen: { host: "127.0.0.1", port: portA } }));
  writeFileSync(fileB, JSON.stringify({ ...base, listen: { host: "127.0.0.1", port: portB } }));
  const read = <T = Json>(sql: string, ...args: (string | number)[]) => {
    const db = openDb(b.db);
    try {
      return db.prepare(sql).all(...args) as T[];
    } finally {
      db.close();
    }
  };
  return { ...b, ...prep, dir, portA, portB, fileA, fileB, read, biz: b.w.f.business as string };
}
type Installation = Awaited<ReturnType<typeof installation>>;

async function act(
  i: Installation,
  call: ReturnType<typeof browser>,
  account: string,
  kind: string,
  input: Json = {},
) {
  const p = await call(`/api/sales/${i.biz}/prepare`, "POST", { kind, input });
  expect(p.status, JSON.stringify(p.body)).toBe(200);
  const c = await call(`/api/sales/${i.biz}/actions`, "POST", {
    kind,
    input: p.body.input,
    action_digest: p.body.action_digest,
    idempotency_key: `matrix-${kind}-${Math.random().toString(36).slice(2, 10)}`,
  });
  expect(c.status, JSON.stringify(c.body)).toBe(201);
  const a = c.body.action as Json;
  await call(`/api/sales/actions/${a.id}/requested`, "POST", {});
  const out = i.w.chain.walletCall(account, a.call);
  return { id: a.id as string, hash: out.transaction.hash as string, call };
}
const TERMS = {
  buyer_account: BUYER,
  price: PRICE,
  expires_in_days: 7,
  available_floor: "0",
  grants: [{ account: OP, caps: 1 }],
  exclusions: [],
  note: "",
  close_window_minutes: 30,
};
const INVOICE =
  "Fictional invoice SH-1042 from Stackline Hosting Ltd, 2026-10-14, total 412.50 USD";

/** Through A: Cara reserves one use, the sale reaches the buyer's acceptance. */
async function upToTheSellersAcceptance(i: Installation, port: number) {
  const seller = browser(port);
  const buyer = browser(port);
  const cara = browser(port);
  await signInAs(seller, FOUNDER, i.ava);
  await signInAs(buyer, BUYER, i.noah);
  await signInAs(cara, CUSTOMER, i.cara);
  const p = await cara(`/api/customer/offers/${i.offer}/prepare`, "POST", {
    idempotency_key: "matrix-use-0001",
    input: INVOICE,
  });
  expect(p.status, JSON.stringify(p.body)).toBe(201);
  const c = await cara(
    `/api/customer/uses/${p.body.use.id}/confirm`,
    "POST",
    i.w.signed(p.body.use.envelope),
  );
  expect(c.body.use?.state).toBe("reserved");
  const done = async (
    call: ReturnType<typeof browser>,
    account: string,
    kind: string,
    input: Json = {},
  ) => {
    const a = await act(i, call, account, kind, input);
    await call(`/api/sales/actions/${a.id}/requested`, "POST", { tx_hash: a.hash });
    return (await call(`/api/sales/actions/${a.id}/check`, "POST", {})).body as Json;
  };
  expect((await done(seller, FOUNDER, "propose", TERMS)).resolution.kind).toBe("confirmed");
  for (const k of ["register", "fund", "accept"])
    expect((await done(buyer, BUYER, k)).resolution.kind, k).toBe("confirmed");
  return { seller, buyer, cara, use: p.body.use.id as string };
}

const methodOf = (body: string) => {
  try {
    const j = JSON.parse(body) as { method?: string };
    return String(j.method);
  } catch {
    return "";
  }
};
/** The cut points: each the first request A makes after the named durable step committed. */
/** The state that must hold AT the cut, before B starts (Astra 03:34). */
type At = (i: Installation) => void;
const count = (i: Installation, sql: string) => i.read(sql).length;
const closesOnChain = (i: Installation) =>
  i.rpc.applied.filter((x) => x.method === "close_sale").length;
const AT = {
  gate: (i) => {
    expect(count(i, "SELECT 1 FROM business_handovers")).toBe(1);
    expect(count(i, "SELECT 1 FROM close_orders")).toBe(0);
    expect(count(i, "SELECT 1 FROM closer_tx_attempts")).toBe(0);
  },
  order: (i) => {
    expect(count(i, "SELECT 1 FROM close_orders")).toBe(1);
    expect(count(i, "SELECT 1 FROM closer_tx_attempts")).toBe(0);
  },
  signed: (i) => {
    expect(count(i, "SELECT 1 FROM closer_tx_attempts WHERE state = 'signed'")).toBe(1);
    expect(closesOnChain(i)).toBe(0);
  },
  lost: (i) => {
    expect(closesOnChain(i)).toBe(1);
    expect(count(i, "SELECT 1 FROM ownership")).toBe(0);
  },
  observed: (i) => {
    expect(i.read("SELECT state FROM business_handovers")[0]?.state).toBe("closed_observed");
    expect(closesOnChain(i)).toBe(1);
    expect(count(i, "SELECT 1 FROM ownership")).toBe(0);
  },
} satisfies Record<string, At>;
const CUTS: [string, (i: Installation) => Cut, At][] = [
  [
    "the local gate committed (armed), before any order",
    (i) => () => (i.read("SELECT 1 FROM business_handovers").length > 0 ? "hold" : "answer"),
    AT.gate,
  ],
  [
    "the order committed (readiness accepted; there is no persisted ready state), before the writer runs",
    (i) => () => (i.read("SELECT 1 FROM close_orders").length > 0 ? "hold" : "answer"),
    AT.order,
  ],
  [
    "the signed attempt committed, before its broadcast reaches the chain",
    (i) => (r) =>
      r.channel === "rpc" &&
      methodOf(r.body) === "send_tx" &&
      i.read("SELECT 1 FROM closer_tx_attempts").length > 0
        ? "hold"
        : "answer",
    AT.signed,
  ],
  [
    "the close accepted by the chain, its reply lost",
    (i) => (r) =>
      r.channel === "rpc" &&
      methodOf(r.body) === "send_tx" &&
      i.read("SELECT 1 FROM closer_tx_attempts").length > 0
        ? "lose_reply"
        : "answer",
    AT.lost,
  ],
  [
    "closed observed, before the reconciliation applies it",
    (i) => () =>
      i.read("SELECT 1 FROM business_handovers WHERE state = 'closed_observed'").length > 0
        ? "hold"
        : "answer",
    AT.observed,
  ],
];

describe("003wf3 P-1: the coordinating process is killed at each durable boundary; the other takes over", () => {
  for (const [name, makeCut, at] of CUTS)
    it(`killed after ${name}: one order kept, one close, one reconciliation, the reserved use returned once, the seller not revived`, async () => {
      const i = await installation();
      const ctlA: Control = {};
      const a = child(i.fileA, i.rpc, i.model, ctlA);
      await a.ready();
      const { seller, use } = await upToTheSellersAcceptance(i, i.portA);
      // From now, A is cut at the boundary. The seller's acceptance lands on the chain through
      // the wallet; its local check may never be answered by A (it is about to be killed).
      ctlA.cut = makeCut(i);
      const accepted = act(i, seller, FOUNDER, "accept").then(
        (x) => seller(`/api/sales/actions/${x.id}/requested`, "POST", { tx_hash: x.hash }),
        () => null,
      );
      await until(() => a.state.cut, `A reaching the cut (${name})`, 60_000);
      const killed = await a.kill();
      // The exact boundary was reached, not merely some later takeover.
      at(i);
      expect(killed.exitCode === null ? killed.signal : "exited").toBeTruthy();
      await accepted.catch(() => null);
      const ordersBefore = i.read("SELECT n, order_json FROM close_orders ORDER BY n");
      const attemptsBefore = i.read("SELECT operation, attempt, tx_hash FROM closer_tx_attempts");
      // B starts on the same installation and takes over after A's lease lapses.
      const b = child(i.fileB, i.rpc, i.model);
      await b.ready();
      await until(
        () =>
          i.read("SELECT state FROM business_handovers WHERE business_id = ?", i.biz)[0]?.state ===
          "released_to_buyer",
        `the handover released by B (${name})`,
        60_000,
      );
      // Exactly one close, one application; the original order and attempt identities kept.
      expect(i.rpc.applied.filter((x) => x.method === "close_sale")).toHaveLength(1);
      const orders = i.read("SELECT n, order_json FROM close_orders ORDER BY n");
      expect(orders).toHaveLength(1);
      for (const o of ordersBefore) expect(orders).toContainEqual(o);
      const attempts = i.read("SELECT operation, attempt, tx_hash FROM closer_tx_attempts");
      for (const x of attemptsBefore) expect(attempts).toContainEqual(x);
      expect(i.read("SELECT state FROM closer_tx_attempts")).toEqual([{ state: "success" }]);
      const own = i.read("SELECT to_id, v3_intent_id FROM ownership WHERE business_id = ?", i.biz);
      expect(own).toHaveLength(1);
      expect(own[0]).toMatchObject({ to_id: "person-noah" });
      expect(own[0]?.v3_intent_id).toBeTruthy();
      expect(
        i.read("SELECT 1 FROM events WHERE type = 'v3.reconciled_by_handover'").length,
      ).toBeLessThanOrEqual(1);
      // Cara's reserved use: returned exactly once, never charged.
      expect(i.rpc.applied.filter((x) => x.method === "release_hold_for")).toHaveLength(1);
      expect(i.rpc.applied.filter((x) => x.method === "settle_hold")).toHaveLength(0);
      const caraB = browser(i.portB);
      await signInAs(caraB, CUSTOMER, i.cara);
      const mine = (await caraB(`/api/customer/uses/${use}`)).body;
      expect(mine.use?.units?.unit ?? mine.units?.unit).toBe("returned");
      // The seller isn't revived: they no longer administer the business.
      const sellerB = browser(i.portB);
      await signInAs(sellerB, FOUNDER, i.ava);
      expect(
        (await sellerB(`/api/businesses/${i.biz}`, "PATCH", { name: "Mine?" })).status,
      ).toBeGreaterThanOrEqual(400);
      expect(await b.shutdown()).toBe(0);
    }, 180_000);
});

describe("003wf3 P-5: a child that can't start, and stops in each phase, leave nothing behind", () => {
  it("a startup failure (a closer key file that isn't the closer's) exits non-zero before listening; a stop while gated exits 0 with no listener left (other stop phases are retained, not exercised here)", async () => {
    const i = await installation();
    const bad = JSON.parse(readFileSync(i.fileA, "utf8")) as Json;
    const keyFile = String(bad.handover.closer.keys[0].key_file);
    const wrong = join(i.dir, "wrong-closer-key.json");
    writeFileSync(
      wrong,
      JSON.stringify({
        ...JSON.parse(readFileSync(keyFile, "utf8")),
        account_id: "someone-else.testnet",
      }),
    );
    bad.handover.closer.keys[0].key_file = wrong;
    const badFile = join(i.dir, "config-bad.json");
    writeFileSync(badFile, JSON.stringify(bad));
    const failing = child(badFile, i.rpc, i.model);
    const code = await failing.exited;
    expect(code).not.toBe(0);
    expect(failing.out()).not.toContain("listening on");
    expect(failing.out()).toMatch(/closer key file is for another account/);
    // A normal child, stopped while the business is gated (an order outstanding is fine).
    const a = child(i.fileA, i.rpc, i.model);
    await a.ready();
    const { seller } = await upToTheSellersAcceptance(i, i.portA);
    const x = await act(i, seller, FOUNDER, "accept");
    await seller(`/api/sales/actions/${x.id}/requested`, "POST", { tx_hash: x.hash });
    await until(() => i.read("SELECT 1 FROM business_handovers").length > 0, "gated");
    expect(await a.shutdown()).toBe(0);
    expect(a.out()).not.toMatch(/drain budget ran out/);
    // No listener remains on A's port.
    await expect(fetch(`http://127.0.0.1:${i.portA}/api/me`)).rejects.toThrow();
    expect(existsSync(i.dir)).toBe(true); // removed by this test's cleanup, after the exit
  }, 120_000);
});

const isProviderCall = (r: { channel: string; url?: string; body: string }) =>
  r.channel === "model" && String(r.url).endsWith("/v1/messages");
const isBuild = (r: { channel: string; url?: string; body: string }) =>
  isProviderCall(r) && r.body.includes('"examples"');

describe("003wf3 P-5: stopped with its close send in flight", () => {
  it("A stops (exit 0) while its close transaction is still on its way; it lands afterwards, to nobody; B resolves the original by its own hash: one order, one close, one application", async () => {
    const i = await installation();
    const ctlA: Control = {};
    const a = child(i.fileA, i.rpc, i.model, ctlA);
    await a.ready();
    const { seller } = await upToTheSellersAcceptance(i, i.portA);
    ctlA.cut = (r) =>
      r.channel === "rpc" && sendMethodOf(r.body) === "close_sale" ? "defer" : "answer";
    const x = await act(i, seller, FOUNDER, "accept");
    await seller(`/api/sales/actions/${x.id}/requested`, "POST", { tx_hash: x.hash });
    await until(() => (ctlA.deferred?.length ?? 0) > 0, "A's close send in flight", 60_000);
    expect(await a.shutdown()).toBe(0);
    await expect(fetch(`http://127.0.0.1:${i.portA}/api/me`)).rejects.toThrow();
    expect(i.rpc.applied.filter((y) => y.method === "close_sale")).toHaveLength(0);
    for (const go of ctlA.deferred ?? []) go(); // the transaction reaches the chain now
    await until(
      () => i.rpc.applied.filter((y) => y.method === "close_sale").length === 1,
      "the late landing",
    );
    const b = child(i.fileB, i.rpc, i.model);
    await b.ready();
    await until(
      () => i.read("SELECT state FROM business_handovers")[0]?.state === "released_to_buyer",
      "B completing the handover",
      60_000,
    );
    expect(i.read("SELECT n FROM close_orders")).toEqual([{ n: 1 }]);
    expect(i.read("SELECT state FROM closer_tx_attempts")).toEqual([{ state: "success" }]);
    expect(i.rpc.applied.filter((y) => y.method === "close_sale")).toHaveLength(1);
    expect(i.read("SELECT 1 FROM ownership WHERE business_id = ?", i.biz)).toHaveLength(1);
    expect(await b.shutdown()).toBe(0);
  }, 180_000);
});

describe("003wf3 P-2: a provider call running in one process while the other coordinates", () => {
  it("A (configured without the handover, so it can't coordinate) serves the customer use at the provider; B is the coordinator holding the lease; when the call answers, the same use is delivered and charged before B's close", async () => {
    const i = await installation();
    const serveOnly = JSON.parse(readFileSync(i.fileA, "utf8")) as Json;
    delete serveOnly.handover;
    const fileServe = join(i.dir, "config-a-serve.json");
    writeFileSync(fileServe, JSON.stringify(serveOnly));
    const ctlA: Control = {};
    const a = child(fileServe, i.rpc, i.model, ctlA);
    await a.ready();
    const holderA = i.read("SELECT holder FROM process_presence").map((r) => String(r.holder));
    expect(holderA).toHaveLength(1);
    const { seller, cara, use } = await upToTheSellersAcceptance(i, i.portA);
    ctlA.cut = (r) => (isProviderCall(r) && !r.body.includes('"examples"') ? "defer" : "answer");
    const running = cara(`/api/customer/uses/${use}/execute`, "POST", {});
    await until(() => (ctlA.deferred?.length ?? 0) > 0, "A's provider call held");
    ctlA.cut = undefined;
    const b = child(i.fileB, i.rpc, i.model);
    await b.ready();
    const holderB = i
      .read("SELECT holder FROM process_presence")
      .map((r) => String(r.holder))
      .filter((h) => !holderA.includes(h));
    expect(holderB).toHaveLength(1);
    // A process without the handover refuses an acceptance that would start a Gated closing
    // (Q2: handover_unavailable, not_configured); the seller accepts through B.
    void seller;
    const sellerB = browser(i.portB);
    await signInAs(sellerB, FOUNDER, i.ava);
    const x = await act(i, sellerB, FOUNDER, "accept");
    await sellerB(`/api/sales/actions/${x.id}/requested`, "POST", { tx_hash: x.hash });
    await sellerB(`/api/sales/actions/${x.id}/check`, "POST", {});
    await until(() => i.read("SELECT 1 FROM business_handovers").length > 0, "gated");
    // B, the only coordinator, holds the business's lease while A serves.
    await until(() => i.read("SELECT 1 FROM handover_lease").length > 0, "B's lease");
    expect(i.read("SELECT holder FROM handover_lease").map((r) => String(r.holder))).toEqual(
      holderB,
    );
    // While A's call is out: readiness waits; no order is made by either process.
    await new Promise((r) => setTimeout(r, 4_000));
    expect(i.read("SELECT 1 FROM close_orders")).toHaveLength(0);
    for (const go of ctlA.deferred ?? []) go();
    const done = await running;
    expect(done.body.use?.execution?.fulfilled, JSON.stringify(done.body)).toBe(true);
    await until(
      () => i.read("SELECT state FROM business_handovers")[0]?.state === "released_to_buyer",
      "the close after the use settled",
      60_000,
    );
    const methods = i.rpc.applied.map((m) => m.method);
    expect(methods.filter((m) => m === "settle_hold")).toHaveLength(1);
    expect(methods.filter((m) => m === "release_hold_for")).toHaveLength(0);
    expect(methods.indexOf("settle_hold")).toBeLessThan(methods.indexOf("close_sale"));
    expect(methods.filter((m) => m === "close_sale")).toHaveLength(1);
    // The close was ordered and sent by B: the lease, the order and the attempt are B's.
    expect(i.read("SELECT holder FROM handover_lease").map((r) => String(r.holder))).toEqual(
      holderB,
    );
    expect(i.read("SELECT state FROM closer_tx_attempts")).toEqual([{ state: "success" }]);
    const caraB = browser(i.portB);
    await signInAs(caraB, CUSTOMER, i.cara);
    expect((await caraB(`/api/customer/uses/${use}/result`)).status).toBe(200);
    expect(await a.shutdown()).toBe(0);
    expect(await b.shutdown()).toBe(0);
  }, 180_000);
});

describe("003wf3 P-3: a late provider answer after its process stopped", () => {
  it("A stops with its customer call out; the late answer reaches nobody and writes nothing; B recovers it as unknown (never re-sent, its cost not zeroed), and readiness waits for it", async () => {
    const i = await installation();
    const ctlA: Control = {};
    const a = child(i.fileA, i.rpc, i.model, ctlA);
    await a.ready();
    const { seller, cara, use } = await upToTheSellersAcceptance(i, i.portA);
    ctlA.cut = (r) => (isProviderCall(r) ? "defer" : "answer");
    const running = cara(`/api/customer/uses/${use}/execute`, "POST", {}).catch(() => null);
    await until(() => (ctlA.deferred?.length ?? 0) > 0, "A's provider call held");
    // The run's worst case is reserved on the business's running budget before it is sent.
    const ledger = () =>
      i.read(
        "SELECT u.kind, u.cents, u.microcents FROM runtime_usage u JOIN runtime_invocations x ON x.id = u.invocation_id WHERE x.purpose = 'customer_use' ORDER BY u.rowid",
      );
    const reserved = Number(
      i.read("SELECT reserved_cents FROM runtime_invocations WHERE purpose = 'customer_use'")[0]
        ?.reserved_cents,
    );
    expect(reserved).toBeGreaterThan(0);
    expect(ledger()).toEqual([expect.objectContaining({ kind: "reservation", cents: reserved })]);
    expect(await a.shutdown()).toBe(0);
    await running;
    const before = i.read(
      "SELECT state, usage_state, reserved_cents, charged_microcents FROM runtime_invocations WHERE purpose = 'customer_use'",
    );
    // The answer arrives now: A is gone (its IPC channel closed), so nothing is written.
    for (const go of ctlA.deferred ?? []) go();
    await new Promise((r) => setTimeout(r, 500));
    // (That late answer was A's original call, answered to nobody: the baseline is taken now.)
    const calls = i.model.calls.messages;
    expect(
      i.read(
        "SELECT state, usage_state, reserved_cents, charged_microcents FROM runtime_invocations WHERE purpose = 'customer_use'",
      ),
    ).toEqual(before);
    expect(
      i.read("SELECT result_state FROM customer_executions WHERE request_id = ?", use),
    ).not.toContainEqual({ result_state: "stored" });
    // B recovers A's running call as unknown: never re-sent, its reserved cost kept, not zero.
    const b = child(i.fileB, i.rpc, i.model);
    await b.ready();
    await until(
      () =>
        i.read("SELECT state FROM runtime_invocations WHERE purpose = 'customer_use'")[0]?.state !==
        "running",
      "B's recovery of A's call",
      30_000,
    );
    const inv = i.read(
      "SELECT state, usage_state, reserved_cents FROM runtime_invocations WHERE purpose = 'customer_use'",
    )[0] as Json;
    expect(inv.state).toBe("unknown");
    expect(inv.usage_state).not.toBe("final");
    expect(i.model.calls.messages).toBe(calls); // never re-sent
    expect(i.rpc.applied.filter((m) => m.method === "settle_hold")).toHaveLength(0);
    // A closing now accounts for it: its unit is decided first (an unknown provider outcome is
    // not a delivered result, so the unit is returned, never charged), then the close.
    void seller; // A's port is closed now: the seller continues through B
    const sellerB = browser(i.portB);
    await signInAs(sellerB, FOUNDER, i.ava);
    const x = await act(i, sellerB, FOUNDER, "accept");
    await sellerB(`/api/sales/actions/${x.id}/requested`, "POST", { tx_hash: x.hash });
    await sellerB(`/api/sales/actions/${x.id}/check`, "POST", {});
    await until(
      () => i.read("SELECT state FROM business_handovers")[0]?.state === "released_to_buyer",
      "the close after the unknown use's unit was decided",
      60_000,
    );
    const methods = i.rpc.applied.map((m) => m.method);
    expect(methods.filter((m) => m === "settle_hold")).toHaveLength(0);
    expect(methods.filter((m) => m === "release_hold_for")).toHaveLength(1);
    expect(methods.indexOf("release_hold_for")).toBeLessThan(methods.indexOf("close_sale"));
    // The provider cost stays unknown on its record, never zeroed by the close.
    const after = i.read(
      "SELECT state, usage_state FROM runtime_invocations WHERE purpose = 'customer_use'",
    )[0] as Json;
    expect(after.state).toBe("unknown");
    expect(after.usage_state).not.toBe("final");
    expect(i.model.calls.messages).toBe(calls);
    // Across the stop, the restart, the unit's return and the close: the reservation is still
    // the run's whole positive worst case, nothing was counted as an actual (zero) charge, and
    // the business's budget keeps it as unresolved, not spent and not released.
    const kept = i.read(
      "SELECT reserved_cents, charged_cents, charged_microcents FROM runtime_invocations WHERE purpose = 'customer_use'",
    )[0] as Json;
    expect(kept).toMatchObject({
      reserved_cents: reserved,
      charged_cents: 0,
      charged_microcents: 0,
    });
    const kinds = ledger().map((l) => l.kind);
    expect(kinds).toContain("reservation");
    expect(kinds).not.toContain("actual");
    expect(kinds).not.toContain("release");
    expect(await b.shutdown()).toBe(0);
  }, 180_000);
});

describe("003wf3 the configured build worker across the handover (actual child process)", () => {
  it("a build A's own worker dispatched before the closing is fenced after the close; its late answer is never applied and its usage isn't final", async () => {
    const i = await installation();
    const ctlA: Control = {};
    const a = child(i.fileA, i.rpc, i.model, ctlA);
    await a.ready();
    const { seller } = await upToTheSellersAcceptance(i, i.portA);
    ctlA.cut = (r) => (isBuild(r) ? "defer" : "answer");
    const r = await seller(`/api/product-projects/${i.w.f.project}/builds`, "POST", {
      idempotency_key: "matrix-build-0001",
      revision: 1,
      budget: {
        max_input_tokens: 10_000,
        max_output_tokens: 2_000,
        max_seconds: 120,
        max_cost_cents: 10,
      },
    });
    expect([201, 202], JSON.stringify(r.body).slice(0, 300)).toContain(r.status);
    const job = r.body.job.id as string;
    await until(() => (ctlA.deferred?.length ?? 0) > 0, "A's worker dispatching the build", 30_000);
    expect(
      i.read("SELECT dispatched_at FROM build_jobs WHERE id = ?", job)[0]?.dispatched_at,
    ).toBeTruthy();
    const x = await act(i, seller, FOUNDER, "accept");
    await seller(`/api/sales/actions/${x.id}/requested`, "POST", { tx_hash: x.hash });
    await until(
      () => i.read("SELECT state FROM business_handovers")[0]?.state === "released_to_buyer",
      "the close (a dispatched build doesn't block it)",
      60_000,
    );
    await until(
      () =>
        i.read("SELECT state FROM build_jobs WHERE id = ?", job)[0]?.state ===
        "needs_reconciliation",
      "A's worker fencing the build after the owner changed",
      40_000,
    );
    for (const go of ctlA.deferred ?? []) go();
    await new Promise((r2) => setTimeout(r2, 1_000));
    expect(
      i.read(
        "SELECT state, failure_code, usage_final, artifact_digest FROM build_jobs WHERE id = ?",
        job,
      )[0],
    ).toMatchObject({
      state: "needs_reconciliation",
      failure_code: "ownership_changed",
      usage_final: 0,
      artifact_digest: null,
    });
    expect(await a.shutdown()).toBe(0);
  }, 180_000);
});

describe("003wf3 P-4: a second genuinely bound business serves its customers through the first's handover", () => {
  it("while business 1 is gated (its close held), business 2's offer is made, Cara's use there is reserved, run, delivered and settled on business 2's contract, and its founder's edit takes effect; then business 1 closes", async () => {
    const i = await installation({ second: true });
    const second = i.second as NonNullable<Installation["second"]>;
    const ctlA: Control = {};
    const a = child(i.fileA, i.rpc, i.model, ctlA);
    await a.ready();
    // Business 2's founder makes its customer offer through the composition's own routes.
    const ben = browser(i.portA);
    await signInAs(ben, FOUNDER2, i.ben);
    const biz2 = second.founder.business;
    const insp = await ben(`/api/businesses/${biz2}/customer-offer-inspections`, "POST", {
      release_id: second.release,
      plan_id: 1,
      retention_days: 30,
    });
    expect(insp.status, JSON.stringify(insp.body).slice(0, 400)).toBe(200);
    const made = await ben(`/api/businesses/${biz2}/customer-offers`, "POST", {
      idempotency_key: "matrix-offer2-0001",
      release_id: second.release,
      plan_id: 1,
      retention_days: 30,
      reviewed_terms: insp.body.inspection.terms_digest,
    });
    expect([200, 201], JSON.stringify(made.body).slice(0, 400)).toContain(made.status);
    const offer2 = made.body.offer.id as string;
    // Cara's entitlements on the two contracts before anything (Astra 04:01: exact balances).
    const free1 = BigInt(String((i.w.chain.ent(CUSTOMER) as Json).free));
    const free2 = BigInt(String((second.chain.ent(CUSTOMER) as Json).free));
    // Business 1 reaches its closing; its close transaction is held before it lands.
    const { seller, cara } = await upToTheSellersAcceptance(i, i.portA);
    ctlA.cut = (r) =>
      r.channel === "rpc" && sendMethodOf(r.body) === "close_sale" ? "defer" : "answer";
    const x = await act(i, seller, FOUNDER, "accept");
    await seller(`/api/sales/actions/${x.id}/requested`, "POST", { tx_hash: x.hash });
    await until(
      () => (ctlA.deferred?.length ?? 0) > 0,
      "business 1's close held at its send",
      60_000,
    );
    expect(
      i.read("SELECT state FROM business_handovers WHERE business_id = ?", i.biz)[0]?.state,
    ).toMatch(/^(ordering|outcome_unknown)$/);
    // Business 2, meanwhile: a full customer use on its own contract.
    const p = await cara(`/api/customer/offers/${offer2}/prepare`, "POST", {
      idempotency_key: "matrix-use2-0001",
      input: INVOICE,
    });
    expect(p.status, JSON.stringify(p.body).slice(0, 400)).toBe(201);
    const c = await cara(
      `/api/customer/uses/${p.body.use.id}/confirm`,
      "POST",
      i.w.signed(p.body.use.envelope),
    );
    expect(c.body.use?.state, JSON.stringify(c.body).slice(0, 400)).toBe("reserved");
    const run = await cara(`/api/customer/uses/${p.body.use.id}/execute`, "POST", {});
    expect(run.body.use?.execution?.fulfilled, JSON.stringify(run.body).slice(0, 400)).toBe(true);
    const on2 = (m: string) =>
      i.rpc.applied.filter((y) => y.receiver === BIZ2 && y.method === m).length;
    await until(() => on2("settle_hold") === 1, "business 2's use settled (maintenance)", 30_000);
    expect(on2("open_hold")).toBe(1);
    expect(on2("release_hold_for")).toBe(0);
    expect((await cara(`/api/customer/uses/${p.body.use.id}/result`)).status).toBe(200);
    // Its founder's edit takes effect while business 1 is still changing hands.
    const renamed = await ben(`/api/businesses/${biz2}`, "PATCH", {
      name: "Second business, live",
    });
    expect(renamed.status, JSON.stringify(renamed.body)).toBe(200);
    expect(i.read("SELECT name FROM businesses WHERE id = ?", biz2)[0]?.name).toBe(
      "Second business, live",
    );
    expect(
      i.read("SELECT state FROM business_handovers WHERE business_id = ?", i.biz)[0]?.state,
    ).not.toBe("released_to_buyer");
    expect(i.read("SELECT 1 FROM business_handovers WHERE business_id = ?", biz2)).toHaveLength(0);
    // Business 1's close goes on; one close, on business 1's contract only.
    for (const go of ctlA.deferred ?? []) go();
    ctlA.cut = undefined;
    await until(
      () =>
        i.read("SELECT state FROM business_handovers WHERE business_id = ?", i.biz)[0]?.state ===
        "released_to_buyer",
      "business 1 handed over",
      60_000,
    );
    const closes = i.rpc.applied.filter((y) => y.method === "close_sale");
    expect(closes.map((y) => y.receiver)).toEqual([BIZ]);
    // Business 1's own reserved use was returned once, never charged; business 2's charged once.
    expect(
      i.rpc.applied.filter((y) => y.receiver === BIZ && y.method === "release_hold_for"),
    ).toHaveLength(1);
    expect(
      i.rpc.applied.filter((y) => y.receiver === BIZ && y.method === "settle_hold"),
    ).toHaveLength(0);
    expect(on2("settle_hold")).toBe(1);
    // Exact balances: business 1's held unit came back (unchanged), business 2's use consumed one.
    expect(BigInt(String((i.w.chain.ent(CUSTOMER) as Json).free))).toBe(free1);
    expect(BigInt(String((second.chain.ent(CUSTOMER) as Json).free))).toBe(free2 - 1n);
    // The provider cost is attributed to business 2's run only, with its own final usage.
    const runs = i.read(
      "SELECT business_id, usage_state, charged_microcents FROM runtime_invocations WHERE purpose = 'customer_use'",
    );
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ business_id: biz2 });
    expect(Number(runs[0]?.charged_microcents)).toBeGreaterThan(0);
    expect(
      i.read(
        "SELECT 1 FROM runtime_usage u JOIN runtime_invocations x ON x.id = u.invocation_id WHERE x.business_id = ? AND x.purpose = 'customer_use' AND u.kind = 'actual'",
        i.biz,
      ),
    ).toHaveLength(0);
    // One network: the metering account's ONE key signed for both contracts with strictly
    // increasing, distinct nonces, in the order the network accepted them.
    const metered = i.rpc.applied.filter((y) => y.signer === OP);
    expect(new Set(metered.map((y) => y.receiver))).toEqual(new Set([BIZ, BIZ2]));
    const nonces = metered.map((y) => y.nonce as bigint);
    for (let n = 1; n < nonces.length; n++)
      expect((nonces[n] as bigint) > (nonces[n - 1] as bigint)).toBe(true);
    expect(await a.shutdown()).toBe(0);
  }, 240_000);
});
