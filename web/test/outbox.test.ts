// Job 002b1: the assistant's outbox. Astra's browser reproduction: send A, type B while A is
// still sending, A returns, B vanished. These tests drive the state rules the panel renders
// from; the composer text is a separate value the outbox never writes.

import { describe, expect, it } from "vitest";
import { classify, type Outbox, retry, settle, start, takeBack } from "../src/outbox.ts";

describe("assistant outbox", () => {
  it("keeps what the founder typed while a message was sending", () => {
    let composer = "Turn invoices into clean data";
    const out = start(null, composer, "msg-a") as Outbox;
    composer = ""; // the composer is cleared for the next thought at send time
    composer = "Also return the invoice date"; // typed while A is sending
    expect(settle(out, { kind: "accepted" })).toBeNull();
    // Nothing in settling A touches the composer.
    expect(composer).toBe("Also return the invoice date");
  });

  it("refuses to start a second send while one is in flight or unresolved", () => {
    const out = start(null, "A", "msg-a") as Outbox;
    expect(start(out, "B", "msg-b")).toBeNull(); // a fast second click
    const unknown = settle(out, { kind: "unknown", reason: "x" }) as Outbox;
    expect(start(unknown, "B", "msg-b")).toBeNull();
    expect(start(null, "   ", "msg-c")).toBeNull();
  });

  it("retries an uncertain send with the same text and key, never different text", () => {
    const out = start(null, "Shape it", "msg-a") as Outbox;
    const unknown = settle(out, classify(new TypeError("Failed to fetch"))) as Outbox;
    expect(unknown).toMatchObject({ state: "unknown", text: "Shape it", key: "msg-a" });
    expect(unknown.reason).toMatch(/may or may not have been sent/);
    expect(retry(unknown)).toMatchObject({ state: "sending", text: "Shape it", key: "msg-a" });
    expect(retry(out)).toBeNull(); // nothing to retry while sending
  });

  it("treats a server refusal as definite and gives the text back only to an empty box", () => {
    const out = start(null, "Shape it", "msg-a") as Outbox;
    const refused = settle(
      out,
      classify(Object.assign(new Error("Set an AI budget"), { status: 409 })),
    ) as Outbox;
    expect(refused).toMatchObject({ state: "refused", reason: "Set an AI budget" });
    expect(retry(refused)).toBeNull(); // a refusal is not retried under the same key
    expect(takeBack(refused, "")).toBe("Shape it");
    expect(takeBack(refused, "Something new")).toBeNull();
  });

  it("classifies server errors without an answer as unknown", () => {
    expect(classify(Object.assign(new Error("x"), { status: 500 })).kind).toBe("unknown");
    expect(classify(Object.assign(new Error("x"), { status: 404 })).kind).toBe("refused");
    expect(classify(null).kind).toBe("unknown");
  });
});
