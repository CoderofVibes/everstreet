// Renders README.md as one designed HTML page (data/runtime/everstreet-readme.html, ignored by git),
// published as a private Artifact for the team. Re-run after README changes, then republish.
//   node scripts/readme-page.mjs
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const GH = "https://github.com/CoderofVibes/everstreet/blob/main/";
const OUT = join(REPO, "data", "runtime", "everstreet-readme.html");
const md = readFileSync(join(REPO, "README.md"), "utf8").replace(/\r\n/g, "\n");
const commit = execFileSync("git", ["-C", REPO, "rev-parse", "--short", "HEAD"]).toString().trim();
const today = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

// ---------- inline ----------
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9 -]/g, "").trim().replace(/ /g, "-");
function href(u) {
  if (/^https?:/.test(u) || u.startsWith("#")) return u;
  return GH + u.replace(/^\.\//, "");
}
function tag(u) {
  if (u.includes("testnet.nearblocks.io/txns/")) return `<span class="tag">testnet tx</span>`;
  if (u.includes("testnet.nearblocks.io/address/")) return `<span class="tag">testnet</span>`;
  if (u.includes("sepolia.etherscan.io")) return `<span class="tag sep">Sepolia</span>`;
  if (/^https?:\/\/(127\.0\.0\.1|localhost)/.test(u)) return `<span class="tag loc">local demo</span>`;
  return "";
}
function inline(s) {
  const codes = [];
  let t = s.replace(/`([^`]+)`/g, (_, c) => {
    codes.push(`<code>${esc(c)}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });
  t = esc(t);
  t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, u) => {
    const h = href(u);
    const ext = /^https?:/.test(h) && !h.startsWith("#");
    return `<a href="${h}"${ext ? ' target="_blank" rel="noopener"' : ""}>${text}</a>${tag(u)}`;
  });
  t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  t = t.replace(/\u0000(\d+)\u0000/g, (_, i) => codes[Number(i)]);
  return t;
}

