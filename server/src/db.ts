// The platform's own records (launch projects, profiles, offers, inquiries, tasks) on Node's
// built-in SQLite. Brand-neutral names; public pages read only published projections.

import { DatabaseSync } from "node:sqlite";

/** Build jobs. Intents: `build` (a product spec) and `propose` (a brief/screens proposal). */
function buildJobsTable(name: string) {
  return `CREATE TABLE IF NOT EXISTS ${name} (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES product_projects(id),
  business_id TEXT NOT NULL REFERENCES businesses(id), revision INTEGER NOT NULL,
  content_hash TEXT NOT NULL, intent TEXT NOT NULL CHECK (intent IN ('build','propose')),
  idempotency_key TEXT NOT NULL, fingerprint TEXT NOT NULL, provider TEXT NOT NULL,
  budget TEXT NOT NULL, pricing TEXT NOT NULL, retry_of TEXT REFERENCES build_jobs(id),
  requested_by TEXT NOT NULL REFERENCES people(id), owner_id TEXT NOT NULL REFERENCES people(id),
  owner_generation INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('queued','running','validating','succeeded','failed','cancelled','needs_reconciliation')),
  attempt INTEGER NOT NULL DEFAULT 0, lease_owner TEXT, lease_expires_at TEXT, started_at TEXT,
  dispatched_at TEXT, cancel_requested_at TEXT, failure_code TEXT, failure_detail TEXT,
  reserved_cents INTEGER NOT NULL CHECK (reserved_cents >= 0),
  charged_cents INTEGER NOT NULL DEFAULT 0 CHECK (charged_cents >= 0),
  usage_state TEXT NOT NULL DEFAULT 'none' CHECK (usage_state IN ('none','reported','unknown')),
  input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0,
  event_count INTEGER NOT NULL DEFAULT 0, artifact_digest TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, finished_at TEXT,
  usage_final INTEGER NOT NULL DEFAULT 0, charged_microcents INTEGER NOT NULL DEFAULT 0,
  provider_config TEXT NOT NULL DEFAULT '', request_ref TEXT,
  UNIQUE (project_id, idempotency_key)
) STRICT;`;
}

