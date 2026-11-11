// Records the data behind the static site's app pages (web/src/proofSite.tsx): the guided tour and
// the self-playing video. It starts a fresh demo, puts a recording proxy in front of it
// (scripts/lib/tourRecorder.ts), and walks the demo's own pages in a headless browser as each
// person, before and after Signalwatch's sale closes. Every read the pages make is kept, per
// viewer, with the routes shown. Nothing is invented or edited: the static site later answers the
// same reads with the same bodies and refuses everything else. FICTIONAL and SYNTHETIC, like the
// demo itself.
//
//   npm run tour:record            builds the web app, records, writes data/tour/recording.json
//   npm run tour:record -- --manual   only the proxy, in front of a demo you started yourself
//                                     (npm run demo): name a viewer with
//                                     POST http://127.0.0.1:8852/__record/viewer/<name>, browse
//                                     http://127.0.0.1:8852/, then POST .../__record/save
//
// The viewers: delphine, cara, noah, agent (before the sale); noah-closed (the sale just closed),
// noah-after (he has moved the Ethereum role), delphine-after (paid, and refused as the former
// owner), cara-after (one more use, under the new owner). Needs Microsoft Edge (Playwright drives
// the installed browser). Listens on 127.0.0.1 only.

import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { type Browser, chromium, type Page } from "playwright-core";
import { startRecorder } from "./lib/tourRecorder.ts";

const HOST = "127.0.0.1";
const flag = (name: string) => process.argv.includes(name);
const arg = (name: string, fallback: number) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? Number(process.argv[i + 1]) : fallback;
};
const OUT = "data/tour/recording.json";
const SHOTS = join("data", "runtime", "tour-record");

/** The demo, started fresh so every recording begins from the same simulated month. */
async function startDemo(port: number): Promise<ChildProcess> {
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "scripts/demo.ts", "--port", String(port), "--minutes", "60"],
    { stdio: ["ignore", "pipe", "inherit"] },
  );
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("The demo didn't start in 3 minutes")),
      180_000,
    );
    child.stdout?.on("data", (d: Buffer) => {
      const text = d.toString();
      process.stdout.write(text.replace(/^/gm, "  demo: ").replace(/ {2}demo: $/, ""));
      if (text.includes("Demo (simulated history")) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.on("exit", (code) => reject(new Error(`The demo stopped (exit ${code})`)));
  });
  return child;
}

/** Waits until the page has had no request in flight for a moment. */
async function settle(page: Page, quiet = 400, max = 12_000) {
  const start = Date.now();
  let calm = 0;
  while (Date.now() - start < max) {
    const busy = await page.evaluate(() => (window as { __inflight?: number }).__inflight ?? 0);
    calm = busy === 0 ? calm + 100 : 0;
    if (calm >= quiet) return;
    await page.waitForTimeout(100);
  }
}

/** Goes to a route the way a link does (no reload), then waits for its reads. */
async function go(page: Page, to: string) {
  await page.evaluate((t) => {
    history.pushState(null, "", t);
    dispatchEvent(new PopStateEvent("popstate"));
  }, to);
  await settle(page);
}

// What a walk may open: the pages the tour and the video show, and the pages they link to.
const ALLOW = [
  /^\/$/,
  /^\/(explore|find|opportunities|activity|inbox|profile|handovers|portfolio|build|desk|acquire)$/,
  /^\/(start|import|experts|attacks)$/,
  /^\/proof\/ledgerline$/,
  /^\/(b|use|uses|example|portfolio|build|handovers)\/[^/]+$/,
  /^\/acquire\/(l|control)\/[^/]+$/,
  /^\/desk\/[^/]+(\/(value|team|continuity|handover|agent-purchases|allowance|public|sale))?$/,
  /^\/sales\/[^/]+(\/(economics|proof))?$/,
];
const allowed = (to: string) => ALLOW.some((re) => re.test(to.split("?")[0] as string));

