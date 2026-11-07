// The attack suite's cases paired with real refusals on NEAR testnet (series 3). Each pair names
// the clean run and the attack run on the deployed contracts, by transaction, and what the chain
// showed afterwards. The suite itself (scripts/attack-suite.ts) runs every case on the local node
// and in the app; this file is the subset that also ran on testnet.
//
//   npx tsx scripts/attack-pairs.ts run       two more allowance attacks on testnet, then compile
//   npx tsx scripts/attack-pairs.ts compile   compile from the recorded series-3 runs only
//
// Writes data/evidence/attack-pairs-testnet.json.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { baseEncode } from "near-api-js";
import { account, actions, EXPLORER, provider, ROOT, view } from "./lib/near.ts";

// biome-ignore lint/suspicious/noExplicitAny: recorded JSON, read field by field
type Json = Record<string, any>;
const OUT = "data/evidence/attack-pairs-testnet.json";
const EXTRA = "data/evidence/attack-pairs-extra-testnet.json";
const ALLOW = `budget-v3s3.${ROOT}`;
const AGENT = `agent-v3s3.${ROOT}`;
const SUPPLIER = `supplier-v3s3.${ROOT}`;
const STRANGER = `cara-v3s3-1.${ROOT}`; // registered with tUSD, never an allowed supplier
const digestOf = (t: string) => createHash("sha256").update(t).digest("hex");

const read = (f: string) => JSON.parse(readFileSync(f, "utf8")) as Json;
const stepsOf = (f: string) => (existsSync(f) ? (read(f).steps as Json[]) : []);
const tx = (s: Json | undefined) =>
  s?.chain?.hash ? { hash: s.chain.hash as string, explorer: `${EXPLORER}${s.chain.hash}` } : null;

/** The agent's own payment, signed first and polled to FINAL (never re-signed). */
async function pay(supplier: string, amount: string, invoice: string) {
  const a = account(AGENT);
  const signer = a.getSigner();
  if (!signer) throw new Error("no agent key");
  const t = await a.createTransaction({
    receiverId: ALLOW,
    actions: [actions.functionCall("pay", { supplier, amount, invoice }, 100_000_000_000_000n, 0n)],
    publicKey: await signer.getPublicKey(),
  });
  const { txHash, signedTransaction } = await signer.signTransaction(t);
  const hash = baseEncode(txHash);
  await provider.sendTransactionAsync(signedTransaction).catch(() => undefined);
  for (let i = 0; i < 80; i++) {
    // biome-ignore lint/suspicious/noExplicitAny: the RPC's status shape
    const r: any = await provider
      .viewTransactionStatusWithReceipts({
        txHash: hash,
        accountId: AGENT,
        waitUntil: "FINAL",
      } as never)
      .catch(() => null);
    if (r?.status && ("SuccessValue" in r.status || "Failure" in r.status)) {
      const text = JSON.stringify(r.status);
      const value =
        "SuccessValue" in r.status ? Buffer.from(r.status.SuccessValue, "base64").toString() : "";
      return {
        hash,
        explorer: `${EXPLORER}${hash}`,
        ok: !("Failure" in r.status),
        code: /E_[A-Z_]+/.exec(text)?.[0] ?? /E_[A-Z_]+/.exec(value)?.[0] ?? null,
      };
    }
    await new Promise((x) => setTimeout(x, 3000));
  }
  throw new Error(`payment ${hash}: outcome unknown`);
}

async function runExtra() {
  const control = await view<Json>(`ledgerline-v3-3b.${ROOT}`, "get_control");
  const before = await view<Json>(ALLOW, "get_allowance");
  // Clean: an allowed supplier, a new invoice, within the cap.
  const invoice = digestOf("fictional invoice SUP-201 0.50 tUSD");
  const clean = await pay(SUPPLIER, "500000", invoice);
  // Attack 1: the same invoice again.
  const replay = await pay(SUPPLIER, "500000", invoice);
  // Attack 2: a supplier the owner never allowed.
  const stranger = await pay(STRANGER, "500000", digestOf("fictional invoice SUP-202 0.50 tUSD"));
  const after = await view<Json>(ALLOW, "get_allowance");
  writeFileSync(
    EXTRA,
    `${JSON.stringify(
      {
        format: "everstreet.attack-pairs-extra",
        network: "testnet",
        at: new Date().toISOString(),
        owner: control.owner,
        generation: control.generation,
        clean,
        replay,
        stranger,
        allowance_before: before,
        allowance_after: after,
      },
      null,
      2,
    )}\n`,
  );
  console.log({ clean, replay, stranger });
  if (!clean.ok || clean.code) throw new Error("the clean payment didn't go through");
  if (replay.code !== "E_REPLAY") throw new Error(`replay: ${replay.code}`);
  if (stranger.code !== "E_SUPPLIER") throw new Error(`stranger: ${stranger.code}`);
}

