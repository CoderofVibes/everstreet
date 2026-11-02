// Adds the example businesses' fictional history to an existing local database (no reset).
//   npm run seed:history

import { openDb } from "../server/src/db.ts";
import { Store } from "../server/src/store.ts";
import { seedHistory } from "./lib/history.ts";

const store = new Store(openDb(process.env.EVERSTREET_DB ?? "data/runtime/everstreet.db"));
console.log(`Seeded ${seedHistory(store)} months of fictional history.`);
