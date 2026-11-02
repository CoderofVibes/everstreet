// Phase 2: real bookings through OpenSeat, the need board, search with constraints, updates,
// following and attribution. OpenSeat runs in process with the test-double authority.

import { describe, expect, it } from "vitest";
import { TestDoubleAuthority } from "../../services/openseat/src/authority.ts";
import { openSeatApp } from "../../services/openseat/src/http.ts";
import { generateKey } from "../../services/openseat/src/keys.ts";
import { OpenSeat } from "../../services/openseat/src/service.ts";
import { PromotionWorker } from "../../services/openseat/src/worker.ts";
import { everstreetApi } from "../src/app.ts";
import { openSeatProvider } from "../src/bookings.ts";
import { interpret } from "../src/community.ts";
import { openDb } from "../src/db.ts";
import { Store } from "../src/store.ts";

// biome-ignore lint/suspicious/noExplicitAny: tests read deep response fields
type Json = Record<string, any>;

function world() {
  const authority = new TestDoubleAuthority("openseat.test", "owner.test");
  const openseat = new OpenSeat({ dbPath: ":memory:", authority });
  const http = openSeatApp(openseat);
  const store = new Store(openDb(":memory:"));
  const app = everstreetApi(store, {
    localPreview: true,
    environment: "test",
    bookingProvider: openSeatProvider((path, init) => Promise.resolve(http.request(path, init))),
  });
  const as =
    (cookie: string) =>
    async (path: string, method = "GET", body?: unknown) => {
      const res = await app.request(path, {
        method,
        headers: { cookie, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      let parsed: Json;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = { text };
      }
      return { status: res.status, body: parsed };
    };
  const join = async (name: string) => {
    const res = await app.request("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    return as((res.headers.get("set-cookie") ?? "").split(";")[0] ?? "");
  };
  // OpenSeat's waitlist worker, authorized by the (test-double) business contract.
  const key = generateKey();
  authority.addKey("worker.test", key.publicKey);
  authority.appoint("worker.test", ["fulfillment"]);
  const worker = new PromotionWorker(
    openseat,
    { accountId: "worker.test", secretKey: key.secretKey },
    1,
  );
  return { app, store, join, anon: as(""), worker, openseat };
}

async function juniper(
  mara: Awaited<ReturnType<ReturnType<typeof world>["join"]>>,
  confirmed = true,
) {
  const p = (
    await mara("/api/projects", "POST", { route: "started", name: "Juniper Print Studio" })
  ).body;
  await mara(`/api/projects/${p.id}/answers`, "PATCH", {
    audience: "Adults new to printmaking",
    outcome: "Make your first three linocut prints",
    deliverable: "A 90-minute session; leave with three prints",
    price: "$35",
    when: "Saturdays",
    where: "14 Alder Lane",
    capacity: "1",
    confirmed,
  });
  await mara(`/api/businesses/${p.business.id}`, "PATCH", { family: "class" });
  await mara(`/api/businesses/${p.business.id}/publish`, "POST");
  return { id: p.business.id as string, slug: p.business.slug as string };
}

const nextWeek = () => new Date(Date.now() + 7 * 864e5).toISOString();

describe("bookings through OpenSeat", () => {
  it("books the last seat, waitlists the next person, and promotes them when a seat frees", async () => {
    const { join, anon, worker } = world();
    const mara = await join("Mara Solis");
    const b = await juniper(mara);
    const opened = await mara(`/api/businesses/${b.id}/sessions`, "POST", {
      starts_at: nextWeek(),
      duration_minutes: 90,
      capacity: 1,
    });
    expect(opened.status).toBe(201);

    const page = (await anon(`/api/public/businesses/${b.slug}`)).body;
    expect(page.sessions[0]).toMatchObject({ seats_left: 1, available: true });
    const sessionId = page.sessions[0].id;

    const sam = await join("Sam Lee");
    const ana = await join("Ana Ruiz");
    const s = (await sam(`/api/public/sessions/${sessionId}/book`, "POST", { source: "link" }))
      .body;
    const a = (await ana(`/api/public/sessions/${sessionId}/book`, "POST", { source: "discovery" }))
      .body;
    expect(s).toMatchObject({ status: "confirmed" });
    expect(a).toMatchObject({ status: "waitlisted", position: 1 });
    expect((await mara(`/api/public/sessions/${sessionId}/book`, "POST")).status).toBe(409);
    expect((await sam(`/api/public/sessions/${sessionId}/book`, "POST")).status).toBe(409);

    // Public pages never carry a booking reference.
    expect(JSON.stringify((await anon(`/api/public/businesses/${b.slug}`)).body)).not.toContain(
      s.reference,
    );

    const roster = (await mara(`/api/businesses/${b.id}/sessions`)).body.sessions[0];
    expect(roster.attendees.map((x: Json) => [x.attendee, x.status])).toEqual([
      ["Sam Lee", "confirmed"],
      ["Ana Ruiz", "waitlisted"],
    ]);
    const tasks = (await mara(`/api/businesses/${b.id}`)).body.tasks.map((t: Json) => t.title);
    expect(tasks.some((t: string) => t.startsWith("New booking: Sam"))).toBe(true);
    expect((await mara(`/api/businesses/${b.id}/extras`)).body.sources.bookings).toEqual({
      link: 1,
      discovery: 1,
    });

    expect((await sam(`/api/activity/bookings/${s.id}/calendar.ics`)).body.text).toContain(
      "BEGIN:VCALENDAR",
    );
    expect((await ana(`/api/activity/bookings/${a.id}/calendar.ics`)).status).toBe(409);
    expect((await ana(`/api/activity/bookings/${s.id}/cancel`, "POST")).status).toBe(404);

    await sam(`/api/activity/bookings/${s.id}/cancel`, "POST");
    await worker.drain();
    const anaNow = (await ana("/api/activity")).body.bookings[0];
    expect(anaNow).toMatchObject({
      status: "confirmed",
      promoted_by: "worker.test",
      promoted_generation: 1,
    });
  });

  it("refuses to open bookings until the details are confirmed", async () => {
    const { join } = world();
    const mara = await join("Mara Solis");
    const b = await juniper(mara, false);
    const res = await mara(`/api/businesses/${b.id}/sessions`, "POST", {
      starts_at: nextWeek(),
      capacity: 4,
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/Confirm you can deliver/);
  });
});

describe("needs, search and following", () => {
  it("reads plain words into constraints", () => {
    expect(interpret("A beginner printmaking class under $40, online")).toEqual({
      words: ["beginner", "printmaking", "class"],
      constraints: { family: "class", max_price_cents: 4000, online: true },
    });
  });

  it("filters on constraints first and says which one blocked a match", async () => {
    const { join, anon } = world();
    await juniper(await join("Mara Solis"));
    const ok = (await anon("/api/public/search?q=printmaking%20class%20under%20%2440&interpret=1"))
      .body;
    expect(ok.matches).toHaveLength(1);
    const tooCheap = (await anon("/api/public/search?q=printmaking%20under%20%2420&interpret=1"))
      .body;
    expect(tooCheap.matches).toHaveLength(0);
    expect(tooCheap.blocked_by).toEqual({ max_price_cents: 1 });
    const relaxed = (
      await anon("/api/public/search?q=printmaking%20under%20%2420&interpret=1&max=none")
    ).body;
    expect(relaxed.matches).toHaveLength(1);
    const online = (await anon("/api/public/search?q=printmaking&online=1")).body;
    expect(online.matches).toHaveLength(0);
    expect(online.blocked_by).toEqual({ online: 1 });
  });

  it("publishes a need without who posted it, and lets a fitting founder answer", async () => {
    const { join, anon } = world();
    const mara = await join("Mara Solis");
    const b = await juniper(mara);
    const sam = await join("Sam Lee");
    await sam("/api/needs", "POST", {
      text: "A printmaking class my teenager could join on a weekend",
      days: 14,
    });
    const board = (await anon("/api/public/needs")).body.needs;
    expect(board).toHaveLength(1);
    expect(JSON.stringify(board)).not.toContain("Sam");

    const fits = (await mara(`/api/businesses/${b.id}/extras`)).body.needs;
    expect(fits[0].matched).toContain("printmaking");
    expect(
      (
        await mara(`/api/needs/${board[0].id}/respond`, "POST", {
          business_id: b.id,
          message: "Teens 14+ welcome on Saturdays.",
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await mara(`/api/needs/${board[0].id}/respond`, "POST", {
          business_id: b.id,
          message: "again",
        })
      ).status,
    ).toBe(409);

    const mine = (await sam("/api/activity")).body.needs[0];
    expect(mine.responses[0]).toMatchObject({
      business_name: "Juniper Print Studio",
      message: "Teens 14+ welcome on Saturdays.",
    });
    await sam(`/api/need-responses/${mine.responses[0].id}/reply`, "POST", {
      text: "Great, we'll book.",
    });
    expect((await mara(`/api/businesses/${b.id}/extras`)).body.need_replies[0].reply).toBe(
      "Great, we'll book.",
    );

    await sam(`/api/needs/${board[0].id}/close`, "POST");
    expect((await anon("/api/public/needs")).body.needs).toHaveLength(0);
  });

  it("respects a need that asked for no replies", async () => {
    const { join, anon } = world();
    const mara = await join("Mara Solis");
    const b = await juniper(mara);
    await (await join("Sam Lee"))("/api/needs", "POST", {
      text: "Just tracking printmaking classes nearby",
      allow_replies: false,
    });
    const need = (await anon("/api/public/needs")).body.needs[0];
    expect(
      (await mara(`/api/needs/${need.id}/respond`, "POST", { business_id: b.id, message: "Hi" }))
        .status,
    ).toBe(409);
  });

  it("lets people follow a business and read its updates in their feed", async () => {
    const { join, anon } = world();
    const mara = await join("Mara Solis");
    const b = await juniper(mara);
    const sam = await join("Sam Lee");
    await sam(`/api/public/businesses/${b.slug}/follow`, "POST", { on: true });
    await mara(`/api/businesses/${b.id}/updates`, "POST", {
      body: "Evening session added after three requests.",
    });
    expect((await sam("/api/activity")).body.feed[0]).toMatchObject({
      business_name: "Juniper Print Studio",
    });
    const page = (await anon(`/api/public/businesses/${b.slug}`)).body;
    expect(page).toMatchObject({ followers: 1, following: false });
    expect(page.updates[0].body).toMatch(/Evening session/);
    const profile = (await anon(`/api/public/people/${page.founder.id}`)).body;
    expect(profile.businesses[0].name).toBe("Juniper Print Studio");
  });
});
