// Where OpenSeat learns who may operate the business. The service never trusts its own memory
// of the owner: every operator command is checked against the business contract at that moment.

export interface OperatorCheck {
  authorized: boolean;
  owner: string;
  generation: number;
  reason: string;
}

export interface Authority {
  /** Shown wherever a result depends on it: "testnet", "sandbox" or "test-double". */
  readonly mode: string;
  readonly business: string;
  /** Does `publicKey` belong to `accountId` and may it speak for this business? */
  keyBelongs(accountId: string, publicKey: string): Promise<boolean>;
  operatorCheck(accountId: string, capability: string): Promise<OperatorCheck>;
}

interface RpcError {
  message?: string;
  data?: unknown;
  cause?: { name?: string };
}

/** Reads the business contract and account keys over NEAR JSON-RPC at final finality. */
export class NearRpcAuthority implements Authority {
  constructor(
    readonly mode: "testnet" | "sandbox",
    readonly business: string,
    private readonly rpcUrl: string,
  ) {}

  private async query(params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await fetch(this.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "openseat",
        method: "query",
        params: { finality: "final", ...params },
      }),
    });
    const body = (await response.json()) as { result?: Record<string, unknown>; error?: RpcError };
    if (body.error) {
      const error = new Error(`RPC: ${body.error.cause?.name ?? body.error.message ?? "error"}`);
      (error as Error & { rpcCause?: string }).rpcCause = body.error.cause?.name;
      throw error;
    }
    const result = body.result ?? {};
    // Some RPC versions report a missing key inside a successful response.
    if (typeof result.error === "string") throw new Error(`RPC: ${result.error}`);
    return result;
  }

  async keyBelongs(accountId: string, publicKey: string): Promise<boolean> {
    try {
      const key = await this.query({
        request_type: "view_access_key",
        account_id: accountId,
        public_key: publicKey,
      });
      const permission = key.permission as "FullAccess" | { FunctionCall: { receiver_id: string } };
      // A full-access key speaks for the account; a function-call key only when it is scoped
      // to this business contract.
      return (
        permission === "FullAccess" ||
        (typeof permission === "object" && permission.FunctionCall.receiver_id === this.business)
      );
    } catch (error) {
      if (String(error).includes("UNKNOWN_ACCESS_KEY") || String(error).includes("UNKNOWN_ACCOUNT"))
        return false;
      if (String(error).includes("does not exist")) return false;
      throw error;
    }
  }

  async operatorCheck(accountId: string, capability: string): Promise<OperatorCheck> {
    return this.view<OperatorCheck>("operator_check", { account_id: accountId, capability });
  }

  async view<T>(method: string, args: Record<string, unknown>): Promise<T> {
    const result = await this.query({
      request_type: "call_function",
      account_id: this.business,
      method_name: method,
      args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
    });
    return JSON.parse(Buffer.from(result.result as number[]).toString("utf8")) as T;
  }
}

/** In-memory stand-in with the contract's rules, for service unit tests only. */
export class TestDoubleAuthority implements Authority {
  readonly mode = "test-double";
  owner: string;
  generation = 1;
  grants = new Map<string, { capabilities: string[]; generation: number }>();
  keys = new Map<string, Set<string>>();

  constructor(
    readonly business: string,
    owner: string,
  ) {
    this.owner = owner;
  }

  addKey(accountId: string, publicKey: string) {
    const set = this.keys.get(accountId) ?? new Set<string>();
    set.add(publicKey);
    this.keys.set(accountId, set);
  }

  appoint(accountId: string, capabilities: string[]) {
    this.grants.set(accountId, { capabilities, generation: this.generation });
  }

  sell(to: string) {
    this.owner = to;
    this.generation += 1;
    this.grants.clear();
  }

  async keyBelongs(accountId: string, publicKey: string) {
    return this.keys.get(accountId)?.has(publicKey) ?? false;
  }

  async operatorCheck(accountId: string, capability: string): Promise<OperatorCheck> {
    const base = { owner: this.owner, generation: this.generation };
    if (accountId === this.owner) return { ...base, authorized: true, reason: "owner" };
    const grant = this.grants.get(accountId);
    if (!grant) return { ...base, authorized: false, reason: "not an operator" };
    if (grant.generation !== this.generation)
      return { ...base, authorized: false, reason: `grant is from generation ${grant.generation}` };
    if (!grant.capabilities.includes(capability))
      return { ...base, authorized: false, reason: `not granted ${capability}` };
    return { ...base, authorized: true, reason: `operator with ${capability}` };
  }
}
