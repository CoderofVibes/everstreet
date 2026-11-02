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
CREATE TABLE IF NOT EXISTS costs (
  id TEXT PRIMARY KEY, business_id TEXT NOT NULL REFERENCES businesses(id), yyyymm INTEGER NOT NULL,
  until_yyyymm INTEGER, category TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('direct','overhead')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0), recurring INTEGER NOT NULL, note TEXT NOT NULL DEFAULT '',
  origin TEXT NOT NULL CHECK (origin IN ('founder','seeded')), created_at TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS seeded_periods (
  business_id TEXT NOT NULL REFERENCES businesses(id), yyyymm INTEGER NOT NULL,
  revenue_cents INTEGER NOT NULL, note TEXT NOT NULL, PRIMARY KEY (business_id, yyyymm)
) STRICT;
CREATE TABLE IF NOT EXISTS value_settings (
  business_id TEXT PRIMARY KEY REFERENCES businesses(id), founder_hours_week REAL,
  hourly_rate_cents INTEGER, multiple_low REAL, multiple_high REAL, plan_customers_month INTEGER,
  share_numbers INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS value_snapshots (
  id TEXT PRIMARY KEY, business_id TEXT NOT NULL REFERENCES businesses(id), model TEXT NOT NULL,
  inputs_hash TEXT NOT NULL, inputs TEXT NOT NULL, output TEXT NOT NULL, created_at TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS value_scenarios (
  id TEXT PRIMARY KEY, business_id TEXT NOT NULL REFERENCES businesses(id), name TEXT NOT NULL,
  overrides TEXT NOT NULL, result TEXT NOT NULL, created_at TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS team (
  business_id TEXT NOT NULL REFERENCES businesses(id), person_id TEXT NOT NULL REFERENCES people(id),
  capabilities TEXT NOT NULL, appointed_tx TEXT, revoked_at TEXT, revoke_tx TEXT, created_at TEXT NOT NULL,
  PRIMARY KEY (business_id, person_id)
) STRICT;
CREATE TABLE IF NOT EXISTS buyers (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES people(id), name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('individual','strategic','fund','cooperative')),
  intent TEXT NOT NULL CHECK (intent IN ('operate','add','team')), about TEXT NOT NULL DEFAULT '',
  interests TEXT NOT NULL DEFAULT '', time_available TEXT NOT NULL DEFAULT '', skills TEXT NOT NULL DEFAULT '',
  budget_basis TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS buyer_members (
  buyer_id TEXT NOT NULL REFERENCES buyers(id), person_id TEXT NOT NULL REFERENCES people(id),
  role TEXT NOT NULL CHECK (role IN ('research','evidence','approve')), created_at TEXT NOT NULL,
  PRIMARY KEY (buyer_id, person_id)
) STRICT;
CREATE TABLE IF NOT EXISTS mandates (
  id TEXT PRIMARY KEY, buyer_id TEXT NOT NULL REFERENCES buyers(id), name TEXT NOT NULL,
  text TEXT NOT NULL DEFAULT '', criteria TEXT NOT NULL, last_seen_at TEXT, created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS listings (
  id TEXT PRIMARY KEY, business_id TEXT NOT NULL UNIQUE REFERENCES businesses(id),
  mode TEXT NOT NULL CHECK (mode IN ('closed','private','anonymous','named')),
  openness TEXT NOT NULL CHECK (openness IN ('curious','open','seeking')),
  asking_cents INTEGER, reason TEXT NOT NULL DEFAULT '', transition TEXT NOT NULL DEFAULT '',
  disclose TEXT NOT NULL DEFAULT '[]', listed_at TEXT, updated_at TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS listing_invites (
  listing_id TEXT NOT NULL REFERENCES listings(id), buyer_id TEXT NOT NULL REFERENCES buyers(id),
  created_at TEXT NOT NULL, PRIMARY KEY (listing_id, buyer_id)
) STRICT;
CREATE TABLE IF NOT EXISTS shortlist (
  buyer_id TEXT NOT NULL REFERENCES buyers(id), listing_id TEXT NOT NULL REFERENCES listings(id),
  note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, PRIMARY KEY (buyer_id, listing_id)
) STRICT;
CREATE TABLE IF NOT EXISTS access_requests (
  id TEXT PRIMARY KEY, buyer_id TEXT NOT NULL REFERENCES buyers(id),
  listing_id TEXT NOT NULL REFERENCES listings(id), requested_by TEXT NOT NULL REFERENCES people(id),
  categories TEXT NOT NULL, purpose TEXT NOT NULL, days INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','granted','declined','revoked','withdrawn')),
  granted TEXT, expires_at TEXT, decided_at TEXT, decision_note TEXT NOT NULL DEFAULT '',
  revoked_at TEXT, created_at TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS buyer_scenarios (
  id TEXT PRIMARY KEY, buyer_id TEXT NOT NULL REFERENCES buyers(id),
  business_id TEXT NOT NULL REFERENCES businesses(id), name TEXT NOT NULL, overrides TEXT NOT NULL,
  result TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS deals (
  id TEXT PRIMARY KEY, business_id TEXT NOT NULL REFERENCES businesses(id),
  buyer_id TEXT NOT NULL REFERENCES buyers(id), seller_id TEXT NOT NULL REFERENCES people(id),
  representative_id TEXT NOT NULL REFERENCES people(id), seller_account TEXT NOT NULL,
  buyer_account TEXT NOT NULL, business_account TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open','closed','cancelled','expired','void')),
  version INTEGER NOT NULL, closed_at TEXT, generation_after INTEGER, close_tx TEXT,
  claim_tx TEXT, claim_error TEXT, claimed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS deal_versions (
  deal_id TEXT NOT NULL REFERENCES deals(id), version INTEGER NOT NULL, price_cents INTEGER NOT NULL,
  expires_at TEXT NOT NULL, terms TEXT NOT NULL, terms_hash TEXT NOT NULL, digest TEXT NOT NULL,
  tx TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (deal_id, version)
) STRICT;
CREATE TABLE IF NOT EXISTS deal_steps (
  id INTEGER PRIMARY KEY, deal_id TEXT NOT NULL REFERENCES deals(id), kind TEXT NOT NULL,
  person_id TEXT, version INTEGER, ok INTEGER NOT NULL, tx TEXT, detail TEXT NOT NULL DEFAULT '',
  at TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS transfer_items (
  deal_id TEXT NOT NULL REFERENCES deals(id), key TEXT NOT NULL, name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','completed','excluded')), detail TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL, PRIMARY KEY (deal_id, key)
) STRICT;
CREATE TABLE IF NOT EXISTS ownership (
  id INTEGER PRIMARY KEY, business_id TEXT NOT NULL REFERENCES businesses(id),
  from_id TEXT NOT NULL REFERENCES people(id), to_id TEXT NOT NULL REFERENCES people(id),
  buyer_id TEXT REFERENCES buyers(id), deal_id TEXT REFERENCES deals(id), generation INTEGER,
  tx TEXT, at TEXT NOT NULL
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