function compile() {
  const ext = stepsOf("data/evidence/v3-ext-testnet.json");
  const gated = stepsOf("data/evidence/v3-gated-testnet.json");
  const rec = stepsOf("data/evidence/v3-recovery-testnet.json");
  const extra = existsSync(EXTRA) ? read(EXTRA) : null;
  const by = (steps: Json[], name: string) => steps.find((s) => s.step === name);
  const pairs: Json[] = [];
  const add = (p: Json) => {
    if (p.attack.tx || p.attack.app) pairs.push(p);
  };
  add({
    case: "Former seller asks for the feed role",
    clean: {
      what: "The owner moves the feed role through Everstreet; final on Sepolia",
      tx: tx(by(ext, "app_feed_move_by_buyer-v3s3")),
    },
    attack: {
      what: "The former owner asks the feed companion to move the role",
      refusal: "E_NOT_OWNER",
      tx: tx(by(ext, "asset_request_set_controller_by_founder-v3s3")),
    },
  });
  add({
    case: "Former seller acts as owner",
    clean: {
      what: "The owner grants the supplier allowance",
      tx: tx(by(ext, "allowance_grant_gen2")),
    },
    attack: {
      what: "The former owner grants it instead",
      refusal: "E_NOT_OWNER",
      tx: tx(by(ext, "former_owner_grant_refused")),
    },
  });
  add({
    case: "Supplier payment after the close",
    clean: {
      what: "The agent pays under the new owner's grant",
      tx: tx(by(ext, "agent_pays_under_new_grant")),
    },
    attack: {
      what: "The agent pays under the previous owner's grant after the close",
      refusal: "E_GRANT_ENDED",
      tx: tx(by(ext, "agent_pays_after_close")),
    },
  });
  if (extra) {
    add({
      case: "Invoice paid twice",
      clean: {
        what: "The agent pays a new invoice",
        tx: { hash: extra.clean.hash, explorer: extra.clean.explorer },
      },
      attack: {
        what: "The same invoice again",
        refusal: extra.replay.code,
        tx: { hash: extra.replay.hash, explorer: extra.replay.explorer },
      },
    });
    add({
      case: "Invoice from a supplier not allowed",
      clean: {
        what: "The agent pays an allowed supplier",
        tx: { hash: extra.clean.hash, explorer: extra.clean.explorer },
      },
      attack: {
        what: "The agent pays an account the owner never allowed",
        refusal: extra.stranger.code,
        tx: { hash: extra.stranger.hash, explorer: extra.stranger.explorer },
      },
    });
  }
  const probe = gated.find(
    (s) => s.facts?.probe?.code === "handover_pause" || s.facts?.code === "handover_pause",
  );
  add({
    case: "New customer hold while closing",
    clean: { what: "A customer's use before the gated close", tx: null },
    attack: {
      what: "A new customer's request while the gated sale is closing",
      refusal: "handover_pause (409)",
      app: probe ? { step: probe.step, source: "app_recorded" } : null,
    },
  });
  const dropped = by(rec, "readback_answer_dropped");
  const recovered = rec.find((s) => String(s.step).startsWith("recovered_with_original_hash"));
  add({
    case: "Wallet answer lost",
    clean: { what: "The purchase confirmed once, by its own transaction ID", tx: null },
    attack: {
      what: "The app's answer for a landed purchase is dropped on the way back",
      refusal: "unknown, then confirmed once",
      app: dropped && recovered ? { step: recovered.step, source: "app_recorded" } : null,
    },
  });
  const body = {
    format: "everstreet.attack-pairs-testnet",
    version: 1,
    network: "testnet",
    series: 3,
    records: [
      "data/evidence/v3-ext-testnet.json",
      "data/evidence/v3-gated-testnet.json",
      "data/evidence/v3-recovery-testnet.json",
      ...(extra ? [EXTRA] : []),
    ],
    pairs,
  };
  writeFileSync(OUT, `${JSON.stringify(body, null, 2)}\n`);
  console.log(`${pairs.length} pairs → ${OUT}`);
  for (const p of pairs)
    console.log(`  ${p.case}: ${p.attack.refusal} ${p.attack.tx?.explorer ?? ""}`);
}

const cmd = process.argv[2];
if (cmd === "run") {
  await runExtra();
  compile();
} else if (cmd === "compile") compile();
else {
  console.error("usage: attack-pairs.ts run | compile");
  process.exit(2);
}
