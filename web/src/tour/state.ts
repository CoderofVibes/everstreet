// What the replay is answering as, shared by the static site's entry (web/src/proofSite.tsx), the
// guided tour and the self-playing video: the recording, who is viewing, and who is asked for next.

import type { TourData } from "./replay.ts";

export const EMPTY_TOUR: TourData = { recorded_at: "", commit: "", viewers: {}, stops: {} };

export const tour = {
  data: EMPTY_TOUR,
  viewer: null as string | null,
  asked: null as string | null,
};
