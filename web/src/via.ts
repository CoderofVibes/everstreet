// How a visitor reached a business page: the founder's own link (?via=link), discovery here
// (?via=discovery), a need (?via=need) or the following feed (?via=follow). Remembered for the
// tab so a later booking or message carries it; unknown stays unknown.

const KNOWN = ["link", "discovery", "need", "follow"];

export function rememberVia(slug: string) {
  const via = new URLSearchParams(window.location.search).get("via");
  if (!via || !KNOWN.includes(via)) return;
  try {
    sessionStorage.setItem(`via:${slug}`, via);
  } catch {
    // Storage unavailable: attribution stays unknown.
  }
}

export function viaFor(slug: string) {
  try {
    return sessionStorage.getItem(`via:${slug}`) ?? "unknown";
  } catch {
    return "unknown";
  }
}

export function when(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function ago(iso: string) {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} days ago`;
}
