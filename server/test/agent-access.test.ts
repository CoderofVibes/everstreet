// Job 006b: an external agent uses an Everstreet product through MCP (revision 2026-07-28,
// Streamable HTTP) and the plain agent API, over the real routes of the customer world (fixture
// chain, scripted extractor, fictional people; no network). The agent is an INDEPENDENT client: no
// cookie, only the bearer token the customer granted. Its key is the fixture's seed-1 use key in
// slot 0, standing for "the agent's own key installed for it" (labelled; a real agent would hold
// its own key installed by the customer with its own limits).

import { describe, expect, it } from "vitest";
import { MCP_VERSION } from "../src/agentAccess.ts";
import { customerWorld, type Json, SyntheticProtection } from "./customer-world.ts";

const INVOICE =
  "Fictional invoice SH-1042 from Stackline Hosting Ltd, 2026-10-14, total 412.50 USD";

async function world(maxUses = 2) {
  const w = await customerWorld({ customer: { protection: new SyntheticProtection() } });
  const offer = await w.offer();
  // Fixture prerequisite: discovery describes offers of PUBLISHED businesses only.
  w.state.store.db
    .prepare("UPDATE businesses SET published_at = ? WHERE id = ?")
    .run(new Date().toISOString(), w.f.business);
  // The owner turns agent use of this offer on (off until then).
  const on = await w.caller(w.f.ava.id)(
    `/api/businesses/${w.f.business}/customer-offers/${offer}/agent-access`,
    "PUT",
    { enabled: true },
  );
  expect(on.status, JSON.stringify(on.body)).toBe(200);
  const cara = w.caller(w.cara.id);
  const grant = await cara("/api/customer/agent-grants", "POST", {
    offer_id: offer,
    key_slot: 0,
    label: "Fictional bookkeeping agent",
    max_uses: maxUses,
    expires_in_days: 7,
  });
  expect(grant.status, JSON.stringify(grant.body)).toBe(201);
  const token = grant.body.token as string;
  /** The agent: plain HTTP, no session cookie. */
  const agent = async (
    path: string,
    method = "GET",
    body?: unknown,
    headers: Record<string, string> = {},
  ) => {
    const res = await w.state.app.request(path, {
      method,
      headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...headers },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : null) as Json };
  };
  let n = 0;
  const meta = (v = MCP_VERSION) => ({
    "io.modelcontextprotocol/protocolVersion": v,
    "io.modelcontextprotocol/clientInfo": { name: "fictional-agent", version: "0.1" },
    "io.modelcontextprotocol/clientCapabilities": {},
  });
  const rpc = (
    method: string,
    params: Json = {},
    o: { version?: string; headers?: Record<string, string> } = {},
  ) => {
    const v = o.version ?? MCP_VERSION;
    return agent(
      "/api/agent/mcp",
      "POST",
      { jsonrpc: "2.0", id: ++n, method, params: { ...params, _meta: meta(v) } },
      {
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": v,
        "mcp-method": method,
        ...(method === "tools/call" ? { "mcp-name": String(params.name) } : {}),
        ...o.headers,
      },
    );
  };
  return { w, offer, cara, grant: grant.body.grant as Json, token, agent, rpc };
}

