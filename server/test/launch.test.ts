// The launch pad's promises: a draft is private until published, a founder's hand edits stick,
// a visitor's interest reaches the founder as a task, and nobody can read someone else's project.

import { describe, expect, it } from "vitest";
import { everstreetApi } from "../src/app.ts";
import { openDb } from "../src/db.ts";
import { Store } from "../src/store.ts";

function world() {
  const store = new Store(openDb(":memory:"));
  const app = everstreetApi(store, { localPreview: true, environment: "test" });
  const as =
    (cookie: string) =>
    async (path: string, method = "GET", body?: unknown) => {
      const res = await app.request(path, {
        method,
        headers: { cookie, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      // biome-ignore lint/suspicious/noExplicitAny: tests read deep response fields
      return { status: res.status, body: (await res.json()) as Record<string, any> };
    };
  const join = async (name: string) => {
    const res = await app.request("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    return as(cookie);
  };
  return { store, app, join, anon: as("") };
}

async function launch(founder: Awaited<ReturnType<ReturnType<typeof world>["join"]>>) {
  const p = (await founder("/api/projects", "POST", { route: "find" })).body;
  await founder(`/api/projects/${p.id}/explore`, "POST", {
    skills: "printmaking, drawing",
    reach: "neighbours and the library art club",
    kinds: ["teach"],
  });
  const chosen = (await founder(`/api/projects/${p.id}/choose`, "POST", { index: 0 })).body;
  const answered = (
    await founder(`/api/projects/${p.id}/answers`, "PATCH", {
      deliverable: "A 90-minute session with materials; you leave with three prints",
      price: "$35",
      when: "Saturday mornings in November",
      where: "Juniper Print Studio, 14 Alder Lane (fictional)",
      capacity: "6",
    })
  ).body;
  const renamed = (
    await founder(`/api/businesses/${chosen.business.id}`, "PATCH", {
      name: "Juniper Print Studio",
    })
  ).body;
  return {
    project: answered,
    businessId: chosen.business.id as string,
    slug: renamed.business.slug as string,
  };
}

describe("launch pad", () => {
  it("suggests three directions and drafts an offer from the interview", async () => {
    const { join } = world();
    const mara = await join("Mara Solis");
    const { project } = await launch(mara);
    expect(project.directions).toHaveLength(3);
    expect(project.directions[0].title).toBe("Teach a first printmaking session");
    expect(project.offer).toMatchObject({ price_cents: 3500, capacity: 6 });
    expect(project.action.label).toBe("Tell me when it opens");
    expect(project.missing).toContain("Confirm you can deliver on that date and place");
  });

  it("keeps a draft private until it is published", async () => {
    const { join, anon } = world();
    const mara = await join("Mara Solis");
    const { slug, businessId } = await launch(mara);
    expect((await anon(`/api/public/businesses/${slug}`)).status).toBe(404);
    expect((await anon("/api/public/discover")).body.businesses).toHaveLength(0);
    const sam = await join("Sam Lee");
    expect((await sam(`/api/businesses/${businessId}`)).status).toBe(404);

    await mara(`/api/businesses/${businessId}/publish`, "POST");
    const page = (await anon(`/api/public/businesses/${slug}`)).body;
    expect(page).toMatchObject({
      name: "Juniper Print Studio",
      founder: { display_name: "Mara Solis" },
    });
    expect(page.offer.price_cents).toBe(3500);
    expect((await anon("/api/public/discover?q=printmaking class")).body.businesses).toHaveLength(
      1,
    );
  });

  it("names the page after the business until it is first published, then keeps the link", async () => {
    const { join } = world();
    const mara = await join("Mara Solis");
    const { slug, businessId } = await launch(mara);
    expect(slug).toBe("juniper-print-studio");
    await mara(`/api/businesses/${businessId}/publish`, "POST");
    const after = (await mara(`/api/businesses/${businessId}`, "PATCH", { name: "Juniper Prints" }))
      .body;
    expect(after.business.slug).toBe("juniper-print-studio");
  });

  it("keeps a founder's hand edit when the interview changes later", async () => {
    const { join } = world();
    const mara = await join("Mara Solis");
    const { project, businessId } = await launch(mara);
    await mara(`/api/businesses/${businessId}/offer`, "PATCH", {
      title: "Your first linocut print",
    });
    const after = (
      await mara(`/api/projects/${project.id}/answers`, "PATCH", { outcome: "make prints" })
    ).body;
    expect(after.offer.title).toBe("Your first linocut print");
    expect(after.offer.outcome).toBe("make prints");
  });

  it("turns a visitor's interest into a task and a reply the visitor can read", async () => {
    const { join } = world();
    const mara = await join("Mara Solis");
    const { businessId, slug } = await launch(mara);
    await mara(`/api/businesses/${businessId}/publish`, "POST");

    const sam = await join("Sam Lee");
    const sent = await sam(`/api/public/businesses/${slug}/inquiries`, "POST", {
      kind: "interest",
      message: "Is the first Saturday still open?",
      share_contact: true,
    });
    expect(sent.status).toBe(201);
    expect(
      (await mara(`/api/public/businesses/${slug}/inquiries`, "POST", { kind: "interest" })).status,
    ).toBe(409);

    const desk = (await mara(`/api/businesses/${businessId}`)).body;
    expect(desk.inquiries[0]).toMatchObject({ from_name: "Sam Lee", kind: "interest" });
    expect(desk.tasks[0].title).toBe("Reply to Sam Lee: they are interested");
    const noShare = await (await join("Ana Ruiz"))(
      `/api/public/businesses/${slug}/inquiries`,
      "POST",
      { kind: "interest", message: "", share_contact: false },
    );
    expect(noShare.status).toBe(201);
    const titles = (await mara(`/api/businesses/${businessId}`)).body.tasks.map(
      (t: { title: string }) => t.title,
    );
    expect(titles).toContain("Reply to Ana: they are interested");

    await mara(`/api/inquiries/${desk.inquiries[0].id}/reply`, "POST", {
      text: "Yes! See you at 10.",
    });
    const inbox = (await sam("/api/inbox")).body;
    expect(inbox.sent[0]).toMatchObject({
      reply: "Yes! See you at 10.",
      business_name: "Juniper Print Studio",
    });
    const tasks = (await mara(`/api/businesses/${businessId}`)).body.tasks;
    expect(
      tasks.find((t: { title: string }) => t.title.startsWith("Reply to Sam")).done_at,
    ).not.toBeNull();
  });

  it("refuses workspace routes without a session", async () => {
    const { anon } = world();
    expect((await anon("/api/projects")).status).toBe(401);
  });
});
