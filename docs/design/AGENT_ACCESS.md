# Agent access (006b, M6 extension)

November 5, 2026, Claude, under Tony's direct build mandate. An external agent uses an Everstreet
product through the **same** customer path a person uses: admission, signed holds, execution,
settlement and retention. Human and machine use share one product, entitlement and business
identity.

## Authority

- **The grant.** A customer creates agent access (`POST /api/customer/agent-grants`, page
  `/agent-access`) for one active offer, one installed key slot (0–3), a use limit (1–1000) and an
  expiry (1–90 days).
  - The key slot holds the **agent's own** use key, installed on the contract with its own daily
    limit (by the existing install path); Everstreet never holds it.
  - The bearer token (`evs_agent_…`, 32 random bytes) is shown once; only its SHA-256 is stored.
- **What the agent can't do:** change limits or retention, reach another offer, customer or
  business, or act as the owner. Its idempotency keys are namespaced per grant, so its retries
  never collide with the customer's own requests.
- **Refusals before anything is prepared or run:** revocation, expiry, a used-up limit, a use
  that isn't this grant's, an invalid token.
- **Through a sale:** the grant belongs to the customer's entitlement and survives it, like the
  customer's own access; it carries no administrative authority to lose.

## The owner's switch (hardening, Nov 5)

Agent use is **off for every offer until its owner turns it on**
(`PUT /api/businesses/:id/customer-offers/:offer/agent-access {enabled}`, listed at
`GET /api/businesses/:id/agent-access`; shown under "Agent use" on the owner's offers panel).
- Off refuses (`agent_access_off`), before anything is prepared or reserved:
  - new grants for the offer;
  - new agent preparations;
  - confirming an agent request that was prepared but not signed yet (nothing is held for it).
- Off does **not** stop a request already confirmed (its unit reserved or being reserved): it
  still runs and settles, because its unit is held for it and stopping it would only strand the
  customer's unit. Retrying a preparation with the same key returns the same request.
- Customers' grants are kept and work again if it's turned back on. The owner's count shows
  grants that can still act (not revoked, expired or used up).
- The switch belongs to the offer, so it carries through a sale; only the current owner can flip
  it (owner-fenced, refused during a managed handover; classified `gated_owner`).
- Every change is kept in an append-only history (`agent_offer_switch_history`).

## Plain API (`/api/agent/v1`)

| Route | Notes |
|---|---|
| `GET /offers/:offer` | The capability description: purpose, input, public offer facts, protocols. No grant; published businesses only |
| `POST /uses` | `{idempotency_key, input}` → the use and the hold/use messages to sign |
| `POST /uses/:id/confirm` | `{envelope_digest, hold_signature, use_signature}` |
| `POST /uses/:id/execute` | Runs the use |
| `GET /uses/:id` | The use's state |
| `GET /uses/:id/result` | The result, when delivered |

Each route except the description needs `Authorization: Bearer <token>`.

## MCP (`/api/agent/mcp`)

Revision **2026-07-28** (modern only), checked on November 5 against
modelcontextprotocol.io/specification/2026-07-28: base, versioning, Streamable HTTP, discover and
tools.

**Transport and versioning:**
- POST only; GET and DELETE answer 405. No sessions.
- An `Origin` other than the platform's gets 403.
- Every request needs `_meta["io.modelcontextprotocol/protocolVersion"]` and `clientCapabilities`
  (missing: 400, -32602).
- `MCP-Protocol-Version`, `Mcp-Method` and, for tools/call, `Mcp-Name` must be present and match
  the body (otherwise 400, -32020).
- Other versions, and `initialize`, get 400 / -32022 with `supported: ["2026-07-28"]`.
- Notifications get 202. Unknown methods get 404 / -32601.

**Methods and tools:**
- `server/discover`: supported versions, `capabilities.tools`, instructions, serverInfo.
- `tools/list`: `describe_offer` (no grant), `prepare_use`, `confirm_use`, `run_use`, `get_use`.
- `tools/call`: results carry `resultType: "complete"`, text `content`, `structuredContent` and
  `isError`.
- An unknown tool is a protocol error (-32602). Refusals such as revoked or used up are tool
  errors (`isError: true`) with their code.

## Evidence

`server/test/agent-access.test.ts` (3): an independent client with only the bearer token, over
the real routes of the customer world (fixture chain, synthetic protection, scripted extractor):
- MCP discover, list and describe; prepare, retry (same use), sign with the agent's key,
  confirm, run, read the result; the customer sees the same use;
- a 1-use cap refused before dispatch, revocation through both APIs, an invalid token (401),
  another customer's use unreachable;
- conformance: version rejection, header mismatches, missing `_meta`, `initialize`,
  notifications, GET/DELETE, unknown method or tool, a parse error.

- The owner's switch: off by default, a non-owner refused, refusal before dispatch, history
  append-only (`agent-access.test.ts`).
- In the actual configured child across a Direct sale (`flagship-agent-sale.test.ts`): the agent
  with its own key installed by a purchase uses MCP over real HTTP, the grant survives the
  sale, the buyer serves its next use, the seller can't flip the switch, the buyer turns it off
  and only the agent is refused.

**006b1 corrections (Astra, Nov 5):** the customer can revoke any grant not yet revoked
(including a used-up one that can still read its results); failed reads say access couldn't be
checked (never "None"); revoke counts only a confirmed answer; one create at a time; the page
and the portfolio are bound to the signed-in person (a switch drops the token, list and late
answers); the owner's switch stays visible on errors, keeps keyboard focus while saving and
announces the server's readback; MCP advertises the key bounds the API enforces (8-60).
Evidence: `web/test/agentControls.test.tsx` (6, each failing on the previous pages),
`agent-access.test.ts` (expiry, unconditional foreign use, switch-off before and after
confirmation, key bounds).

**Not done:**
- SSE responses (JSON only, which the transport permits).
- The agent-key installation step in the agent access page (it uses the existing purchase
  install).
- A browser pass of `/agent-access`.
