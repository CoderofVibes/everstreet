// Job 006b (M6 extension): an external agent uses an Everstreet product through the SAME customer
// path a person uses (admission, holds signed by the use key, execution, settlement, retention).
// Design: docs/design/AGENT_ACCESS.md.
//
// - A customer grants an agent narrow authority: one offer, one installed use-key slot (the
//   AGENT's own key, installed on the contract with its own limits; the server never holds it),
//   a maximum number of uses and an expiry. The grant's bearer token is shown once and stored
//   only as a SHA-256 hash. Revocation and expiry refuse before anything is prepared or run.
// - The agent can't raise limits, change retention, act as the owner, or reach another offer,
//   customer or business. Discovery (the capability description) needs no grant and shows no
//   secret.
// - MCP, revision 2026-07-28 (modern only), Streamable HTTP at POST /api/agent/mcp: per-request
//   `_meta` protocol version and client capabilities; MCP-Protocol-Version / Mcp-Method /
//   Mcp-Name headers must match the body (-32020); unsupported versions get -32022 with the
//   supported list; server/discover, tools/list, tools/call; GET and DELETE answer 405.
//   Checked against https://modelcontextprotocol.io/specification/2026-07-28 (Nov 5 2026).

import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { CustomerUses } from "./customerUse.ts";
import type { Db } from "./db.ts";
import { HttpError, type Person, type Store } from "./store.ts";

export const MCP_VERSION = "2026-07-28";
const TOKEN_PREFIX = "evs_agent_";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");

export const AGENT_SCHEMA = `
CREATE TABLE IF NOT EXISTS agent_grants (
  id TEXT PRIMARY KEY, person_id TEXT NOT NULL REFERENCES people(id),
  offer_id TEXT NOT NULL REFERENCES customer_offers(id), key_slot INTEGER NOT NULL,
  label TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, max_uses INTEGER NOT NULL,
  expires_at TEXT NOT NULL, revoked_at TEXT, created_at TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS agent_grant_uses (
  grant_id TEXT NOT NULL REFERENCES agent_grants(id), use_id TEXT NOT NULL UNIQUE,
  idempotency_key TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (grant_id, idempotency_key)
) STRICT;
CREATE TABLE IF NOT EXISTS agent_offer_switch (
  offer_id TEXT PRIMARY KEY REFERENCES customer_offers(id),
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)), changed_by TEXT NOT NULL, changed_at TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS agent_offer_switch_history (
  n INTEGER PRIMARY KEY AUTOINCREMENT, offer_id TEXT NOT NULL REFERENCES customer_offers(id),
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)), changed_by TEXT NOT NULL, changed_at TEXT NOT NULL
) STRICT;
CREATE TRIGGER IF NOT EXISTS agent_offer_switch_history_no_update
  BEFORE UPDATE ON agent_offer_switch_history BEGIN SELECT RAISE(ABORT, 'append-only'); END;
CREATE TRIGGER IF NOT EXISTS agent_offer_switch_history_no_delete
  BEFORE DELETE ON agent_offer_switch_history BEGIN SELECT RAISE(ABORT, 'append-only'); END;
`;

interface GrantRow {
  id: string;
  person_id: string;
  offer_id: string;
  key_slot: number;
  label: string;
  max_uses: number;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
}

export class AgentAccess {
  constructor(
    private readonly db: Db,
    private readonly store: Store,
    private readonly uses: () => CustomerUses,
    private readonly origin: string | null = null,
  ) {
    db.exec(AGENT_SCHEMA);
  }

  // ---------- the owner's switch (hardening, Nov 5): off until the business turns it on ----------

  /** Whether the business lets agents use this offer. Off unless its owner turned it on. */
  agentsAllowed(offerId: string) {
    const r = this.db
      .prepare("SELECT enabled FROM agent_offer_switch WHERE offer_id = ?")
      .get(offerId) as { enabled: number } | undefined;
    return r?.enabled === 1;
  }

  /** The owner's per-offer switches (the business's offers only). */
  ownerSwitches(viewer: Person, businessId: string) {
    this.store.ownedBusiness(viewer, businessId);
    const rows = this.db
      .prepare(
        `SELECT o.id, o.state, COALESCE(s.enabled, 0) AS enabled, s.changed_at,
                (SELECT COUNT(*) FROM agent_grants g WHERE g.offer_id = o.id AND g.revoked_at IS NULL) AS grants
           FROM customer_offers o LEFT JOIN agent_offer_switch s ON s.offer_id = o.id
          WHERE o.business_id = ? ORDER BY o.created_at, o.id LIMIT 200`,
      )
      .all(businessId) as {
      id: string;
      state: string;
      enabled: number;
      changed_at: string | null;
      grants: number;
    }[];
    return {
      offers: rows.map((r) => ({
        offer_id: r.id,
        offer_state: r.state,
        agents: r.enabled === 1 ? "on" : "off",
        changed_at: r.changed_at,
        active_grants: r.grants,
      })),
    };
  }

