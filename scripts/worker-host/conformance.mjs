// Job 002e: FINITE real-engine conformance suite. Run ONLY on an authorized host after
// setup.sh install, as everstreet-runner:  /opt/everstreet-worker/node/bin/node conformance.mjs
// Every case goes through the real launcher (sudo -n .../launch run). Abusive modules are
// bounded by the guest limits under test; nothing here runs on the Windows host or in a browser.
// Writes conformance-<date>.json beside itself. Until it passes, isolation is UNVERIFIED.

import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readdirSync, writeFileSync } from "node:fs";

const canon = (v) =>
  Array.isArray(v)
    ? `[${v.map(canon).join(",")}]`
    : v && typeof v === "object"
      ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(",")}}`
      : JSON.stringify(v);

const INDEX = { path: "index.html", text: "<!doctype html><title>t</title>\n" };
const bundle = (logic, checks) =>
  canon({
    kind: "web_app_bundle",
    schema_version: 1,
    name: "Conformance",
    description: "",
    files: [INDEX, { path: "logic.js", text: logic }].sort((a, b) => (a.path < b.path ? -1 : 1)),
    checks: checks.map((c) => ({ label: c.id, module: "logic.js", input: null, ...c })),
  });

function launch(verb, stdin, killAfterMs) {
  return new Promise((resolve) => {
    const p = spawn("sudo", ["-n", "/opt/everstreet-worker/bin/launch", verb], { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    p.stdout.on("data", (d) => {
      out += d;
    });
    const t = killAfterMs ? setTimeout(() => p.kill("SIGKILL"), killAfterMs) : null;
    p.on("close", () => {
      if (t) clearTimeout(t);
      try {
        resolve(JSON.parse(out.trim().split("\n").pop() || "null"));
      } catch {
        resolve({ unparsed: out.slice(0, 300) });
      }
    });
    p.stdin.end(stdin ?? "");
  });
}

async function runCase(logic, checks, killAfterMs) {
  const text = bundle(logic, checks);
  const job = {
    check_id: randomUUID(),
    attempt: 1,
    digest: createHash("sha256").update(text).digest("hex"),
    recipe: "web_app_checks/1",
    bundle: text,
  };
  // The host stays responsive: a timer keeps ticking while the VM runs.
  let ticks = 0;
  const timer = setInterval(() => ticks++, 100);
  const started = Date.now();
  const r = await launch("run", JSON.stringify(job), killAfterMs);
  clearInterval(timer);
  const secs = (Date.now() - started) / 1000;
  return { r, responsive: ticks >= Math.floor(secs * 10 * 0.8), secs };
}

const leftovers = () => {
  const jails = (() => {
    try {
      return readdirSync("/srv/everstreet-jail/firecracker");
    } catch {
      return [];
    }
  })();
  const cgs = readdirSync("/sys/fs/cgroup/everstreet-worker").filter((d) => d.startsWith("es-"));
  return [...jails, ...cgs];
};

const results = [];
const record = (name, pass, evidence) => {
  results.push({ name, pass, evidence });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}`);
};
const caseOf = (o, id) => o.r?.report?.cases?.find((c) => c.id === id);

