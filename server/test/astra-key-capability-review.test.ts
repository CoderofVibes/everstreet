// A capability read must not strand the otherwise healthy device-readiness endpoint.
// Real customer route, synthetic contract transport; no wallet or network operations.
import { expect, it } from "vitest";
import { customerWorld } from "./customer-world.ts";

it("an unanswered optional key-capability read preserves bounded key readiness", async () => {
  const w = await customerWorld({ customer: { readTimeoutMs: 20 } });
  const offer = await w.offer();
  const original = w.reader.view.bind(w.reader);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  w.reader.view = async (input) => {
    if (input.method === "get_key_terms") await gate;
    return original(input);
  };
  const pending = w.cara(`/api/customer/offers/${offer}/keys`);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      pending,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), 250);
      }),
    ]);
    expect(
      result,
      "optional capability must time out instead of stranding readiness",
    ).not.toBeNull();
    expect(result?.status).toBe(200);
    expect(result?.body.guarded_revoke).toBe(false);
    expect(result?.body.registered).toBe(true);
    expect(result?.body.keys).toHaveLength(4);
  } finally {
    if (timer) clearTimeout(timer);
    release();
    await pending;
  }
});
