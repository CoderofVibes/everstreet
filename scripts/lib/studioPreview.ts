// Job 001b: the in-memory scenario behind scripts/preview-studio.ts, kept apart from any listener so
// a test can drive it through the real API without a network.
//
// FICTIONAL and SYNTHETIC: the customer preview (in-memory database, real app and routes, labelled
// customer chain double, scripted extractor, in-memory protection, preview-only signer) with one
// founder, Ava, and three product projects in representative states, made through the real
// product, build and evaluation APIs:
//   1. "released": a checked, released build with an active customer offer, and a NEWER saved
//      brief revision (so the editable brief and the released build differ, truthfully);
//   2. "failed": a built candidate whose release checks failed (the scripted runtime errs);
//   3. "draft": a brief only, in another business, never built.
// The app the preview serves has no build service configured, so the studio shows building as
// unavailable; trials and checks still run on the scripted runtime. No model, wallet or NEAR.

import { RuntimeFailure } from "../../server/src/runtime.ts";
import { customerPreview } from "./customerPreview.ts";

export async function studioPreview() {
  const p = await customerPreview({
    withOffer: true,
    label: {
      label: "Preview only: synthetic studio, runtime and customer chain",
      detail:
        "Fictional projects made through the real APIs; a scripted runtime, no model, wallet or network. Building is deliberately not connected here.",
    },
  });
  const { w } = p;
  const rw = w.rw;
  const ava = w.f.ava; // the runtime world's caller (its app has the build service)

  // 1. The released product gets a newer saved brief revision than its released build.
  const released = w.f.project;
  const v = (await ava(`/api/product-projects/${released}`)).body;
  const saved = await ava(`/api/product-projects/${released}/revisions`, "POST", {
    base_revision: v.head.number,
    brief: { ...v.head.brief, promise: `${v.head.brief.promise} Now also reads due dates.` },
    prototype: v.head.prototype,
    note: "Preview: a newer brief than the released build",
  });
  if (saved.status !== 201 && saved.status !== 200)
    throw new Error(`preview setup: save ${saved.status} ${saved.body.error ?? ""}`);

  // 2. A second product in the same business: built, then its release checks fail.
  const second = (
    await ava("/api/product-projects", "POST", {
      idea: "Turn fictional delivery notes into received-goods rows",
      foundation: "ai_api",
      business_id: w.f.business,
    })
  ).body.project as { id: string };
  const job = await rw.build(ava, second.id);
  const original = w.provider.script;
  w.provider.script = async () => {
    throw new RuntimeFailure(
      "Preview: the scripted runtime errs for this check",
      "provider_error",
      null,
    );
  };
  try {
    const run = await rw.check({ ...w.f, project: second.id, job });
    if (run.release_ready) throw new Error("preview setup: the failing check passed");
  } finally {
    w.provider.script = original;
  }

  // 3. A brief only, in another business (never built).
  const draft = (
    await ava("/api/product-projects", "POST", {
      idea: "Summarise fictional customer emails into follow-up tasks",
      foundation: "ai_api",
    })
  ).body.project as { id: string; business_id: string };

  return {
    site: p.site,
    w,
    people: p.people,
    controls: p.controls,
    projects: { released, failed: second.id, draft: draft.id },
    businesses: { main: w.f.business, draft: draft.business_id },
  };
}