  /**
   * The owner turns agent use of one offer on or off. Off refuses new agent grants and every new
   * agent preparation before anything is prepared; a use already reserved still finishes (its
   * unit is held for it). Fenced like the owner's other writes; refused during a handover.
   */
  setSwitch(viewer: Person, businessId: string, offerId: string, input: Record<string, unknown>) {
    if (typeof input.enabled !== "boolean")
      throw new HttpError(400, "Say whether agents may use this offer (enabled: true or false)");
    const enabled = input.enabled ? 1 : 0;
    const epoch = this.store.controlEpoch(viewer, businessId);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.store.stillControls(viewer, epoch);
      this.store.requireNoHandover(businessId);
      const o = this.db
        .prepare("SELECT business_id FROM customer_offers WHERE id = ?")
        .get(offerId) as { business_id: string } | undefined;
      if (o?.business_id !== businessId) throw new HttpError(404, "No such offer");
      const now = new Date().toISOString();
      if (this.agentsAllowed(offerId) !== (enabled === 1)) {
        this.db
          .prepare(
            "INSERT INTO agent_offer_switch (offer_id, enabled, changed_by, changed_at) VALUES (?, ?, ?, ?) ON CONFLICT (offer_id) DO UPDATE SET enabled = excluded.enabled, changed_by = excluded.changed_by, changed_at = excluded.changed_at",
          )
          .run(offerId, enabled, viewer.id, now);
        this.db
          .prepare(
            "INSERT INTO agent_offer_switch_history (offer_id, enabled, changed_by, changed_at) VALUES (?, ?, ?, ?)",
          )
          .run(offerId, enabled, viewer.id, now);
      }
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
    return { offer_id: offerId, agents: enabled ? "on" : "off" };
  }

  private requireAgentsAllowed(offerId: string) {
    if (!this.agentsAllowed(offerId))
      throw new HttpError(
        403,
        "The business hasn't turned on agent use for this offer",
        "agent_access_off",
      );
  }

  // ---------- the customer's grants ----------

