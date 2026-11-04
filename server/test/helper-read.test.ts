// Job 005b: what a helper may READ, through the real routes. Astra reproduced it: after the owner
// revoked Ellis, GET /api/helping/:id still answered 200 with the customer's private inquiry,
// even though it said authorized=false and active=false. Policy (docs/design/HELPER_READ_AUTHORITY.md):
// private fields are returned only for a capability the business's contract confirms NOW, for a
// person Everstreet currently records as a helper, and only if neither changed while the check
// ran. Historical appointment is never enough; an unreachable contract gives no private data.
// Fictional people and a fictional private canary; FakeChain double; finite.

import { describe, expect, it } from "vitest";
import { type Json, world } from "./deal-world.ts";

const CANARY = "FICTIONAL PRIVATE CANARY: invoice integration question";

async function helperWorld() {
  const w = world();
  const mara = await w.join("Mara Solis");
  const p = (
    await mara("/api/projects", "POST", { route: "started", name: "Juniper Print Studio" })
  ).body;
  const id = p.business.id as string;
  await mara(`/api/projects/${p.id}/answers`, "PATCH", {
    audience: "Adults",
    outcome: "Three prints",
    deliverable: "90 minutes",
    price: "$35",
    when: "Saturdays",
    where: "Alder Lane",
    capacity: "6",
    confirmed: true,
  });
  await mara(`/api/businesses/${id}`, "PATCH", { family: "class" });
  const slug = (await mara(`/api/businesses/${id}/publish`, "POST")).body.business?.slug as
    | string
    | undefined;
  const pub =
    slug ??
    (w.store.db.prepare("SELECT slug FROM businesses WHERE id = ?").get(id) as { slug: string })
      .slug;
  await mara(`/api/businesses/${id}/payments/activate`, "POST", { refund_hours: 0 });
  await mara(`/api/businesses/${id}/sessions`, "POST", {
    starts_at: new Date(Date.now() + 864e5 * 3).toISOString(),
    capacity: 4,
  });
  const visitor = await w.join("Visitor Fictional");
  const session = (await visitor(`/api/public/businesses/${pub}`)).body.sessions[0].id;
  const sam = await w.join("Sam Fictional");
  const paid = (await sam(`/api/public/sessions/${session}/pay`, "POST")).body;
  await sam(`/api/public/businesses/${pub}/inquiries`, "POST", {
    kind: "question",
    message: CANARY,
    share_contact: true,
  });
  const ellis = await w.join("Ellis Grant");
  const appoint = async () =>
    expect((await mara(`/api/businesses/${id}/team`, "POST", { person_id: ellis.id })).status).toBe(
      201,
    );
  await appoint();
  const chainBiz = () =>
    w.chain.businesses.values().next().value as {
      operators: Map<string, string[]>;
    };
  const ellisAccount = () =>
    (
      w.store.db
        .prepare(
          "SELECT account_id FROM chain_accounts WHERE owner_kind = 'person' AND owner_id = ?",
        )
        .get(ellis.id) as { account_id: string }
    ).account_id;
  const desk = async (who = ellis) => {
    const r = await who(`/api/helping/${id}`);
    return { status: r.status, body: r.body as Json, text: JSON.stringify(r.body) };
  };
  return { w, mara, sam, ellis, id, paid, appoint, chainBiz, ellisAccount, desk };
}

/** Nothing private: no inquiry text, customer names or orders, in any field. */
const noPrivate = (text: string) => {
  expect(text).not.toContain(CANARY);
  expect(text).not.toContain("Sam Fictional");
  expect(text).not.toContain("Sam");
};

