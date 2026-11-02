// OpenSeat against the in-memory authority double (same rules as the contract's
// operator_check). The real contract is exercised by scripts/handoff.ts on sandbox and testnet.

import { describe, expect, it } from "vitest";
import { TestDoubleAuthority } from "../src/authority.ts";
import { type OperatorIdentity, signCommand } from "../src/command.ts";
import { JUNIPER_CLASS, seedJuniper } from "../src/fixture.ts";
import { openSeatApp } from "../src/http.ts";
import { generateKey } from "../src/keys.ts";
import { OpenSeat } from "../src/service.ts";
import { PromotionWorker } from "../src/worker.ts";

const BUSINESS = "openseat.business.test";

function identity(accountId: string, authority: TestDoubleAuthority): OperatorIdentity {
  const key = generateKey();
  authority.addKey(accountId, key.publicKey);
  return { accountId, secretKey: key.secretKey };
}

function world() {
  const authority = new TestDoubleAuthority(BUSINESS, "founder.test");
  const service = new OpenSeat({ dbPath: ":memory:", authority });
  const founder = identity("founder.test", authority);
  const buyer = identity("northline.test", authority);
  const workerA = identity("worker-a.test", authority);
  const workerB = identity("worker-b.test", authority);
  authority.appoint(workerA.accountId, ["fulfillment"]);
  const { maya, sam } = seedJuniper(service);
  return { authority, service, founder, buyer, workerA, workerB, maya, sam };
}

const setCapacity = (who: OperatorIdentity, generation: number, opId = `cap-${Math.random()}`) =>
  signCommand(who, {
    business: BUSINESS,
    action: "set_capacity",
    args: { class_id: JUNIPER_CLASS.id, capacity: 5 },
    op_id: opId,
    generation,
  });

