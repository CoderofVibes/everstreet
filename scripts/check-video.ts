// Checks the self-playing video (web/src/video) the way it will be recorded: the built static site
// in a headless browser, playing from start to finish.
//
//   npm run video:check                 builds the site, plays the video at 10x, and fails unless
//                                       every caption came on in order, every cue found its
//                                       target, the console stayed clean, and nothing asked the
//                                       network for anything outside the build
//   npm run video:check -- --no-build   the same, on the build already in web/dist-proof
//   npm run video:check -- --shots      also saves two pictures of every beat (data/runtime/video-shots);
//                                       --at 12.5,33 adds pictures at those seconds, and
//                                       --size 1920x1080 takes them in a window of that size
//
// Needs Microsoft Edge (Playwright drives the installed browser). Listens on 127.0.0.1 only.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, join, normalize, resolve } from "node:path";
import { chromium } from "playwright-core";
import { BEATS, beatStart, totalSeconds } from "../web/src/video/beats.ts";

const DIST = resolve("web", "dist-proof");
const SHOTS = join("data", "runtime", "video-shots");
const flag = (name: string) => process.argv.includes(name);
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".jpg": "image/jpeg",
  ".png": "image/png",
};

if (!flag("--no-build"))
  execFileSync(process.execPath, ["--import", "tsx", "scripts/build-proof-site.ts"], {
    stdio: "inherit",
  });
if (!existsSync(join(DIST, "index.html")))
  throw new Error("Build the site first: npm run proof-site");

// The build, served as a static host serves it: a file, or the page for any other route.
const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
  const file = join(DIST, normalize(path));
  const isFile = file.startsWith(DIST) && existsSync(file) && statSync(file).isFile();
  if (!isFile && /^\/(data|assets|video)\//.test(path)) {
    res.writeHead(404).end("Not found");
    return;
  }
  const served = isFile ? file : join(DIST, "index.html");
  res.writeHead(200, { "content-type": TYPES[extname(served)] ?? "application/octet-stream" });
  res.end(readFileSync(served));
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

const browser = await chromium.launch({ channel: "msedge", headless: true });
const problems: string[] = [];
try {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    colorScheme: "light",
  });
  const page = await context.newPage();
  const outside: string[] = [];
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith(`${base}/`) || url.startsWith("data:")) return route.continue();
    outside.push(url);
    return route.abort();
  });
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(`console: ${m.text()}`);
  });
  page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));

  await page.goto(`${base}/?video=1&capture=1&autostart=1&speed=10`);
  await page.waitForFunction(
    () => (window as { __everstreetVideo?: { done: boolean } }).__everstreetVideo?.done === true,
    null,
    { timeout: 180_000 },
  );
  const report = (await page.evaluate(
    () => (window as { __everstreetVideo?: unknown }).__everstreetVideo,
  )) as { captions: string[]; beats: string[]; problems: string[] };

  const captions = BEATS.flatMap((b) => b.captions.map((c) => c.text));
  if (JSON.stringify(report.captions) !== JSON.stringify(captions)) {
    const at = captions.findIndex((c, i) => report.captions[i] !== c);
    problems.push(
      `captions: expected ${captions.length} in order, saw ${report.captions.length}; first difference at ${at + 1}: expected "${captions[at]}", saw "${report.captions[at] ?? "nothing"}"`,
    );
  }
  if (JSON.stringify(report.beats) !== JSON.stringify(BEATS.map((b) => b.id)))
    problems.push(`beats: saw ${report.beats.join(", ")}`);
  for (const p of report.problems) problems.push(`cue: ${p}`);
  for (const url of outside) problems.push(`asked the network for ${url}`);
  // Nothing may be left in the picture that capture mode is meant to hide.
  if ((await page.locator(".video-hud").count()) > 0)
    problems.push("the hint is showing in capture mode");

  // At normal speed the video keeps time: about five seconds of video in five seconds.
  const timed = await context.newPage();
  await timed.goto(`${base}/?video=1&capture=1&autostart=1`);
  await timed.waitForFunction(
    () => ((window as { __everstreetVideo?: { time: number } }).__everstreetVideo?.time ?? 0) > 0,
  );
  const t0 = Date.now();
  const v0 = (await timed.evaluate(
    () => (window as { __everstreetVideo?: { time: number } }).__everstreetVideo?.time,
  )) as number;
  await timed.waitForTimeout(5000);
  const played =
    ((await timed.evaluate(
      () => (window as { __everstreetVideo?: { time: number } }).__everstreetVideo?.time,
    )) as number) - v0;
  const ratio = played / ((Date.now() - t0) / 1000);
  if (ratio > 1.05 || ratio < 0.8)
    problems.push(`at normal speed the video played ${ratio.toFixed(2)} times real time`);
  await timed.close();

  if (flag("--shots")) {
    mkdirSync(SHOTS, { recursive: true });
    const [w, h] = (process.argv[process.argv.indexOf("--size") + 1] ?? "").split("x").map(Number);
    const sized = flag("--size") && w && h ? { width: w, height: h } : { width: 1280, height: 720 };
    const shots = await (
      await browser.newContext({ viewport: sized, colorScheme: "light" })
    ).newPage();
    await shots.goto(`${base}/?video=1&capture=1&autostart=1&speed=2`);
    // Two pictures of every beat, and any moments asked for: --at 12.5,33
    const asked = (process.argv[process.argv.indexOf("--at") + 1] ?? "").split(",").map(Number);
    const extra = process.argv.includes("--at") ? asked.filter((n) => Number.isFinite(n)) : [];
    const times = [
      ...BEATS.flatMap((b, i) =>
        [0.45, 0.9].map((p) => ({
          id: `${String(i + 1).padStart(2, "0")}-${b.id}-${p < 0.5 ? "a" : "b"}`,
          t: beatStart(i) + b.dur * p,
        })),
      ),
      ...extra.map((t) => ({ id: `at-${t.toFixed(1).padStart(5, "0")}`, t })),
    ].sort((x, y) => x.t - y.t);
    for (const shot of times) {
      await shots.waitForFunction(
        (t) =>
          ((window as { __everstreetVideo?: { time: number } }).__everstreetVideo?.time ?? 0) >= t,
        Math.min(shot.t, totalSeconds() - 0.05),
        { timeout: 120_000, polling: 50 },
      );
      await shots.screenshot({ path: join(SHOTS, `${shot.id}.jpg`), type: "jpeg", quality: 80 });
    }
    console.log(`Pictures of every beat: ${SHOTS}`);
  }
} finally {
  await browser.close();
  server.close();
}

const length = `${Math.floor(totalSeconds() / 60)}:${String(totalSeconds() % 60).padStart(2, "0")}`;
if (problems.length) {
  console.error(`✗ The video has ${problems.length} problem${problems.length === 1 ? "" : "s"}:`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(
  `✓ The video plays: ${BEATS.length} beats, ${BEATS.flatMap((b) => b.captions).length} captions in order, ${length}, no console errors, nothing outside the build`,
);