const pre = await launch("preflight");
record("preflight", pre?.ok === true, pre);
if (!pre?.ok) {
  writeFileSync(`conformance-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ pre, results }, null, 2));
  process.exit(1);
}

// 1. Benign: the fictional API plan estimate passes; memory peaks recorded.
{
  const o = await runCase(
    "export function estimate(i){const k=Math.max(1,Math.min(10000,Math.floor(Number(i.thousands)||0)));const per=i.support==='priority'?45:12;const cents=Math.round((500+k*per)*(k>=1000?0.9:1));return {thousands:k,cents,label:'$'+(cents/100).toFixed(2)};}\n",
    [{ id: "standard_100k", export: "estimate", input: { thousands: 100, support: "standard" }, expect: { thousands: 100, cents: 1700, label: "$17.00" } }],
  );
  record("benign app passes", caseOf(o, "standard_100k")?.passed === true && o.responsive, o);
}
// 2. Canary: the guest can't read the job drive, the host's drives or a Windows mount.
{
  const o = await runCase(
    "import {readFileSync} from 'node:fs';export function probe(){const r={};for(const p of ['/dev/vdb','/dev/vdc','/dev/vda','/mnt/c/Windows/win.ini','/etc/shadow']){try{readFileSync(p);r[p]='read'}catch(e){r[p]=e.code}}return r;}\n",
    [{ id: "probe", export: "probe", expect: null }],
  );
  const v = caseOf(o, "probe")?.detail ?? "";
  record("guest canaries unreadable", !/"read"/.test(v), o);
}
// 3. Network: no NIC, so every connection fails.
{
  const o = await runCase(
    "import net from 'node:net';const t=(h,p)=>new Promise(r=>{const s=net.connect({host:h,port:p});s.setTimeout(1500,()=>{s.destroy();r('timeout')});s.on('connect',()=>{s.destroy();r('CONNECTED')});s.on('error',e=>r(e.code))});export async function net3(){return [await t('10.0.2.2',80),await t('169.254.169.254',80),await t('1.1.1.1',443)];}\n",
    [{ id: "net", export: "net3", expect: null }],
  );
  record("network unreachable", !/CONNECTED/.test(caseOf(o, "net")?.detail ?? "CONNECTED"), o);
}
// 4. Guest memory: past 160 MiB the guest cgroup stops it; the report still arrives.
{
  const o = await runCase(
    "export function grow(){const a=[];for(let i=0;i<400;i++)a.push(Buffer.alloc(1048576,1));return a.length;}\nexport function ok(){return 1;}\n",
    [{ id: "grow", export: "grow", expect: 400 }, { id: "ok", export: "ok", expect: 1 }],
  );
  record("guest memory bounded", caseOf(o, "grow")?.passed === false && caseOf(o, "ok")?.passed === true && o.responsive, o);
}
// 5. Guest processes: spawning stops at the guest pids limit.
{
  const o = await runCase(
    "import {spawn} from 'node:child_process';export function fork(){let n=0;for(let i=0;i<200;i++){try{const c=spawn('/bin/sleep',['3']);c.on('error',()=>{});if(c.pid)n++;}catch{}}return n<32?'bounded':'unbounded:'+n;}\n",
    [{ id: "fork", export: "fork", expect: "bounded" }],
  );
  record("guest processes bounded", caseOf(o, "fork")?.passed === true, o);
}
// 6. Guest tmpfs: writing past 8 MiB fails; the report still arrives.
{
  const o = await runCase(
    "import {writeFileSync} from 'node:fs';export function fill(){try{writeFileSync('/work/scratch/big.bin',Buffer.alloc(20*1048576));return 'wrote'}catch(e){return e.code}}\n",
    [{ id: "fill", export: "fill", expect: "ENOSPC" }],
  );
  record("guest work space bounded", caseOf(o, "fill")?.passed === true, o);
}
// 6b. Sibling modules: the bundle tree is root-owned and read-only to cases.
{
  const o = await runCase(
    "import {writeFileSync,renameSync,unlinkSync} from 'node:fs';export function swap(){const r=[];for(const f of [()=>writeFileSync('/work/app/index.html','x'),()=>renameSync('/work/app/index.html','/work/scratch/i'),()=>unlinkSync('/work/app/logic.js')]){try{f();r.push('CHANGED')}catch(e){r.push(e.code)}}return r.join(',');}\nexport function after(){return 1;}\n",
    [{ id: "swap", export: "swap", expect: "EACCES,EACCES,EACCES" }, { id: "after", export: "after", expect: 1 }],
  );
  record("bundle tree immutable to cases", caseOf(o, "swap")?.passed === true && caseOf(o, "after")?.passed === true, o);
}
// 7. Report forgery: a fake envelope is only this case's (wrong) value; the drive is closed to it.
{
  const o = await runCase(
    "import {openSync} from 'node:fs';export function forge(){let d;try{openSync('/dev/vdc','r+');d='OPENED'}catch(e){d=e.code}process.stdout.write(JSON.stringify({cases:[{id:'other',passed:true}]})+'\\n');return d;}\nexport function other(){return 2;}\n",
    [{ id: "forge", export: "forge", expect: "EACCES" }, { id: "other", export: "other", expect: 1 }],
  );
  record(
    "report forgery contained",
    caseOf(o, "other")?.passed === false && !/OPENED/.test(JSON.stringify(o.r)),
    o,
  );
}
// 8. Time: an endless loop is killed at the step limit; the VM finishes.
{
  const o = await runCase("export function spin(){for(;;){}}\nexport function ok(){return 1;}\n", [
    { id: "spin", export: "spin", expect: 1 },
    { id: "ok", export: "ok", expect: 1 },
  ]);
  record("step time bounded", /longer than 5 seconds/.test(caseOf(o, "spin")?.detail ?? "") && caseOf(o, "ok")?.passed === true, o);
}
// 10. Cancel/orphan: kill the launcher mid-run; preflight cleans up; nothing left.
{
  await runCase("export function spin(){for(;;){}}\n", [{ id: "spin", export: "spin", expect: 1 }], 2000);
  await launch("preflight");
  record("no leftovers after a killed launcher", leftovers().length === 0, { left: leftovers() });
}
record("no leftovers at the end", leftovers().length === 0, { left: leftovers() });
// 9 (host VMM limits) is verified by the launcher before every VM start (limits_unverified).
// 11 (fail-open trap) needs root to remove the parent cgroup: run manually, see EXECUTABLE_PRODUCTS §7.

const file = `conformance-${new Date().toISOString().slice(0, 10)}.json`;
writeFileSync(file, JSON.stringify({ engine: pre.engine, results }, null, 2));
console.log(`wrote ${file}; ${results.filter((r) => r.pass).length}/${results.length} passed`);
process.exit(results.every((r) => r.pass) ? 0 : 1);
