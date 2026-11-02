// Seeded demo class (labeled "seeded" on every booking it creates): Juniper Print Studio's
// beginner linocut workshop, full, with one named attendee booked and one waiting.

import type { OpenSeat } from "./service.ts";

export const JUNIPER_CLASS = {
  id: "juniper-linocut-2611",
  studio: "Juniper Print Studio",
  title: "Beginner linocut workshop",
  starts_at: "2026-11-14T18:00:00.000Z",
  ends_at: "2026-11-14T20:30:00.000Z",
  location: "Juniper Print Studio, 14 Alder Lane (fictional)",
  capacity: 4,
} as const;

/** Returns the two named attendees' references: Maya holds a seat, Sam is first in line. */
export function seedJuniper(service: OpenSeat) {
  service.addClass(JUNIPER_CLASS);
  for (const name of ["Seeded attendee 1", "Seeded attendee 2", "Seeded attendee 3"]) {
    service.book(JUNIPER_CLASS.id, name, "seeded");
  }
  const maya = service.book(JUNIPER_CLASS.id, "Maya Ortiz", "seeded");
  const sam = service.book(JUNIPER_CLASS.id, "Sam Lee", "seeded");
  return { maya, sam };
}
