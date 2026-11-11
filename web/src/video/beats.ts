// The self-playing video's script (web/src/video/Video.tsx), as data: one beat per scene of the
// filming script (docs/astra/2026-11-07_VideoCueSheet.md), in order. A beat says which page to
// show, as whom and in which recorded state, what to press or scroll to and when, and the captions
// burned into the picture. Captions make the claims; they follow the README and the filming
// script's claim boundaries. Times are seconds from the start of the beat, on the video's own
// clock (60 frames to the second), so every take is the same.
//
// A route may name a place in the recording as {stop} (scripts/lib/tourData.ts): ids are made
// fresh by each demo run. Viewers are the recording's (scripts/record-tour.ts).

export type Cue =
  /** Open a page, as a viewer; `strip` is which label the app's top strip carries. */
  | { at: number; go: string; as?: string }
  /** Ring a control, then press it (`lead` seconds after the ring shows). Text, or "css:…". */
  | { at: number; click: string; lead?: number }
  /** Scroll until the element with this text (or "css:…") sits near the top; 0 is the top. */
  | { at: number; scroll: string | 0; dur?: number }
  /** Type into a field ("css:…"), a few characters a frame. */
  | { at: number; type: string; text: string; cps?: number }
  /** Who the picture is following now, shown for a moment. */
  | { at: number; card: string };

export interface Caption {
  at: number;
  text: string;
}

export interface Beat {
  id: string;
  /** The README's part this beat belongs to, shown small beside the caption. */
  chapter: string;
  /** Seconds. */
  dur: number;
  /** What a shot could be mistaken for without it: where its data comes from. */
  label: string;
  /** Which strip the app shows above the page. */
  strip: "demo" | "proof";
  /** The app's pages, the explorer screenshots, or the closing slide. */
  kind: "app" | "explorers" | "end";
  captions: Caption[];
  cues: Cue[];
}

export const CHAPTERS = {
  launch: "Launch and run",
  agents: "Agents as customers and spenders",
  sell: "Sell it, and hand it over intact",
  proof: "The proof",
} as const;

const DEMO = "Recorded demo · synthetic chain";

