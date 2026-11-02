// Adds the example businesses' fictional history, buyers and listings to an existing local
// database (no reset).
//   npm run seed:history

import { openDb } from "../server/src/db.ts";
import { Store } from "../server/src/store.ts";
import { seedBuyers } from "./lib/buyers.ts";
import { seedHistory } from "./lib/history.ts";

const store = new Store(openDb(process.env.EVERSTREET_DB ?? "data/runtime/everstreet.db"));
console.log(`Seeded ${seedHistory(store)} months of fictional history.`);
seedBuyers(store);
console.log(
  "Seeded fictional buyers and listings (Northline, Alder Lane co-op; Paperfin, an anonymous teaser).",
);
