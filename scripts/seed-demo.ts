// Fills a fresh local Everstreet with a few fictional businesses at different stages, created
// through the same store calls the app uses, so search and "Starting now" have something real
// to show. Everyone and everything here is invented.
//
//   npm run seed:demo             only if the database is empty
//   npm run seed:demo -- --reset  delete the local database first (stop the app before)

import { existsSync, mkdirSync, rmSync } from "node:fs";
import { openDb } from "../server/src/db.ts";
import { Store } from "../server/src/store.ts";

const DB = process.env.EVERSTREET_DB ?? "data/runtime/everstreet.db";
mkdirSync("data/runtime", { recursive: true });
if (process.argv.includes("--reset")) {
  for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) if (existsSync(f)) rmSync(f);
}
const store = new Store(openDb(DB));
if (store.people().length > 0) {
  console.log("The local database already has people in it. Use --reset to start over.");
  process.exit(0);
}

interface Example {
  founder: string;
  headline: string;
  bio: string;
  business: string;
  tagline: string;
  family: "class" | "service" | "product" | "software";
  interview: Record<string, string | boolean>;
  idea: { problem: string; ask: string };
}

const EXAMPLES: Example[] = [
  {
    founder: "Mara Solis",
    headline: "Printmaker and teacher on Alder Lane",
    bio: "I have been carving blocks for ten years. Teaching people to make their first print is my favourite part.",
    business: "Juniper Print Studio",
    tagline: "Beginner linocut printmaking on Saturday mornings",
    family: "class",
    interview: {
      audience: "Adults who have never tried printmaking",
      outcome: "Make your first three linocut prints",
      deliverable:
        "A relaxed 90-minute session at a shared table. You carve one block and leave with three prints.",
      includes: "All materials, tea, and a carving tool to keep",
      evidence: "Ten years of printmaking; I ran the library's kids' art club for two years.",
      price: "$35",
      price_unit: "per person",
      when: "Saturdays in November, 10:00",
      where: "14 Alder Lane (fictional)",
      capacity: "6",
      confirmed: true,
    },
    idea: {
      problem:
        "Trying printmaking for the first time is hard to do alone, and most classes assume you already know the basics.",
      ask: "Tell me which Saturday would suit you",
    },
  },
  {
    founder: "Nadia Vale",
    headline: "Developer; builds small, dependable APIs",
    bio: "I kept rebuilding the same receipt renderer for every shop I worked with, so I made it a service.",
    business: "Paperfin API",
    tagline: "Order data in, a clean PDF receipt out",
    family: "software",
    interview: {
      audience: "Small online shops and the developers who build their checkout",
      outcome: "Send order data, get back a consistent PDF receipt",
      deliverable:
        "A hosted API: one request per receipt, with versioned templates and a sandbox key",
      includes: "Three templates, failed renders never billed",
      evidence: "Built and ran receipt rendering for four small shops over two years.",
      price: "$10",
      price_unit: "per 1,000 requests",
      first_free: false,
      when: "Available now",
      where: "Online",
      confirmed: true,
    },
    idea: {
      problem: "Every small commerce tool needs receipts, and everyone rebuilds the same renderer.",
      ask: "Tell me what your receipts need to include",
    },
  },
  {
    founder: "Theo Park",
    headline: "Bike mechanic, weekends",
    bio: "I fix my neighbours' bikes for free and they keep telling me to charge for it.",
    business: "Doorstep Bike Fix",
    tagline: "Tune-ups at your door on Sunday mornings",
    family: "service",
    interview: {
      audience: "Commuters in the north side neighbourhoods",
      outcome: "A bike that shifts and stops properly again, without taking it to a shop",
      deliverable: "A 45-minute tune-up at your door: gears, brakes, tyres and chain",
      evidence: "Five years fixing bikes for friends and neighbours.",
      price: "$40",
      price_unit: "per session",
      when: "Sunday mornings",
      where: "At your door, north side (fictional)",
      confirmed: false,
    },
    idea: {
      problem: "Taking a bike to a shop means a week without it.",
      ask: "Tell me what is wrong with your bike",
    },
  },
  {
    founder: "Ana Ruiz",
    headline: "Candle maker testing her first batch",
    bio: "I pour candles in my kitchen and want to know if anyone besides my sister would buy them.",
    business: "Small Hours Candles",
    tagline: "Hand-poured candles in small batches",
    family: "product",
    interview: {
      audience: "People looking for a small handmade gift",
      outcome: "A hand-poured candle in a reusable jar",
      deliverable: "One 8 oz soy candle, three scents to choose from",
      evidence: "Two years of pouring candles for friends.",
      price: "$18",
      price_unit: "per item",
      first_free: false,
      when: "First batch ships in December if twelve people are interested",
      confirmed: false,
    },
    idea: {
      problem: "Most gift candles are mass-made and smell the same.",
      ask: "Tell me which scent you would choose",
    },
  },
];

const people = [];
for (const ex of EXAMPLES) {
  const { person } = store.createPerson(ex.founder);
  store.updatePerson(person.id, { headline: ex.headline, bio: ex.bio });
  const me = store.person(person.id);
  const project = store.startProject(me, "idea", ex.business);
  store.answer(me, project.id, ex.interview);
  store.updateBusiness(me, project.business.id, {
    name: ex.business,
    tagline: ex.tagline,
    family: ex.family,
  });
  store.editIdea(me, project.business.id, { ...ex.idea, why_me: String(ex.interview.evidence) });
  store.publish(me, project.business.id);
  people.push({ me, slug: store.business(me, project.business.id).business.slug });
}

// A customer who has started talking to two of them.
const { person: sam } = store.createPerson("Sam Lee");
store.inquire(
  sam,
  people[0]?.slug as string,
  "question",
  "Can I book two places for the first Saturday?",
  true,
);
store.inquire(sam, people[3]?.slug as string, "interest", "Cedar and smoke, please.", false);

console.log(
  `Seeded ${EXAMPLES.length} fictional businesses and ${EXAMPLES.length + 1} people into ${DB}.`,
);