export const BEATS: Beat[] = [
  {
    id: "open",
    chapter: CHAPTERS.launch,
    dur: 11,
    label: DEMO,
    strip: "demo",
    kind: "app",
    captions: [
      { at: 0, text: "Everstreet: a launchpad and marketplace for the agentic economy, on NEAR." },
      { at: 4.5, text: "Launch a business. People and agents find it and pay for what it does." },
    ],
    cues: [
      { at: 0, go: "/", as: "delphine" },
      { at: 2.4, click: "Run the sample", lead: 0.7 },
      { at: 6.6, go: "/explore", as: "delphine" },
      { at: 7.4, click: "Open for customers", lead: 0.6 },
    ],
  },
  {
    id: "build",
    chapter: CHAPTERS.launch,
    dur: 12,
    label: DEMO,
    strip: "demo",
    kind: "app",
    captions: [
      { at: 0, text: "Start with an idea, or bring a product you have already built." },
      { at: 5.2, text: "Shape it in the studio, then publish an offer customers can buy." },
    ],
    cues: [
      { at: 0, go: "/build", as: "delphine" },
      {
        at: 0.6,
        type: "css:textarea",
        text: "An agent that reads a supplier's release notes and flags what will break for us",
        cps: 34,
      },
      { at: 3.4, click: "Agent service", lead: 0.6 },
      { at: 5.2, go: "{studio}", as: "delphine" },
      { at: 5.4, card: "Example business · Ledgerline" },
      { at: 8.6, go: "{customerAccess}", as: "delphine" },
    ],
  },
  {
    id: "find",
    chapter: CHAPTERS.launch,
    dur: 7,
    label: DEMO,
    strip: "demo",
    kind: "app",
    captions: [
      { at: 0, text: "Customers find a service they can use today, or post what they need next." },
    ],
    cues: [
      { at: 0, go: "/find", as: "delphine" },
      { at: 0.8, click: "turns invoices into JSON", lead: 0.6 },
      { at: 2.2, click: "Search", lead: 0.6 },
      { at: 3.8, scroll: "Might fit", dur: 1.2 },
    ],
  },
  {
    id: "portfolio",
    chapter: CHAPTERS.launch,
    dur: 9,
    label: "Recorded demo · simulated history (fictional)",
    strip: "demo",
    kind: "app",
    captions: [
      {
        at: 0,
        text: "One desk shows what your businesses earn, what they deliver, and what they owe customers.",
      },
    ],
    cues: [
      { at: 0, go: "/portfolio", as: "delphine" },
      { at: 2.8, scroll: "Performance", dur: 1.6 },
      { at: 6, go: "{desk}", as: "delphine" },
      { at: 6.2, card: "Ledgerline's own desk" },
    ],
  },
  {
    id: "agent-buys",
    chapter: CHAPTERS.agents,
    dur: 6,
    label: DEMO,
    strip: "demo",
    kind: "app",
    captions: [
      { at: 0, text: "An agent gets a price over HTTP 402 and pays from its own NEAR account." },
    ],
    cues: [{ at: 0, go: "{agentsLedgerline}", as: "delphine" }],
  },
  {
    id: "agent-activity",
    chapter: CHAPTERS.agents,
    dur: 6,
    label: DEMO,
    strip: "demo",
    kind: "app",
    captions: [
      {
        at: 0,
        text: "Signalwatch's agent buys invoice reads from Ledgerline: one business is another's customer.",
      },
    ],
    cues: [
      { at: 0, go: "/activity", as: "agent" },
      { at: 0.2, card: "Signalwatch's agent · its own NEAR account" },
    ],
  },
  {
    id: "allowance",
    chapter: CHAPTERS.agents,
    dur: 7,
    label: DEMO,
    strip: "demo",
    kind: "app",
    captions: [
      {
        at: 0,
        text: "The agent also pays suppliers, within limits the contract enforces. Larger invoices wait for the owner.",
      },
    ],
    cues: [
      { at: 0, go: "{allowance}", as: "delphine" },
      { at: 3.4, scroll: "css:main table", dur: 1.4 },
    ],
  },
  {
    id: "acquire",
    chapter: CHAPTERS.sell,
    dur: 12,
    label: DEMO,
    strip: "demo",
    kind: "app",
    captions: [
      { at: 0, text: "Investors and other companies look for a business to own." },
      {
        at: 4.4,
        text: "Noah opens Signalwatch and checks its revenue and what it still owes customers.",
      },
    ],
    cues: [
      { at: 0, go: "/acquire", as: "noah" },
      { at: 0.2, card: "Noah Brandt · a buyer" },
      { at: 1.4, scroll: "Open to buyers now", dur: 1.4 },
      { at: 4.4, go: "{sale}", as: "noah" },
      { at: 7.2, go: "{saleEconomics}", as: "noah" },
      { at: 8.6, scroll: "Per-use economics", dur: 1.4 },
    ],
  },
  {
    id: "terms",
    chapter: CHAPTERS.sell,
    dur: 5,
    label: DEMO,
    strip: "demo",
    kind: "app",
    captions: [
      {
        at: 0,
        text: "The price waits in escrow on the business's contract. Both sides review the same exact terms.",
      },
    ],
    cues: [
      { at: 0, go: "{sale}", as: "noah" },
      { at: 1, scroll: "Deal 1", dur: 1.4 },
    ],
  },
  {
    id: "close",
    chapter: CHAPTERS.sell,
    dur: 13,
    label: DEMO,
    strip: "demo",
    kind: "app",
    captions: [
      { at: 0, text: "Both sides accept, and the contract transfers control." },
      { at: 8.8, text: "The seller collects the proceeds. The buyer takes charge." },
    ],
    cues: [
      { at: 0, go: "{sale}", as: "delphine" },
      { at: 0.2, card: "Delphine Marsh · the seller" },
      { at: 1.4, click: "Accept version 1", lead: 0.7 },
      { at: 2.8, scroll: "Your account (approves and pays)", dur: 1.2 },
      { at: 5.2, go: "{sale}", as: "noah-closed" },
      { at: 5.4, card: "Noah Brandt · the buyer, after both accepted" },
      { at: 8.8, go: "{sale}", as: "delphine-after" },
      { at: 9, card: "Delphine Marsh · the seller, after the close" },
    ],
  },
  {
    id: "first-shift",
    chapter: CHAPTERS.sell,
    dur: 8,
    label: DEMO,
    strip: "demo",
    kind: "app",
    captions: [
      {
        at: 0,
        text: "The buyer also moves the business's asset on Ethereum, signed with NEAR Chain Signatures.",
      },
    ],
    cues: [
      { at: 0, go: "{sale}", as: "noah-closed" },
      { at: 0.2, card: "Noah Brandt · the new owner's first shift" },
      { at: 0.6, scroll: "Your first shift", dur: 1 },
      { at: 2.4, click: "Move it to your address", lead: 0.7 },
      { at: 5.4, go: "{sale}", as: "noah-after" },
      { at: 5.6, scroll: "Your first shift", dur: 0.3 },
    ],
  },
  {
    id: "refused",
    chapter: CHAPTERS.sell,
    dur: 6,
    label: DEMO,
    strip: "demo",
    kind: "app",
    captions: [{ at: 0, text: "The former owner tries an owner action. The contract refuses it." }],
    cues: [
      { at: 0, go: "{sale}", as: "delphine-after" },
      { at: 0.2, card: "Delphine Marsh · the former owner" },
      { at: 0.8, scroll: "Your access after the sale", dur: 1.2 },
    ],
  },
  {
    id: "cara",
    chapter: CHAPTERS.sell,
    dur: 8,
    label: DEMO,
    strip: "demo",
    kind: "app",
    captions: [
      {
        at: 0,
        text: "Cara keeps using what she paid for. Her prepaid uses followed the business to its new owner.",
      },
    ],
    cues: [
      { at: 0, go: "{caraResult}", as: "cara-after" },
      { at: 0.2, card: "Cara Okafor · a customer, after the sale" },
      { at: 1, click: "Show my result", lead: 0.7 },
      { at: 2.2, scroll: "Your unit", dur: 1 },
      { at: 5.4, go: "{caraUse}", as: "cara-after" },
      { at: 5.8, scroll: "Your uses", dur: 0.8 },
    ],
  },
  {
    id: "proof",
    chapter: CHAPTERS.proof,
    dur: 10,
    label: "Recorded on NEAR testnet · Ledgerline",
    strip: "proof",
    kind: "app",
    captions: [
      { at: 0, text: "On NEAR testnet, Ledgerline has changed hands three times." },
      {
        at: 4.4,
        text: "The contract refuses the former owner. All 100 customer uses are accounted for: 22 used, 78 left.",
      },
    ],
    cues: [
      { at: 0, go: "/proof/ledgerline", as: "delphine" },
      { at: 1.2, scroll: "Sales of this business", dur: 1.4 },
    ],
  },
  {
    id: "explorers",
    chapter: CHAPTERS.proof,
    dur: 8,
    label: "Recorded on NEAR testnet and Ethereum Sepolia · Ledgerline",
    strip: "proof",
    kind: "explorers",
    captions: [
      {
        at: 0,
        text: "Each step is a public transaction: the agent's payment, the escrow, the refusal, the move on Ethereum.",
      },
    ],
    cues: [{ at: 0, go: "/proof/ledgerline", as: "delphine" }],
  },
  {
    id: "end",
    chapter: CHAPTERS.proof,
    dur: 8,
    label: "",
    strip: "proof",
    kind: "end",
    captions: [{ at: 0, text: "Everstreet. What can you create?" }],
    cues: [{ at: 0, go: "/proof/ledgerline", as: "delphine" }],
  },
];

