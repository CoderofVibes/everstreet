// Everstreet's HTTP API. Sessions are a cookie; every workspace route resolves the person from
// it and the store checks ownership. Public routes read only published projections.

import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { HttpError, type Person, type Store } from "./store.ts";

const COOKIE = "es_session";

export interface AppOptions {
  /** Local preview: anyone at this computer may switch between fictional people. */
  localPreview: boolean;
  environment: string;
}

export function everstreetApi(store: Store, options: AppOptions) {
  const app = new Hono<{ Variables: { person: Person | null } }>();

  app.onError((error, c) => {
    if (error instanceof HttpError) return c.json({ error: error.message }, error.status);
    console.error(error);
    return c.json({ error: "Something went wrong on our side" }, 500);
  });

  app.use("*", async (c, next) => {
    c.set("person", store.personForToken(getCookie(c, COOKIE)));
    await next();
  });

  const me = (c: { get: (k: "person") => Person | null }) => {
    const p = c.get("person");
    if (!p) throw new HttpError(401, "Sign in first");
    return p;
  };
  const body = async <T>(c: { req: { json: () => Promise<unknown> } }) =>
    ((await c.req.json().catch(() => ({}))) ?? {}) as T;
  const startSession = (c: Parameters<typeof setCookie>[0], token: string) =>
    setCookie(c, COOKIE, token, {
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 90,
    });

  app.get("/api/env", (c) =>
    c.json({ environment: options.environment, localPreview: options.localPreview }),
  );

  // ---------- account ----------

  app.get("/api/me", (c) => c.json({ person: c.get("person") }));

  app.post("/api/session", async (c) => {
    const { name } = await body<{ name?: string }>(c);
    const { person, token } = store.createPerson(String(name ?? ""));
    startSession(c, token);
    return c.json({ person }, 201);
  });

  app.delete("/api/session", (c) => {
    const token = getCookie(c, COOKIE);
    if (token) store.endSession(token);
    deleteCookie(c, COOKIE, { path: "/" });
    return c.json({ person: null });
  });

  app.get("/api/people", (c) => {
    if (!options.localPreview) throw new HttpError(404, "Not available");
    return c.json({
      people: store.people().map((p) => ({ id: p.id, display_name: p.display_name })),
    });
  });

  app.post("/api/session/as/:id", (c) => {
    if (!options.localPreview) throw new HttpError(404, "Not available");
    const token = store.sessionFor(c.req.param("id"));
    startSession(c, token);
    return c.json({ person: store.person(c.req.param("id")) });
  });

  app.patch("/api/me", async (c) =>
    c.json({ person: store.updatePerson(me(c).id, await body(c)) }),
  );

  // ---------- launch studio ----------

  app.get("/api/projects", (c) => c.json({ projects: store.projects(me(c)) }));

  app.post("/api/projects", async (c) => {
    const { route, name } = await body<{ route?: string; name?: string }>(c);
    if (route !== "idea" && route !== "find" && route !== "started")
      throw new HttpError(400, "Choose how you want to start");
    return c.json(store.startProject(me(c), route, name), 201);
  });

  app.get("/api/projects/:id", (c) => c.json(store.project(me(c), c.req.param("id"))));

  app.post("/api/projects/:id/explore", async (c) =>
    c.json(store.explore(me(c), c.req.param("id"), await body(c))),
  );

  app.post("/api/projects/:id/choose", async (c) => {
    const { index } = await body<{ index?: number }>(c);
    return c.json(store.chooseDirection(me(c), c.req.param("id"), Number(index)));
  });

  app.patch("/api/projects/:id/answers", async (c) =>
    c.json(store.answer(me(c), c.req.param("id"), await body(c))),
  );

  app.post("/api/projects/:id/step", async (c) => {
    const { step } = await body<{ step?: string }>(c);
    return c.json(store.setStep(me(c), c.req.param("id"), String(step ?? "")));
  });

  // ---------- the founder's business ----------

  app.get("/api/businesses/:id", (c) => c.json(store.business(me(c), c.req.param("id"))));
  app.patch("/api/businesses/:id", async (c) =>
    c.json(store.updateBusiness(me(c), c.req.param("id"), await body(c))),
  );
  app.patch("/api/businesses/:id/offer", async (c) =>
    c.json(store.editOffer(me(c), c.req.param("id"), await body(c))),
  );
  app.patch("/api/businesses/:id/idea", async (c) =>
    c.json(store.editIdea(me(c), c.req.param("id"), await body(c))),
  );
  app.post("/api/businesses/:id/publish", (c) => c.json(store.publish(me(c), c.req.param("id"))));
  app.post("/api/businesses/:id/unpublish", (c) =>
    c.json(store.unpublish(me(c), c.req.param("id"))),
  );
  app.patch("/api/tasks/:id", async (c) => {
    const { done } = await body<{ done?: boolean }>(c);
    return c.json({ tasks: store.setTaskDone(me(c), c.req.param("id"), Boolean(done)) });
  });

  // ---------- inbox ----------

  app.get("/api/inbox", (c) => c.json(store.inbox(me(c))));
  app.post("/api/inquiries/:id/reply", async (c) => {
    const { text } = await body<{ text?: string }>(c);
    return c.json(store.reply(me(c), c.req.param("id"), String(text ?? "")));
  });

  // ---------- public ----------

  app.get("/api/public/discover", (c) =>
    c.json({ businesses: store.discover(c.req.query("q") ?? "") }),
  );
  app.get("/api/public/businesses/:slug", (c) => {
    const page = store.publicBusiness(c.req.param("slug"));
    const viewer = c.get("person");
    return c.json({
      ...page,
      viewer_is_owner: viewer ? store.isOwner(viewer, c.req.param("slug")) : false,
    });
  });
  app.post("/api/public/businesses/:slug/inquiries", async (c) => {
    const { kind, message, share_contact } = await body<{
      kind?: string;
      message?: string;
      share_contact?: boolean;
    }>(c);
    if (kind !== "interest" && kind !== "question") throw new HttpError(400, "Unknown request");
    return c.json(
      store.inquire(
        me(c),
        c.req.param("slug"),
        kind,
        String(message ?? ""),
        Boolean(share_contact),
      ),
      201,
    );
  });

  return app;
}
