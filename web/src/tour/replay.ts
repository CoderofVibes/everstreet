// The guided tour's replay (web/src/proofSite.tsx): the app's own pages answer from a recording of
// the demo (scripts/record-tour.ts, data/tour/recording.json) instead of a server. A recorded read
// gets its recorded body; any other read is "not in this tour"; nothing can be written. Who is
// viewing follows the route: each recorded viewer has the routes they walked. The self-playing
// video (web/src/video) plays from the same recording, including its after-the-sale viewers.

export interface TourViewer {
  /** The routes (pathnames) this viewer walked while the recording ran. */
  routes: string[];
  /**
   * Every successful GET /api read those pages made: "path?query" → the body. Also the requests the
   * server prepared for review ("POST path body" → the body): reads made by POST, storing nothing.
   */
  reads: Record<string, unknown>;
}

export interface TourData {
  recorded_at: string;
  commit: string;
  viewers: Record<string, TourViewer>;
  /** Named places in the tour (their ids are made fresh by each demo run). */
  stops: Record<string, string>;
}

/** The order viewers are tried in when the current one hasn't walked a route. */
export const VIEWER_ORDER = ["delphine", "cara", "noah"] as const;

export const VIEWER_NAMES: Record<string, { name: string; role: string }> = {
  delphine: { name: "Delphine Marsh", role: "a founder with three businesses" },
  cara: { name: "Cara Okafor", role: "a customer" },
  noah: { name: "Noah Brandt", role: "a buyer" },
};

const walked = (data: TourData, viewer: string, path: string) =>
  data.viewers[viewer]?.routes.includes(path) ?? false;

/**
 * Who views `path`: the viewer asked for (a guide step's `?as=`), else whoever is viewing now, else
 * the first viewer who walked it. Null when nobody did: the route is not in the tour.
 */
export function viewerFor(
  data: TourData,
  path: string,
  current: string | null,
  asked?: string | null,
): string | null {
  if (asked && walked(data, asked, path)) return asked;
  if (current && walked(data, current, path)) return current;
  return VIEWER_ORDER.find((v) => walked(data, v, path)) ?? null;
}

export interface Answer {
  status: number;
  body: unknown;
}

export const RECORDING_TEXT =
  "This is a recording, so nothing can be changed here. The whole app runs on your computer with npm run demo.";
export const NOT_RECORDED_TEXT =
  "Not part of this recorded tour. The whole app runs on your computer with npm run demo.";

/** The key a prepared request was recorded under: its path and its exact JSON body. */
export function preparedKey(path: string, body: string | null | undefined): string {
  try {
    return `POST ${path} ${JSON.stringify(JSON.parse(body || "{}"))}`;
  } catch {
    return `POST ${path} `;
  }
}

/**
 * What the replay answers to one API call (`target` is "path?query"). A POST is answered only
 * when it is a recorded request-for-review (the same path and body); every other write is refused.
 */
export function answer(
  data: TourData,
  viewer: string | null,
  method: string,
  target: string,
  body?: string | null,
): Answer {
  const reads = viewer ? data.viewers[viewer]?.reads : undefined;
  if (method !== "GET") {
    const key = method === "POST" ? preparedKey(target.split("?")[0] as string, body) : "";
    if (key && reads && Object.hasOwn(reads, key)) return { status: 200, body: reads[key] };
    return { status: 403, body: { error: RECORDING_TEXT, code: "recording" } };
  }
  if (reads && Object.hasOwn(reads, target)) return { status: 200, body: reads[target] };
  return { status: 404, body: { error: NOT_RECORDED_TEXT, code: "static" } };
}
