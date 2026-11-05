// Evidence quality for the configured-process tests: the RPC boundary must preserve identity
// and pinned state, rather than serving any account/current state under an older block label.
import { expect, it } from "vitest";
import { BUSINESS, FixtureChain } from "./customer-world.ts";
import { SyntheticRpc } from "./lifecycleWorld.ts";

const request = async (rpc: SyntheticRpc, method: string, params: Record<string, unknown>) =>
  JSON.parse(await rpc.answer(JSON.stringify({ jsonrpc: "2.0", id: "review", method, params })));

const query = (account: string, hash: string) => ({
  request_type: "call_function",
  account_id: account,
  block_id: hash,
  method_name: "get_control",
  args_base64: Buffer.from("{}").toString("base64"),
});

it("the synthetic RPC refuses an unknown contract instead of returning the fixture business", async () => {
  const rpc = new SyntheticRpc(new FixtureChain());
  const block = await request(rpc, "block", { finality: "final" });
  const good = await request(rpc, "query", query(BUSINESS, block.result.header.hash));
  expect(good.result.result).toBeInstanceOf(Array);
  const wrong = await request(
    rpc,
    "query",
    query("unrelated-synthetic.testnet", block.result.header.hash),
  );
  expect(Boolean(wrong.error || wrong.result?.error)).toBe(true);
});

it("a pinned old block never labels a later owner as its own state", async () => {
  const chain = new FixtureChain();
  const rpc = new SyntheticRpc(chain);
  const block = await request(rpc, "block", { finality: "final" });
  const q = query(BUSINESS, block.result.header.hash);
  const before = await request(rpc, "query", q);
  const old = JSON.parse(Buffer.from(before.result.result).toString("utf8"));
  chain.afterSale(); // named contract-produced post-sale fixture, in a later synthetic block
  chain.tick(1n);
  expect(chain.control.owner).not.toBe(old.owner);
  const laterRead = await request(rpc, "query", q);
  // An unavailable historical block is honest too; relabelling current state is not.
  if (laterRead.error || laterRead.result?.error) return;
  expect(JSON.parse(Buffer.from(laterRead.result.result).toString("utf8"))).toEqual(old);
});
