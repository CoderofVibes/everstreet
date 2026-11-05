// Job 003wf3 (MANAGED_HANDOVER.md §10.4, P-1/P-4/P-5): managed handovers in ACTUAL child processes
// running the normal entry (entryChild.ts -> serve.ts -> composeApplication) with `handover`
// configured, two processes on one database. Their RPC and model are answered by THIS process over
// IPC from one synthetic state (lifecycleWorld.ts SyntheticRpc), so the chain survives a forced
// kill and a send can be held at a deterministic barrier. Disposable directories, ephemeral keys,
// fictional accounts; every child is bounded and stopped here.

import { type ChildProcess, fork } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDb } from "../src/db.ts";
import type { Json } from "./customer-world.ts";
import { BUYER, PRICE, prepareHandover } from "./handoverWorld.ts";
import {
  API_KEY_ENV,
  bootstrap,
  FICTIONAL_KEY,
  FOUNDER,
  OP,
  type SyntheticModel,
  type SyntheticRpc,
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

function child(configFile: string, rpc: SyntheticRpc, model: SyntheticModel) {
  const proc: ChildProcess = fork(join("server", "test", "entryChild.ts"), [configFile], {
    execArgv: ["--import", "tsx", "--max-old-space-size=256"],
    env: { ...process.env, [API_KEY_ENV]: FICTIONAL_KEY },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  let out = "";
  proc.stdout?.on("data", (d) => (out = (out + d).slice(-16_384)));
  proc.stderr?.on("data", (d) => (out = (out + d).slice(-16_384)));
  proc.on(
    "message",
    (m: { type?: string; channel?: string; id?: number; url?: string; body?: string }) => {
      if (m?.type !== "fetch") return;
      void (async () => {
        const r =
          m.channel === "rpc"
            ? { status: 200, body: await rpc.answer(String(m.body)) }
            : await model.answer(String(m.url), JSON.parse(String(m.body || "{}")));
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
    out: () => out,
    ready: () =>
      until(() => out.includes("listening on"), "the child listening").catch((e) => {
        throw new Error(`${(e as Error).message}: ${out.slice(-800)}`);
      }),
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

/** Two configured children (A, B) on one database, with `handover` and short coordinator passes. */
async function installation() {
  const dir = mkdtempSync(join(tmpdir(), "handover-proc-"));
  cleanups.push(() =>
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }),
  );
  const [portA, portB] = [await freePort(), await freePort()];
  const b = await bootstrap(dir, portA, {
    interval_ms: 60_000,
    batch: 5,
    pass_budget_ms: 3_000,
    op_deadline_ms: 2_000,
    stop_timeout_ms: 5_000,
  });
  const prep = prepareHandover(b, dir, {
    handover: { interval_ms: 1_000, pass_budget_ms: 1_000, op_deadline_ms: 800 },
  });
  const base = { ...JSON.parse(readFileSync(b.configFile, "utf8")), handover: prep.handover };
  const fileA = join(dir, "config-a.json");
  const fileB = join(dir, "config-b.json");
  writeFileSync(fileA, JSON.stringify({ ...base, listen: { host: "127.0.0.1", port: portA } }));
  writeFileSync(fileB, JSON.stringify({ ...base, listen: { host: "127.0.0.1", port: portB } }));
  const read = <T>(sql: string, ...args: (string | number)[]) => {
    const db = openDb(b.db);
    try {
      return db.prepare(sql).all(...args) as T[];
    } finally {
      db.close();
    }
  };
  return { ...b, ...prep, dir, portA, portB, fileA, fileB, read, biz: b.w.f.business as string };
}

type Call = ReturnType<typeof browser>;
async function act(
  i: Awaited<ReturnType<typeof installation>>,
  call: Call,
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
    idempotency_key: `proc-${kind}-${Math.random().toString(36).slice(2, 10)}`,
  });
  expect(c.status, JSON.stringify(c.body)).toBe(201);
  const a = c.body.action as Json;
  await call(`/api/sales/actions/${a.id}/requested`, "POST", {});
  const out = i.w.chain.walletCall(account, a.call);
  await call(`/api/sales/actions/${a.id}/requested`, "POST", { tx_hash: out.transaction.hash });
  return (await call(`/api/sales/actions/${a.id}/check`, "POST", {})).body as Json;
}

describe("003wf3 managed handover in actual processes", () => {
  it("the dispatching process is killed with its close held in flight; the other process takes over after the lease lapses, resolves the original attempt by its own bytes, and applies exactly one close; another business stays writable throughout", async () => {
    const i = await installation();
    const a = child(i.fileA, i.rpc, i.model);
    await a.ready();
    const seller = browser(i.portA);
    const buyer = browser(i.portA);
    await signInAs(seller, FOUNDER, i.ava);
    await signInAs(buyer, BUYER, i.noah);
    // An unrelated business of the same founder: never gated by this sale.
    const other = await seller("/api/projects", "POST", { route: "idea", name: "Second business" });
    const otherId = other.body.business?.id as string;
    expect(otherId).toBeTruthy();
    const terms = {
      buyer_account: BUYER,
      price: PRICE,
      expires_in_days: 7,
      available_floor: "0",
      grants: [{ account: OP, caps: 1 }],
      exclusions: [],
      note: "",
      close_window_minutes: 30,
    };
    expect((await act(i, seller, FOUNDER, "propose", terms)).resolution.kind).toBe("confirmed");
    for (const k of ["register", "fund", "accept"])
      expect((await act(i, buyer, BUYER, k)).resolution.kind, k).toBe("confirmed");
    // The closer's send is held: A's coordinator records its attempt, broadcasts, and waits.
    const held = i.rpc.holdNextSend();
    expect((await act(i, seller, FOUNDER, "accept")).resolution.result).toBe("closing");
    await held.entered;
    const attempts = i.read<Json>("SELECT operation, state FROM closer_tx_attempts");
    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.state).toBe("signed");
    // While gated: the gated business refuses owner changes; the other one doesn't.
    expect((await seller(`/api/businesses/${i.biz}`, "PATCH", { name: "Gated" })).status).toBe(409);
    expect(
      (await seller(`/api/businesses/${otherId}`, "PATCH", { name: "Still mine" })).status,
    ).toBe(200);
    // A dies mid-dispatch. B starts on the same database.
    a.proc.kill("SIGKILL");
    await a.exited;
    const bChild = child(i.fileB, i.rpc, i.model);
    await bChild.ready();
    await until(
      () =>
        i.read<Json>("SELECT state FROM business_handovers WHERE business_id = ?", i.biz)[0]
          ?.state === "released_to_buyer",
      "the handover released to the buyer by process B",
      60_000,
    );
    // The held original send finally arrives: the same signed transaction, applied once.
    held.open();
    await new Promise((r) => setTimeout(r, 300));
    expect(i.rpc.applied.filter((x) => x.method === "close_sale")).toHaveLength(1);
    expect(i.read<Json>("SELECT COUNT(*) AS n FROM close_orders")[0]?.n).toBe(1);
    expect(i.read<Json>("SELECT state FROM closer_tx_attempts")).toEqual([{ state: "success" }]);
    const owner = i.read<Json>("SELECT owner_id FROM businesses WHERE id = ?", i.biz)[0];
    expect(owner?.owner_id).toBe("person-noah");
    const kinds = i.read<Json>("SELECT kind FROM handover_journal").map((j) => j.kind);
    expect(kinds).toContain("takeover");
    expect(
      i.read<Json>("SELECT COUNT(*) AS n FROM ownership WHERE business_id = ?", i.biz)[0]?.n,
    ).toBe(1);
    // B stops cleanly (admission, drain, fence, close).
    expect(await bChild.shutdown()).toBe(0);
  }, 150_000);
});
