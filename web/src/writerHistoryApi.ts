// Job 003wf slice 3 (docs/design/WRITER_HISTORY.md): the operators' writer-history calls.

export interface WriterAttempt {
  attempt: number;
  method: string;
  receiver: string;
  signer: string;
  public_key: string;
  nonce: string;
  block_height: string;
  tx_hash: string;
  sends_claimed: number;
  history: "counted" | "uncounted";
  state: "signed" | "success" | "failure" | "invalid";
  code: string | null;
  reconcile: "legacy_invalid" | null;
  unresolved: boolean;
  reasons: { key: string; text: string }[];
  created_at: string;
  updated_at: string;
  checks: {
    id: string;
    checked_by_account: string;
    observed: string;
    observed_code: string | null;
    recorded: number;
    state_before: string;
    state_after: string;
    checked_at: string;
  }[];
}

export interface WriterOperation {
  table: "chain_tx_attempts" | "closer_tx_attempts";
  operation: string;
  subject: Record<string, unknown> & { kind: string; note: string };
  newest_state: string | null;
  unresolved_behind_terminal: number;
  attempts: WriterAttempt[];
}

export interface WriterHistoryList {
  operations: WriterOperation[];
  truncated: boolean;
  validity_blocks: string;
  policy: string;
}

export interface WriterCheck {
  observed: "success" | "failure" | "not_found" | "pending" | "read_failed" | "unsupported";
  recorded: boolean;
  attempt: { operation: string; attempt: number; tx_hash: string; state: string };
  explanation: string;
}

async function call<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok)
    throw Object.assign(new Error(data.error ?? `Request failed (${res.status})`), {
      status: res.status,
    });
  return data as T;
}

export const writerHistoryApi = {
  list: () => call<WriterHistoryList>("/api/operator/writer-history"),
  check: (table: string, operation: string, attempt: number) =>
    call<WriterCheck>("/api/operator/writer-history/check", "POST", { table, operation, attempt }),
};