  createGrant(viewer: Person, input: Record<string, unknown>) {
    const offerId = String(input.offer_id ?? "");
    const offer = this.db
      .prepare("SELECT id, state FROM customer_offers WHERE id = ?")
      .get(offerId) as { id: string; state: string } | undefined;
    if (offer?.state !== "active") throw new HttpError(404, "No such active offer");
    this.requireAgentsAllowed(offerId);
    const slot = Number(input.key_slot);
    if (!Number.isInteger(slot) || slot < 0 || slot > 3)
      throw new HttpError(400, "Choose the key slot installed for the agent (0 to 3)");
    const maxUses = Number(input.max_uses);
    if (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 1000)
      throw new HttpError(400, "Allow 1 to 1000 uses");
    const days = Number(input.expires_in_days ?? 30);
    if (!Number.isInteger(days) || days < 1 || days > 90)
      throw new HttpError(400, "Expire it in 1 to 90 days");
    const label = typeof input.label === "string" ? input.label.trim().slice(0, 80) : "";
    if (!label) throw new HttpError(400, "Name the agent");
    const token = `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
    const id = randomUUID();
    const now = new Date();
    this.db
      .prepare(
        "INSERT INTO agent_grants (id, person_id, offer_id, key_slot, label, token_hash, max_uses, expires_at, revoked_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)",
      )
      .run(
        id,
        viewer.id,
        offerId,
        slot,
        label,
        hash(token),
        maxUses,
        new Date(now.getTime() + days * 86_400_000).toISOString(),
        now.toISOString(),
      );
    return {
      grant: this.view(this.row(id) as GrantRow),
      token,
      token_note:
        "Shown once. Give it only to your agent; Everstreet keeps only a fingerprint of it. Revoke it any time.",
    };
  }

  listGrants(viewer: Person) {
    return {
      grants: (
        this.db
          .prepare("SELECT * FROM agent_grants WHERE person_id = ? ORDER BY created_at DESC")
          .all(viewer.id) as unknown as GrantRow[]
      ).map((g) => this.view(g)),
    };
  }

  revoke(viewer: Person, id: string) {
    const g = this.row(id);
    if (!g || g.person_id !== viewer.id) throw new HttpError(404, "No such agent access");
    this.db
      .prepare("UPDATE agent_grants SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ?")
      .run(new Date().toISOString(), id);
    return this.view(this.row(id) as GrantRow);
  }

  private row(id: string) {
    return this.db.prepare("SELECT * FROM agent_grants WHERE id = ?").get(id) as
      | GrantRow
      | undefined;
  }

  private used(id: string) {
    return (
      this.db.prepare("SELECT COUNT(*) AS n FROM agent_grant_uses WHERE grant_id = ?").get(id) as {
        n: number;
      }
    ).n;
  }

  private view(g: GrantRow) {
    const used = this.used(g.id);
    const state = g.revoked_at
      ? "revoked"
      : Date.parse(g.expires_at) <= Date.now()
        ? "expired"
        : used >= g.max_uses
          ? "used_up"
          : "active";
    return {
      id: g.id,
      label: g.label,
      offer_id: g.offer_id,
      key_slot: g.key_slot,
      max_uses: g.max_uses,
      used,
      expires_at: g.expires_at,
      revoked_at: g.revoked_at,
      state,
      created_at: g.created_at,
    };
  }

  // ---------- the agent's side ----------

  /** The grant behind a bearer token, refused unless active. Never says which part was wrong. */
  authorize(authorization: string | undefined) {
    const m = /^Bearer (evs_agent_[A-Za-z0-9_-]{20,80})$/.exec(authorization ?? "");
    const g = m
      ? (this.db
          .prepare("SELECT * FROM agent_grants WHERE token_hash = ?")
          .get(hash(m[1] as string)) as GrantRow | undefined)
      : undefined;
    if (!g) throw new HttpError(401, "Agent access isn't valid", "agent_unauthorized");
    if (g.revoked_at) throw new HttpError(403, "This agent access was revoked", "agent_revoked");
    if (Date.parse(g.expires_at) <= Date.now())
      throw new HttpError(403, "This agent access expired", "agent_expired");
    return { grant: g, person: this.store.person(g.person_id) };
  }

  private ownUse(grantId: string, useId: string) {
    const r = this.db
      .prepare("SELECT use_id FROM agent_grant_uses WHERE grant_id = ? AND use_id = ?")
      .get(grantId, useId);
    if (!r) throw new HttpError(404, "No such use for this agent access");
  }

  /** The capability description: public facts of an active offer; no secret, no grant needed. */
  describe(offerId: string) {
    const o = this.uses().publicOffer(offerId) as Record<string, unknown>;
    return {
      offer: o,
      agent_use: this.agentsAllowed(offerId) ? "on" : "off",
      purpose:
        "Extract the fields this product declares from one pasted document, as structured data.",
      input: {
        type: "text",
        note: "One document's text; at most the product's stated character limit.",
      },
      authorization:
        "A customer of this offer grants an agent access: a token for one offer and one installed key slot, with a use limit and expiry. The agent signs each hold and use with its own installed key.",
      protocols: {
        http: "/api/agent/v1",
        mcp: { endpoint: "/api/agent/mcp", version: MCP_VERSION },
      },
    };
  }

  async prepare(auth: ReturnType<AgentAccess["authorize"]>, input: Record<string, unknown>) {
    const key = typeof input.idempotency_key === "string" ? input.idempotency_key : "";
    if (!/^[A-Za-z0-9_-]{8,60}$/.test(key))
      throw new HttpError(
        400,
        "idempotency_key must be 8 to 60 letters, digits, dashes or underscores",
      );
    const prior = this.db
      .prepare("SELECT use_id FROM agent_grant_uses WHERE grant_id = ? AND idempotency_key = ?")
      .get(auth.grant.id, key) as { use_id: string } | undefined;
    if (!prior) this.requireAgentsAllowed(auth.grant.offer_id);
    if (!prior && this.used(auth.grant.id) >= auth.grant.max_uses)
      throw new HttpError(403, "This agent access has used all its allowed uses", "agent_used_up");
    // The same customer path, scoped to the grant's offer and key slot; the key is namespaced
    // per grant so an agent's retry can't collide with the customer's own requests.
    const r = await this.uses().prepare(auth.person, auth.grant.offer_id, {
      idempotency_key: `agent-${auth.grant.id.slice(0, 8)}-${key}`,
      input: input.input,
      key_slot: auth.grant.key_slot,
    });
    const useId = (r as { use: { id: string } }).use.id;
    this.db
      .prepare(
        "INSERT OR IGNORE INTO agent_grant_uses (grant_id, use_id, idempotency_key, created_at) VALUES (?, ?, ?, ?)",
      )
      .run(auth.grant.id, useId, key, new Date().toISOString());
    return r;
  }

  async confirm(
    auth: ReturnType<AgentAccess["authorize"]>,
    useId: string,
    input: Record<string, unknown>,
  ) {
    this.ownUse(auth.grant.id, useId);
    return this.uses().confirm(auth.person, useId, input);
  }
  async execute(auth: ReturnType<AgentAccess["authorize"]>, useId: string) {
    this.ownUse(auth.grant.id, useId);
    return this.uses().execute(auth.person, useId, {});
  }
  status(auth: ReturnType<AgentAccess["authorize"]>, useId: string) {
    this.ownUse(auth.grant.id, useId);
    return this.uses().status(auth.person, useId);
  }
  async result(auth: ReturnType<AgentAccess["authorize"]>, useId: string) {
    this.ownUse(auth.grant.id, useId);
    return this.uses().result(auth.person, useId);
  }

  // ---------- MCP 2026-07-28, Streamable HTTP ----------

  private static TOOLS = [
    {
      name: "describe_offer",
      title: "Describe an offer",
      description:
        "Public facts of an Everstreet offer: product, fields, price per use, availability. No access needed.",
      inputSchema: {
        type: "object",
        properties: { offer_id: { type: "string" } },
        required: ["offer_id"],
        additionalProperties: false,
      },
    },
    {
      name: "prepare_use",
      title: "Prepare one use",
      description:
        "Prepares one use of the granted offer. Returns the use id and the hold and use messages your installed key must sign. Nothing runs or is charged yet. Retry with the same idempotency_key after a lost answer.",
      inputSchema: {
        type: "object",
        properties: {
          idempotency_key: { type: "string", minLength: 8, maxLength: 80 },
          input: { type: "string" },
        },
        required: ["idempotency_key", "input"],
        additionalProperties: false,
      },
    },
    {
      name: "confirm_use",
      title: "Confirm a prepared use with your signatures",
      description:
        "Sends your key's signatures over the prepared hold and use; the contract then reserves one unit.",
      inputSchema: {
        type: "object",
        properties: {
          use_id: { type: "string" },
          envelope_digest: { type: "string" },
          hold_signature: { type: "string" },
          use_signature: { type: "string" },
        },
        required: ["use_id", "envelope_digest", "hold_signature", "use_signature"],
        additionalProperties: false,
      },
    },
    {
      name: "run_use",
      title: "Run a reserved use",
      description:
        "Runs the reserved use. A delivered result is charged once; a refused or failed one isn't.",
      inputSchema: {
        type: "object",
        properties: { use_id: { type: "string" } },
        required: ["use_id"],
        additionalProperties: false,
      },
    },
    {
      name: "get_use",
      title: "Read a use and its result",
      description: "The use's state and, when delivered, its result.",
      inputSchema: {
        type: "object",
        properties: { use_id: { type: "string" } },
        required: ["use_id"],
        additionalProperties: false,
      },
    },
  ];

  async mcp(req: {
    method: string;
    headers: Headers;
    body: string;
  }): Promise<{ status: number; body: unknown | null }> {
    const err = (status: number, id: unknown, code: number, message: string, data?: unknown) => ({
      status,
      body: {
        jsonrpc: "2.0",
        ...(id === undefined ? {} : { id }),
        error: { code, message, ...(data === undefined ? {} : { data }) },
      },
    });
    if (req.method !== "POST") return { status: 405, body: null };
    const origin = req.headers.get("origin");
    if (origin && this.origin && origin !== this.origin)
      return err(403, undefined, -32600, "Origin not allowed");
    let m: {
      jsonrpc?: string;
      id?: string | number | null;
      method?: string;
      params?: Record<string, unknown>;
    };
    try {
      m = JSON.parse(req.body);
    } catch {
      return err(400, null, -32700, "Parse error");
    }
    if (m?.jsonrpc !== "2.0" || typeof m.method !== "string")
      return err(400, m?.id ?? null, -32600, "Invalid Request");
    const isNotification = !("id" in m);
    if (m.method === "initialize")
      return err(
        400,
        m.id,
        -32022,
        `Unsupported protocol version: this server speaks ${MCP_VERSION} only (no initialize handshake).`,
        {
          supported: [MCP_VERSION],
          requested:
            (m.params as { protocolVersion?: string } | undefined)?.protocolVersion ?? null,
        },
      );
    if (isNotification) return { status: 202, body: null };
    if (m.id === null || (typeof m.id !== "string" && typeof m.id !== "number"))
      return err(400, null, -32600, "Invalid Request: id");
    const meta = (m.params?._meta ?? {}) as Record<string, unknown>;
    const version = meta["io.modelcontextprotocol/protocolVersion"];
    const caps = meta["io.modelcontextprotocol/clientCapabilities"];
    const hv = req.headers.get("mcp-protocol-version");
    const hm = req.headers.get("mcp-method");
    if (!hv || !hm)
      return err(
        400,
        m.id,
        -32020,
        "Header mismatch: MCP-Protocol-Version and Mcp-Method are required",
      );
    if (typeof version !== "string" || typeof caps !== "object" || caps === null)
      return err(
        400,
        m.id,
        -32602,
        "Invalid params: _meta must carry io.modelcontextprotocol/protocolVersion and clientCapabilities",
      );
    if (hv !== version)
      return err(
        400,
        m.id,
        -32020,
        `Header mismatch: MCP-Protocol-Version '${hv}' does not match body '${version}'`,
      );
    if (hm !== m.method)
      return err(
        400,
        m.id,
        -32020,
        `Header mismatch: Mcp-Method '${hm}' does not match body '${m.method}'`,
      );
    if (version !== MCP_VERSION)
      return err(400, m.id, -32022, "Unsupported protocol version", {
        supported: [MCP_VERSION],
        requested: version,
      });
    const ok = (result: Record<string, unknown>) => ({
      status: 200,
      body: {
        jsonrpc: "2.0",
        id: m.id,
        result: {
          resultType: "complete",
          ...result,
          _meta: {
            "io.modelcontextprotocol/serverInfo": { name: "everstreet-agent-access", version: "1" },
          },
        },
      },
    });
    if (m.method === "server/discover")
      return ok({
        supportedVersions: [MCP_VERSION],
        capabilities: { tools: {} },
        instructions:
          "Use an Everstreet product for a customer who granted you access. describe_offer needs no access; the other tools need the customer's Bearer token. Sign each prepared hold and use with your own installed key.",
      });
    if (m.method === "tools/list") return ok({ tools: AgentAccess.TOOLS });
    if (m.method !== "tools/call") return err(404, m.id, -32601, "Method not found");
    const name = (m.params as { name?: unknown }).name;
    const hn = req.headers.get("mcp-name");
    if (typeof name !== "string" || !AgentAccess.TOOLS.some((t) => t.name === name))
      return err(200, m.id, -32602, `Unknown tool: ${String(name)}`);
    if (hn !== name)
      return err(
        400,
        m.id,
        -32020,
        `Header mismatch: Mcp-Name '${hn}' does not match body '${name}'`,
      );
    const args = ((m.params as { arguments?: unknown }).arguments ?? {}) as Record<string, unknown>;
    const toolResult = (data: unknown, isError = false) =>
      ok({
        content: [{ type: "text", text: JSON.stringify(data) }],
        structuredContent: data,
        isError,
      });
    try {
      if (name === "describe_offer") return toolResult(this.describe(String(args.offer_id ?? "")));
      const auth = this.authorize(req.headers.get("authorization") ?? undefined);
      if (name === "prepare_use") return toolResult(await this.prepare(auth, args));
      const useId = String(args.use_id ?? "");
      if (name === "confirm_use")
        return toolResult(
          await this.confirm(auth, useId, {
            envelope_digest: args.envelope_digest,
            hold_signature: args.hold_signature,
            use_signature: args.use_signature,
          }),
        );
      if (name === "run_use") return toolResult(await this.execute(auth, useId));
      const st = this.status(auth, useId) as { use?: { execution?: { result?: string } } };
      const result =
        st.use?.execution?.result === "available" ? await this.result(auth, useId) : null;
      return toolResult({ ...st, result });
    } catch (e) {
      // Tool execution errors are results the model can act on (MCP §Tools, error handling).
      const h = e as HttpError & { code?: string };
      return toolResult(
        {
          error: h.message,
          code: h.code ?? null,
          status: (h as { status?: number }).status ?? 500,
        },
        true,
      );
    }
  }
}