const BUILD_JOB_COLUMNS = [
  "id",
  "project_id",
  "business_id",
  "revision",
  "content_hash",
  "intent",
  "idempotency_key",
  "fingerprint",
  "provider",
  "budget",
  "pricing",
  "retry_of",
  "requested_by",
  "owner_id",
  "owner_generation",
  "state",
  "attempt",
  "lease_owner",
  "lease_expires_at",
  "started_at",
  "dispatched_at",
  "cancel_requested_at",
  "failure_code",
  "failure_detail",
  "reserved_cents",
  "charged_cents",
  "usage_state",
  "input_tokens",
  "output_tokens",
  "event_count",
  "artifact_digest",
  "created_at",
  "updated_at",
  "finished_at",
  "usage_final",
  "charged_microcents",
  "provider_config",
];

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
CREATE TABLE IF NOT EXISTS product_projects (
  id TEXT PRIMARY KEY, business_id TEXT NOT NULL REFERENCES businesses(id),
  foundation TEXT NOT NULL CHECK (foundation IN ('ai_api','saas_workflow','agent_service','client_portal')),
  idea TEXT NOT NULL, created_by TEXT NOT NULL REFERENCES people(id),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS product_projects_business ON product_projects(business_id);
CREATE TABLE IF NOT EXISTS product_revisions (
  project_id TEXT NOT NULL REFERENCES product_projects(id), number INTEGER NOT NULL CHECK (number >= 1),
  brief TEXT NOT NULL, prototype TEXT NOT NULL, content_hash TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '', restored_from INTEGER, author_id TEXT NOT NULL REFERENCES people(id),
  created_at TEXT NOT NULL, PRIMARY KEY (project_id, number)
) STRICT;
CREATE TRIGGER IF NOT EXISTS product_revisions_no_update BEFORE UPDATE ON product_revisions
BEGIN SELECT RAISE(ABORT, 'product revisions are immutable'); END;
CREATE TRIGGER IF NOT EXISTS product_revisions_no_delete BEFORE DELETE ON product_revisions
BEGIN SELECT RAISE(ABORT, 'product revisions are immutable'); END;
CREATE TABLE IF NOT EXISTS build_budgets (
  business_id TEXT PRIMARY KEY REFERENCES businesses(id),
  limit_cents INTEGER NOT NULL CHECK (limit_cents >= 0), updated_by TEXT NOT NULL REFERENCES people(id),
  updated_at TEXT NOT NULL
) STRICT;
${buildJobsTable("build_jobs")}
CREATE INDEX IF NOT EXISTS build_jobs_state ON build_jobs(state, created_at);
CREATE INDEX IF NOT EXISTS build_jobs_business ON build_jobs(business_id);
CREATE TABLE IF NOT EXISTS product_messages (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES product_projects(id),
  seq INTEGER NOT NULL, role TEXT NOT NULL CHECK (role IN ('founder','assistant')),
  text TEXT NOT NULL, author_id TEXT REFERENCES people(id), idempotency_key TEXT,
  job_id TEXT REFERENCES build_jobs(id), proposal_id TEXT, created_at TEXT NOT NULL,
  UNIQUE (project_id, seq), UNIQUE (project_id, idempotency_key)
) STRICT;
CREATE TABLE IF NOT EXISTS product_proposals (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES product_projects(id),
  job_id TEXT NOT NULL UNIQUE REFERENCES build_jobs(id), message_id TEXT NOT NULL,
  base_revision INTEGER NOT NULL, base_hash TEXT NOT NULL, brief TEXT NOT NULL,
  prototype TEXT NOT NULL, content_hash TEXT NOT NULL, summary TEXT NOT NULL,
  assumptions TEXT NOT NULL, questions TEXT NOT NULL, provider_config TEXT NOT NULL,
  requested_by TEXT NOT NULL REFERENCES people(id), owner_epoch TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open','applied','superseded')),
  applied_revision INTEGER, applied_by TEXT REFERENCES people(id), applied_at TEXT,
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS product_proposals_project ON product_proposals(project_id, created_at);
CREATE TABLE IF NOT EXISTS build_events (
  job_id TEXT NOT NULL REFERENCES build_jobs(id), seq INTEGER NOT NULL, attempt INTEGER NOT NULL,
  type TEXT NOT NULL, data TEXT NOT NULL, at TEXT NOT NULL, PRIMARY KEY (job_id, seq)
) STRICT;
CREATE TABLE IF NOT EXISTS build_artifacts (
  job_id TEXT PRIMARY KEY REFERENCES build_jobs(id), attempt INTEGER NOT NULL, kind TEXT NOT NULL,
  schema_version INTEGER NOT NULL, digest TEXT NOT NULL, bytes INTEGER NOT NULL, content TEXT NOT NULL,
  checks TEXT NOT NULL, provenance TEXT NOT NULL, created_at TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS build_usage (
  id INTEGER PRIMARY KEY, job_id TEXT NOT NULL REFERENCES build_jobs(id), attempt INTEGER NOT NULL,
  ledger TEXT NOT NULL CHECK (ledger = 'build'),
  kind TEXT NOT NULL CHECK (kind IN ('reservation','release','actual','unknown')),
  cents INTEGER, input_tokens INTEGER, output_tokens INTEGER, note TEXT NOT NULL DEFAULT '', at TEXT NOT NULL
) STRICT;
CREATE TRIGGER IF NOT EXISTS build_events_no_update BEFORE UPDATE ON build_events
BEGIN SELECT RAISE(ABORT, 'build events are append-only'); END;
CREATE TRIGGER IF NOT EXISTS build_events_no_delete BEFORE DELETE ON build_events
BEGIN SELECT RAISE(ABORT, 'build events are append-only'); END;
CREATE TRIGGER IF NOT EXISTS build_artifacts_no_update BEFORE UPDATE ON build_artifacts
BEGIN SELECT RAISE(ABORT, 'build artifacts are immutable'); END;
CREATE TRIGGER IF NOT EXISTS build_artifacts_no_delete BEFORE DELETE ON build_artifacts
BEGIN SELECT RAISE(ABORT, 'build artifacts are immutable'); END;
-- Job 002c: running a product. Its own budget and ledger, never summed with build usage.
CREATE TABLE IF NOT EXISTS runtime_budgets (
  business_id TEXT PRIMARY KEY REFERENCES businesses(id),
  limit_cents INTEGER NOT NULL CHECK (limit_cents >= 0), updated_by TEXT NOT NULL REFERENCES people(id),
  updated_at TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS runtime_invocations (
  id TEXT PRIMARY KEY, business_id TEXT NOT NULL REFERENCES businesses(id),
  project_id TEXT NOT NULL REFERENCES product_projects(id),
  artifact_job TEXT NOT NULL REFERENCES build_jobs(id), artifact_digest TEXT NOT NULL, release_id TEXT,
  purpose TEXT NOT NULL CHECK (purpose IN ('trial','evaluation','release','customer_use')),
  eval_run TEXT, eval_case TEXT,
  requested_by TEXT NOT NULL REFERENCES people(id), owner_id TEXT NOT NULL, owner_generation INTEGER NOT NULL,
  idempotency_key TEXT NOT NULL, fingerprint TEXT NOT NULL, input_sha TEXT NOT NULL, input_chars INTEGER NOT NULL,
  provider TEXT NOT NULL, provider_config TEXT NOT NULL, validator TEXT NOT NULL, pricing TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('running','completed','failed','cancelled','unknown')),
  outcome TEXT CHECK (outcome IN ('extracted','incomplete','refused','invalid')),
  failure_class TEXT, failure_detail TEXT, output TEXT,
  reserved_cents INTEGER NOT NULL DEFAULT 0, charged_cents INTEGER NOT NULL DEFAULT 0,
  charged_microcents INTEGER NOT NULL DEFAULT 0,
  usage_state TEXT NOT NULL DEFAULT 'none' CHECK (usage_state IN ('none','final','partial','unknown')),
  input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0,
  cancel_requested_at TEXT, dispatched_at TEXT, created_at TEXT NOT NULL, finished_at TEXT, elapsed_ms INTEGER,
  UNIQUE (project_id, idempotency_key)
) STRICT;
CREATE INDEX IF NOT EXISTS runtime_invocations_project ON runtime_invocations(project_id, created_at);
CREATE TABLE IF NOT EXISTS runtime_usage (
  id INTEGER PRIMARY KEY, invocation_id TEXT NOT NULL REFERENCES runtime_invocations(id),
  ledger TEXT NOT NULL CHECK (ledger = 'runtime'),
  kind TEXT NOT NULL CHECK (kind IN ('reservation','release','actual','unknown')),
  cents INTEGER, microcents INTEGER, input_tokens INTEGER, output_tokens INTEGER,
  note TEXT NOT NULL DEFAULT '', at TEXT NOT NULL
) STRICT;
CREATE TRIGGER IF NOT EXISTS runtime_usage_no_update BEFORE UPDATE ON runtime_usage
BEGIN SELECT RAISE(ABORT, 'runtime usage is append-only'); END;
CREATE TRIGGER IF NOT EXISTS runtime_usage_no_delete BEFORE DELETE ON runtime_usage
BEGIN SELECT RAISE(ABORT, 'runtime usage is append-only'); END;
-- Founder-approved test cases: every edit is a new immutable version.
CREATE TABLE IF NOT EXISTS eval_fixtures (
  project_id TEXT NOT NULL REFERENCES product_projects(id), version INTEGER NOT NULL,
  source TEXT NOT NULL, cases TEXT NOT NULL, created_by TEXT NOT NULL REFERENCES people(id),
  created_at TEXT NOT NULL, PRIMARY KEY (project_id, version)
) STRICT;
CREATE TRIGGER IF NOT EXISTS eval_fixtures_no_update BEFORE UPDATE ON eval_fixtures
BEGIN SELECT RAISE(ABORT, 'test case versions are immutable'); END;
CREATE TRIGGER IF NOT EXISTS eval_fixtures_no_delete BEFORE DELETE ON eval_fixtures
BEGIN SELECT RAISE(ABORT, 'test case versions are immutable'); END;
CREATE TABLE IF NOT EXISTS eval_runs (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES product_projects(id),
  business_id TEXT NOT NULL REFERENCES businesses(id),
  artifact_job TEXT NOT NULL REFERENCES build_jobs(id), artifact_digest TEXT NOT NULL,
  fixture_version INTEGER NOT NULL, validator TEXT NOT NULL, provider_config TEXT NOT NULL,
  requested_by TEXT NOT NULL REFERENCES people(id),
  state TEXT NOT NULL CHECK (state IN ('running','complete','stopped')),
  results TEXT NOT NULL DEFAULT '[]', passed INTEGER NOT NULL DEFAULT 0, failed INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0, not_applicable INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL,
  created_at TEXT NOT NULL, finished_at TEXT
) STRICT;
CREATE TABLE IF NOT EXISTS runtime_releases (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES product_projects(id),
  business_id TEXT NOT NULL REFERENCES businesses(id),
  artifact_job TEXT NOT NULL REFERENCES build_jobs(id), artifact_digest TEXT NOT NULL,
  eval_run TEXT NOT NULL REFERENCES eval_runs(id), fixture_version INTEGER NOT NULL,
  validator TEXT NOT NULL, provider_config TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('active','retired')), rolled_back_from TEXT,
  activated_by TEXT NOT NULL REFERENCES people(id), owner_id TEXT NOT NULL, owner_generation INTEGER NOT NULL,
  activated_at TEXT NOT NULL, retired_at TEXT
) STRICT;
CREATE UNIQUE INDEX IF NOT EXISTS runtime_releases_one_active ON runtime_releases(project_id) WHERE state = 'active';
-- Job 004a: bringing an existing product. A private workspace belongs to a business; every
-- inspection of a supplied manifest is an immutable snapshot of normalized facts (never the raw
-- file), with an immutable readiness report. Founder statements are versioned per item.
CREATE TABLE IF NOT EXISTS import_workspaces (
  id TEXT PRIMARY KEY, business_id TEXT NOT NULL REFERENCES businesses(id),
  name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  product_kind TEXT NOT NULL CHECK (product_kind IN ('saas','api','ai_tool','agent','website','online_service','near_app','other')),
  version INTEGER NOT NULL CHECK (version >= 1), created_by TEXT NOT NULL REFERENCES people(id),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS import_workspaces_business ON import_workspaces(business_id);
CREATE TABLE IF NOT EXISTS import_requests (
  person_id TEXT NOT NULL REFERENCES people(id), idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL, workspace_id TEXT NOT NULL REFERENCES import_workspaces(id),
  created_at TEXT NOT NULL, PRIMARY KEY (person_id, idempotency_key)
) STRICT;
CREATE TABLE IF NOT EXISTS import_inspections (
  workspace_id TEXT NOT NULL REFERENCES import_workspaces(id), number INTEGER NOT NULL CHECK (number >= 1),
  inspector TEXT NOT NULL, inspector_version TEXT NOT NULL, input_digest TEXT NOT NULL,
  input_bytes INTEGER NOT NULL, facts TEXT NOT NULL, idempotency_key TEXT NOT NULL,
  requested_by TEXT NOT NULL REFERENCES people(id), created_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, number), UNIQUE (workspace_id, idempotency_key)
) STRICT;
CREATE TRIGGER IF NOT EXISTS import_inspections_no_update BEFORE UPDATE ON import_inspections
BEGIN SELECT RAISE(ABORT, 'inspections are immutable'); END;
CREATE TRIGGER IF NOT EXISTS import_inspections_no_delete BEFORE DELETE ON import_inspections
BEGIN SELECT RAISE(ABORT, 'inspections are immutable'); END;
CREATE TABLE IF NOT EXISTS import_reports (
  workspace_id TEXT NOT NULL REFERENCES import_workspaces(id), number INTEGER NOT NULL,
  inspection_number INTEGER NOT NULL, report TEXT NOT NULL, created_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, number)
) STRICT;
CREATE TRIGGER IF NOT EXISTS import_reports_no_update BEFORE UPDATE ON import_reports
BEGIN SELECT RAISE(ABORT, 'readiness reports are immutable'); END;
CREATE TRIGGER IF NOT EXISTS import_reports_no_delete BEFORE DELETE ON import_reports
BEGIN SELECT RAISE(ABORT, 'readiness reports are immutable'); END;
CREATE TABLE IF NOT EXISTS import_dependencies (
  workspace_id TEXT NOT NULL REFERENCES import_workspaces(id),
  category TEXT NOT NULL CHECK (category IN ('source_ownership','hosting','database','model_provider','authentication','payments','domain','customer_promises')),
  uses INTEGER CHECK (uses IN (0, 1)), note TEXT NOT NULL DEFAULT '',
  asserted_by TEXT REFERENCES people(id), asserted_at TEXT, version INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (workspace_id, category)
) STRICT;
-- Job 003h: read-only observations of business-v3 contracts. Decoded snapshots only (never raw
-- transport text); the projection and its high-water mark are never pruned, so ordering
-- survives restarts and retention.
CREATE TABLE IF NOT EXISTS v3_observations (
  id INTEGER PRIMARY KEY, business_id TEXT NOT NULL REFERENCES businesses(id),
  network TEXT NOT NULL, account TEXT NOT NULL, schema TEXT NOT NULL,
  block_height TEXT NOT NULL, block_hash TEXT NOT NULL, control_seq TEXT NOT NULL,
  generation INTEGER NOT NULL, owner TEXT NOT NULL, snapshot TEXT NOT NULL, digest TEXT NOT NULL,
  observed_at TEXT NOT NULL, UNIQUE (business_id, block_hash)
) STRICT;
CREATE TABLE IF NOT EXISTS v3_outcomes (
  business_id TEXT NOT NULL REFERENCES businesses(id), seq TEXT NOT NULL, status TEXT NOT NULL,
  outcome TEXT NOT NULL, first_block_height TEXT NOT NULL, PRIMARY KEY (business_id, seq)
) STRICT;
CREATE TRIGGER IF NOT EXISTS v3_outcomes_no_update BEFORE UPDATE ON v3_outcomes
BEGIN SELECT RAISE(ABORT, 'observed outcomes are immutable'); END;
CREATE TABLE IF NOT EXISTS v3_projection (
  business_id TEXT PRIMARY KEY REFERENCES businesses(id),
  network TEXT NOT NULL, account TEXT NOT NULL, schema TEXT NOT NULL,
  observation_id INTEGER NOT NULL, high_block_height TEXT NOT NULL, high_block_hash TEXT NOT NULL,
  high_control_seq TEXT NOT NULL, flag TEXT, flag_detail TEXT, updated_at TEXT NOT NULL
) STRICT;
-- Job 005a: a project inspired by a publicly shared request keeps a bounded snapshot of it (never
-- its author, contact, replies or searches). Keyed by project, so it follows business control.
CREATE TABLE IF NOT EXISTS project_sources (
  project_id TEXT PRIMARY KEY REFERENCES product_projects(id), need_id TEXT NOT NULL,
  need_text TEXT NOT NULL, constraints TEXT NOT NULL, allow_replies INTEGER NOT NULL,
  need_created_at TEXT NOT NULL, need_expires_at TEXT NOT NULL, captured_at TEXT NOT NULL,
  constraints_unreadable TEXT NOT NULL DEFAULT '[]'
) STRICT;
CREATE TABLE IF NOT EXISTS need_project_requests (
  person_id TEXT NOT NULL REFERENCES people(id), idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL, project_id TEXT NOT NULL REFERENCES product_projects(id),
  created_at TEXT NOT NULL, PRIMARY KEY (person_id, idempotency_key)
) STRICT;
-- Job 003k: an exact v3 acquisition intent, one per deal version (docs/design/V3_RECONCILIATION.md).
-- Its terms come from the observed live deal; the digest is the contract's own.
CREATE TABLE IF NOT EXISTS v3_intents (
  id TEXT PRIMARY KEY, business_id TEXT NOT NULL REFERENCES businesses(id),
  network TEXT NOT NULL, account TEXT NOT NULL, schema TEXT NOT NULL,
  deal_seq TEXT NOT NULL, version INTEGER NOT NULL, digest TEXT NOT NULL, terms TEXT NOT NULL,
  seller_account TEXT NOT NULL, buyer_account TEXT NOT NULL, expected_generation INTEGER NOT NULL,
  seller_person_id TEXT NOT NULL REFERENCES people(id), buyer_person_id TEXT NOT NULL REFERENCES people(id),
  local_epoch INTEGER NOT NULL, recorded_block TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('recorded','applied','ended','superseded')),
  idempotency_key TEXT NOT NULL, request_hash TEXT NOT NULL, result TEXT,
  created_by TEXT NOT NULL REFERENCES people(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE (business_id, idempotency_key), UNIQUE (business_id, network, account, deal_seq, version)
) STRICT;
-- Job 003i: the stored observation format (key 'observation_format'); see V3_OBSERVATIONS.md §8.
CREATE TABLE IF NOT EXISTS v3_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
-- Job 003h1: period evidence kept apart from the core snapshot: the newest per month, each with
-- its own block and observation time; at most 24 months per business.
CREATE TABLE IF NOT EXISTS v3_periods (
  business_id TEXT NOT NULL REFERENCES businesses(id), yyyymm INTEGER NOT NULL,
  block_height TEXT NOT NULL, block_hash TEXT NOT NULL, period TEXT NOT NULL, digest TEXT NOT NULL,
  observed_at TEXT NOT NULL, PRIMARY KEY (business_id, yyyymm)
) STRICT;
-- Job 003m: customer use (docs/design/CUSTOMER_USE_RUNTIME.md §8). An offer binds a release to a
-- contract plan; it is the business's, immutable but for retirement. A request is the customer's
-- own record: never the owner's, before or after a sale. Raw input is never stored here.
CREATE TABLE IF NOT EXISTS customer_offers (
  id TEXT PRIMARY KEY, business_id TEXT NOT NULL REFERENCES businesses(id),
  project_id TEXT NOT NULL REFERENCES product_projects(id),
  release_id TEXT NOT NULL REFERENCES runtime_releases(id), artifact_digest TEXT NOT NULL,
  network TEXT NOT NULL, account TEXT NOT NULL, plan_id INTEGER NOT NULL, plan TEXT NOT NULL,
  asset TEXT NOT NULL, read_block TEXT NOT NULL, retention_days INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('active','retired')),
  idempotency_key TEXT NOT NULL, request_hash TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES people(id), owner_generation INTEGER NOT NULL,
  created_at TEXT NOT NULL, retired_at TEXT, UNIQUE (business_id, idempotency_key)
) STRICT;
CREATE UNIQUE INDEX IF NOT EXISTS customer_offers_one_active ON customer_offers(release_id, plan_id) WHERE state = 'active';
CREATE TRIGGER IF NOT EXISTS customer_offers_immutable BEFORE UPDATE ON customer_offers
WHEN OLD.state = 'retired' OR NEW.state <> 'retired' OR NEW.id IS NOT OLD.id
  OR NEW.business_id IS NOT OLD.business_id OR NEW.project_id IS NOT OLD.project_id
  OR NEW.release_id IS NOT OLD.release_id OR NEW.artifact_digest IS NOT OLD.artifact_digest
  OR NEW.network IS NOT OLD.network OR NEW.account IS NOT OLD.account
  OR NEW.plan_id IS NOT OLD.plan_id OR NEW.plan IS NOT OLD.plan OR NEW.asset IS NOT OLD.asset
  OR NEW.read_block IS NOT OLD.read_block OR NEW.retention_days IS NOT OLD.retention_days
  OR NEW.idempotency_key IS NOT OLD.idempotency_key OR NEW.request_hash IS NOT OLD.request_hash
  OR NEW.created_by IS NOT OLD.created_by OR NEW.owner_generation IS NOT OLD.owner_generation
  OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT, 'customer offers are immutable but for retirement'); END;
