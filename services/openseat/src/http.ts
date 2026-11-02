// OpenSeat's HTTP API. Customer routes need only the booking reference the customer holds;
// operator routes take signed commands (command.ts) and never a session cookie or API token,
// so there is nothing for a former operator to keep using after control changes.

import { Hono } from "hono";
import type { SignedCommand } from "./command.ts";
import { type OpenSeat, ServiceError } from "./service.ts";

export function openSeatApp(service: OpenSeat) {
  const app = new Hono();

  app.onError((error, c) => {
    if (error instanceof ServiceError) return c.json({ error: error.message }, error.status);
    console.error(error);
    return c.json({ error: "Something went wrong on our side" }, 500);
  });

  app.get("/health", (c) =>
    c.json({ ok: true, business: service.authority.business, authority: service.authority.mode }),
  );

  app.get("/classes/:id", (c) => {
    const { id, studio, title, starts_at, ends_at, location, capacity, seats_left, waitlisted } =
      service.getClass(c.req.param("id"));
    return c.json({
      id,
      studio,
      title,
      starts_at,
      ends_at,
      location,
      capacity,
      seats_left,
      waitlisted,
    });
  });

  app.post("/classes/:id/bookings", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { name?: string };
    return c.json(service.book(c.req.param("id"), String(body.name ?? "")), 201);
  });

  app.get("/bookings/:ref", (c) => c.json(service.booking(c.req.param("ref"))));

  app.post("/bookings/:ref/cancel", (c) => c.json(service.cancel(c.req.param("ref"))));

  app.get("/bookings/:ref/calendar.ics", (c) => {
    const ref = c.req.param("ref");
    return c.body(service.calendar(ref), 200, {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": `attachment; filename="${ref}.ics"`,
    });
  });

  app.post("/operator/commands", async (c) => {
    const signed = (await c.req.json()) as SignedCommand;
    if (!signed?.command || typeof signed.signature !== "string")
      throw new ServiceError(400, "Expected { command, signature }");
    const outcome = await service.execute(signed);
    return c.json(outcome, outcome.accepted ? 200 : 403);
  });

  return app;
}
