// First-use review (#28, #44, #49, #75, #80): one way to show a moment, everywhere. The person's
// own local time with its zone ("Nov 21, 2026, 4:08 AM PST"), never a raw ISO string, a bare UTC
// slice or a time without a zone. Monthly figures stay in UTC calendar months (the contract's).

const FORMAT: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
};

/** A moment from an ISO string, epoch milliseconds (number or decimal string) or a Date. */
export function when(at: string | number | Date | null | undefined): string {
  if (at === null || at === undefined || at === "") return "unknown";
  const d =
    at instanceof Date
      ? at
      : typeof at === "number" || /^\d+$/.test(at)
        ? new Date(Number(at))
        : new Date(at);
  return Number.isNaN(d.getTime()) ? "unknown" : d.toLocaleString(undefined, FORMAT);
}
