// Job 005c: expert help through the real routes (local preview identities, fictional people).

import { describe, expect, it } from "vitest";
import { everstreetApi } from "../src/app.ts";
import { openDb } from "../src/db.ts";
import { Store } from "../src/store.ts";
import type { Json } from "./deal-world.ts";

function world() {
  const store = new Store(openDb(":memory:"));
  const api = everstreetApi(store, { localPreview: true, environment: "test" });
  const as =
    (cookie: string) =>
    async (path: string, method = "GET", body?: unknown) => {
      const res = await api.request(path, {
        method,
        headers: { cookie, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      return { status: res.status, body: (text ? JSON.parse(text) : {}) as Json, text };
    };
  const join = async (name: string) => {
    const res = await api.request("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    return Object.assign(as(cookie), { id: ((await res.json()) as Json).person.id as string });
  };
  const transfer = (businessId: string, from: string, to: string) => {
    const gen = (
      store.db
        .prepare("SELECT COUNT(*) AS n FROM ownership WHERE business_id = ?")
        .get(businessId) as { n: number }
    ).n;
    store.db.prepare("UPDATE businesses SET owner_id = ? WHERE id = ?").run(to, businessId);
    store.db
      .prepare(
        "INSERT INTO ownership (business_id, from_id, to_id, generation, at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(businessId, from, to, gen + 2, new Date().toISOString());
  };
  return { store, join, transfer, anon: as("") };
}

let n = 0;
const key = () => `eh-${++n}`;
const PROFILE = {
  headline: "Evaluations for document-extraction APIs",
  offer: "I design adversarial evaluation sets and review release checks for AI APIs.",
  skills: ["evaluations", "ai_workflows"],
  availability: "Two afternoons a week",
  capacity: "open",
  pricing_basis: "hourly",
  pricing_note: "Fictional rate, stated by me",
  links: [],
  version: 0,
};

async function setup() {
  const w = world();
  const iris = await w.join("Iris Okafor (expert)");
  const ava = await w.join("Ava Chen");
  expect((await iris("/api/me/expert-profile", "PUT", PROFILE)).status).toBe(200);
  // Unpublished: not in the directory, not readable by others.
  expect((await ava("/api/experts")).body.experts).toEqual([]);
  expect((await ava(`/api/experts/${iris.id}`)).status).toBe(404);
  await iris("/api/me/expert-profile/publish", "POST");
  const p = await ava("/api/product-projects", "POST", {
    idea: "Turn fictional supplier invoices into clean rows",
    foundation: "ai_api",
  });
  return {
    w,
    iris,
    ava,
    business: p.body.project.business_id as string,
    project: p.body.project.id as string,
  };
}

describe("005c expert help", () => {
  it("find with stated reasons, preview exactly what's shared, request, accept, deliver, complete; records persist", async () => {
    const { w, iris, ava, business, project } = await setup();
    const found = await ava("/api/experts?skill=evaluations&q=adversarial");
    expect(found.body.experts).toHaveLength(1);
    expect(found.body.experts[0].reasons).toEqual([
      "Lists AI evaluations and testing",
      'Their offer mentions "adversarial"',
    ]);
    expect(found.body.experts[0].self_reported).toMatch(/doesn't verify/);
    expect(JSON.stringify(found.body)).not.toMatch(/"(rating|score|verified|badge|confidence)[a-z_]*":/i);

    const ask = {
      expert_id: iris.id,
      business_id: business,
      project_id: project,
      title: "Review our release checks",
      task: "Our invoice reader passes 10 named cases; we want harder adversarial ones.",
      outcome: "Five new adversarial cases",
      deliverables: "Case list with expected outputs",
      budget_amount: 300,
      budget_unit: "USD",
    };
    const preview = await ava("/api/help-requests/preview", "POST", ask);
    expect(preview.body.shared).toMatchObject({
      title: ask.title,
      context: { business: { id: business }, project: { id: project } },
      budget: { amount: 300, unit: "USD", note: "A budget, not an agreed price." },
    });
    expect(preview.body.shared.not_shared).toMatch(/no customer documents/);
    const k = key();
    const made = await ava("/api/help-requests", "POST", { ...ask, idempotency_key: k });
    expect(made.status).toBe(201);
    // A lost answer, retried with the same key: the same request, not a second one.
    const again = await ava("/api/help-requests", "POST", { ...ask, idempotency_key: k });
    expect([again.status, again.body.request.id]).toEqual([200, made.body.request.id]);
    const id = made.body.request.id as string;
    // The expert sees exactly the snapshot, and the authority statement.
    const seen = await iris(`/api/help-requests/${id}`);
    expect(seen.body.shared).toEqual(preview.body.shared);
    expect(seen.body.actions).toEqual(["accept", "decline"]);
    expect(seen.body.authority).toMatch(/grants no access/);
    // Strict roles: the requester can't accept; the expert can't complete.
    expect(
      (
        await ava(`/api/help-requests/${id}/events`, "POST", {
          kind: "accept",
          idempotency_key: key(),
        })
      ).status,
    ).toBe(409);
    await iris(`/api/help-requests/${id}/events`, "POST", {
      kind: "message",
      body: "Which documents fail today?",
      idempotency_key: key(),
    });
    await iris(`/api/help-requests/${id}/events`, "POST", {
      kind: "accept",
      idempotency_key: key(),
    });
    expect(
      (
        await iris(`/api/help-requests/${id}/events`, "POST", {
          kind: "complete",
          idempotency_key: key(),
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await iris(`/api/help-requests/${id}/events`, "POST", {
          kind: "deliver",
          idempotency_key: key(),
        })
      ).status,
    ).toBe(400); // needs a note
    await iris(`/api/help-requests/${id}/events`, "POST", {
      kind: "deliver",
      body: "Sent five cases in the thread.",
      idempotency_key: key(),
    });
    const done = await ava(`/api/help-requests/${id}/events`, "POST", {
      kind: "complete",
      idempotency_key: key(),
    });
    expect(done.body.request).toMatchObject({
      state: "completed",
      actions: [],
      can_message: false,
    });
    expect(done.body.request.events.map((e: Json) => e.kind)).toEqual([
      "requested",
      "message",
      "accept",
      "deliver",
      "complete",
    ]);
    // Accepting granted the expert nothing on the business.
    expect((await iris(`/api/product-projects/${project}`)).status).not.toBe(200);
    expect((await iris(`/api/businesses/${business}/books`)).status).not.toBe(200);
    // Both lists show it; a third person and anonymous readers see nothing.
    expect((await ava("/api/help-requests")).body.requests[0]).toMatchObject({
      id,
      role: "requester",
      state: "completed",
    });
    expect((await iris("/api/help-requests")).body.requests[0]).toMatchObject({
      id,
      role: "expert",
    });
    const ben = await w.join("Ben Okoro");
    expect((await ben(`/api/help-requests/${id}`)).status).toBe(404);
    expect((await ben("/api/help-requests")).body.requests).toEqual([]);
    // The trail is append-only.
    expect(() => w.store.db.prepare("UPDATE help_request_events SET body = 'x'").run()).toThrow(
      /append-only/,
    );
  });

  it("a business-linked request pauses when the business changes hands; the new owner never sees it", async () => {
    const { w, iris, ava, business } = await setup();
    const made = await ava("/api/help-requests", "POST", {
      expert_id: iris.id,
      business_id: business,
      title: "Help with operations",
      task: "Settlement monitoring",
      idempotency_key: key(),
    });
    const id = made.body.request.id as string;
    await iris(`/api/help-requests/${id}/events`, "POST", {
      kind: "accept",
      idempotency_key: key(),
    });
    const noah = await w.join("Noah Brandt");
    w.transfer(business, ava.id, noah.id);
    const v = await iris(`/api/help-requests/${id}`);
    expect(v.body).toMatchObject({ paused: true, actions: [], can_message: false });
    expect(
      (
        await iris(`/api/help-requests/${id}/events`, "POST", {
          kind: "deliver",
          body: "x",
          idempotency_key: key(),
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await iris(`/api/help-requests/${id}/events`, "POST", {
          kind: "message",
          body: "hi",
          idempotency_key: key(),
        })
      ).status,
    ).toBe(409);
    expect((await noah(`/api/help-requests/${id}`)).status).toBe(404);
    expect((await noah("/api/help-requests")).body.requests).toEqual([]);
    // The former owner can still withdraw (close it out), nothing more.
    const wd = await ava(`/api/help-requests/${id}/events`, "POST", {
      kind: "withdraw",
      idempotency_key: key(),
    });
    expect(wd.body.request.state).toBe("withdrawn");
  });

  it("refuses a business the requester doesn't control, unpublished experts, and oneself", async () => {
    const { w, iris, ava, business } = await setup();
    const ben = await w.join("Ben Okoro");
    expect(
      (
        await ben("/api/help-requests", "POST", {
          expert_id: iris.id,
          business_id: business,
          title: "x",
          task: "y",
          idempotency_key: key(),
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await iris("/api/help-requests", "POST", {
          expert_id: iris.id,
          title: "x",
          task: "y",
          idempotency_key: key(),
        })
      ).status,
    ).toBe(400);
    await iris("/api/me/expert-profile/unpublish", "POST");
    expect(
      (
        await ava("/api/help-requests", "POST", {
          expert_id: iris.id,
          title: "x",
          task: "y",
          idempotency_key: key(),
        })
      ).status,
    ).toBe(404);
    expect((await w.anon("/api/experts")).body.experts).toEqual([]);
  });
});