describe("customer bookings", () => {
  it("seeds a full class with Maya booked and Sam first in line", () => {
    const { service, maya, sam } = world();
    expect(maya.status).toBe("confirmed");
    expect(sam).toMatchObject({ status: "waitlisted", position: 1 });
    expect(service.getClass(JUNIPER_CLASS.id).seats_left).toBe(0);
  });

  it("gives the last seat to exactly one of two concurrent requests", async () => {
    const authority = new TestDoubleAuthority(BUSINESS, "founder.test");
    const service = new OpenSeat({ dbPath: ":memory:", authority });
    service.addClass({ ...JUNIPER_CLASS, capacity: 1 });
    const app = openSeatApp(service);
    const book = (name: string) =>
      app.request(`/classes/${JUNIPER_CLASS.id}/bookings`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
    const results = await Promise.all([book("Ana"), book("Bo")]);
    const statuses = (await Promise.all(results.map((r) => r.json()))).map((b) => b.status).sort();
    expect(statuses).toEqual(["confirmed", "waitlisted"]);
  });

  it("serves a calendar file only for a confirmed seat", () => {
    const { service, maya, sam } = world();
    expect(service.calendar(maya.ref)).toContain(`UID:${maya.ref}@openseat`);
    expect(() => service.calendar(sam.ref)).toThrow(/waitlisted/);
  });

  it("queues one promotion per cancellation, however often the cancel is redelivered", () => {
    const { service, maya } = world();
    service.cancel(maya.ref);
    service.cancel(maya.ref);
    expect(service.jobs()).toHaveLength(1);
    expect(
      service.outbox().filter((e) => (e as { type: string }).type === "attendee_cancelled"),
    ).toHaveLength(1);
  });
});

describe("operator commands", () => {
  it("accepts the owner's signed command and refuses tampering", async () => {
    const { service, founder } = world();
    const ok = await service.execute(setCapacity(founder, 1));
    expect(ok).toMatchObject({ accepted: true, authority: { generation: 1 } });

    const tampered = setCapacity(founder, 1);
    tampered.command.args = { class_id: JUNIPER_CLASS.id, capacity: 99 };
    expect((await service.execute(tampered)).reason).toBe("signature does not verify");
  });

  it("refuses a command for another business, an expired one, and a key that is not the signer's", async () => {
    const { service, founder, authority } = world();
    const other = signCommand(founder, {
      business: "someone-else.test",
      action: "set_capacity",
      args: { class_id: JUNIPER_CLASS.id, capacity: 5 },
      op_id: "x1",
      generation: 1,
    });
    expect((await service.execute(other)).reason).toMatch(/not openseat.business.test/);

    const expired = signCommand(founder, {
      business: BUSINESS,
      action: "set_capacity",
      args: { class_id: JUNIPER_CLASS.id, capacity: 5 },
      op_id: "x2",
      generation: 1,
      expires_at: new Date(Date.now() - 1000).toISOString(),
    });
    expect((await service.execute(expired)).reason).toBe("command has expired");

    // A key the founder never registered on their account.
    const impostor = { accountId: "founder.test", secretKey: generateKey().secretKey };
    expect((await service.execute(setCapacity(impostor, 1))).reason).toMatch(/not an access key/);
    expect(authority.owner).toBe("founder.test");
  });

  it("returns the first outcome for a replayed op_id and runs nothing again", async () => {
    const { service, founder } = world();
    const signed = setCapacity(founder, 1, "same-op");
    await service.execute(signed);
    const again = await service.execute(signed);
    expect(again).toMatchObject({ replayed: true, accepted: true });
    expect(service.commandLog()).toHaveLength(1);
  });

  it("refuses an operator without the capability", async () => {
    const { service, workerA } = world();
    const out = await service.execute(setCapacity(workerA, 1));
    expect(out).toMatchObject({ accepted: false, reason: "not authorized: not granted support" });
  });
});

describe("change of operator", () => {
  it("keeps Sam's place through the sale and promotes him once under the buyer's worker", async () => {
    const { service, authority, founder, buyer, workerA, workerB, maya, sam } = world();
    const oldWorker = new PromotionWorker(service, workerA, 1);

    authority.sell(buyer.accountId);

    // The founder's stale UI and the old worker both fail at the authority boundary.
    const founderTry = await service.execute(setCapacity(founder, 1));
    expect(founderTry).toMatchObject({ accepted: false, authority: { generation: 2 } });
    expect(founderTry.reason).toMatch(/not an operator/);
    const founderGen2 = await service.execute(setCapacity(founder, 2));
    expect(founderGen2.accepted).toBe(false);

    service.cancel(maya.ref);
    const blocked = await oldWorker.drain();
    expect(blocked[0]?.outcome.accepted).toBe(false);
    expect(service.pendingJobs()[0]).toMatchObject({ status: "blocked" });
    expect(service.booking(sam.ref).status).toBe("waitlisted");

    // The buyer appoints a worker for generation 2 and the pending job completes.
    authority.appoint(workerB.accountId, ["fulfillment"]);
    const newWorker = new PromotionWorker(service, workerB, 2);
    const done = await newWorker.drain();
    expect(done[0]?.outcome).toMatchObject({ accepted: true, result: { promoted: sam.ref } });
    expect(await newWorker.drain()).toEqual([]);
    service.cancel(maya.ref);
    expect(await newWorker.drain()).toEqual([]);

    expect(service.booking(sam.ref)).toMatchObject({
      status: "confirmed",
      promoted_by: "worker-b.test",
      promoted_generation: 2,
    });
    expect(service.notifications(sam.ref)).toHaveLength(1);
    expect(service.calendar(sam.ref)).toContain(sam.ref);
  });
});

describe("studios", () => {
  async function call(
    app: ReturnType<typeof openSeatApp>,
    path: string,
    method = "GET",
    body?: unknown,
    key?: string,
  ) {
    const res = await app.request(path, {
      method,
      headers: {
        "content-type": "application/json",
        ...(key ? { authorization: `Bearer ${key}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  }

  it("lets a studio publish its own class and see only its own roster", async () => {
    const service = new OpenSeat({
      dbPath: ":memory:",
      authority: new TestDoubleAuthority(BUSINESS, "founder.test"),
    });
    const app = openSeatApp(service);
    const juniper = (await call(app, "/studios", "POST", { name: "Juniper Print Studio" })).body;
    const other = (await call(app, "/studios", "POST", { name: "Elsewhere" })).body;
    const cls = await call(
      app,
      "/studio/classes",
      "POST",
      {
        title: "Beginner linocut",
        starts_at: "2026-11-07T18:00:00Z",
        ends_at: "2026-11-07T19:30:00Z",
        location: "Alder Lane",
        capacity: 1,
      },
      juniper.api_key as string,
    );
    expect(cls.status).toBe(201);
    const id = cls.body.id as string;
    await call(app, `/classes/${id}/bookings`, "POST", { name: "Sam Lee" });
    await call(app, `/classes/${id}/bookings`, "POST", { name: "Ana Ruiz" });
    const roster = await call(
      app,
      `/studio/classes/${id}/roster`,
      "GET",
      undefined,
      juniper.api_key as string,
    );
    expect(
      (roster.body.attendees as { attendee: string; status: string }[]).map((a) => a.status),
    ).toEqual(["confirmed", "waitlisted"]);
    expect(
      (await call(app, `/studio/classes/${id}/roster`, "GET", undefined, other.api_key as string))
        .status,
    ).toBe(404);
    expect((await call(app, "/studio/classes", "POST", { title: "x" })).status).toBe(403);
    expect(JSON.stringify(roster.body)).not.toContain("OS-");
  });
});