describe("006b agent access", () => {
  it("MCP: discover, list, describe without access, then prepare, sign, confirm, run and read the result; a retry is the same use", async () => {
    const { w, offer, rpc } = await world();
    const d = await rpc("server/discover");
    expect(d.body.result).toMatchObject({
      resultType: "complete",
      supportedVersions: [MCP_VERSION],
      capabilities: { tools: {} },
    });
    const tools = (await rpc("tools/list")).body.result.tools.map((t: Json) => t.name);
    expect(tools).toEqual(["describe_offer", "prepare_use", "confirm_use", "run_use", "get_use"]);
    const desc = await rpc("tools/call", {
      name: "describe_offer",
      arguments: { offer_id: offer },
    });
    expect(desc.body.result.isError).toBe(false);
    expect(JSON.stringify(desc.body.result.structuredContent)).not.toMatch(/evs_agent_|token_hash/);

    const prep = await rpc("tools/call", {
      name: "prepare_use",
      arguments: { idempotency_key: "agent-use-0001", input: INVOICE },
    });
    expect(prep.body.result.isError, JSON.stringify(prep.body)).toBe(false);
    const use = prep.body.result.structuredContent.use as Json;
    // A lost answer, retried with the same key: the same use, nothing new.
    const again = await rpc("tools/call", {
      name: "prepare_use",
      arguments: { idempotency_key: "agent-use-0001", input: INVOICE },
    });
    expect(again.body.result.structuredContent.use.id).toBe(use.id);
    const sig = w.signed(use.envelope);
    const conf = await rpc("tools/call", {
      name: "confirm_use",
      arguments: { use_id: use.id, ...sig },
    });
    expect(conf.body.result.structuredContent.use?.state, JSON.stringify(conf.body)).toBe(
      "reserved",
    );
    const run = await rpc("tools/call", { name: "run_use", arguments: { use_id: use.id } });
    expect(
      run.body.result.structuredContent.use?.execution?.fulfilled,
      JSON.stringify(run.body),
    ).toBe(true);
    const got = await rpc("tools/call", { name: "get_use", arguments: { use_id: use.id } });
    expect(JSON.stringify(got.body.result.structuredContent.result)).toContain("SH-1042");
    // The customer sees the same use as hers (shared product, entitlement and identity).
    const mine = await w.caller(w.cara.id)(`/api/customer/uses/${use.id}`);
    expect(mine.status).toBe(200);
  });

  it("refuses before dispatch: used-up, revoked, expired-looking tokens, another customer's use; never raises limits", async () => {
    const { w, cara, grant, agent, rpc } = await world(1);
    const first = await agent("/api/agent/v1/uses", "POST", {
      idempotency_key: "agent-cap-0001",
      input: INVOICE,
    });
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    const third = await agent("/api/agent/v1/uses", "POST", {
      idempotency_key: "agent-cap-0003",
      input: INVOICE,
    });
    expect([third.status, third.body.code]).toEqual([403, "agent_used_up"]);
    // Another customer's use can't be touched with this grant.
    const dana = w.caller(w.dana.id);
    const other = await dana(`/api/customer/offers/${grant.offer_id}/prepare`, "POST", {
      idempotency_key: "dana-0001",
      input: INVOICE,
    });
    if (other.body?.use?.id)
      expect((await agent(`/api/agent/v1/uses/${other.body.use.id}`)).status).toBe(404);
    // Revoked: every agent call refuses, through MCP as a tool error, before anything runs.
    await cara(`/api/customer/agent-grants/${grant.id}/revoke`, "POST");
    expect(
      (
        await agent("/api/agent/v1/uses", "POST", {
          idempotency_key: "agent-cap-0004",
          input: INVOICE,
        })
      ).status,
    ).toBe(403);
    const viaMcp = await rpc("tools/call", {
      name: "prepare_use",
      arguments: { idempotency_key: "agent-cap-0005", input: INVOICE },
    });
    expect(viaMcp.body.result).toMatchObject({
      isError: true,
      structuredContent: { code: "agent_revoked" },
    });
    expect((await cara("/api/customer/agent-grants")).body.grants[0]).toMatchObject({
      state: "revoked",
      used: 1,
    });
    // A garbage token is unauthorized.
    const res = await w.state.app.request("/api/agent/v1/uses", {
      method: "POST",
      headers: {
        authorization: "Bearer evs_agent_notarealtokenatallxxxxxxxx",
        "content-type": "application/json",
      },
      body: "{}",
    });
    expect(res.status).toBe(401);
  });

  it("the owner's switch: off by default refuses a grant; turned off later refuses new agent preparations before dispatch; only the owner can flip it; history is append-only", async () => {
    const w = await customerWorld({ customer: { protection: new SyntheticProtection() } });
    const offer = await w.offer();
    const cara = w.caller(w.cara.id);
    const owner = w.caller(w.f.ava.id);
    const path = `/api/businesses/${w.f.business}/customer-offers/${offer}/agent-access`;
    const grantBody = {
      offer_id: offer,
      key_slot: 0,
      label: "Fictional agent",
      max_uses: 3,
      expires_in_days: 7,
    };
    const off = await cara("/api/customer/agent-grants", "POST", grantBody);
    expect([off.status, off.body.code]).toEqual([403, "agent_access_off"]);
    // A customer (not the owner) can't turn it on.
    expect((await cara(path, "PUT", { enabled: true })).status).toBeGreaterThanOrEqual(400);
    expect((await owner(path, "PUT", { enabled: "yes" })).status).toBe(400);
    expect((await owner(path, "PUT", { enabled: true })).body).toEqual({
      offer_id: offer,
      agents: "on",
    });
    const g = await cara("/api/customer/agent-grants", "POST", grantBody);
    expect(g.status).toBe(201);
    const listed = await owner(`/api/businesses/${w.f.business}/agent-access`);
    expect(listed.body.offers).toEqual([
      expect.objectContaining({ offer_id: offer, agents: "on", active_grants: 1 }),
    ]);
    await owner(path, "PUT", { enabled: false });
    const r = await w.state.app.request("/api/agent/v1/uses", {
      method: "POST",
      headers: { authorization: `Bearer ${g.body.token}`, "content-type": "application/json" },
      body: JSON.stringify({ idempotency_key: "agent-off-0001", input: INVOICE }),
    });
    expect(r.status).toBe(403);
    expect(((await r.json()) as Json).code).toBe("agent_access_off");
    expect(
      w.state.store.db.prepare("SELECT COUNT(*) AS n FROM customer_requests").get() as Json,
    ).toEqual({ n: 0 });
    // The grant survives (the customer's), and the history records both changes, append-only.
    expect((await cara("/api/customer/agent-grants")).body.grants[0].state).toBe("active");
    const h = w.state.store.db
      .prepare("SELECT enabled FROM agent_offer_switch_history ORDER BY n")
      .all() as Json[];
    expect(h.map((x) => x.enabled)).toEqual([1, 0]);
    expect(() => w.state.store.db.exec("DELETE FROM agent_offer_switch_history")).toThrow(
      /append-only/,
    );
  });

  it("MCP conformance: version rejection, header mismatch, missing _meta, initialize, notifications, GET/DELETE, unknown method/tool", async () => {
    const { agent, rpc } = await world();
    const old = await rpc("tools/list", {}, { version: "2025-11-25" });
    expect([old.status, old.body.error.code, old.body.error.data.supported]).toEqual([
      400,
      -32022,
      [MCP_VERSION],
    ]);
    const mismatch = await rpc("tools/list", {}, { headers: { "mcp-method": "tools/call" } });
    expect([mismatch.status, mismatch.body.error.code]).toEqual([400, -32020]);
    const noName = await rpc(
      "tools/call",
      { name: "describe_offer", arguments: { offer_id: "x" } },
      { headers: { "mcp-name": "other" } },
    );
    expect([noName.status, noName.body.error.code]).toEqual([400, -32020]);
    const bare = await agent(
      "/api/agent/mcp",
      "POST",
      { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
      { "mcp-protocol-version": MCP_VERSION, "mcp-method": "tools/list" },
    );
    expect([bare.status, bare.body.error.code]).toEqual([400, -32602]);
    const init = await agent("/api/agent/mcp", "POST", {
      jsonrpc: "2.0",
      id: 2,
      method: "initialize",
      params: { protocolVersion: "2025-06-18" },
    });
    expect([init.status, init.body.error.code, init.body.error.data.supported]).toEqual([
      400,
      -32022,
      [MCP_VERSION],
    ]);
    const note = await agent("/api/agent/mcp", "POST", {
      jsonrpc: "2.0",
      method: "notifications/x",
    });
    expect([note.status, note.body]).toEqual([202, null]);
    expect((await agent("/api/agent/mcp", "GET")).status).toBe(405);
    expect((await agent("/api/agent/mcp", "DELETE")).status).toBe(405);
    const unknown = await rpc("resources/list");
    expect([unknown.status, unknown.body.error.code]).toEqual([404, -32601]);
    const badTool = await rpc("tools/call", { name: "transfer_treasury", arguments: {} });
    expect(badTool.body.error.code).toBe(-32602);
    expect((await agent("/api/agent/mcp", "POST", "{not json")).body.error.code).toBe(-32700);
  });
});
