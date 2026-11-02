// Early signer probe (brief §7, first 48 hours): is NEAR testnet reachable, and does the Chain
// Signatures MPC contract answer? Reads only: no keys, no transactions, nothing spent.
//
//   npm run probe:signer            one ✓/✗ line per check
//   npm run probe:signer -- --json  the same as one JSON object

const RPC = process.env.NEAR_RPC ?? "https://test.rpc.fastnear.com";
const MPC = process.env.MPC_CONTRACT ?? "v1.signer-prod.testnet";

async function query(params: Record<string, unknown>) {
  const response = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "probe",
      method: "query",
      params: { finality: "final", ...params },
    }),
  });
  const body = (await response.json()) as {
    result?: Record<string, unknown>;
    error?: { cause?: { name?: string } };
  };
  if (body.error) throw new Error(body.error.cause?.name ?? JSON.stringify(body.error));
  return body.result ?? {};
}

async function view(contract: string, method: string, args: Record<string, unknown> = {}) {
  const result = await query({
    request_type: "call_function",
    account_id: contract,
    method_name: method,
    args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
  });
  return JSON.parse(Buffer.from(result.result as number[]).toString("utf8")) as unknown;
}

const checks: { name: string; ok: boolean; detail: string }[] = [];
async function check(name: string, fn: () => Promise<string>) {
  try {
    checks.push({ name, ok: true, detail: await fn() });
  } catch (error) {
    checks.push({
      name,
      ok: false,
      detail: String(error instanceof Error ? error.message : error),
    });
  }
}

await check("testnet RPC", async () => {
  const response = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "s", method: "status", params: [] }),
  });
  const s = (await response.json()) as {
    result: { chain_id: string; sync_info: { latest_block_height: number } };
  };
  return `${s.result.chain_id} at block ${s.result.sync_info.latest_block_height}`;
});
await check(`MPC contract ${MPC} deployed`, async () => {
  const account = await query({ request_type: "view_account", account_id: MPC });
  return `code hash ${account.code_hash}`;
});
await check("MPC root key (secp256k1, domain 0)", async () => {
  const key = await view(MPC, "public_key", { domain_id: 0 });
  return String(key);
});
await check("MPC derived key for a business path", async () => {
  const key = await view(MPC, "derived_public_key", {
    path: "business-service-issuer",
    predecessor: "probe.testnet",
    domain_id: 0,
  });
  return String(key);
});

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ rpc: RPC, mpc: MPC, checks }));
} else {
  for (const c of checks) console.log(`${c.ok ? "✓" : "✗"} ${c.name}: ${c.detail}`);
}
process.exit(checks.every((c) => c.ok) ? 0 : 1);
