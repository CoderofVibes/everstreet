// Job 002e: a FICTIONAL generated web app for tests and the disposable preview: a monthly plan
// estimator for an invented API service (Astra's BundleInputReview: keep the example digital).
// Sample rates are fictional. Its checks are declarative cases for the isolated recipe; nothing
// here is executed by the platform.

export const QUOTE_FILES = [
  {
    path: "index.html",
    text: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>API plan estimator</title>
<link rel="stylesheet" href="style.css">
<script type="module" src="app.js"></script>
</head>
<body>
<main>
<h1>Lumen Parse API: monthly estimate</h1>
<p class="note">Fictional service. Sample rates are illustrative, not real prices.</p>
<label>Requests per month (thousands) <input id="requests" type="number" min="1" max="10000" value="100"></label>
<label>Support <select id="support"><option value="standard">Standard</option><option value="priority">Priority</option></select></label>
<p id="total" aria-live="polite"></p>
</main>
</body>
</html>
`,
  },
  {
    path: "style.css",
    text: "body { font-family: system-ui, sans-serif; margin: 24px; }\nlabel { display: block; margin: 12px 0; }\n#total { font-size: 22px; font-weight: 600; }\n.note { color: #566178; }\n",
  },
  {
    path: "estimate.js",
    text: `// Pure pricing logic (a logic module: no DOM). Cents, so the result is exact.
export function estimate(input) {
  const thousands = Math.max(1, Math.min(10000, Math.floor(Number(input.thousands) || 0)));
  const per = input.support === "priority" ? 45 : 12;
  const base = 500;
  const discount = thousands >= 1000 ? 0.1 : 0;
  const cents = Math.round((base + thousands * per) * (1 - discount));
  return { thousands, cents, label: "$" + (cents / 100).toFixed(2) };
}
`,
  },
  {
    path: "app.js",
    text: `// UI module: parsed by the worker, run only in the browser preview.
import { estimate } from "./estimate.js";
const requests = document.getElementById("requests");
const support = document.getElementById("support");
const total = document.getElementById("total");
function update() {
  const q = estimate({ thousands: requests.value, support: support.value });
  total.textContent = q.thousands + "k requests a month: " + q.label;
}
requests.addEventListener("input", update);
support.addEventListener("change", update);
update();
parent.postMessage({ everstreet_preview: 1, type: "ready" }, "*");
`,
  },
];

export const QUOTE_CHECKS = [
  {
    id: "standard_100k",
    label: "100k requests on Standard support cost $17.00 a month",
    module: "estimate.js",
    export: "estimate",
    input: { thousands: 100, support: "standard" },
    expect: { thousands: 100, cents: 1700, label: "$17.00" },
  },
  {
    id: "priority_volume",
    label: "1M requests on Priority support get the 10% volume discount",
    module: "estimate.js",
    export: "estimate",
    input: { thousands: 1000, support: "priority" },
    expect: { thousands: 1000, cents: 40950, label: "$409.50" },
  },
];

export const QUOTE_BUNDLE = {
  kind: "web_app_bundle",
  schema_version: 1,
  name: "Lumen Parse plan estimator",
  description: "A fictional API service's monthly plan estimate page.",
  files: QUOTE_FILES,
  checks: QUOTE_CHECKS,
};

/** The same app with a cheaper Priority rate: a second version to compare and restore. */
export const QUOTE_BUNDLE_V2 = {
  ...QUOTE_BUNDLE,
  files: QUOTE_FILES.map((f) =>
    f.path === "estimate.js" ? { ...f, text: f.text.replace("? 45 : 12", "? 40 : 12") } : f,
  ),
  checks: [
    QUOTE_CHECKS[0],
    { ...QUOTE_CHECKS[1], expect: { thousands: 1000, cents: 36450, label: "$364.50" } },
  ],
};

/**
 * 006a: records a TEST DOUBLE's passed isolated logic check of an app version (a fixture row; the
 * check path itself is proven in app-checks.test.ts). Never isolation evidence.
 */
export function seedDoubleCheck(
  db: {
    prepare: (sql: string) => {
      run: (...a: unknown[]) => unknown;
      get: (...a: unknown[]) => unknown;
    };
  },
  v: {
    project: string;
    business: string;
    job: string;
    requestedBy: string;
    ownerId: string;
    generation: number;
  },
) {
  const a = db.prepare("SELECT digest FROM build_artifacts WHERE job_id = ?").get(v.job) as {
    digest: string;
  };
  const t = new Date().toISOString();
  db.prepare(
    `INSERT INTO app_checks (id, project_id, business_id, job_id, digest, recipe, idempotency_key, fingerprint, requested_by, owner_id, owner_generation, state, attempt, engine, result, created_at, updated_at, finished_at)
     VALUES (?, ?, ?, ?, ?, 'web_app_checks/1', ?, 'fixture', ?, ?, ?, 'passed', 1, ?, '{}', ?, ?, ?)`,
  ).run(
    `check-${v.job}`,
    v.project,
    v.business,
    v.job,
    a.digest,
    `fixture-${v.job.slice(0, 12)}`,
    v.requestedBy,
    v.ownerId,
    v.generation,
    JSON.stringify({ engine: "test-double", recipe: "web_app_checks/1" }),
    t,
    t,
    t,
  );
  return a.digest;
}
