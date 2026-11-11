// The guided tour's dock (web/src/proofSite.tsx): a panel fixed to the foot of the window that
// names the stop, says in a few lines what the page above shows, and moves on with Next. The page
// above is the app itself, so the dock does the explaining and the pages stay as they are.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "../router.tsx";
import { type TourData, VIEWER_NAMES } from "./replay.ts";
import { CLAIMS_URL, STEPS, stepAt, stepRoute } from "./steps.ts";

type Listener = (text: string) => void;
const listeners = new Set<Listener>();
/** A short message above the dock (a link the tour doesn't hold, a change the recording can't make). */
export function notify(text: string) {
  for (const l of listeners) l(text);
}

const STEP_KEY = "everstreet:tour:step";
function storedStep(): number {
  try {
    const n = Number(window.sessionStorage.getItem(STEP_KEY));
    return Number.isInteger(n) && n >= 0 && n < STEPS.length ? n : 0;
  } catch {
    return 0;
  }
}

const SOURCE = {
  demo: "Recorded demo · simulated history",
  testnet: "Recorded on NEAR testnet",
  tests: "Recorded test run · testnet pairs linked",
} as const;

export function Guide({
  data,
  viewer,
  visit,
}: {
  data: TourData;
  /** Who is viewing the page above. */
  viewer: string | null;
  /** Opens a route as a viewer. */
  visit: (to: string, as?: string) => void;
}) {
  const { path } = useRouter();
  const at = stepAt(path, data.stops);
  const [step, setStep] = useState(() => (at >= 0 ? at : storedStep()));
  const [open, setOpen] = useState(true);
  const [side, setSide] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const dock = useRef<HTMLElement>(null);

  // Arriving on a stop's page by any road (a link in the page, back and forward) makes it current.
  useEffect(() => {
    if (at < 0) return;
    setStep(at);
    setSide(null);
  }, [at]);
  useEffect(() => {
    try {
      window.sessionStorage.setItem(STEP_KEY, String(step));
    } catch {
      // Blocked storage: the tour still works, it just starts at its first stop after a reload.
    }
  }, [step]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const show: Listener = (text) => {
      setNotice(text);
      clearTimeout(timer);
      timer = setTimeout(() => setNotice(null), 6000);
    };
    listeners.add(show);
    return () => {
      listeners.delete(show);
      clearTimeout(timer);
    };
  }, []);
  // The page keeps room for the dock, so its last lines are never under it.
  useLayoutEffect(() => {
    const el = dock.current;
    if (!el) return;
    const set = () =>
      document.documentElement.style.setProperty("--tour-h", `${el.offsetHeight + 24}px`);
    set();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  });

  const s = STEPS[step] as (typeof STEPS)[number];
  const onPath = at === step;
  const last = step === STEPS.length - 1;
  const next = STEPS[step + 1];
  const go = (i: number) => {
    const target = STEPS[i];
    if (!target) return;
    setStep(i);
    setSide(null);
    setOpen(true);
    visit(stepRoute(target, data.stops), target.as);
  };
  const who = viewer ? VIEWER_NAMES[viewer] : undefined;

  return (
    <>
      {notice && (
        <div className="tour-notice" role="status">
          {notice}
        </div>
      )}
      <aside
        ref={dock}
        className={`tour-dock${open ? "" : " closed"}`}
        aria-label="Guided tour of Everstreet"
      >
        {open ? (
          <>
            <ol className="tour-rail">
              {STEPS.map((x, i) => (
                <li key={x.id}>
                  <button
                    type="button"
                    className={i < step ? "done" : undefined}
                    aria-current={i === step ? "step" : undefined}
                    onClick={() => go(i)}
                  >
                    <span className="tour-n">{i + 1}</span>
                    <span className="tour-l">{x.label}</span>
                  </button>
                </li>
              ))}
            </ol>
            <div className="tour-body">
              <div className="tour-text">
                <div className="tour-k">
                  Step {step + 1} of {STEPS.length}
                  <span className={`tour-src ${s.source}`}>{SOURCE[s.source]}</span>
                  {who && (s.source === "demo" || !onPath) && (
                    <span className="tour-who">
                      Viewing as {who.name}, {who.role}
                    </span>
                  )}
                </div>
                <h2>{s.title}</h2>
                {onPath ? (
                  s.body.map((p) => <p key={p}>{p}</p>)
                ) : (
                  <p>
                    {side
                      ? `A side door from this step: ${side}.`
                      : "You have stepped off the tour's path."}
                  </p>
                )}
                {onPath && (s.peeks || s.links) && (
                  <div className="tour-more">
                    {s.peeks?.map((p) => (
                      <button
                        key={p.stop}
                        type="button"
                        className="tour-chip"
                        onClick={() => {
                          const to = data.stops[p.stop];
                          if (!to) return;
                          setSide(p.label);
                          visit(to, p.as);
                        }}
                      >
                        {p.label} →
                      </button>
                    ))}
                    {s.links?.map((l) => (
                      <a
                        key={l.href}
                        className="tour-chip tour-tx"
                        href={l.href}
                        target="_blank"
                        rel="noopener"
                      >
                        {l.label} ↗
                      </a>
                    ))}
                  </div>
                )}
              </div>
              <div className="tour-nav">
                {onPath ? (
                  <button
                    type="button"
                    className="btn tour-btn"
                    disabled={step === 0}
                    onClick={() => go(step - 1)}
                  >
                    Back
                  </button>
                ) : (
                  <button type="button" className="btn tour-btn" onClick={() => go(step)}>
                    ← Back to step {step + 1}
                  </button>
                )}
                {next ? (
                  <button type="button" className="btn btn-primary" onClick={() => go(step + 1)}>
                    Next: {next.label} →
                  </button>
                ) : (
                  <a className="btn btn-primary" href={CLAIMS_URL} target="_blank" rel="noopener">
                    Every claim, with its test ↗
                  </a>
                )}
                {last && (
                  <button type="button" className="btn tour-btn" onClick={() => go(0)}>
                    Start again
                  </button>
                )}
                <button type="button" className="tour-hide" onClick={() => setOpen(false)}>
                  Hide the guide
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="tour-closed">
            <button type="button" className="tour-show" onClick={() => setOpen(true)}>
              <strong>Guide</strong> · step {step + 1} of {STEPS.length}: {s.label}
              <span>Show</span>
            </button>
            {next && (
              <button type="button" className="btn btn-primary btn-sm" onClick={() => go(step + 1)}>
                Next →
              </button>
            )}
          </div>
        )}
      </aside>
    </>
  );
}
