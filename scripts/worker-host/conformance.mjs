// Job 002e: FINITE real-engine conformance suite. Run ONLY on an authorized host after
// `setup.sh install`, as everstreet-runner:
//   /opt/everstreet-worker/node/bin/node /opt/everstreet-worker/conformance.mjs
// Every case goes through the real launcher (sudo -n .../launch run). Abusive modules are bounded
// by the guest limits under test; nothing here runs on the Windows host or in a browser.
// Writes conformance-<date>.json beside itself. Until it passes, isolation is UNVERIFIED.
//
// Revised after Astra's WorkerImplementationReview:
// - an isolation claim needs the probe to have RUN: a complete, bound report with exactly the
//   declared cases, and the probe case PASSED, i.e. it returned the exact structured
//   observation (an import failure, timeout, missing case or unavailable engine is never
//   evidence); the assertion helpers are self-tested against negative controls first;
// - the harness has its own deadline, output bounds, stderr drain and spawn-error handling;
// - synthetic canaries stand for a host file and another job's file; per-file and aggregate disk
//   limits are tested separately; preflight during a live run must say busy and kill nothing.

import { spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync, readdirSync, rmSync, writeFileSync } from "node:fs";

const HARNESS_MS = 120_000;
const OUT_MAX = 256 * 1024;

