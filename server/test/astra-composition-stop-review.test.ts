// Actual composition/HTTP routes, in-memory preview only. No wallet, provider or network.
import { expect, it, vi } from "vitest";
import { validateConfig } from "../src/appConfig.ts";
import { composeApplication } from "../src/compose.ts";

const make = () =>
  composeApplication(
    validateConfig({
      config_version: 1,
      mode: "preview",
      network: "testnet",
      listen: { host: "127.0.0.1", port: 8800 },
      database: ":memory:",
    }),
  );

it("a stopped composition refuses new HTTP admission before touching closed services", async () => {
  const c = make();
  c.start();
  expect((await c.app.request("/api/env")).status).toBe(200);
  await c.stop();
  expect((await c.app.request("/api/env")).status).toBe(503);
  await c.stop();
});

it("a previously admitted request body cannot resume into closed storage", async () => {
  const c = make();
  c.start();
  let entered!: () => void;
  const reading = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const stream = new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        entered();
        await gate;
        controller.enqueue(
          new TextEncoder().encode(JSON.stringify({ name: "Synthetic Stop Test" })),
        );
        controller.close();
      },
    },
    { highWaterMark: 0 },
  );
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  const init: RequestInit & { duplex: "half" } = {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: stream,
    duplex: "half",
  };
  const pending = c.app.request(new Request("http://localhost/api/session", init));
  let responseTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    await reading;
    await c.stop();
    // The caller must finish even if its upload never resumes. Releasing it first would hide
    // a shutdown that closes storage but leaves an admitted request outstanding indefinitely.
    const stoppedResponse = await Promise.race([
      pending,
      new Promise<null>((resolve) => {
        responseTimer = setTimeout(() => resolve(null), 250);
      }),
    ]);
    expect(
      stoppedResponse,
      "stop must finish or abort an admitted request without its body",
    ).not.toBeNull();
    expect(stoppedResponse?.status).toBe(503);
    release();
    const response = await pending;
    expect(response.status).toBe(503);
    expect(errors).not.toHaveBeenCalled();
  } finally {
    if (responseTimer) clearTimeout(responseTimer);
    release();
    await pending;
    await c.stop();
    errors.mockRestore();
  }
}, 15_000);