describe("005b the read follows current authority, not history", () => {
  it("authorized: support and fulfillment fields, from the contract's answer", async () => {
    const s = await helperWorld();
    const d = await s.desk();
    expect(d.status).toBe(200);
    expect(d.body.access).toBe("active");
    expect(d.body.capabilities).toMatchObject({
      support: { state: "authorized" },
      fulfillment: { state: "authorized" },
    });
    expect(d.text).toContain(CANARY);
    expect((d.body.orders as Json[]).some((o) => o.customer === "Sam Fictional")).toBe(true);
  });

  it("Astra's reproduction: revoked by the owner, the direct URL shows ended access and nothing private", async () => {
    const s = await helperWorld();
    expect((await s.mara(`/api/businesses/${s.id}/team/${s.ellis.id}`, "DELETE")).status).toBe(200);
    const d = await s.desk();
    expect(d.status).toBe(200);
    expect(d.body.access).toBe("ended");
    expect(d.body.inquiries ?? null).toBeNull();
    expect(d.body.orders ?? null).toBeNull();
    noPrivate(d.text);
  });

  it("revoked on the contract only (Everstreet's record still active): denied, nothing private", async () => {
    const s = await helperWorld();
    s.chainBiz().operators.delete(s.ellisAccount());
    const d = await s.desk();
    expect(d.body.access).toBe("denied");
    noPrivate(d.text);
  });

  it("revoked in Everstreet but the contract not yet: ended (a historical or stale grant is never enough)", async () => {
    const s = await helperWorld();
    s.w.store.db
      .prepare("UPDATE team SET revoked_at = ? WHERE person_id = ?")
      .run(new Date().toISOString(), s.ellis.id);
    const d = await s.desk();
    expect(d.body.access).toBe("ended");
    noPrivate(d.text);
    // And the reply (a write Everstreet alone records) is refused too.
    const inquiry = s.w.store.db.prepare("SELECT id FROM inquiries LIMIT 1").get() as {
      id: string;
    };
    const r = await s.ellis(`/api/helping/${s.id}/inquiries/${inquiry.id}/reply`, "POST", {
      text: "still here",
    });
    expect(r.status).toBe(403);
  });

  it("support only: messages and replies, no orders or customer names from orders", async () => {
    const s = await helperWorld();
    s.chainBiz().operators.set(s.ellisAccount(), ["support"]);
    const d = await s.desk();
    expect(d.body.access).toBe("active");
    expect(d.body.capabilities.fulfillment.state).toBe("denied");
    expect(d.text).toContain(CANARY);
    expect(d.body.orders ?? null).toBeNull();
    // Fulfillment is still decided by the contract.
    expect((await s.ellis(`/api/payments/${s.paid.order_id}/deliver`, "POST")).status).toBe(403);
  });

  it("fulfillment only: orders, no inquiry text", async () => {
    const s = await helperWorld();
    s.chainBiz().operators.set(s.ellisAccount(), ["fulfillment"]);
    const d = await s.desk();
    expect(d.body.capabilities.support.state).toBe("denied");
    expect(d.text).not.toContain(CANARY);
    expect(d.body.inquiries ?? null).toBeNull();
    expect((d.body.orders as Json[]).length).toBeGreaterThan(0);
  });

  it("the contract can't be reached: unconfirmed, nothing private, no permission implied", async () => {
    const s = await helperWorld();
    s.w.chain.operatorCheck = async () => {
      throw new Error("fictional outage");
    };
    const d = await s.desk();
    expect(d.status).toBe(200);
    expect(d.body.access).toBe("unconfirmed");
    expect(d.body.capabilities.support.state).toBe("unconfirmed");
    noPrivate(d.text);
  });

  it("never a helper: 404 with nothing (unchanged)", async () => {
    const s = await helperWorld();
    const bea = await s.w.join("Bea Fictional");
    const d = await s.desk(bea);
    expect(d.status).toBe(404);
    noPrivate(d.text);
  });

  it("revoked while the contract check is in flight: nothing private is returned", async () => {
    const s = await helperWorld();
    const real = s.w.chain.operatorCheck.bind(s.w.chain);
    let release: () => void = () => {};
    const held = new Promise<void>((r) => {
      release = r;
    });
    let entered: () => void = () => {};
    const inCheck = new Promise<void>((r) => {
      entered = r;
    });
    let calls = 0;
    s.w.chain.operatorCheck = async (b: string, a: string, c: string) => {
      const answer = await real(b, a, c); // authorized at the time it was asked
      if (++calls === 1) {
        entered();
        await held;
      }
      return answer;
    };
    const pending = s.desk();
    await inCheck;
    // The owner revokes while the check is out (Everstreet's record changes; the contract too).
    s.w.chain.operatorCheck = real;
    expect((await s.mara(`/api/businesses/${s.id}/team/${s.ellis.id}`, "DELETE")).status).toBe(200);
    release();
    const d = await pending;
    // The contract said yes when asked, but the record changed meanwhile: nothing is shown.
    expect(d.status).toBe(409);
    expect(d.body.code ?? d.body.error).toBeTruthy();
    noPrivate(d.text);
  });

  it("only what answering needs: no person ids; the sender's name as the customer shared it", async () => {
    const s = await helperWorld();
    const d = await s.desk();
    const i = (d.body.inquiries as Json[])[0] ?? {};
    expect(Object.keys(i).sort()).toEqual(
      [
        "created_at",
        "from_name",
        "id",
        "kind",
        "message",
        "replied_at",
        "reply",
        "share_contact",
      ].sort(),
    );
    expect(d.text).not.toContain(s.sam.id);
  });

  it("a reply is sent once: a repeat (e.g. after a lost response) is refused, not overwritten", async () => {
    const s = await helperWorld();
    const id = ((await s.desk()).body.inquiries as Json[])[0]?.id as string;
    const first = await s.ellis(`/api/helping/${s.id}/inquiries/${id}/reply`, "POST", {
      text: "Bring yourself",
    });
    expect(first.status).toBe(200);
    const again = await s.ellis(`/api/helping/${s.id}/inquiries/${id}/reply`, "POST", {
      text: "Bring yourself",
    });
    expect(again.status).toBe(409);
    const reply = (
      s.w.store.db.prepare("SELECT reply FROM inquiries WHERE id = ?").get(id) as {
        reply: string;
      }
    ).reply;
    expect(reply.match(/Bring yourself/g)).toHaveLength(1);
  });

  it("re-appointed after a revocation: active again (the business can delegate anew)", async () => {
    const s = await helperWorld();
    await s.mara(`/api/businesses/${s.id}/team/${s.ellis.id}`, "DELETE");
    noPrivate((await s.desk()).text);
    await s.appoint();
    const d = await s.desk();
    expect(d.body.access).toBe("active");
    expect(d.text).toContain(CANARY);
  });

  it("the customer keeps their own message and order throughout", async () => {
    const s = await helperWorld();
    await s.mara(`/api/businesses/${s.id}/team/${s.ellis.id}`, "DELETE");
    const inbox = (await s.sam("/api/inbox")).body as Json;
    expect(JSON.stringify(inbox)).toContain(CANARY);
  });
});
