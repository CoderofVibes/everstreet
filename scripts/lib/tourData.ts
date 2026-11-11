// The data file behind the guided tour and the self-playing video (web/dist-proof/data/tour.json),
// made from the committed recording of the demo (data/tour/recording.json, scripts/record-tour.ts).
// Adds the named places the guide and the video open: their ids are made fresh by each demo run,
// so they are found in the recording, never written by hand. Throws if one is missing.

import { readFileSync } from "node:fs";
import type { TourData } from "../../web/src/tour/replay.ts";
import { tourProblems } from "../../web/src/tour/steps.ts";
import { videoProblems } from "../../web/src/video/beats.ts";

// biome-ignore lint/suspicious/noExplicitAny: recorded API bodies, read field by field
type Json = Record<string, any>;

export const RECORDING = "data/tour/recording.json";

export function tourData(file = RECORDING): TourData {
  const rec = JSON.parse(readFileSync(file, "utf8")) as Json;
  if (rec.format !== "everstreet.tour-recording") throw new Error(`${file}: not a tour recording`);
  const viewers = rec.viewers as TourData["viewers"];
  const reads = (who: string) => (viewers[who]?.reads ?? {}) as Record<string, Json>;
  // Every viewer is somebody signed in: without their session read the pages would ask to sign in.
  for (const who of Object.keys(viewers))
    if (!reads(who)["/api/me"]?.person || !reads(who)["/api/env"])
      throw new Error(`${file}: ${who} has no session read; record again`);
  const projects = (reads("delphine")["/api/product-projects"]?.projects ?? []) as Json[];
  const business = (name: string) => projects.find((p) => p.business_name === name);
  const ledgerline = business("Ledgerline");
  const signalwatch = business("Signalwatch");
  if (!ledgerline || !signalwatch)
    throw new Error(`${file}: Ledgerline or Signalwatch is missing from the founder's projects`);
  const offer = Object.entries(reads("cara")).find(
    ([k, v]) =>
      k.startsWith("/api/public/customer-offers/") && v.offer?.business?.slug === "ledgerline",
  )?.[1];
  if (!offer) throw new Error(`${file}: the customer's Ledgerline offer is missing`);
  // The use Cara made after the sale (the video's last demo shot): in her list then, not before.
  const usesOf = (who: string) => (reads(who)["/api/customer/uses?limit=20"]?.uses ?? []) as Json[];
  const before = new Set(usesOf("cara").map((u) => u.id));
  const later = usesOf("cara-after").find(
    (u) => u.business?.slug === "signalwatch" && !before.has(u.id),
  );
  if (!later) throw new Error(`${file}: the customer's use after the sale is missing`);
  const data: TourData = {
    recorded_at: String(rec.recorded_at),
    commit: String(rec.commit),
    viewers,
    stops: {
      portfolio: "/portfolio",
      studio: `/build/${ledgerline.id}`,
      desk: `/desk/${ledgerline.business_id}`,
      value: `/desk/${ledgerline.business_id}/value`,
      customer: `/use/${offer.offer.offer_id}`,
      sale: `/sales/${signalwatch.business_id}`,
      agents: `/desk/${signalwatch.business_id}/agent-purchases`,
      agentsLedgerline: `/desk/${ledgerline.business_id}/agent-purchases`,
      allowance: `/desk/${signalwatch.business_id}/allowance`,
      customerAccess: `/build/${ledgerline.id}?view=service&task=customers`,
      saleEconomics: `/sales/${signalwatch.business_id}/economics`,
      caraResult: `/uses/${later.id}`,
      caraUse: `/use/${later.offer_id}`,
    },
  };
  const problems = [...tourProblems(data), ...videoProblems(data)];
  if (problems.length) throw new Error(`${file}: ${problems.join("; ")}`);
  return data;
}
