// Job 003p: the browser hides evidence the moment the person or room changes, ignores late
// answers, and clears on any refusal or failed check.

import { describe, expect, it } from "vitest";
import { begin, type EvidenceView, initial, settle } from "../src/evidenceView.ts";

type Room = { name: string };
const ok = (name: string) => ({ ok: true as const, data: { name } });
const no = (status: number, message = "The seller ended this access") => ({
  ok: false as const,
  status,
  message,
});

function shown(actor: string, room: string, name: string): EvidenceView<Room> {
  const v = begin(initial<Room>(actor, room), actor, room);
  return settle(v, v.load, actor, room, ok(name));
}

describe("evidence in the browser", () => {
  it("switching person hides the previous person's room at once", () => {
    const ana = shown("ana", "r1", "Ana's room");
    const ben = begin(ana, "ben", "r1");
    expect(ben).toMatchObject({ state: "checking", data: null, actor: "ben" });
  });

  it("a delayed answer for the previous person never repopulates the room", () => {
    const loading = begin(initial<Room>("ana", "r1"), "ana", "r1");
    const switched = begin(loading, "ben", "r1");
    // Ana's slow response arrives after the switch.
    const late = settle(switched, loading.load, "ana", "r1", ok("Ana's room"));
    expect(late).toBe(switched);
    expect(late.data).toBeNull();
  });

  it("an older load's answer is ignored even for the same person", () => {
    const first = begin(initial<Room>("ana", "r1"), "ana", "r1");
    const second = begin(first, "ana", "r1");
    const stale = settle(second, first.load, "ana", "r1", ok("old"));
    expect(stale).toBe(second);
    const fresh = settle(second, second.load, "ana", "r1", ok("new"));
    expect(fresh.data).toEqual({ name: "new" });
  });

  it("returning to the tab keeps the room visible while access is rechecked, and clears on 403", () => {
    const room = shown("ana", "r1", "Ana's room");
    const recheck = begin(room, "ana", "r1");
    expect(recheck.data).toEqual({ name: "Ana's room" });
    const ended = settle(recheck, recheck.load, "ana", "r1", no(403));
    expect(ended).toMatchObject({ state: "refused", data: null });
    expect(ended.message).toMatch(/ended this access/);
  });

  it("a network error hides the room instead of keeping what was shown", () => {
    const room = shown("ana", "r1", "Ana's room");
    const recheck = begin(room, "ana", "r1");
    const failed = settle(recheck, recheck.load, "ana", "r1", no(0, "Failed to fetch"));
    expect(failed).toMatchObject({ state: "unchecked", data: null });
  });

  it("another room never shows the previous room's evidence", () => {
    const room = shown("ana", "r1", "Room one");
    expect(begin(room, "ana", "r2").data).toBeNull();
  });
});
