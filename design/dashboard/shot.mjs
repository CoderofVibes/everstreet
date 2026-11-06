// Renders a local HTML mockup to a PNG with headless Chrome (offline; nothing is fetched).
//   node design/dashboard/shot.mjs <file.html> <out.png> <width> <height>
//   e.g. node design/dashboard/shot.mjs design/dashboard/a/index.html design/dashboard/a/desktop.png 1440 2400
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [html, out, width = "1440", height = "2400"] = process.argv.slice(2);
if (!html || !out) {
  console.error("usage: node shot.mjs <file.html> <out.png> [width] [height]");
  process.exit(2);
}
const chrome = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
].find((p) => existsSync(p));
if (!chrome) throw new Error("No Chrome or Edge found");
const target = resolve(out);
execFileSync(chrome, [
  "--headless=new",
  "--disable-gpu",
  "--hide-scrollbars",
  "--force-device-scale-factor=1",
  `--window-size=${width},${height}`,
  "--virtual-time-budget=3000",
  `--screenshot=${target}`,
  pathToFileURL(resolve(html)).href,
], { stdio: "ignore" });
if (!existsSync(target)) throw new Error("no screenshot was written");
console.log(`wrote ${out} (${width}x${height})`);