const canon = (v) =>
  Array.isArray(v)
    ? `[${v.map(canon).join(",")}]`
    : v && typeof v === "object"
      ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(",")}}`
      : JSON.stringify(v);

const INDEX = { path: "index.html", text: "<!doctype html><title>t</title>\n" };
function makeJob(logic, checks) {
  const bundle = canon({
    kind: "web_app_bundle",
    schema_version: 1,
    name: "Conformance",
    description: "",
    files: [INDEX, { path: "logic.js", text: logic }].sort((a, b) => (a.path < b.path ? -1 : 1)),
    checks: checks.map((c) => ({ label: c.id, module: "logic.js", input: null, ...c })),
  });
  return {
    check_id: randomUUID(),
    attempt: 1,
    digest: createHash("sha256").update(bundle).digest("hex"),
    recipe: "web_app_checks/1",
    bundle,
    ids: checks.map((c) => c.id),
  };
}

/** One launcher call with its OWN deadline and bounds, independent of the engine's. */
function launch(verb, stdin, killAfterMs = HARNESS_MS) {
  return new Promise((resolve) => {
    let p;
    try {
      p = spawn("sudo", ["-n", "/opt/everstreet-worker/bin/launch", verb], { stdio: ["pipe", "pipe", "pipe"] });
    } catch (e) {
      return resolve({ harness_error: `spawn: ${e.message}` });
    }
    let out = "";
    let over = false;
    p.stdout.on("data", (d) => {
      if (out.length + d.length > OUT_MAX) over = true;
      else out += d;
    });
    p.stderr.on("data", () => {}); // drained, never buffered without bound
    p.on("error", (e) => resolve({ harness_error: `spawn: ${e.message}` }));
    const t = setTimeout(() => p.kill("SIGKILL"), killAfterMs);
    p.on("close", (code, signal) => {
      clearTimeout(t);
      if (over) return resolve({ harness_error: "output over bound" });
      if (signal) return resolve({ harness_error: `launcher ended by ${signal}`, out: out.slice(0, 300) });
      try {
        resolve(JSON.parse(out.trim().split("\n").pop() || "null"));
      } catch {
        resolve({ harness_error: "unparsed", out: out.slice(0, 300) });
      }
    });
    p.stdin.on("error", () => {});
    p.stdin.end(stdin ?? "");
  });
}

/** A run counts only with a complete report bound to this job and exactly its cases. */
function completeReport(o, job) {
  const r = o?.report;
  if (!r || typeof r !== "object" || r.error) return null;
  if (r.check_id !== job.check_id || r.attempt !== job.attempt || r.digest !== job.digest) return null;
  if (!Array.isArray(r.cases)) return null;
  const ids = r.cases.map((c) => c.id).sort();
  if (canon(ids) !== canon([...job.ids].sort())) return null;
  return r;
}
/** The probe ran and returned exactly its expected observation. */
const observed = (o, job, id) => completeReport(o, job)?.cases.find((c) => c.id === id)?.passed === true;
/** The case ran to a definite failure with this detail (e.g. a limit killed it). */
const failedWith = (o, job, id, re) => {
  const c = completeReport(o, job)?.cases.find((x) => x.id === id);
  return c?.passed === false && re.test(c.detail ?? "");
};

// Negative controls: the helpers must refuse what isn't evidence.
function selfTest() {
  const job = { check_id: "a", attempt: 1, digest: "d", ids: ["p", "q"] };
  const good = { report: { check_id: "a", attempt: 1, digest: "d", cases: [{ id: "p", passed: true }, { id: "q", passed: false, detail: "killed by signal SIGXFSZ" }] } };
  const bad = [
    {},
    { report: {} },
    { error: "unavailable" },
    { report: { ...good.report, digest: "x" } },
    { report: { ...good.report, cases: [{ id: "p", passed: true }] } },
    { report: { ...good.report, cases: [...good.report.cases, { id: "z", passed: true }] } },
    { report: { ...good.report, cases: [{ id: "p", passed: false, detail: "module_load_failed: x" }, good.report.cases[1]] } },
    { report: { ...good.report, error: "supervisor_failed" } },
  ];
  const ok = observed(good, job, "p") && failedWith(good, job, "q", /SIGXFSZ/);
  const refused = bad.every((b) => !observed(b, job, "p") && !failedWith(b, job, "q", /SIGXFSZ/));
  if (!ok || !refused) throw new Error("conformance helpers accept non-evidence; refusing to run");
}

const results = [];
const record = (name, pass, evidence) => {
  results.push({ name, pass, evidence });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}`);
};
const leftovers = () => {
  const jails = existsSync("/srv/everstreet-jail/firecracker") ? readdirSync("/srv/everstreet-jail/firecracker") : [];
  const cgs = existsSync("/sys/fs/cgroup/everstreet-worker")
    ? readdirSync("/sys/fs/cgroup/everstreet-worker").filter((d) => d.startsWith("es-"))
    : [];
  return [...jails, ...cgs];
};
async function runCase(logic, checks, killAfterMs) {
  const job = makeJob(logic, checks);
  let ticks = 0;
  const timer = setInterval(() => ticks++, 100);
  const started = Date.now();
  const o = await launch("run", JSON.stringify({ ...job, ids: undefined }), killAfterMs);
  clearInterval(timer);
  const secs = (Date.now() - started) / 1000;
  return { o, job, responsive: ticks >= Math.floor(secs * 10 * 0.8), secs };
}
const fin = () => {
  const file = `conformance-${new Date().toISOString().slice(0, 10)}.json`;
  writeFileSync(file, JSON.stringify({ results }, null, 2));
  console.log(`wrote ${file}; ${results.filter((r) => r.pass).length}/${results.length} passed`);
  process.exit(results.length > 1 && results.every((r) => r.pass) ? 0 : 1);
};

selfTest();
const pre = await launch("preflight");
record("preflight ready", pre?.ok === true, pre);
if (!pre?.ok) fin();

// Synthetic canaries on the host, standing for "a host file" and "another job's file".
const canaryDir = `/tmp/everstreet-canary-${randomBytes(6).toString("hex")}`;
const hostCanary = `${canaryDir}/host-canary.txt`;
const jobCanary = `/srv/everstreet-jail/firecracker/es-000000000000-1/root/input.img`;
rmSync(canaryDir, { recursive: true, force: true });
(await import("node:fs")).mkdirSync(canaryDir, { recursive: true });
writeFileSync(hostCanary, "FICTIONAL CANARY\n");

