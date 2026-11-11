// The static site (Nov 7, Tony: the recorded proof; Nov 11, Tony: a guided tour of Everstreet, then
// the proof). Servable from any static host with no Everstreet server behind it. The pages are the
// app's own (App.tsx, unchanged); what they read is answered from files written at build time
// (scripts/build-proof-site.ts):
//   - the proof pages' two public reads, from the committed testnet evidence (STATIC_READS);
//   - every other read, from a recording of the demo (data/tour/recording.json, web/src/tour).
// Nothing is recomputed or hand-written, nothing can be changed, and a route nobody walked while
// the recording ran is not offered. The guide (tour/Guide.tsx) walks a visitor through in order.
// With ?video=1 the same pages play themselves instead (video/Video.tsx), for recording the demo
// video in one take.

import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { Link, queryParam, Router, splitLocation, useRouter } from "./router.tsx";
import { SessionProvider } from "./session.tsx";
import { Guide, notify } from "./tour/Guide.tsx";
import {
  answer,
  NOT_RECORDED_TEXT,
  RECORDING_TEXT,
  type TourData,
  viewerFor,
} from "./tour/replay.ts";
import { tour } from "./tour/state.ts";
import { Video, videoOptions } from "./video/Video.tsx";
import "./styles.css";

/** The proof pages' reads, and the build-time file (from committed evidence) that answers each. */
export const STATIC_READS: Record<string, string> = {
  "/api/examples/ledgerline": "/data/ledgerline.json",
  "/api/public/attacks": "/data/attacks.json",
};

/**
 * The video's settings, read once: the pages it plays change the address as they go. A reload of
 * a video window (F5) starts the video again from the top, not the page it had reached (Tony,
 * Nov 11): the tab remembers that it is a video window.
 */
const VIDEO_KEY = "everstreet:video";
const VIDEO = (() => {
  const store = (() => {
    try {
      return window.sessionStorage;
    } catch {
      return null;
    }
  })();
  const asked = videoOptions(window.location.search);
  if (asked) {
    store?.setItem(VIDEO_KEY, window.location.search);
    return asked;
  }
  const kept = store?.getItem(VIDEO_KEY) ?? null;
  const options = kept ? videoOptions(kept) : null;
  if (kept && options) window.history.replaceState(null, "", `/${kept}`);
  return options;
})();

const VIEWER_KEY = "everstreet:tour:viewer";
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const real = window.fetch.bind(window);
window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const at = new URL(url, window.location.origin);
  if (!at.pathname.startsWith("/api/")) return real(input, init);
  const method = (
    init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET")
  ).toUpperCase();
  const file = STATIC_READS[at.pathname];
  if (file && method === "GET") return real(file);
  const sent = typeof init?.body === "string" ? init.body : null;
  const a = answer(tour.data, tour.viewer, method, `${at.pathname}${at.search}`, sent);
  if (a.status === 403) notify(RECORDING_TEXT);
  else if (a.status === 404) console.debug(`[tour] not recorded: ${at.pathname}${at.search}`);
  return Promise.resolve(json(a.status, a.body));
};

// The app shell's own label (previewLabel.ts): one strip saying what this copy is.
(globalThis as { __everstreetPreview?: unknown }).__everstreetPreview = {
  label: "Recorded tour",
  detail: "fictional people and test tokens · the pages are live to explore, changes are off",
};
// A wallet button in a recording has no wallet to open: it says so (wallet.ts reads this global).
(globalThis as { __everstreetHarnessWallet?: unknown }).__everstreetHarnessWallet = () => {
  throw new Error(RECORDING_TEXT);
};

/** A link inside the page to a route nobody walked while the recording ran goes nowhere. */
function fence(e: MouseEvent) {
  const a = (e.target as Element | null)?.closest?.("a[href]");
  const href = a?.getAttribute("href");
  if (!a || !href?.startsWith("/") || href.startsWith("/data/")) return;
  if (viewerFor(tour.data, splitLocation(href).path, tour.viewer) !== null) return;
  e.preventDefault();
  e.stopPropagation();
  notify(NOT_RECORDED_TEXT);
}

function Tour({ data }: { data: TourData }) {
  const { path, search, go } = useRouter();
  // Who views this route: set while rendering, so every read the page below makes is theirs.
  const viewer = viewerFor(data, path, tour.viewer, tour.asked ?? queryParam("as", search));
  if (viewer) tour.viewer = viewer;
  // biome-ignore lint/correctness/useExhaustiveDependencies: path is a trigger: a step's request for a viewer is spent once its route shows
  useEffect(() => {
    tour.asked = null;
    try {
      if (tour.viewer) window.sessionStorage.setItem(VIEWER_KEY, tour.viewer);
    } catch {
      // Blocked storage: a reload starts as the first viewer who walked the route.
    }
  }, [path, viewer]);
  useEffect(() => {
    document.addEventListener("click", fence, true);
    return () => document.removeEventListener("click", fence, true);
  }, []);
  const visit = (to: string, as?: string) => {
    tour.asked = as ?? null;
    go(to);
  };
  return (
    <>
      {viewer ? (
        // The app remounts for each viewer, as it does when someone signs in.
        <SessionProvider key={viewer}>
          <App />
        </SessionProvider>
      ) : (
        <main className="main">
          <div className="page empty">
            <h2>Not part of this recorded tour</h2>
            <p>
              <Link to="/">Start the tour</Link>
            </p>
          </div>
        </main>
      )}
      <Guide data={data} viewer={viewer} visit={visit} />
    </>
  );
}

function Loader() {
  const [data, setData] = useState<TourData | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    real("/data/tour.json")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: TourData) => {
        tour.data = d;
        try {
          tour.viewer = VIDEO ? null : window.sessionStorage.getItem(VIEWER_KEY);
        } catch {
          tour.viewer = null;
        }
        setData(d);
      })
      .catch(() => setFailed(true));
  }, []);
  if (failed)
    return (
      <div className="page empty">
        <h2>The recorded tour couldn't be loaded</h2>
        <p>Reload the page to try again.</p>
      </div>
    );
  if (!data) return <div className="page muted">Loading…</div>;
  return VIDEO ? <Video data={data} options={VIDEO} /> : <Tour data={data} />;
}

const root = document.getElementById("root");
if (root)
  createRoot(root).render(
    <StrictMode>
      <Router>
        <Loader />
      </Router>
    </StrictMode>,
  );
