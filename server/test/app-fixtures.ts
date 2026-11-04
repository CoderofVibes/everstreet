// Job 002e: a FICTIONAL generated web app for tests and the disposable preview: a quote
// calculator for an invented print shop. Its checks are declarative cases the isolated recipe
// runs; nothing here is executed by the platform.

export const QUOTE_FILES = [
  {
    path: "index.html",
    text: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Quote calculator</title>
<link rel="stylesheet" href="style.css">
<script type="module" src="app.js"></script>
</head>
<body>
<main>
<h1>Brightleaf Print: instant quote</h1>
<p class="note">Fictional business. Prices are illustrative.</p>
<label>Copies <input id="copies" type="number" min="1" max="10000" value="100"></label>
<label>Colour <select id="colour"><option value="mono">Black and white</option><option value="colour">Colour</option></select></label>
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
    path: "quote.js",
    text: `// Pure pricing: cents, so the result is exact.
export function quote(input) {
  const copies = Math.max(1, Math.min(10000, Math.floor(Number(input.copies) || 0)));
  const each = input.colour === "colour" ? 45 : 12;
  const setup = 500;
  const discount = copies >= 1000 ? 0.1 : 0;
  const cents = Math.round((setup + copies * each) * (1 - discount));
  return { copies, cents, label: "$" + (cents / 100).toFixed(2) };
}
`,
  },
  {
    path: "app.js",
    text: `import { quote } from "./quote.js";
const copies = document.getElementById("copies");
const colour = document.getElementById("colour");
const total = document.getElementById("total");
function update() {
  const q = quote({ copies: copies.value, colour: colour.value });
  total.textContent = q.copies + " copies: " + q.label;
}
copies.addEventListener("input", update);
colour.addEventListener("change", update);
update();
parent.postMessage({ everstreet_preview: 1, type: "ready" }, "*");
`,
  },
];

export const QUOTE_CHECKS = [
  {
    id: "mono_100",
    label: "100 black-and-white copies cost $17.00",
    module: "quote.js",
    export: "quote",
    input: { copies: 100, colour: "mono" },
    expect: { copies: 100, cents: 1700, label: "$17.00" },
  },
  {
    id: "colour_bulk",
    label: "1,000 colour copies get the 10% bulk discount",
    module: "quote.js",
    export: "quote",
    input: { copies: 1000, colour: "colour" },
    expect: { copies: 1000, cents: 40950, label: "$409.50" },
  },
];

export const QUOTE_BUNDLE = {
  kind: "web_app_bundle",
  schema_version: 1,
  name: "Brightleaf quote calculator",
  description: "A fictional print shop's instant quote page.",
  files: QUOTE_FILES,
  checks: QUOTE_CHECKS,
};

/** The same app with a changed price: a second version to compare and restore. */
export const QUOTE_BUNDLE_V2 = {
  ...QUOTE_BUNDLE,
  files: QUOTE_FILES.map((f) =>
    f.path === "quote.js" ? { ...f, text: f.text.replace("? 45 : 12", "? 40 : 12") } : f,
  ),
  checks: [
    QUOTE_CHECKS[0],
    { ...QUOTE_CHECKS[1], expect: { copies: 1000, cents: 36450, label: "$364.50" } },
  ],
};