/** Opens every allowed page reachable from `starts` by the links the pages themselves show. */
async function crawl(page: Page, starts: string[], limit = 260) {
  const seen = new Set<string>();
  const queue = [...starts];
  while (queue.length && seen.size < limit) {
    const to = queue.shift() as string;
    if (seen.has(to) || !allowed(to)) continue;
    seen.add(to);
    await go(page, to);
    // A page's own view tabs (they only change what is shown).
    const tabs = await page.locator("main .tab").count();
    for (let i = 0; i < tabs; i++) {
      const tab = page.locator("main .tab").nth(i);
      if (!(await tab.isVisible().catch(() => false))) continue;
      await tab.click().catch(() => {});
      await settle(page);
      seen.add(await page.evaluate(() => location.pathname + location.search));
    }
    // The studio's service view has three tasks; the portfolio's chart has series and measures.
    for (const name of ["Try", "Evaluate and release", "Customer access"]) {
      if (!/^\/build\/[^/]+\?view=service/.test(to)) break;
      const b = page.locator("main button", { hasText: new RegExp(`^${name}$`) }).first();
      if (await b.isVisible().catch(() => false)) {
        await b.click().catch(() => {});
        await settle(page);
      }
    }
    if (/^\/portfolio/.test(to)) {
      for (const name of ["Ledgerline", "Relaydesk", "Signalwatch", "Portfolio", "Delivered"]) {
        const b = page.locator("main button", { hasText: new RegExp(`^${name}`) }).first();
        if (await b.isVisible().catch(() => false)) {
          await b.click().catch(() => {});
          await settle(page, 200);
        }
      }
      const earned = page.locator("main button", { hasText: /^Earned/ }).first();
      if (await earned.isVisible().catch(() => false)) await earned.click().catch(() => {});
      await settle(page, 200);
    }
    const links = await page.evaluate(() =>
      [...document.querySelectorAll("main a[href^='/'], header a[href^='/']")].map(
        (a) => (a.getAttribute("href") as string).split("#")[0] as string,
      ),
    );
    for (const l of links) if (!seen.has(l)) queue.push(l);
  }
  return seen;
}

