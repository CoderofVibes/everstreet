// Job 001f1: Explore's read path, as pure rules. The feed's load settles (ready, or failed with a
// retry, never an endless Loading); the Following feed belongs to the account that asked for it,
// so a different account never sees it; the tab list moves with the keyboard.

import type { LoadState } from "./latestLoad.ts";
import { nextTab } from "./publication.ts";

export type ExploreTab = "starting" | "open" | "needs" | "following";
export const EXPLORE_TABS: ExploreTab[] = ["starting", "open", "needs", "following"];

/** What the feed area shows for a load: data once there is some, else loading or a retry. */
export function feedView<T>(s: LoadState<T>): "ready" | "loading" | "failed" {
  if (s.data !== null) return "ready";
  return s.status === "loading" ? "loading" : "failed";
}

/** The Following feed as loaded for one account. */
export interface FollowSlot<T> {
  who: string | null;
  state: LoadState<T>;
}

/** The slot's state only when it was loaded for this account; anyone else starts from nothing. */
export function followingFor<T>(slot: FollowSlot<T>, who: string | null): LoadState<T> {
  return slot.who !== null && slot.who === who
    ? slot.state
    : { data: null, error: null, status: "loading" };
}

/** Arrow keys, Home and End over Explore's tabs; null for any other key. */
export function exploreTabKey(current: ExploreTab, key: string): ExploreTab | null {
  const i = nextTab(EXPLORE_TABS.indexOf(current), key, EXPLORE_TABS.length);
  return i === null ? null : (EXPLORE_TABS[i] ?? null);
}
