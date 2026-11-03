// Job 005a: what a product project keeps about the publicly shared request that inspired it.
//
// Captured once, when the project is created: the request's public text and stated constraints,
// when it was posted and until when it was open, and whether its author accepted replies. Never
// who posted it, their contact, replies to it, or anyone's searches. The snapshot stays with the
// project (and so with the business, whoever owns it) after the request closes or expires: it is
// the founder's record of what inspired their own work, not access to the requester's later
// information. The current state of the request is read live and only ever narrows what is shown:
// once the request is gone, its id is no longer given out.

import type { Db } from "./db.ts";
import { projectNeedConstraints } from "./needConstraints.ts";

export type SourceState = "open" | "closed" | "expired" | "unavailable";

export function projectSource(db: Db, projectId: string) {
  const s = db.prepare("SELECT * FROM project_sources WHERE project_id = ?").get(projectId) as
    | {
        need_id: string;
        need_text: string;
        constraints: string;
        allow_replies: number;
        need_created_at: string;
        need_expires_at: string;
        captured_at: string;
        constraints_unreadable: string;
      }
    | undefined;
  if (!s) return null;
  // Job 005a1: projected again on every read, so a snapshot captured before the boundary existed
  // (which may hold extra fields) shows only the allowed ones.
  const c = projectNeedConstraints(s.constraints);
  let earlier: string[] = [];
  try {
    const u = JSON.parse(s.constraints_unreadable) as unknown;
    if (Array.isArray(u)) earlier = u.filter((x): x is string => typeof x === "string").slice(0, 5);
  } catch {
    earlier = ["other"];
  }
  const unreadable = [...new Set([...earlier, ...c.unreadable])];
  const now = db
    .prepare("SELECT status, expires_at, allow_replies FROM needs WHERE id = ?")
    .get(s.need_id) as { status: string; expires_at: string; allow_replies: number } | undefined;
  const state: SourceState = !now
    ? "unavailable"
    : now.status !== "open"
      ? "closed"
      : now.expires_at <= new Date().toISOString()
        ? "expired"
        : "open";
  const open = state === "open";
  return {
    kind: "public_request" as const,
    label: "Inspiration from a publicly shared request",
    captured_at: s.captured_at,
    snapshot: {
      text: s.need_text.slice(0, 600),
      constraints: c.constraints,
      /** Stated constraints that couldn't be read; never treated as met. */
      constraints_unreadable: unreadable,
      posted_at: s.need_created_at,
      open_until: s.need_expires_at,
      replies_allowed: s.allow_replies === 1,
    },
    state,
    /** Given only while the request is open, so the founder can still reply with a business. */
    need_id: open ? s.need_id : null,
    can_reply: open && now?.allow_replies === 1,
    notes: [
      "Creating this project didn't contact the person who posted the request, reply to it or reserve it.",
      "A stated price limit is what the requester said they would pay, not a product price, a development budget or income.",
      "Kept here: the request's public text and constraints as captured. Not kept: who posted it, their contact, replies or searches.",
    ],
  };
}
