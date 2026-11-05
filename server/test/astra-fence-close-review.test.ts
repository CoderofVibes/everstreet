// A stopped composition must release its own waiters even when a raw adapter ignores abort.
import { expect, it } from "vitest";
import { Fence, StoppedError } from "../src/fence.ts";

it("close rejects an outstanding fenced call without waiting for the raw adapter", async () => {
  const fence = new Fence();
  let release!: (value: string) => void;
  const raw = new Promise<string>((resolve) => {
    release = resolve;
  });
  const pending = fence
    .pass(() => raw)
    .then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    fence.close();
    const outcome = await Promise.race([
      pending,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), 100);
      }),
    ]);
    expect(outcome, "the fence owns and must finish its waiter at close").not.toBeNull();
    expect(outcome).toEqual({ error: expect.any(StoppedError) });
    release("late result");
    expect(await pending).toEqual({ error: expect.any(StoppedError) });
  } finally {
    if (timer) clearTimeout(timer);
    release("cleanup");
    await pending;
  }
});