/** The public explorer pages on the explorers beat (scripts/capture-explorers.ts saves them). */
export const EXPLORERS = [
  {
    file: "/video/agent-pays-ledgerline.jpg",
    title: "An agent pays Ledgerline from its own account",
    where: "NEAR testnet",
    at: 0.3,
  },
  {
    file: "/video/intents-escrow-funding.jpg",
    title: "A buyer funds escrow from another token, with NEAR Intents",
    where: "NEAR testnet",
    at: 1.5,
  },
  {
    file: "/video/former-owner-refused.jpg",
    title: "The contract refuses the former owner: E_NOT_OWNER",
    where: "NEAR testnet",
    at: 2.7,
  },
  {
    file: "/video/sepolia-role-move.jpg",
    title: "The buyer moves the asset, signed with NEAR Chain Signatures",
    where: "Ethereum Sepolia",
    at: 3.6,
  },
];

/** The closing slide (Tony, Nov 11). */
export const END = {
  name: "Everstreet",
  line: "Built at NEAR HACKATHON",
  team: "Built by DadMod: one nuclear-startup engineer running on newborn hours, a project manager that never sleeps (GPT-6 Astra), and an engineer that never gets tired of building (Claude Opus 5.5).",
  ask: "What can you create?",
  small:
    "The demo runs on a synthetic chain; the proof is recorded on NEAR testnet. Every business, person and number is fictional.",
};

export const FPS = 60;
export const totalSeconds = () => BEATS.reduce((n, b) => n + b.dur, 0);