// 1. Benign: the fictional API plan estimate passes; host responsive.
{
  const c = await runCase(
    "export function estimate(i){const k=Math.max(1,Math.min(10000,Math.floor(Number(i.thousands)||0)));const per=i.support==='priority'?45:12;const cents=Math.round((500+k*per)*(k>=1000?0.9:1));return {thousands:k,cents,label:'$'+(cents/100).toFixed(2)};}\n",
    [{ id: "standard_100k", export: "estimate", input: { thousands: 100, support: "standard" }, expect: { thousands: 100, cents: 1700, label: "$17.00" } }],
  );
  record("benign app passes; host responsive", observed(c.o, c.job, "standard_100k") && c.responsive, c.o);
}
// 2. Canaries and the drives: exact codes for each path.
{
  const paths = [hostCanary, jobCanary, "/dev/vdb", "/dev/vdc"];
  const c = await runCase(
    `import {readFileSync} from 'node:fs';export function probe(){const r={};for(const p of ${JSON.stringify(paths)}){try{readFileSync(p);r[p]='READ'}catch(e){r[p]=e.code}}return r;}\n`,
    [{ id: "probe", export: "probe", expect: { [hostCanary]: "ENOENT", [jobCanary]: "ENOENT", "/dev/vdb": "EACCES", "/dev/vdc": "EACCES" } }],
  );
  record("host and job canaries absent; drives closed to the case", observed(c.o, c.job, "probe"), c.o);
}
// 3. Network: no NIC; every connection fails with an error (never connects or hangs).
{
  const c = await runCase(
    "import net from 'node:net';const t=(h,p)=>new Promise(r=>{const s=net.connect({host:h,port:p});s.setTimeout(1500,()=>{s.destroy();r('timeout')});s.on('connect',()=>{s.destroy();r('CONNECTED')});s.on('error',e=>r('error'))});export async function net3(){return [await t('10.0.2.2',80),await t('169.254.169.254',80),await t('1.1.1.1',443)];}\n",
    [{ id: "net", export: "net3", expect: ["error", "error", "error"] }],
  );
  record("network unreachable", observed(c.o, c.job, "net"), c.o);
}
// 4. Guest memory: past 160 MiB the guest cgroup kills it; the next case still runs.
{
  const c = await runCase(
    "export function grow(){const a=[];for(let i=0;i<400;i++)a.push(Buffer.alloc(1048576,1));return a.length;}\nexport function ok(){return 1;}\n",
    [{ id: "grow", export: "grow", expect: 400 }, { id: "ok", export: "ok", expect: 1 }],
  );
  record("guest memory bounded", failedWith(c.o, c.job, "grow", /killed by signal|exited/) && observed(c.o, c.job, "ok") && c.responsive, c.o);
}
// 5. Guest processes: spawning stops below the guest pids limit.
{
  const c = await runCase(
    "import {spawn} from 'node:child_process';export function fork(){let n=0;for(let i=0;i<200;i++){try{const p=spawn('/bin/sleep',['3']);p.on('error',()=>{});if(p.pid)n++;}catch{}}return n<32?'bounded':'unbounded';}\n",
    [{ id: "fork", export: "fork", expect: "bounded" }],
  );
  record("guest processes bounded", observed(c.o, c.job, "fork"), c.o);
}
// 6a. Per-file limit (RLIMIT_FSIZE 2 MiB): a 3 MiB file is refused or the step killed (SIGXFSZ).
{
  const c = await runCase(
    "import {writeFileSync} from 'node:fs';export function big(){try{writeFileSync('/work/scratch/one.bin',Buffer.alloc(3*1048576));return 'wrote'}catch(e){return e.code}}\n",
    [{ id: "big", export: "big", expect: "EFBIG" }],
  );
  record("per-file size bounded", observed(c.o, c.job, "big") || failedWith(c.o, c.job, "big", /SIGXFSZ/), c.o);
}
// 6b. Aggregate tmpfs limit (8 MiB): several individually allowed files until ENOSPC.
{
  const c = await runCase(
    "import {writeFileSync} from 'node:fs';export function fill(){let n=0;for(;n<10;n++){try{writeFileSync('/work/scratch/f'+n,Buffer.alloc(1900*1024))}catch(e){return e.code==='ENOSPC'&&n>=3&&n<=5?'aggregate_bounded':'n='+n+':'+e.code}}return 'unbounded';}\n",
    [{ id: "fill", export: "fill", expect: "aggregate_bounded" }],
  );
  record("work space bounded in aggregate", observed(c.o, c.job, "fill"), c.o);
}
// 6c. The bundle tree is root-owned and read-only to cases (no sibling replacement).
{
  const c = await runCase(
    "import {writeFileSync,renameSync,unlinkSync} from 'node:fs';export function swap(){const r=[];for(const f of [()=>writeFileSync('/work/app/index.html','x'),()=>renameSync('/work/app/index.html','/work/scratch/i'),()=>unlinkSync('/work/app/logic.js')]){try{f();r.push('CHANGED')}catch(e){r.push(e.code)}}return r;}\nexport function after(){return 1;}\n",
    [{ id: "swap", export: "swap", expect: ["EACCES", "EACCES", "EACCES"] }, { id: "after", export: "after", expect: 1 }],
  );
  record("bundle tree immutable to cases", observed(c.o, c.job, "swap") && observed(c.o, c.job, "after"), c.o);
}
// 7. Report forgery: a printed fake envelope is only that case's value; the drive refuses it;
//    another case is unaffected.
{
  const fake = { cases: [{ id: "other", passed: true }] };
  const c = await runCase(
    `import {openSync} from 'node:fs';export function forge(){process.stdout.write(JSON.stringify(${JSON.stringify(fake)})+'\\n');return 0;}\nexport function drive(){try{openSync('/dev/vdc','r+');return 'OPENED'}catch(e){return e.code}}\nexport function other(){return 2;}\n`,
    [
      { id: "forge", export: "forge", expect: fake },
      { id: "drive", export: "drive", expect: "EACCES" },
      { id: "other", export: "other", expect: 2 },
    ],
  );
  record(
    "report forgery contained",
    observed(c.o, c.job, "forge") && observed(c.o, c.job, "drive") && observed(c.o, c.job, "other"),
    c.o,
  );
}
// 8. Time: an endless loop is killed at the step limit; the next case runs.
{
  const c = await runCase("export function spin(){for(;;){}}\nexport function ok(){return 1;}\n", [
    { id: "spin", export: "spin", expect: 1 },
    { id: "ok", export: "ok", expect: 1 },
  ]);
  record("step time bounded", failedWith(c.o, c.job, "spin", /longer than 5 seconds/) && observed(c.o, c.job, "ok"), c.o);
}
// 9. A preflight during a live (finite) run says busy and kills nothing; the run completes.
{
  const running = runCase("export function nap(){const t=Date.now();while(Date.now()-t<3000){}return 1;}\n", [{ id: "nap", export: "nap", expect: 1 }]);
  await new Promise((r) => setTimeout(r, 1500));
  const mid = await launch("preflight");
  const c = await running;
  record("preflight during a run is busy and harmless", mid?.busy === true && observed(c.o, c.job, "nap"), { mid, o: c.o });
}
// 10. A real orphan: the launcher is killed mid-run; preflight proves it orphaned and cleans it.
{
  await runCase("export function spin(){for(;;){}}\n", [{ id: "spin", export: "spin", expect: 1 }], 2000);
  const after = await launch("preflight");
  record("orphan proven and cleaned", after?.ok === true && (after.removed ?? []).length >= 1 && leftovers().length === 0, { after, left: leftovers() });
}
record("no leftovers at the end", leftovers().length === 0, { left: leftovers() });
// Host VMM limits are verified by the launcher before every VM start (limits_unverified).
// The fail-open trap (removing the parent cgroup) needs root: run by hand, EXECUTABLE_PRODUCTS §7.
rmSync(canaryDir, { recursive: true, force: true });
fin();
