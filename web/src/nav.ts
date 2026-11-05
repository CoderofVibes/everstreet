// Job 001f: the four primary destinations (Discover, Build, Operate, Acquire), which existing
// route belongs to which, and each destination's contextual links. Pure, so deep links and the
// active state are tested without a browser. Every earlier route keeps working; only the shell
// that frames it changed.

export type Destination = "discover" | "build" | "operate" | "acquire";

export const DESTINATIONS: { id: Destination; label: string; to: string }[] = [
  { id: "discover", label: "Discover", to: "/" },
  { id: "build", label: "Build", to: "/build" },
  { id: "operate", label: "Operate", to: "/desk" },
  { id: "acquire", label: "Acquire", to: "/acquire" },
];

export const SUBNAV: Record<Destination, { label: string; to: string }[]> = {
  discover: [
    { label: "Home", to: "/" },
    { label: "Explore", to: "/explore" },
    { label: "Requests", to: "/opportunities" },
    { label: "Find a solution", to: "/find" },
  ],
  build: [
    { label: "Product studio", to: "/build" },
    { label: "Bring a product", to: "/import" },
    { label: "Start a business", to: "/start" },
    { label: "Expert help", to: "/experts" },
  ],
  operate: [
    { label: "My businesses", to: "/desk" },
    { label: "Inbox", to: "/inbox" },
    { label: "Help requests", to: "/expert-help" },
  ],
  acquire: [
    { label: "Acquisitions", to: "/acquire" },
    { label: "Handovers", to: "/handovers" },
    { label: "Portfolio", to: "/portfolio" },
  ],
};

/** Utilities beside the destinations (the acting-context menu holds profile and switching). */
export const UTILITIES = [
  { id: "activity", label: "My activity", to: "/activity" },
  { id: "inbox", label: "Inbox", to: "/inbox" },
] as const;

const under = (path: string, base: string) => path === base || path.startsWith(`${base}/`);

/**
 * Which destination a path belongs to, or null for personal pages (customer activity, a
 * product in use, profile) that sit outside the four.
 */
export function destinationOf(rawPath: string): Destination | null {
  const path = rawPath.split(/[?#]/)[0] ?? "/";
  // A business's sale and handover are acquisition work, even though they live under /desk.
  if (/^\/desk\/[^/]+\/(sale|handover)(\/|$)/.test(path)) return "acquire";
  if (
    under(path, "/acquire") ||
    under(path, "/deal") ||
    under(path, "/handovers") ||
    under(path, "/portfolio")
  )
    return "acquire";
  if (
    under(path, "/desk") ||
    under(path, "/help") ||
    under(path, "/inbox") ||
    under(path, "/expert-help")
  )
    return "operate";
  if (
    under(path, "/build") ||
    under(path, "/start") ||
    under(path, "/import") ||
    under(path, "/studio") ||
    under(path, "/experts")
  )
    return "build";
  if (
    path === "/" ||
    under(path, "/explore") ||
    under(path, "/find") ||
    under(path, "/opportunities") ||
    under(path, "/b") ||
    under(path, "/p")
  )
    return "discover";
  return null;
}

/** Whether a link is the current page (Home only on "/"; others on their own subtree). */
export function isCurrent(to: string, rawPath: string): boolean {
  const path = rawPath.split(/[?#]/)[0] ?? "/";
  return to === "/" ? path === "/" : under(path, to);
}