/** The beat playing at `t` seconds, and how far into it. */
export function beatAt(t: number): { index: number; local: number } {
  let start = 0;
  for (let i = 0; i < BEATS.length; i++) {
    const dur = (BEATS[i] as Beat).dur;
    if (t < start + dur) return { index: i, local: t - start };
    start += dur;
  }
  const last = BEATS.length - 1;
  return { index: last, local: (BEATS[last] as Beat).dur };
}

/** When a beat starts, in seconds. */
export function beatStart(index: number): number {
  return BEATS.slice(0, index).reduce((n, b) => n + b.dur, 0);
}

/** A cue's route with its {stop} names filled in from the recording. */
export function resolveRoute(to: string, stops: Record<string, string>): string | null {
  let missing = false;
  const out = to.replace(/\{(\w+)\}/g, (_m, name: string) => {
    const v = stops[name];
    if (!v) missing = true;
    return v ?? "";
  });
  return missing ? null : out;
}

/** The caption on screen `local` seconds into a beat. */
export function captionAt(beat: Beat, local: number): Caption | null {
  let now: Caption | null = null;
  for (const c of beat.captions) if (c.at <= local) now = c;
  return now;
}

/**
 * What is wrong with the script against a recording, if anything: every beat opens a page first,
 * and every page it opens is one its viewer walked while the recording ran (the build and the
 * tests both ask).
 */
export function videoProblems(data: {
  viewers: Record<string, { routes: string[] }>;
  stops: Record<string, string>;
}): string[] {
  const out: string[] = [];
  for (const b of BEATS) {
    const first = b.cues[0];
    if (!first || !("go" in first) || first.at !== 0 || !first.as)
      out.push(`beat ${b.id}: must open a page, as someone, at its first frame`);
    let viewer = "";
    for (const c of b.cues) {
      if (c.at < 0 || c.at >= b.dur)
        out.push(`beat ${b.id}: a cue at ${c.at}s is outside the beat`);
      if (!("go" in c)) continue;
      viewer = c.as ?? viewer;
      const to = resolveRoute(c.go, data.stops);
      if (!to) {
        out.push(`beat ${b.id}: no such place in the recording: ${c.go}`);
        continue;
      }
      const path = to.split("?")[0] as string;
      if (!data.viewers[viewer]?.routes.includes(path))
        out.push(`beat ${b.id}: ${path} was not walked by ${viewer || "anyone"}`);
    }
    for (const c of b.captions)
      if (c.at < 0 || c.at >= b.dur)
        out.push(`beat ${b.id}: a caption at ${c.at}s is outside the beat`);
  }
  return out;
}

/**
 * The voice-over, one line per beat (Tony records each in Audacity; wording settled with him on
 * Nov 11). A line fits its beat at about
 * 2.5 words a second and claims no more than the beat's captions do. docs/VIDEO.md carries the
 * same lines for reading aloud.
 */
export const VOICE: Record<string, string> = {
  open: "Everstreet is a launchpad and marketplace for the agentic economy that runs on NEAR. Launch a product, and people and agents find it and pay for it.",
  build:
    "Start with an idea, or bring a product you've already built. Shape it in the studio, then release it to customers at a price per use.",
  find: "Customers search for services they need today, or post requests for future solutions.",
  portfolio:
    "The portfolio shows what your businesses earn, what they deliver, and other financial metrics.",
  "agent-buys": "Agents get an HTTP 402 price and pay from their own NEAR account.",
  "agent-activity":
    "Businesses buy from each other: Signalwatch's agent pays Ledgerline to read its invoices.",
  allowance:
    "The agent also pays suppliers, within limits the contract enforces. Larger invoices wait for owner approval.",
  acquire:
    "Everstreet also allows investors and companies to search for businesses to acquire. Companies can opt to share financials, with revenue verifiable on NEAR.",
  terms: "The price waits in escrow. Both sides review the same exact terms.",
  close:
    "Both sides accept, and the contract transfers control. The seller collects the proceeds. The buyer assumes ownership.",
  "first-shift":
    "The business's Ethereum asset moves to the buyer too, signed with NEAR Chain Signatures.",
  refused: "The contract on NEAR refuses the former owner's actions.",
  cara: "Customers keep using what they paid for, even after the business changes hands.",
  proof:
    "On NEAR testnet, Ledgerline has changed hands three times. The contract refuses the former owner. All one hundred customer uses are accounted for.",
  explorers:
    "Each step is a public transaction: the agent's payment, the escrow, the refusal, the move on Ethereum.",
  end: "Everstreet. What can you create?",
};