// ---------- blocks ----------
function blocks(text) {
  const lines = text.split("\n");
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    if (l.startsWith("```")) {
      const lang = l.slice(3).trim();
      const body = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) body.push(lines[i++]);
      i++;
      out.push({ type: "code", lang, body: body.join("\n") });
      continue;
    }
    const h = l.match(/^(#{1,3}) (.+)$/);
    if (h) { out.push({ type: "h", level: h[1].length, text: h[2] }); i++; continue; }
    if (l.startsWith("|")) {
      const rows = [];
      while (i < lines.length && lines[i].startsWith("|")) rows.push(lines[i++]);
      const cells = (r) => r.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
      out.push({ type: "table", head: cells(rows[0]), rows: rows.slice(2).map(cells) });
      continue;
    }
    if (/^(- |\d+\. )/.test(l)) {
      const ordered = /^\d+\. /.test(l);
      const items = [];
      while (i < lines.length && (/^(- |\d+\. )/.test(lines[i]) || /^ {2,}\S/.test(lines[i]))) {
        if (/^(- |\d+\. )/.test(lines[i])) items.push(lines[i].replace(/^(- |\d+\. )/, ""));
        else items[items.length - 1] += ` ${lines[i].trim()}`;
        i++;
      }
      out.push({ type: "list", ordered, items });
      continue;
    }
    const p = [];
    while (i < lines.length && lines[i].trim() && !/^(```|#|\||- |\d+\. )/.test(lines[i])) p.push(lines[i++].trim());
    out.push({ type: "p", text: p.join(" ") });
  }
  return out;
}

const renderTable = (b) => {
  if (b.head[0] === "Claim") {
    return `<div class="claims">${b.rows
      .map(
        (r) => `<article class="claim">
  <h3>${inline(r[0])}</h3>
  <dl>
    <div><dt>Test or verifier</dt><dd>${inline(r[1])}</dd></div>
    <div><dt>Recorded evidence</dt><dd>${inline(r[2])}</dd></div>
    <div><dt>Where to look</dt><dd>${inline(r[3])}</dd></div>
  </dl>
</article>`,
      )
      .join("\n")}</div>`;
  }
  return `<div class="tablewrap"><table><thead><tr>${b.head.map((h) => `<th>${inline(h)}</th>`).join("")}</tr></thead><tbody>${b.rows
    .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`)
    .join("")}</tbody></table></div>`;
};
function render(b) {
  if (b.type === "p") return `<p>${inline(b.text)}</p>`;
  if (b.type === "h") return `<h${b.level + 1}>${inline(b.text)}</h${b.level + 1}>`;
  if (b.type === "list") {
    const t = b.ordered ? "ol" : "ul";
    return `<${t} class="${b.ordered ? "steps" : "points"}">${b.items.map((x) => `<li>${inline(x)}</li>`).join("")}</${t}>`;
  }
  if (b.type === "code")
    return `<figure class="code"><figcaption>${b.lang === "sh" ? "Terminal" : b.lang.toUpperCase()}</figcaption><pre><code>${esc(b.body)}</code></pre></figure>`;
  if (b.type === "table") return renderTable(b);
  return "";
}

// ---------- sections ----------
const parts = md.split(/\n(?=## )/);
const heroBlocks = blocks(parts[0]);
const sections = parts.slice(1).map((s) => {
  const [first, ...rest] = s.split("\n");
  const title = first.replace(/^## /, "");
  return { title, id: slug(title), body: blocks(rest.join("\n")) };
});

// The hero, from the README's opening in order.
const hb = heroBlocks.filter((b) => b.type !== "h");
const headline = hb.find((b) => b.type === "p" && /^\*\*.+\*\*$/.test(b.text));
const intro = hb[hb.indexOf(headline) + 1];
const pillars = hb.find((b) => b.type === "list");
const lead = hb.find((b) => b.type === "p" && b.text.startsWith("**Ledgerline"));
const strip = hb.find((b) => b.type === "table");
const built = hb.find((b) => b.type === "p" && b.text.startsWith("Built at"));
const pillar = (x) => {
  const m = x.match(/^\*\*(.+?)\*\*\s*(.*)$/);
  return `<li><h3>${inline(m ? m[1] : "")}</h3><p>${inline(m ? m[2] : x)}</p></li>`;
};
const stripCards = strip.head
  .map(
    (h, i) => `<li class="step">
  <span class="step-n">Step ${i + 1}</span>
  <h3>${inline(h)}</h3>
  <p>${inline(strip.rows[0][i])}</p>
  <p class="step-ev">${inline(strip.rows[1][i])}</p>
</li>`,
  )
  .join("\n");

const html = `<title>Everstreet README</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>
/* Layout: an ink header with the thesis and the three-step proof, a sticky section bar, then one
   reading column with claim cards and code panels. Everstreet's own palette (canvas, ink, cobalt). */
:root {
  --canvas: #f4f6fb; --surface: #ffffff; --surface-2: #f8f9fc;
  --text: #17243c; --text-2: #3b4860; --text-3: #566178;
  --line: #dce1eb; --line-strong: #bcc4d4;
  --cobalt: #3155d9; --cobalt-ink: #2846c4; --cobalt-soft: #ebeffd;
  --band: #17243c; --band-2: #22314d; --on-band: #f2f5fb; --on-band-2: #aeb8cc; --band-accent: #afc2ff;
  --warm-soft: #fcefe3; --warm-ink: #7a3f10;
  --success: #1e7a4c; --success-soft: #e5f3eb;
  --code-bg: #121b2e; --code-fg: #dbe3f3;
  --sans: "Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, "SF Pro Text", Roboto, "Helvetica Neue", Arial, sans-serif;
  --display: "Segoe UI Variable Display", "Segoe UI", system-ui, -apple-system, "SF Pro Display", Roboto, "Helvetica Neue", Arial, sans-serif;
  --mono: "Cascadia Code", "SF Mono", ui-monospace, Menlo, Consolas, monospace;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --canvas: #0e1524; --surface: #151f33; --surface-2: #1a2640;
  --text: #e6ebf5; --text-2: #bcc6d8; --text-3: #8f9bb2;
  --line: #26324a; --line-strong: #34425e;
  --cobalt: #8ea6ff; --cobalt-ink: #a9bbff; --cobalt-soft: #1c2a52;
  --band: #0a1120; --band-2: #16213a; --on-band: #eef2fa; --on-band-2: #a3aec4; --band-accent: #afc2ff;
  --warm-soft: #3a2a1c; --warm-ink: #f3c49d;
  --success: #6fd09c; --success-soft: #16342a;
  --code-bg: #0a1120; --code-fg: #dbe3f3; color-scheme: dark; } }
:root[data-theme="dark"] {
  --canvas: #0e1524; --surface: #151f33; --surface-2: #1a2640;
  --text: #e6ebf5; --text-2: #bcc6d8; --text-3: #8f9bb2;
  --line: #26324a; --line-strong: #34425e;
  --cobalt: #8ea6ff; --cobalt-ink: #a9bbff; --cobalt-soft: #1c2a52;
  --band: #0a1120; --band-2: #16213a; --on-band: #eef2fa; --on-band-2: #a3aec4; --band-accent: #afc2ff;
  --warm-soft: #3a2a1c; --warm-ink: #f3c49d;
  --success: #6fd09c; --success-soft: #16342a;
  --code-bg: #0a1120; --code-fg: #dbe3f3; color-scheme: dark; }
* { box-sizing: border-box; }
body { background: var(--canvas); color: var(--text); font-family: var(--sans); font-size: 16px; line-height: 1.6; }
a { color: var(--cobalt-ink); text-underline-offset: 2px; }
a:focus-visible, summary:focus-visible { outline: 2px solid var(--cobalt); outline-offset: 2px; border-radius: 3px; }
code { font-family: var(--mono); font-size: 0.86em; background: var(--surface-2); border: 1px solid var(--line); border-radius: 4px; padding: 0.05em 0.35em; overflow-wrap: anywhere; }
strong { font-weight: 650; }
.wrap { max-width: 1080px; margin: 0 auto; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); }
.tag { display: inline-block; margin-left: 5px; padding: 0 6px; border-radius: 999px; font-size: 10.5px; line-height: 17px; letter-spacing: 0.04em; text-transform: uppercase; font-weight: 600; background: var(--cobalt-soft); color: var(--cobalt-ink); vertical-align: 1px; white-space: nowrap; }
.tag.sep { background: var(--warm-soft); color: var(--warm-ink); }
.tag.loc { background: var(--surface-2); color: var(--text-3); border: 1px solid var(--line); }

/* Header band */
.band { background: var(--band); color: var(--on-band); }
.band .wrap { padding-block: 40px 44px; display: grid; gap: 28px; }
.band a { color: var(--band-accent); }
.band code { background: var(--band-2); border-color: transparent; color: var(--on-band); }
.band .tag { background: var(--band-2); color: var(--band-accent); }
.mark { display: flex; align-items: center; gap: 10px; font-family: var(--display); font-weight: 650; font-size: 15px; letter-spacing: 0.02em; color: var(--on-band-2); }
.mark svg { width: 26px; height: 26px; }
.thesis h1 { font-family: var(--display); font-size: clamp(30px, 4.6vw, 46px); line-height: 1.12; letter-spacing: -0.02em; font-weight: 680; margin: 10px 0 12px; text-wrap: balance; max-width: 22ch; }
.thesis p { color: var(--on-band-2); font-size: 18px; max-width: 60ch; margin: 0; }
.pillars { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
.pillars li { background: var(--band-2); border-radius: 10px; padding: 16px 18px; min-width: 0; }
.pillars h3 { margin: 0 0 6px; font-family: var(--display); font-size: 16px; font-weight: 650; color: var(--on-band); }
.pillars p { margin: 0; color: var(--on-band-2); font-size: 14.5px; line-height: 1.55; }
.meta { font-size: 13px; color: var(--on-band-2); margin: 0; }

/* Proof strip */
.proof { padding-block: 28px 8px; }
.lead { font-size: 18px; max-width: 70ch; margin: 0 0 16px; text-wrap: pretty; }
.strip { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0; background: var(--surface); border: 1px solid var(--line); border-radius: 12px; overflow: hidden; }
.step { padding: 18px 20px; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.step + .step { border-left: 1px solid var(--line); }
.step-n { font-family: var(--mono); font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--cobalt-ink); font-weight: 600; }
.step h3 { margin: 0; font-family: var(--display); font-size: 17px; font-weight: 650; }
.step p { margin: 0; color: var(--text-2); font-size: 14.5px; }
.step .step-ev { margin-top: auto; padding-top: 6px; font-size: 14px; }

/* Section bar */
.bar { position: sticky; top: env(safe-area-inset-top, 0px); z-index: 5; background: var(--canvas); border-bottom: 1px solid var(--line); }
body::before { content: ""; position: fixed; inset: 0 0 auto; height: env(safe-area-inset-top, 0px); z-index: 10; background: var(--canvas); }
.bar nav { display: flex; gap: 4px; overflow-x: auto; padding-block: 8px; scrollbar-width: none; }
.bar a { flex: none; text-decoration: none; color: var(--text-2); font-size: 13.5px; padding: 5px 10px; border-radius: 999px; }
.bar a:hover { background: var(--surface); color: var(--text); }

/* Reading column */
main .wrap { padding-block: 8px 64px; }
section { padding-top: 34px; scroll-margin-top: 56px; }
section > * { max-width: 74ch; }
section > .claims, section > .tablewrap, section > .code { max-width: none; }
h2 { font-family: var(--display); font-size: 26px; font-weight: 680; letter-spacing: -0.015em; margin: 0 0 12px; padding-top: 22px; border-top: 1px solid var(--line); text-wrap: balance; }
section p { margin: 0 0 14px; color: var(--text-2); }
section p strong { color: var(--text); }
.points, .steps { padding-left: 0; list-style: none; display: grid; gap: 10px; margin: 0 0 18px; }
.points li { padding-left: 16px; position: relative; color: var(--text-2); }
.points li::before { content: ""; position: absolute; left: 0; top: 0.72em; width: 6px; height: 6px; border-radius: 2px; background: var(--cobalt); }
.points li strong:first-child { color: var(--text); }
.steps { counter-reset: s; }
.steps li { counter-increment: s; display: grid; grid-template-columns: 28px minmax(0, 1fr); gap: 10px; color: var(--text-2); }
.steps li::before { content: counter(s); width: 24px; height: 24px; border-radius: 50%; background: var(--cobalt-soft); color: var(--cobalt-ink); font-weight: 650; font-size: 13px; display: grid; place-items: center; margin-top: 1px; }

.code { margin: 0 0 18px; border-radius: 10px; overflow: hidden; background: var(--code-bg); }
.code figcaption { font-family: var(--mono); font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: #8f9bb2; padding: 8px 14px 0; }
.code pre { margin: 0; padding: 8px 14px 14px; overflow-x: auto; }
.code code { background: none; border: 0; padding: 0; color: var(--code-fg); font-size: 13px; line-height: 1.55; overflow-wrap: normal; }

.claims { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; margin: 4px 0 22px; }
.claim { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 16px 18px; min-width: 0; display: flex; flex-direction: column; gap: 10px; }
.claim h3 { margin: 0; font-family: var(--display); font-size: 15.5px; font-weight: 650; line-height: 1.4; }
.claim dl { margin: 0; display: grid; gap: 8px; }
.claim dl div { display: grid; grid-template-columns: 112px minmax(0, 1fr); gap: 10px; font-size: 13.5px; }
.claim dt { color: var(--text-3); font-size: 11.5px; letter-spacing: 0.04em; text-transform: uppercase; font-weight: 600; padding-top: 2px; }
.claim dd { margin: 0; color: var(--text-2); min-width: 0; }

.tablewrap { overflow-x: auto; margin: 0 0 18px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); }
table { border-collapse: collapse; width: 100%; font-size: 14px; }
th { text-align: left; font-size: 11.5px; letter-spacing: 0.04em; text-transform: uppercase; color: var(--text-3); font-weight: 600; padding: 10px 14px; border-bottom: 1px solid var(--line); background: var(--surface-2); }
td { padding: 10px 14px; border-bottom: 1px solid var(--line); vertical-align: top; color: var(--text-2); }
tr:last-child td { border-bottom: 0; }
td:first-child { white-space: nowrap; }

footer { border-top: 1px solid var(--line); }
footer .wrap { padding-block: 20px 36px; font-size: 13px; color: var(--text-3); }

@media (max-width: 820px) {
  .pillars, .strip, .claims { grid-template-columns: minmax(0, 1fr); }
  .step + .step { border-left: 0; border-top: 1px solid var(--line); }
  td:first-child { white-space: normal; }
}
@media (max-width: 480px) { .claim dl div { grid-template-columns: minmax(0, 1fr); gap: 2px; } }
@media (prefers-reduced-motion: no-preference) { html { scroll-behavior: smooth; } }
</style>

<header class="band">
  <div class="wrap">
    <div class="mark" aria-label="Everstreet">
      <svg viewBox="0 0 26 26" aria-hidden="true"><rect width="26" height="26" rx="6" fill="#3155d9"/><path d="M8 7h10M8 13h8M8 19h10M8 7v12" stroke="#ffffff" stroke-width="2.4" stroke-linecap="round" fill="none"/></svg>
      Everstreet
    </div>
    <div class="thesis">
      <h1>${headline.text.replace(/^\*\*|\*\*$/g, "").replace(/\.$/, "")}</h1>
      <p>${inline(intro.text)}</p>
    </div>
    <ul class="pillars">${pillars.items.map(pillar).join("")}</ul>
    <p class="meta">${inline(built.text)} · From README.md at commit <code>${commit}</code>, ${today}.</p>
  </div>
</header>

<div class="wrap proof">
  <p class="lead">${inline(lead.text)}</p>
  <ol class="strip">${stripCards}</ol>
</div>

<div class="bar"><div class="wrap"><nav aria-label="Sections">${sections.map((s) => `<a href="#${s.id}">${esc(s.title)}</a>`).join("")}</nav></div></div>

<main><div class="wrap">
${sections.map((s) => `<section id="${s.id}"><h2>${inline(s.title)}</h2>\n${s.body.map(render).join("\n")}</section>`).join("\n")}
</div></main>

<footer><div class="wrap">Repository: <a href="https://github.com/CoderofVibes/everstreet" target="_blank" rel="noopener">github.com/CoderofVibes/everstreet</a> · Links to repository files open on GitHub · Testnet links open the public NEAR explorer.</div></footer>
`;
writeFileSync(OUT, html);
console.log(`wrote ${OUT} (${html.length} bytes) at ${commit}`);
