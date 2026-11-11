// The guided tour's script (web/src/tour/Guide.tsx): seven stops, in order. The first three and
// the last open the app's own pages on the recorded demo (simulated history, fictional people); the
// middle three are the proof pages (two recorded on NEAR testnet, one a recorded test run). The
// guide carries the explaining so
// the product pages stay as they are. Wording follows the README; testnet links are the README's.

const TX = "https://testnet.nearblocks.io/txns/";

export interface TourLink {
  label: string;
  href: string;
}

export interface TourPeek {
  label: string;
  /** A named place in the recording (TourData.stops). */
  stop: string;
  /** Who views it. */
  as: string;
}

export interface TourStep {
  id: string;
  /** The short name on the step rail. */
  label: string;
  /** Where the data on screen comes from. */
  source: "demo" | "testnet" | "tests";
  title: string;
  body: string[];
  /** A fixed route, or a named place in the recording. */
  to?: string;
  stop?: string;
  /** Who views it (the proof pages are the same for everyone). */
  as?: string;
  /** Side doors: other people's view of the same thing, one click away. */
  peeks?: TourPeek[];
  /** Transactions and records that back the step. */
  links?: TourLink[];
}

export const STEPS: TourStep[] = [
  {
    id: "everstreet",
    label: "Everstreet",
    source: "demo",
    title: "A launchpad and marketplace for the agentic economy, on NEAR",
    body: [
      "This is Everstreet's front page. Builders describe a product and shape it here. Customers and agents find what is published and pay per use. Investors find businesses that are open to a sale. Scroll and click freely: only changes are switched off.",
    ],
    to: "/",
    as: "delphine",
    peeks: [
      { label: "A customer's side: Cara's prepaid uses", stop: "customer", as: "cara" },
      { label: "A buyer's side: Noah buying Signalwatch", stop: "sale", as: "noah" },
    ],
  },
  {
    id: "build",
    label: "Build",
    source: "demo",
    title: "Build: the product studio",
    body: [
      "Delphine shaped Ledgerline's invoice reader here: a brief, a prototype, saved revisions, a build, release checks, then an offer customers can buy. The work is kept with the business, so a new owner gets all of it. Try the tabs: Versions, Builds, Service.",
    ],
    stop: "studio",
    as: "delphine",
  },
  {
    id: "run",
    label: "Run",
    source: "demo",
    title: "Run: the portfolio",
    body: [
      "Everything Delphine owns on one page: what each business earned, read from its contract; what it delivered; what it cost to run; and the prepaid uses its customers still hold. Signalwatch is mid-sale: the price sits in escrow until both sides accept the same terms.",
    ],
    stop: "portfolio",
    as: "delphine",
    peeks: [
      { label: "Ledgerline's desk", stop: "desk", as: "delphine" },
      { label: "What Ledgerline could be worth", stop: "value", as: "delphine" },
    ],
  },
  {
    id: "handoff",
    label: "Handoff proof",
    source: "testnet",
    title: "A business changes hands, and its customers keep what they paid for",
    body: [
      "From here the pages show runs recorded on NEAR testnet. Ledgerline has been sold three times. Its contract names the fourth owner and refuses the former one, and all 100 uses its first customer bought are accounted for: 78 unused, 22 used.",
    ],
    to: "/proof/ledgerline",
    links: [
      { label: "Closing transaction", href: `${TX}3psBJvLE3EBq9BNMF7ZZQub9EZab77L7je5U8x8zcSet` },
      { label: "Former owner refused", href: `${TX}ZWJP4nst8L6Syx52WkyZ7fmCuHZJSoER6j5oD7f8zyb` },
    ],
  },
  {
    id: "sale",
    label: "Recorded sale",
    source: "testnet",
    title: "The recorded sale: what the buyer took over",
    body: [
      "Ledgerline's first sale, read from its record: the buyer took over the business contract, the product with its releases, and the customer offer, then shipped an update a customer used. The Try and Operate tabs show the same business as a customer and as its owner.",
    ],
    to: "/example/ledgerline?tab=acquire",
  },
  {
    id: "attacks",
    label: "Attacks",
    source: "tests",
    title: "What we tried to break",
    body: [
      "Every attack we ran against the app and its contract rules, each refused or flagged, and the faults we planted to check that our tests catch them. The cases run on a synthetic chain that follows the contract's rules; where one also ran on NEAR testnet, its row links to the transaction.",
    ],
    to: "/attacks",
  },
  {
    id: "agents",
    label: "Agents",
    source: "demo",
    title: "Agents are customers too, with their own NEAR accounts",
    body: [
      "An agent that asks for a use and holds no units gets HTTP 402 with the exact payment to sign. This desk lists the agents that met Signalwatch's 402 in the demo: one paid from its own account, one did not. The links below are the same thing recorded on NEAR testnet.",
    ],
    stop: "agents",
    as: "delphine",
    peeks: [
      { label: "Ledgerline's side of that sale", stop: "agentsLedgerline", as: "delphine" },
      { label: "An agent's spending budget", stop: "allowance", as: "delphine" },
    ],
    links: [
      { label: "Agent's purchase", href: `${TX}2eMu6YHuVFQ5BXGi8qMx4W9NK5F2fcFPQhgt97GUDPPV` },
      { label: "Agent appointed", href: `${TX}CGjBBb6ec6APwdWhkfb83s8WZLrUYHxpHGFnQ8ofuj5Q` },
      { label: "Agent pays Ledgerline", href: `${TX}Hfhwf17ADeAEu6GPnYV8fWt6zrSbHqdsGCEVbbn1am9V` },
    ],
  },
];

/** The repository's README on GitHub: every claim with its test and transaction lives there. */
export const README_URL = "https://github.com/CoderofVibes/everstreet";
export const CLAIMS_URL = `${README_URL}#follow-the-proof`;

/** Every named place a step or a side door opens. */
export const STOPS_USED = [
  ...new Set(STEPS.flatMap((s) => [s.stop, ...(s.peeks ?? []).map((p) => p.stop)])),
].filter((s): s is string => Boolean(s));

/** Where a step opens: its fixed route, or its named place in the recording. */
export function stepRoute(step: TourStep, stops: Record<string, string>): string {
  return step.stop ? (stops[step.stop] ?? "/") : (step.to ?? "/");
}

const pathOf = (to: string) => to.split("#")[0]?.split("?")[0] || "/";

/** The step whose page is at `path`, or -1 when the path is off the tour's main line. */
export function stepAt(path: string, stops: Record<string, string>): number {
  return STEPS.findIndex((s) => pathOf(stepRoute(s, stops)) === path);
}

/**
 * What is wrong with a tour's data, if anything: every stop and side door must be a route its
 * viewer walked while the recording ran (the build and the tests both ask).
 */
export function tourProblems(data: {
  viewers: Record<string, { routes: string[] }>;
  stops: Record<string, string>;
}): string[] {
  const out: string[] = [];
  const check = (what: string, to: string | undefined, as: string | undefined) => {
    if (!to) return out.push(`${what}: no such place in the recording`);
    const path = pathOf(to);
    const who = as ? [as] : Object.keys(data.viewers);
    if (!who.some((v) => data.viewers[v]?.routes.includes(path)))
      out.push(`${what}: ${path} was not walked by ${as ?? "anyone"}`);
  };
  for (const s of STEPS) {
    check(`step ${s.id}`, s.stop ? data.stops[s.stop] : s.to, s.as);
    for (const p of s.peeks ?? []) check(`side door ${p.stop}`, data.stops[p.stop], p.as);
  }
  return out;
}