async function recordAll() {
  const demoPort = arg("--demo", 8850);
  if (!flag("--no-build"))
    execFileSync(
      process.execPath,
      [join("node_modules", "vite", "bin", "vite.js"), "build", "--config", "web/vite.config.ts"],
      { stdio: "inherit" },
    );
  mkdirSync(SHOTS, { recursive: true });
  console.log("Starting a fresh demo…");
  const demo = await startDemo(demoPort);
  const rec = startRecorder({
    demo: `http://${HOST}:${demoPort}`,
    port: arg("--port", 8852),
    out: OUT,
  });
  let browser: Browser | null = null;
  const control = async (path: string) => {
    const r = await fetch(`http://${HOST}:${demoPort + 1}${path}`, { method: "POST" });
    if (!r.ok) throw new Error(`demo control ${path}: ${r.status} ${await r.text()}`);
    return (await r.json()) as Record<string, unknown>;
  };
  try {
    browser = await chromium.launch({ channel: "msedge", headless: !flag("--headed") });
    const b = browser;

    /** A fresh browser signed in as one of the demo's people, with the recorder naming them. */
    const as = async (viewer: string, account: string, fn: (page: Page) => Promise<unknown>) => {
      await control(`/account/${account}`);
      rec.setViewer("scratch");
      const context = await b.newContext({ viewport: { width: 1440, height: 900 } });
      await context.addInitScript(() => {
        const w = window as { __inflight?: number };
        w.__inflight = 0;
        const real = window.fetch.bind(window);
        window.fetch = (...a: Parameters<typeof fetch>) => {
          w.__inflight = (w.__inflight ?? 0) + 1;
          return real(...a).finally(() => {
            w.__inflight = (w.__inflight ?? 1) - 1;
          });
        };
      });
      const page = await context.newPage();
      page.on("pageerror", (e) => console.log(`  page error (${viewer}): ${e.message}`));
      try {
        await page.goto(`${rec.url}/`);
        await page.getByRole("button", { name: "Sign in or join" }).first().click();
        await page.getByRole("button", { name: /Continue with Synthetic demo wallet/ }).click();
        await page.locator(".acting-button").first().waitFor({ timeout: 20_000 });
        await settle(page);
        await name(page, viewer);
        await fn(page);
        console.log(`  ${viewer}: ${JSON.stringify(rec.summary()[viewer])}`);
      } catch (e) {
        await page.screenshot({ path: join(SHOTS, `failed-${viewer}.png`), fullPage: true });
        throw new Error(`${viewer}: ${(e as Error).message}`);
      } finally {
        await context.close();
      }
    };

    /** Names who the reads belong to from here, and loads the app afresh so its session is theirs. */
    const name = async (page: Page, viewer: string) => {
      rec.setViewer(viewer);
      await page.goto(`${rec.url}/`);
      await settle(page);
    };

    /** Presses a button, approves the wallet's review if one opens, and waits for the result. */
    const act = async (page: Page, button: RegExp, result: RegExp, timeout = 90_000) => {
      await page.getByRole("button", { name: button }).first().click();
      const approve = page.getByRole("button", { name: /Approve in my wallet/ }).first();
      const done = page.getByText(result).first();
      await Promise.race([approve.waitFor({ timeout }), done.waitFor({ timeout })]);
      // The request for review belongs to whoever is viewing; what follows the approval doesn't.
      await settle(page);
      rec.setViewer("scratch");
      if (await approve.isVisible().catch(() => false)) await approve.click();
      await done.waitFor({ timeout });
      await settle(page);
    };

    let sale = "";
    console.log("Before the sale…");
    await as("delphine", "delphine.near", async (page) => {
      const projects = (await page.evaluate(() =>
        fetch("/api/product-projects").then((r) => r.json()),
      )) as { projects: { business_id: string; business_name: string }[] };
      const sw = projects.projects.find((p) => p.business_name === "Signalwatch");
      if (!sw) throw new Error("Signalwatch is missing from the founder's projects");
      sale = `/sales/${sw.business_id}`;
      await crawl(page, ["/", "/build", "/desk", "/portfolio", "/acquire", "/activity", "/inbox"]);
      // The video's own moves: a search, and the wallet's review of her acceptance (not approved).
      await go(page, "/find");
      await page
        .getByRole("button", { name: /turns invoices into JSON/ })
        .first()
        .click();
      await page
        .getByRole("button", { name: /^Search$/ })
        .first()
        .click();
      await settle(page);
      await go(page, sale);
      await page
        .getByRole("button", { name: /^Accept version 1/ })
        .first()
        .click();
      await page
        .getByRole("button", { name: /Approve in my wallet/ })
        .first()
        .waitFor();
      await settle(page);
      await page.screenshot({ path: join(SHOTS, "delphine-review.png") });
    });
    await as("cara", "cara.near", (page) => crawl(page, ["/", "/activity", "/explore", "/inbox"]));
    await as("noah", "buyer.near", (page) =>
      crawl(page, ["/", "/acquire", "/portfolio", "/activity", "/handovers", "/inbox", sale]),
    );
    await as("agent", "signalwatch-agent.demo.near", (page) =>
      crawl(page, ["/", "/activity", "/inbox"]),
    );

    console.log("Closing the sale (both accept, through the real routes)…");
    console.log(`  ${JSON.stringify(await control("/sale/accept-both"))}`);
    await as("noah-closed", "buyer.near", async (page) => {
      await crawl(page, [sale, "/portfolio", "/activity", "/desk", "/handovers", "/"]);
      await go(page, sale);
      await act(page, /Move it to your address/, /at your address/);
      await page.screenshot({ path: join(SHOTS, "noah-moved.png"), fullPage: true });
      await name(page, "noah-after");
      await crawl(page, [sale, "/portfolio", "/activity", "/desk", "/handovers", "/"]);
    });
    await as("delphine-after", "delphine.near", async (page) => {
      rec.setViewer("scratch");
      await go(page, sale);
      await act(page, /Register with the token to collect/, /Collect the sale proceeds/);
      await act(page, /Collect the sale proceeds/, /Paid/);
      await act(page, /Try an owner action/, /Refused by the contract/);
      await page.screenshot({ path: join(SHOTS, "delphine-after.png"), fullPage: true });
      await name(page, "delphine-after");
      await crawl(page, [sale, "/portfolio", "/activity", "/desk", "/"]);
    });
    console.log(
      `  Cara's use under the new owner: ${JSON.stringify(await control("/use/signalwatch")).slice(0, 200)}`,
    );
    await as("cara-after", "cara.near", async (page) => {
      await crawl(page, ["/activity", "/"]);
      // Her newest use, with its result shown (only she can read it).
      const mine = (await page.evaluate(() =>
        fetch("/api/customer/uses?limit=20").then((r) => r.json()),
      )) as { uses: { id: string }[] };
      await go(page, `/uses/${mine.uses[0]?.id}`);
      await page
        .getByRole("button", { name: /Show my result/ })
        .first()
        .click();
      await settle(page);
      await page.screenshot({ path: join(SHOTS, "cara-result.png"), fullPage: true });
    });

    rec.dropViewer("scratch");
    console.log(JSON.stringify(rec.save(), null, 1));
  } finally {
    await browser?.close();
    rec.close();
    demo.kill();
  }
  process.exit(0);
}

if (flag("--manual")) {
  const rec = startRecorder({
    demo: `http://${HOST}:${arg("--demo", 8820)}`,
    port: arg("--port", 8852),
    out: OUT,
  });
  console.log(`Recording proxy: ${rec.url}/ (in front of the demo)`);
  console.log(`  Name the viewer first: POST ${rec.url}/__record/viewer/<name>`);
} else {
  await recordAll();
}
