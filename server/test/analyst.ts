// The labelled STAND-IN analyst (docs/design/AGENT_ANALYSIS.md §5): a deterministic double for
// the AI model in tests, the configured child and the showcase. It answers the analysis
// request's closed schema the way a careful model should: it flags lines that announce a removal,
// deprecation, rename, price or limit change, only when they name something the customer's
// context mentions, quoting the line verbatim, and refuses text that isn't release notes. It
// ignores instructions inside the notes. Not a model; never presented as one. Fictional data.

import type { Prototype } from "../src/products.ts";

/** Signalwatch's prototype: the release-notes form, and the agent's result fed by it. */
export const SIGNALWATCH_PROTOTYPE: Prototype = {
  schema: 1,
  screens: [
    {
      id: "notes",
      kind: "form",
      title: "Check a supplier's release notes",
      fields: [
        { key: "notes", label: "Release notes", type: "long_text", options: [] },
        { key: "relies", label: "What you rely on", type: "long_text", options: [] },
      ],
      submit_label: "Check these notes",
    },
    {
      id: "flags",
      kind: "model",
      title: "Flags for you",
      source: "notes",
      outputs: [
        { key: "flag", label: "Flag", type: "text", options: [] },
        { key: "action", label: "Proposed action", type: "long_text", options: [] },
      ],
    },
  ],
};

export const SIGNALWATCH_BRIEF = {
  name: "Signalwatch",
  audience: "Small fictional software teams that depend on outside suppliers",
  problem: "Supplier release notes hide changes that break what a team relies on",
  promise: "Flags the changes in a supplier's release notes that affect what you rely on",
  features: ["Paste release notes", "Flags with quotes, reasons and next steps"],
  price: { model: "per_use", amount_cents: 15 },
};

const STOP = new Set(
  "the and with every night call calls our use uses using we you your for from that this into have has are was will can not all any its sign".split(
    " ",
  ),
);
const HIGH = /\b(removed|removing|being removed|sunset|discontinued|breaking)\b/i;
const MEDIUM = /\b(deprecated|deprecating|renamed|rate limit|price|pricing)\b/i;
const NOTES = /release notes|changelog|\bv\d+(\.\d+)+\b/i;

/** The stand-in's answer for one submission (the closed schema of analysisSchema()). */
export function standInAnalysis(source: string, context: string) {
  if (!NOTES.test(source))
    return {
      status: "not_applicable",
      summary: "This doesn't look like a supplier's release notes.",
      findings: [],
    };
  const terms = [
    ...new Set(
      (context.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(
        (w) => w.length >= 3 && !STOP.has(w),
      ),
    ),
  ];
  const findings = source
    .split("\n")
    .map((l) => l.trim().replace(/^[-*]\s*/, ""))
    .filter((l) => l && (HIGH.test(l) || MEDIUM.test(l)))
    .flatMap((line) => {
      const words = new Set(line.toLowerCase().match(/[a-z0-9]+/g) ?? []);
      const hit = terms.find((t) => words.has(t));
      if (!hit) return [];
      const high = HIGH.test(line);
      return [
        {
          title: line.length > 80 ? `${line.slice(0, 77)}…` : line,
          severity: high ? "high" : "medium",
          evidence: line,
          why: `You rely on "${hit}", and this release ${high ? "removes or breaks it" : "changes it"}.`,
          proposed_action: high
            ? "Plan the move before the date in the notes, and test the replacement first."
            : "Note it, and schedule the change before the old way is removed.",
        },
      ];
    })
    .slice(0, 8);
  return {
    status: "analyzed",
    summary: findings.length
      ? `${findings.length} change${findings.length === 1 ? "" : "s"} could affect what you rely on.`
      : "Nothing in these notes affects what you rely on.",
    findings,
  };
}

/** The stand-in reading the analysis request's user message (analysisContent). */
export function standInFromContent(content: string) {
  const c = JSON.parse(content) as { source: string; context: { value: string }[] };
  return standInAnalysis(c.source, c.context.map((x) => x.value).join("\n"));
}
