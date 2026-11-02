// The platform's own records (launch projects, profiles, offers, inquiries, tasks) on Node's
// built-in SQLite. Brand-neutral names; public pages read only published projections.

import { DatabaseSync } from "node:sqlite";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS people (
  id TEXT PRIMARY KEY, display_name TEXT NOT NULL, headline TEXT NOT NULL DEFAULT '',
  bio TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY, person_id TEXT NOT NULL REFERENCES people(id), created_at TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS businesses (
  id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, owner_id TEXT NOT NULL REFERENCES people(id),
  name TEXT NOT NULL, tagline TEXT NOT NULL DEFAULT '', about TEXT NOT NULL DEFAULT '',
  family TEXT NOT NULL CHECK (family IN ('class','service','product','software','undecided')),
  stage TEXT NOT NULL CHECK (stage IN ('shape','test','launch','grow')),
  published_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY, business_id TEXT NOT NULL REFERENCES businesses(id),
  route TEXT NOT NULL CHECK (route IN ('idea','find','started')),
  step TEXT NOT NULL, explore TEXT NOT NULL DEFAULT '{}', directions TEXT NOT NULL DEFAULT '[]',
  answers TEXT NOT NULL DEFAULT '{}', updated_at TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS offers (
  id TEXT PRIMARY KEY, business_id TEXT NOT NULL REFERENCES businesses(id), version INTEGER NOT NULL,
  title TEXT NOT NULL DEFAULT '', outcome TEXT NOT NULL DEFAULT '', audience TEXT NOT NULL DEFAULT '',
  not_for TEXT NOT NULL DEFAULT '', deliverable TEXT NOT NULL DEFAULT '', includes TEXT NOT NULL DEFAULT '',
  price_cents INTEGER, price_unit TEXT NOT NULL DEFAULT 'per person', first_free INTEGER NOT NULL DEFAULT 0,
  delivery TEXT NOT NULL DEFAULT '', when_text TEXT NOT NULL DEFAULT '', where_text TEXT NOT NULL DEFAULT '',
  capacity INTEGER, confirmed INTEGER NOT NULL DEFAULT 0, edited TEXT NOT NULL DEFAULT '[]',
  published_at TEXT, updated_at TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS ideas (
  business_id TEXT PRIMARY KEY REFERENCES businesses(id), problem TEXT NOT NULL DEFAULT '',
  why_me TEXT NOT NULL DEFAULT '', ask TEXT NOT NULL DEFAULT '', evidence TEXT NOT NULL DEFAULT '',
  published_at TEXT, updated_at TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS inquiries (
  id TEXT PRIMARY KEY, business_id TEXT NOT NULL REFERENCES businesses(id),
  from_id TEXT NOT NULL REFERENCES people(id),
  kind TEXT NOT NULL CHECK (kind IN ('interest','question')), message TEXT NOT NULL,
  share_contact INTEGER NOT NULL, reply TEXT, replied_at TEXT, created_at TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY, business_id TEXT NOT NULL REFERENCES businesses(id), title TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '', source TEXT NOT NULL, ref TEXT, done_at TEXT, sort INTEGER NOT NULL,
  created_at TEXT NOT NULL, UNIQUE (business_id, source, ref)
) STRICT;
CREATE TABLE IF NOT EXISTS integrations (
  business_id TEXT PRIMARY KEY REFERENCES businesses(id), provider TEXT NOT NULL,
  account_id TEXT NOT NULL, secret TEXT NOT NULL, created_at TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS sessions_offered (
  id TEXT PRIMARY KEY, business_id TEXT NOT NULL REFERENCES businesses(id),
  provider_ref TEXT NOT NULL, starts_at TEXT NOT NULL, ends_at TEXT NOT NULL,
  capacity INTEGER NOT NULL, created_at TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY, person_id TEXT NOT NULL REFERENCES people(id),
  business_id TEXT NOT NULL REFERENCES businesses(id), session_id TEXT NOT NULL REFERENCES sessions_offered(id),
  ref TEXT NOT NULL UNIQUE, source TEXT NOT NULL, created_at TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS follows (
  person_id TEXT NOT NULL REFERENCES people(id), business_id TEXT NOT NULL REFERENCES businesses(id),
  created_at TEXT NOT NULL, PRIMARY KEY (person_id, business_id)
) STRICT;
CREATE TABLE IF NOT EXISTS updates (
  id TEXT PRIMARY KEY, business_id TEXT NOT NULL REFERENCES businesses(id), body TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS needs (
  id TEXT PRIMARY KEY, person_id TEXT NOT NULL REFERENCES people(id), text TEXT NOT NULL,
  constraints TEXT NOT NULL, allow_replies INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open','closed')), expires_at TEXT NOT NULL, created_at TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS need_responses (
  id TEXT PRIMARY KEY, need_id TEXT NOT NULL REFERENCES needs(id),
  business_id TEXT NOT NULL REFERENCES businesses(id), message TEXT NOT NULL, reply TEXT,
  created_at TEXT NOT NULL, replied_at TEXT, UNIQUE (need_id, business_id)
) STRICT;
CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, subject TEXT NOT NULL, person_id TEXT NOT NULL,
  reason TEXT NOT NULL, created_at TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS chain_accounts (
  owner_kind TEXT NOT NULL CHECK (owner_kind IN ('person','business')), owner_id TEXT NOT NULL,
  account_id TEXT NOT NULL UNIQUE, secret TEXT, rules TEXT NOT NULL DEFAULT '{}', tx TEXT NOT NULL,
  created_at TEXT NOT NULL, PRIMARY KEY (owner_kind, owner_id)
) STRICT;
CREATE TABLE IF NOT EXISTS payments (
  order_id TEXT PRIMARY KEY, person_id TEXT NOT NULL REFERENCES people(id),
  business_id TEXT NOT NULL REFERENCES businesses(id), session_id TEXT NOT NULL,
  booking_id TEXT REFERENCES bookings(id), amount_cents INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('submitted','unknown','paid','failed','delivered','refunded','kept')),
  tx TEXT, refund_tx TEXT, deliver_tx TEXT, error TEXT, cancel_before TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY, type TEXT NOT NULL, subject TEXT NOT NULL, actor TEXT,
  payload TEXT NOT NULL, at TEXT NOT NULL
) STRICT;
`;

export function openDb(path: string) {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA);
  // Columns added after the first release: attribution of how a response arrived.
  const cols = db.prepare("PRAGMA table_info(inquiries)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "source")) {
    db.exec("ALTER TABLE inquiries ADD COLUMN source TEXT NOT NULL DEFAULT 'unknown'");
  }
  return db;
}

export type Db = DatabaseSync;
