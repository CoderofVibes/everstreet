// Job 001b: where a product stands, from actual records only. The editable brief/prototype
// revision, the generated candidate builds, their checks and the active release are different
// things; the projection names each from its own record and says "unknown" when a record couldn't
// be read. Nothing here is inferred from a single flag, and an active release is never described
// as a live provider, wallet or network connection.

import type { Candidate, Releases } from "./runtimeApi.ts";

export type Tone = "done" | "now" | "blocked" | "unknown";

/** Where the studio can take the person for an item (an existing view or route). */
export type Target =
  | { tab: "brief" | "builds" | "versions" | "continuity" }
  | { tab: "service"; task: "try" | "evaluate" | "customers" }
  | { route: string };

export interface StatusItem {
  key: "brief" | "build" | "evaluation" | "release" | "customers" | "handover";
  label: string;
  value: string;
  tone: Tone;
  target: Target;
}

export interface StudioStatus {
  chip: { label: string; tone: "mint" | "blue" | "caution" | "" };
  items: StatusItem[];
  /** The one useful next step after the brief's own to-dos, or null. */
  next: { label: string; target: Target } | null;
  /** A note shown with a release: what it does and doesn't show. */
  releaseNote: string | null;
}

export interface StatusInput {
  head: number;
  dirty: boolean;
  build: { available: boolean; reason?: string | null };
  businessId: string;
  /** The releases record, or "unknown" if it couldn't be read. */
  releases: Releases | "unknown";
  /** Active and retired customer offers for this product, or "unknown". */
  offers: { active: number; retired: number } | "unknown";
}

const short = (h: string) => (h.length > 10 ? `${h.slice(0, 8)}…` : h);

function latest(candidates: Candidate[]): Candidate | null {
  return (
    [...candidates].sort(
      (a, b) => b.revision - a.revision || b.built_at.localeCompare(a.built_at),
    )[0] ?? null
  );
}

export function projectStatus(s: StatusInput): StudioStatus {
  const items: StatusItem[] = [];
  items.push({
    key: "brief",
    label: "Brief and prototype",
    value: s.dirty
      ? `Unsaved changes (would become revision ${s.head + 1})`
      : `Revision ${s.head} saved`,
    tone: s.dirty ? "now" : "done",
    target: { tab: "brief" },
  });

  if (s.releases === "unknown") {
    for (const [key, label] of [
      ["build", "Build"],
      ["evaluation", "Release checks"],
      ["release", "Release"],
    ] as const)
      items.push({
        key,
        label,
        value: "Couldn't be read just now",
        tone: "unknown",
        target: key === "build" ? { tab: "builds" } : { tab: "service", task: "evaluate" },
      });
  } else {
    const r = s.releases;
    const cand = latest(r.candidates);
    items.push({
      key: "build",
      label: "Build",
      value: cand
        ? `Build ${short(cand.artifact_job)} from revision ${cand.revision}${
            cand.revision < s.head ? ` (the brief is now at revision ${s.head})` : ""
          }`
        : s.build.available
          ? "No build yet"
          : "Not available here",
      tone: cand ? "done" : s.build.available ? "now" : "blocked",
      target: { tab: "builds" },
    });
    const check = cand?.latest_check ?? null;
    items.push({
      key: "evaluation",
      label: "Release checks",
      value: !cand
        ? "Nothing to check yet"
        : !check
          ? `Not run yet for build ${short(cand.artifact_job)}`
          : check.release_ready
            ? `${check.passed} of ${check.total} passed; ready to release`
            : `${check.passed} of ${check.total} passed; not releasable${
                check.reasons.length ? `: ${check.reasons.join(". ")}` : ""
              }`,
      tone: !cand ? "blocked" : !check ? "now" : check.release_ready ? "done" : "blocked",
      target: { tab: "service", task: "evaluate" },
    });
    const active = r.active;
    const activeCand = active
      ? r.candidates.find((c) => c.artifact_job === active.artifact_job)
      : null;
    items.push({
      key: "release",
      label: "Release",
      value: active
        ? `Build ${short(active.artifact_job)}${
            activeCand ? ` (revision ${activeCand.revision})` : ""
          } released${!active.checks_current ? "; its checks are out of date" : ""}${
            activeCand && activeCand.revision < s.head
              ? `; the brief has changed since (revision ${s.head})`
              : ""
          }`
        : "Not released",
      tone: active ? (active.checks_current ? "done" : "blocked") : cand ? "now" : "blocked",
      target: { tab: "service", task: "evaluate" },
    });
  }

  items.push({
    key: "customers",
    label: "Customer offer",
    value:
      s.offers === "unknown"
        ? "Couldn't be read just now"
        : s.offers.active > 0
          ? `${s.offers.active} active (a local setting; see readiness)`
          : s.offers.retired > 0
            ? "None active (earlier offers retired)"
            : "None",
    tone:
      s.offers === "unknown"
        ? "unknown"
        : s.offers.active > 0
          ? "done"
          : s.releases !== "unknown" && s.releases.active
            ? "now"
            : "blocked",
    target: { tab: "service", task: "customers" },
  });
  items.push({
    key: "handover",
    label: "Sale and handover",
    value: "Evidence and any sale in progress",
    tone: "unknown",
    target: { route: `/desk/${s.businessId}/handover` },
  });

  const rel = s.releases === "unknown" ? null : s.releases;
  const cand = rel ? latest(rel.candidates) : null;
  const chip: StudioStatus["chip"] = rel?.active
    ? { label: "Released build", tone: "mint" }
    : cand
      ? { label: "Built, not released", tone: "blue" }
      : rel
        ? { label: "Prototype only", tone: "caution" }
        : { label: "Status unknown", tone: "" };

  let next: StudioStatus["next"] = null;
  if (rel) {
    const check = cand?.latest_check ?? null;
    if (!cand)
      // First-use review #19: when this kind can't be built here, offer the way that works
      // (a service with a bookable page), never a step that leads back to the studio.
      next = s.build.available
        ? { label: "Build a version", target: { tab: "builds" } }
        : { label: "Offer it as a service instead", target: { route: "/start" } };
    else if (!rel.active && !check)
      next = { label: "Check the latest build", target: { tab: "service", task: "evaluate" } };
    else if (!rel.active && check?.release_ready)
      next = { label: "Release the checked build", target: { tab: "service", task: "evaluate" } };
    else if (!rel.active)
      next = { label: "See why checks failed", target: { tab: "service", task: "evaluate" } };
    else if (s.offers !== "unknown" && s.offers.active === 0)
      next = { label: "Set up a customer offer", target: { tab: "service", task: "customers" } };
    else next = { label: "Try the released version", target: { tab: "service", task: "try" } };
  }
  return {
    chip,
    items,
    next,
    releaseNote: rel?.active
      ? "A release is the version customers would use. It doesn't show that a model provider, wallet or network connection is live."
      : null,
  };
}