CREATE TRIGGER IF NOT EXISTS customer_offers_no_delete BEFORE DELETE ON customer_offers
BEGIN SELECT RAISE(ABORT, 'customer offers are kept'); END;
CREATE TABLE IF NOT EXISTS customer_requests (
  id TEXT PRIMARY KEY, person_id TEXT NOT NULL REFERENCES people(id), customer_account TEXT NOT NULL,
  offer_id TEXT NOT NULL REFERENCES customer_offers(id), business_id TEXT NOT NULL REFERENCES businesses(id),
  idempotency_key TEXT NOT NULL, request_hash TEXT NOT NULL,
  input_sha TEXT NOT NULL, input_chars INTEGER NOT NULL, input_ref TEXT, input_scheme TEXT,
  network TEXT NOT NULL, account TEXT NOT NULL, plan_id INTEGER NOT NULL, reg_id TEXT NOT NULL,
  key_slot INTEGER NOT NULL, key_epoch INTEGER NOT NULL, public_key TEXT NOT NULL,
  hold_seq INTEGER NOT NULL, units INTEGER NOT NULL CHECK (units = 1), slot INTEGER NOT NULL CHECK (slot = 0),
  serve_until_ms TEXT NOT NULL, settle_until_ms TEXT NOT NULL, accept_by_ms TEXT NOT NULL,
  sign_by_ms INTEGER NOT NULL, salt TEXT NOT NULL, fingerprint TEXT NOT NULL,
  hold_message TEXT NOT NULL, use_message TEXT NOT NULL, envelope TEXT NOT NULL, envelope_digest TEXT NOT NULL,
  hold_sig TEXT, use_sig TEXT, prepared_block TEXT NOT NULL, notice TEXT,
  state TEXT NOT NULL CHECK (state IN ('prepared','reserve_requested','reserve_unknown','reserved','refused','unresolved','cancelled','expired')),
  reason TEXT, serving INTEGER, evidence TEXT, evidence_height TEXT, evidence_mark TEXT, conflict TEXT,
  input_deleted_at TEXT,
  lease_gen INTEGER NOT NULL DEFAULT 0, lease_until INTEGER, submissions INTEGER NOT NULL DEFAULT 0,
  allocation TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE (person_id, idempotency_key)
) STRICT;
CREATE UNIQUE INDEX IF NOT EXISTS customer_requests_one_allocation ON customer_requests(allocation) WHERE allocation IS NOT NULL;
CREATE INDEX IF NOT EXISTS customer_requests_due ON customer_requests(state, updated_at);
CREATE TABLE IF NOT EXISTS customer_request_events (
  request_id TEXT NOT NULL REFERENCES customer_requests(id), seq INTEGER NOT NULL,
  kind TEXT NOT NULL, code TEXT, block TEXT, lease_gen INTEGER, at TEXT NOT NULL,
  PRIMARY KEY (request_id, seq)
) STRICT;
-- Job 003n: one execution per reserved customer request, one-to-one with its customer_use
-- invocation. The invocation keeps cost only; the result exists only behind the protection seam.
CREATE TABLE IF NOT EXISTS customer_executions (
  request_id TEXT PRIMARY KEY REFERENCES customer_requests(id),
  invocation_id TEXT NOT NULL UNIQUE REFERENCES runtime_invocations(id),
  person_id TEXT NOT NULL REFERENCES people(id), admission TEXT NOT NULL,
  input_source TEXT NOT NULL CHECK (input_source IN ('protected','resubmitted')),
  result_state TEXT NOT NULL CHECK (result_state IN ('pending','stored','none','unavailable','deleted')),
  result_ref TEXT, result_scheme TEXT, result_outcome TEXT, retention_until_ms INTEGER,
  delivered_at TEXT, delivery TEXT CHECK (delivery IN ('protecting','delivered','not_delivered')),
  delivery_started_ms INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS customer_executions_retention ON customer_executions(result_state, retention_until_ms);
-- Job 003o: one unit outcome per reserved request: charge the delivered use, or release the
-- unused unit. Its own state, separate from the invocation's provider cost (never counted twice).
CREATE TABLE IF NOT EXISTS customer_settlements (
  request_id TEXT PRIMARY KEY REFERENCES customer_requests(id),
  kind TEXT NOT NULL CHECK (kind IN ('charge','release')),
  state TEXT NOT NULL CHECK (state IN ('requested','unknown','charged','returned','conflict','unresolved')),
  reason TEXT, eligibility TEXT NOT NULL,
  submissions INTEGER NOT NULL DEFAULT 0, lease_gen INTEGER NOT NULL DEFAULT 0, lease_until INTEGER,
  evidence TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS customer_settlements_due ON customer_settlements(state, updated_at);
-- Job 002d: customer maintenance coordination. One lease row per supervisor name (compare-and-
-- set claim/renew/expiry across processes); one status row per name (heartbeat and the last
-- pass's safe counts); per-item backoff so failing or undecidable work never blocks the rest.
CREATE TABLE IF NOT EXISTS maintenance_lease (
  name TEXT PRIMARY KEY, holder TEXT NOT NULL, gen INTEGER NOT NULL, until_ms INTEGER NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS maintenance_status (
  name TEXT PRIMARY KEY, holder TEXT, state TEXT NOT NULL CHECK (state IN ('running','stopped')),
  interval_ms INTEGER NOT NULL, started_ms INTEGER, heartbeat_ms INTEGER, last_pass_ms INTEGER,
  last_pass TEXT
) STRICT;
CREATE TABLE IF NOT EXISTS maintenance_backoff (
  task TEXT NOT NULL CHECK (task IN ('reserve','settle','result','input')), subject TEXT NOT NULL,
  failures INTEGER NOT NULL, next_ms INTEGER NOT NULL, code TEXT NOT NULL, updated_ms INTEGER NOT NULL,
  PRIMARY KEY (task, subject)
) STRICT;
CREATE TRIGGER IF NOT EXISTS customer_request_events_no_update BEFORE UPDATE ON customer_request_events
BEGIN SELECT RAISE(ABORT, 'customer request events are append-only'); END;
CREATE TRIGGER IF NOT EXISTS customer_request_events_no_delete BEFORE DELETE ON customer_request_events
BEGIN SELECT RAISE(ABORT, 'customer request events are append-only'); END;
CREATE TRIGGER IF NOT EXISTS build_usage_no_update BEFORE UPDATE ON build_usage
BEGIN SELECT RAISE(ABORT, 'build usage is append-only'); END;
CREATE TRIGGER IF NOT EXISTS build_usage_no_delete BEFORE DELETE ON build_usage
BEGIN SELECT RAISE(ABORT, 'build usage is append-only'); END;
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
  // Build jobs, after the first review (job 002a1): a complete usage receipt, the exact cost,
  // and the provider configuration a job is pinned to.
  const jobCols = new Set(
    (db.prepare("PRAGMA table_info(build_jobs)").all() as { name: string }[]).map((c) => c.name),
  );
  if (!jobCols.has("usage_final"))
    db.exec("ALTER TABLE build_jobs ADD COLUMN usage_final INTEGER NOT NULL DEFAULT 0");
  if (!jobCols.has("charged_microcents"))
    db.exec("ALTER TABLE build_jobs ADD COLUMN charged_microcents INTEGER NOT NULL DEFAULT 0");
  if (!jobCols.has("provider_config"))
    db.exec("ALTER TABLE build_jobs ADD COLUMN provider_config TEXT NOT NULL DEFAULT ''");
  // Job 003p: evidence access. `access_version` changes on every decision about a request, so a
  // read that started under one grant can tell the grant changed while it was in flight.
  // `scope_version` and `disclose_version` record which wording a grant or listing was agreed
  // under; rows from before stay at 1 and keep the scope they were agreed with.
  const columns = (table: string) =>
    new Set(
      (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name),
    );
  const requestCols = columns("access_requests");
  if (!requestCols.has("access_version"))
    db.exec("ALTER TABLE access_requests ADD COLUMN access_version INTEGER NOT NULL DEFAULT 0");
  if (!requestCols.has("scope_version"))
    db.exec("ALTER TABLE access_requests ADD COLUMN scope_version INTEGER NOT NULL DEFAULT 1");
  // Job 003f: a one-off cost in a closed month is never deleted; a correction marks it.
  const costCols = columns("costs");
  if (!costCols.has("voided_at")) db.exec("ALTER TABLE costs ADD COLUMN voided_at TEXT");
  if (!costCols.has("void_note"))
    db.exec("ALTER TABLE costs ADD COLUMN void_note TEXT NOT NULL DEFAULT ''");
  // Job 002c1: the release policy a check ran under and a release was made with. Rows from
  // before have an empty policy, so they read as stale and need a new check.
  if (!columns("eval_runs").has("policy"))
    db.exec("ALTER TABLE eval_runs ADD COLUMN policy TEXT NOT NULL DEFAULT ''");
  if (!columns("runtime_releases").has("policy"))
    db.exec("ALTER TABLE runtime_releases ADD COLUMN policy TEXT NOT NULL DEFAULT ''");
  if (!columns("listings").has("disclose_version"))
    db.exec("ALTER TABLE listings ADD COLUMN disclose_version INTEGER NOT NULL DEFAULT 1");
  // Job 005a1: which stated constraints couldn't be read when a project captured its request.
  if (!columns("project_sources").has("constraints_unreadable"))
    db.exec(
      "ALTER TABLE project_sources ADD COLUMN constraints_unreadable TEXT NOT NULL DEFAULT '[]'",
    );
  // Job 003m1: the fenced evidence mark and a sticky evidence conflict per customer request. A row
  // from 003m has no mark; it is fenced from its prepared block when next read.
  const requestCols003m = columns("customer_requests");
  if (!requestCols003m.has("evidence_mark"))
    db.exec("ALTER TABLE customer_requests ADD COLUMN evidence_mark TEXT");
  if (!requestCols003m.has("conflict"))
    db.exec("ALTER TABLE customer_requests ADD COLUMN conflict TEXT");
  // Job 003n1: when a protected input was deleted, and when a result was durably delivered.
  if (!requestCols003m.has("input_deleted_at"))
    db.exec("ALTER TABLE customer_requests ADD COLUMN input_deleted_at TEXT");
  if (!columns("customer_executions").has("delivered_at"))
    db.exec("ALTER TABLE customer_executions ADD COLUMN delivered_at TEXT");
  // Job 003o1: the durable delivery decision (null: undecided) and when protection started.
  if (!columns("customer_executions").has("delivery"))
    db.exec(
      "ALTER TABLE customer_executions ADD COLUMN delivery TEXT CHECK (delivery IN ('protecting','delivered','not_delivered'))",
    );
  if (!columns("customer_executions").has("delivery_started_ms"))
    db.exec("ALTER TABLE customer_executions ADD COLUMN delivery_started_ms INTEGER");
  // Job 003b: one ownership entry per closed deal, as a backstop to the reconciler. Installed
  // only when existing data allows it; earlier duplicates are reported, never deleted.
  if (ownershipConflicts(db).length === 0)
    db.exec(
      "CREATE UNIQUE INDEX IF NOT EXISTS ownership_once_per_deal ON ownership(deal_id) WHERE deal_id IS NOT NULL",
    );
  // Job 003k: a v3 sale's ownership entry names its intent (v2's deal_id references v2 deals),
  // and there is at most one entry per intent.
  if (!columns("ownership").has("v3_intent_id"))
    db.exec("ALTER TABLE ownership ADD COLUMN v3_intent_id TEXT REFERENCES v3_intents(id)");
  db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS ownership_once_per_v3_intent ON ownership(v3_intent_id) WHERE v3_intent_id IS NOT NULL",
  );
  // Job 003n: the purpose `customer_use`. SQLite cannot change a CHECK, so a runtime table from
  // before is rebuilt once, keeping every row and column (runtime_usage keeps its references).
  const runtimeSql = (
    db
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'runtime_invocations'",
      )
      .get() as { sql: string } | undefined
  )?.sql;
  if (runtimeSql && !runtimeSql.includes("'customer_use'")) {
    const cols = [...columns("runtime_invocations")].join(", ");
    const next = runtimeSql
      .replace(/CREATE TABLE ("?)runtime_invocations\1/, "CREATE TABLE runtime_invocations_next")
      .replace("'trial','evaluation','release'", "'trial','evaluation','release','customer_use'");
    if (!next.includes("'customer_use'") || !next.includes("runtime_invocations_next"))
      throw new Error("runtime_invocations could not be upgraded for customer use");
    db.exec("PRAGMA foreign_keys = OFF");
    try {
      db.exec("BEGIN IMMEDIATE");
      db.exec(next);
      db.exec(
        `INSERT INTO runtime_invocations_next (${cols}) SELECT ${cols} FROM runtime_invocations`,
      );
      db.exec("DROP TABLE runtime_invocations");
      db.exec("ALTER TABLE runtime_invocations_next RENAME TO runtime_invocations");
      db.exec(
        "CREATE INDEX IF NOT EXISTS runtime_invocations_project ON runtime_invocations(project_id, created_at)",
      );
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    } finally {
      db.exec("PRAGMA foreign_keys = ON");
    }
  }
  // Job 002b: a second intent (`propose`) and a reference to the message a job answers.
  // SQLite cannot change a CHECK, so a table from before is rebuilt once, keeping every row.
  const sql = (
    db
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'build_jobs'")
      .get() as { sql: string } | undefined
  )?.sql;
  if (sql && !sql.includes("'propose'")) {
    const cols = BUILD_JOB_COLUMNS.join(", ");
    db.exec("PRAGMA foreign_keys = OFF");
    try {
      db.exec("BEGIN IMMEDIATE");
      db.exec(buildJobsTable("build_jobs_next"));
      db.exec(`INSERT INTO build_jobs_next (${cols}) SELECT ${cols} FROM build_jobs`);
      db.exec("DROP TABLE build_jobs");
      db.exec("ALTER TABLE build_jobs_next RENAME TO build_jobs");
      db.exec("CREATE INDEX IF NOT EXISTS build_jobs_state ON build_jobs(state, created_at)");
      db.exec("CREATE INDEX IF NOT EXISTS build_jobs_business ON build_jobs(business_id)");
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    } finally {
      db.exec("PRAGMA foreign_keys = ON");
    }
  }
  return db;
}

export type Db = DatabaseSync;

/** Deals with more than one recorded ownership entry (from before reconciliation was fixed). */
export function ownershipConflicts(db: DatabaseSync) {
  return db
    .prepare(
      "SELECT deal_id, COUNT(*) AS entries FROM ownership WHERE deal_id IS NOT NULL GROUP BY deal_id HAVING COUNT(*) > 1",
    )
    .all() as { deal_id: string; entries: number }[];
}
