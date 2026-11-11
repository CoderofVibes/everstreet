// The self-playing video (Tony, Nov 11): the static site's own pages, played from the recording by
// a script (beats.ts), with captions burned in, so the demo video is one take with no clicking.
//
//   /?video=1                 the player, paused on its first frame. Space starts and pauses, R goes
//                             back to the start, the left and right arrows skip a beat.
//   &capture=1                for recording: no hints, no scrollbar, no cursor. Captions stay.
//   &from=<beat id>           start at a beat (for a retake); &autostart=1 starts at once.
//   &speed=10                 for the automatic check (scripts/check-video.ts).
//
// The clock counts animation frames, 60 to the second, and never reads the system clock: every
// take is the same, and a busy computer plays slower instead of skipping. A cue that needs
// something on the page (a button to press, a place to scroll to) holds the clock until it is
// there. Nothing here reaches a network: the pages answer from the recording (tour/replay.ts).

import { useEffect, useReducer, useRef } from "react";
import { App } from "../App.tsx";
import { useRouter } from "../router.tsx";
import { SessionProvider } from "../session.tsx";
import type { TourData } from "../tour/replay.ts";
import { tour } from "../tour/state.ts";
import {
  BEATS,
  type Beat,
  beatAt,
  beatStart,
  type Cue,
  captionAt,
  END,
  EXPLORERS,
  FPS,
  resolveRoute,
  totalSeconds,
} from "./beats.ts";

export interface VideoOptions {
  capture: boolean;
  autostart: boolean;
  from: string | null;
  speed: number;
}

/** The video's settings from the address, or null when the address doesn't ask for the video. */
export function videoOptions(search: string): VideoOptions | null {
  const q = new URLSearchParams(search);
  if (q.get("video") !== "1") return null;
  const speed = Number(q.get("speed") ?? "1");
  return {
    capture: q.get("capture") === "1",
    autostart: q.get("autostart") === "1",
    from: q.get("from"),
    speed: Number.isFinite(speed) && speed >= 1 && speed <= 20 ? Math.round(speed) : 1,
  };
}

/** The picture is composed for a 1280 by 720 frame; a larger window is the same picture, larger. */
const STAGE_WIDTH = 1280;
/** How many animation frames a cue may wait for its target before the video reports it. */
const HOLD_FRAMES = 180;
const STRIPS = {
  demo: {
    label: "Recorded demo",
    detail: "simulated history · fictional people and test tokens · synthetic wallet and chain",
  },
  proof: { label: "Recorded proof", detail: "NEAR testnet · fictional people and test tokens" },
} as const;

/** The strip the app is showing now (previewLabel.ts reads its label when the app mounts). */
const STRIP_NOW = { kind: "" as "" | "demo" | "proof" };

type Op =
  | { at: number; kind: "go"; to: string; as?: string }
  | { at: number; kind: "ring"; target: string }
  | { at: number; kind: "press" }
  | { at: number; kind: "scroll"; target: string | 0; dur: number }
  | { at: number; kind: "type"; target: string; text: string; cps: number }
  | { at: number; kind: "card"; text: string };

/** A beat's cues as single steps, in time order (a click is a ring, then a press). */
export function compile(cues: Cue[]): Op[] {
  const ops: Op[] = [];
  for (const c of cues) {
    if ("go" in c) ops.push({ at: c.at, kind: "go", to: c.go, as: c.as });
    else if ("click" in c) {
      ops.push({ at: c.at, kind: "ring", target: c.click });
      ops.push({ at: c.at + (c.lead ?? 0.6), kind: "press" });
    } else if ("scroll" in c)
      ops.push({ at: c.at, kind: "scroll", target: c.scroll, dur: c.dur ?? 1.2 });
    else if ("type" in c)
      ops.push({ at: c.at, kind: "type", target: c.type, text: c.text, cps: c.cps ?? 30 });
    else ops.push({ at: c.at, kind: "card", text: c.card });
  }
  return ops
    .map((op, i) => ({ op, i }))
    .sort((a, b) => a.op.at - b.op.at || a.i - b.i)
    .map((x) => x.op);
}

const shown = (el: Element) => el.getClientRects().length > 0;
const words = (el: Element) => (el.textContent ?? "").replace(/\s+/g, " ").trim();

/** The element a cue names: "css:…" is a selector; anything else is text on the page. */
function find(target: string, press: boolean): HTMLElement | null {
  if (target.startsWith("css:")) return document.querySelector<HTMLElement>(target.slice(4));
  const scope = document.querySelector("main") ?? document.body;
  const pool = press
    ? "button, a, [role='tab'], label, summary"
    : "h1, h2, h3, h4, th, td, dt, dd, strong, p, span, li, div, summary, caption";
  let best: HTMLElement | null = null;
  for (const el of scope.querySelectorAll<HTMLElement>(pool)) {
    const text = words(el);
    if (!text.includes(target) || !shown(el)) continue;
    if (!best || text.length < words(best).length) best = el;
  }
  return best;
}

/** Sets a field the way typing does, so the page's own state follows. */
function setValue(el: HTMLElement, value: string) {
  const proto =
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

const ease = (p: number) => (p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2);
const scrollToY = (y: number) => window.scrollTo({ top: y, behavior: "instant" });

interface Report {
  /** Every caption, in the order it came on screen. */
  captions: string[];
  /** Every beat entered, in order. */
  beats: string[];
  /** A cue whose target never showed. */
  problems: string[];
  /** Seconds played, on the video's own clock. */
  time: number;
  done: boolean;
}

interface View {
  beat: number;
  local: number;
  caption: string;
  card: string | null;
  ring: { left: number; top: number; width: number; height: number } | null;
  viewer: string | null;
  epoch: number;
  playing: boolean;
  done: boolean;
}

export function Video({ data, options }: { data: TourData; options: VideoOptions }) {
  const { go } = useRouter();
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const goRef = useRef(go);
  goRef.current = go;

  const s = useRef({
    frame: 0,
    beat: -1,
    ops: [] as Op[],
    next: 0,
    hold: 0,
    pressing: null as HTMLElement | null,
    ringUntil: 0,
    cardUntil: 0,
    scroll: null as { from: number; to: number; start: number; frames: number } | null,
    typing: null as {
      el: HTMLElement;
      text: string;
      start: number;
      cps: number;
      shown: number;
    } | null,
    scale: 1,
    view: {
      beat: 0,
      local: 0,
      caption: "",
      card: null,
      ring: null,
      viewer: null,
      epoch: 0,
      playing: options.autostart,
      done: false,
    } as View,
    report: { captions: [], beats: [], problems: [], time: 0, done: false } as Report,
  }).current;

  // The player: one mount, one animation-frame loop, the keys.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the player is set up once; it reads its settings and the recording through refs that never change
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("video-mode");
    if (options.capture) root.classList.add("video-capture");
    (window as { __everstreetVideo?: Report }).__everstreetVideo = s.report;
    const size = () => {
      s.scale = Math.max(1, window.innerWidth / STAGE_WIDTH);
      root.style.zoom = String(s.scale);
    };
    size();
    window.addEventListener("resize", size);

    const from = BEATS.findIndex((b) => b.id === options.from);
    s.frame = from > 0 ? Math.round(beatStart(from) * FPS) : 0;
    const end = Math.round(totalSeconds() * FPS);
    const v = s.view;
    let dirty = true;

    const fail = (what: string) => {
      s.report.problems.push(what);
      console.error(`[video] ${what}`);
    };

    const run = (op: Op, beat: Beat): boolean => {
      if (op.kind === "go") {
        const to = resolveRoute(op.to, data.stops);
        if (!to) {
          fail(`${beat.id}: no such place in the recording: ${op.to}`);
          return true;
        }
        const viewer = op.as ?? v.viewer;
        if (viewer !== v.viewer || beat.strip !== STRIP_NOW.kind) {
          // Another viewer or another strip: the app starts again as it does at a sign-in.
          v.viewer = viewer;
          STRIP_NOW.kind = beat.strip;
          // The proof pages are the same for everyone: no one's name sits over them.
          document.documentElement.classList.toggle("video-proof", beat.strip === "proof");
          (globalThis as { __everstreetPreview?: unknown }).__everstreetPreview =
            STRIPS[beat.strip];
          v.epoch++;
        }
        tour.viewer = viewer;
        s.scroll = null;
        s.typing = null;
        s.pressing = null;
        v.ring = null;
        goRef.current(to);
        scrollToY(0);
        dirty = true;
        return true;
      }
      if (op.kind === "ring") {
        const el = find(op.target, true);
        if (!el) return false;
        s.pressing = el;
        s.ringUntil = s.frame + FPS * 3;
        return true;
      }
      if (op.kind === "press") {
        if (s.pressing?.isConnected) s.pressing.click();
        else fail(`${beat.id}: the control to press had gone`);
        s.ringUntil = s.frame + Math.round(FPS * 0.25);
        return true;
      }
      if (op.kind === "scroll") {
        let to = 0;
        if (op.target !== 0) {
          const el = find(op.target, false);
          if (!el) return false;
          const here = window.scrollY;
          const before = el.style.scrollMarginTop;
          el.style.scrollMarginTop = "132px";
          el.scrollIntoView({ block: "start", behavior: "instant" });
          to = window.scrollY;
          el.style.scrollMarginTop = before;
          scrollToY(here);
        }
        s.scroll = {
          from: window.scrollY,
          to,
          start: s.frame,
          frames: Math.max(1, Math.round(op.dur * FPS)),
        };
        return true;
      }
      if (op.kind === "type") {
        const el = find(op.target, false);
        if (!el) return false;
        s.typing = { el, text: op.text, start: s.frame, cps: op.cps, shown: -1 };
        return true;
      }
      v.card = op.text;
      s.cardUntil = s.frame + Math.round(FPS * 2.4);
      dirty = true;
      return true;
    };

    /** Everything due at this frame. False when a cue is still waiting for the page. */
    const process = (): boolean => {
      const { index, local } = beatAt(s.frame / FPS);
      const beat = BEATS[index] as Beat;
      if (index !== s.beat) {
        s.beat = index;
        s.ops = compile(beat.cues);
        s.next = 0;
        s.hold = 0;
        v.beat = index;
        v.card = null;
        s.report.beats.push(beat.id);
        dirty = true;
      }
      while (s.next < s.ops.length && (s.ops[s.next] as Op).at <= local) {
        const op = s.ops[s.next] as Op;
        if (!run(op, beat)) {
          if (++s.hold <= HOLD_FRAMES) return false;
          fail(`${beat.id}: nothing on the page for "${"target" in op ? op.target : op.kind}"`);
        }
        s.hold = 0;
        s.next++;
      }
      if (s.scroll) {
        const p = Math.min(1, (s.frame - s.scroll.start) / s.scroll.frames);
        scrollToY(s.scroll.from + (s.scroll.to - s.scroll.from) * ease(p));
        if (p >= 1) s.scroll = null;
      }
      if (s.typing) {
        const t = s.typing;
        const n = Math.min(t.text.length, Math.floor(((s.frame - t.start) / FPS) * t.cps));
        if (n !== t.shown && t.el.isConnected) {
          t.shown = n;
          setValue(t.el, t.text.slice(0, n));
        }
        if (n >= t.text.length) s.typing = null;
      }
      const ring =
        s.pressing?.isConnected && s.frame < s.ringUntil
          ? s.pressing.getBoundingClientRect()
          : null;
      const next = ring
        ? {
            left: Math.round(ring.left / s.scale),
            top: Math.round(ring.top / s.scale),
            width: Math.round(ring.width / s.scale),
            height: Math.round(ring.height / s.scale),
          }
        : null;
      if (JSON.stringify(next) !== JSON.stringify(v.ring)) {
        v.ring = next;
        dirty = true;
      }
      if (v.card && s.frame >= s.cardUntil) {
        v.card = null;
        dirty = true;
      }
      const caption = captionAt(beat, local)?.text ?? "";
      if (caption !== v.caption) {
        v.caption = caption;
        if (caption) s.report.captions.push(caption);
        dirty = true;
      }
      // The explorer tiles and the closing slide come on by the clock; the hint shows the time.
      const tick = Math.floor(local * 10);
      if (tick !== Math.floor(v.local * 10) && (beat.kind !== "app" || !options.capture))
        dirty = true;
      v.local = local;
      return true;
    };

    const jump = (index: number) => {
      const i = Math.max(0, Math.min(BEATS.length - 1, index));
      s.frame = Math.round(beatStart(i) * FPS);
      s.beat = -1;
      s.scroll = null;
      s.typing = null;
      s.pressing = null;
      v.ring = null;
      v.viewer = null;
      v.epoch++;
      v.done = false;
      s.report.done = false;
      dirty = true;
    };

    let raf = 0;
    const loop = () => {
      for (let i = 0; i < options.speed; i++) {
        if (!process()) break;
        if (!v.playing) break;
        if (s.frame >= end) {
          v.playing = false;
          v.done = true;
          s.report.done = true;
          dirty = true;
          break;
        }
        s.frame++;
      }
      s.report.time = s.frame / FPS;
      if (dirty) {
        dirty = false;
        redraw();
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    const onKey = (e: KeyboardEvent) => {
      const key = e.key === " " ? "Space" : e.key;
      if (!["Space", "r", "R", "ArrowLeft", "ArrowRight"].includes(key)) return;
      e.preventDefault();
      e.stopPropagation();
      (document.activeElement as HTMLElement | null)?.blur?.();
      if (key === "Space") {
        if (v.done) return;
        v.playing = !v.playing;
      } else if (key === "r" || key === "R") {
        v.playing = false;
        jump(0);
      } else jump(s.beat + (key === "ArrowRight" ? 1 : -1));
      dirty = true;
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", size);
      root.classList.remove("video-mode", "video-capture", "video-proof");
      root.style.zoom = "";
    };
  }, []);

  const v = s.view;
  const beat = BEATS[v.beat] as Beat;
  const seconds = s.frame / FPS;
  const clock = `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(1).padStart(4, "0")}`;
  return (
    <>
      {v.viewer && (
        <SessionProvider key={`${v.viewer}:${v.epoch}`}>
          <App />
        </SessionProvider>
      )}
      {beat.kind === "explorers" && (
        <div className="video-explorers">
          {EXPLORERS.map((e) => (
            <figure key={e.file} className={`video-shot${v.local >= e.at ? " on" : ""}`}>
              <figcaption>
                <strong>{e.title}</strong>
                <span>{e.where}</span>
              </figcaption>
              <img src={e.file} alt="" />
            </figure>
          ))}
        </div>
      )}
      {v.ring && <div className="video-ring" style={v.ring} />}
      {v.card && beat.kind === "app" && <div className="video-card">{v.card}</div>}
      {beat.kind !== "end" && (
        <div className="video-bar">
          <div className="video-meta">
            <span className="video-chapter">{beat.chapter}</span>
            {beat.label && <span className="video-label">{beat.label}</span>}
          </div>
          <p className="video-caption">{v.caption}</p>
        </div>
      )}
      {beat.kind === "end" && (
        <div className="video-end">
          <div>
            <h1 className={v.local >= 0.2 ? "on" : ""}>
              <img src="/favicon.svg" alt="" /> {END.name}
            </h1>
            <p className={`video-end-line${v.local >= 0.9 ? " on" : ""}`}>{END.line}</p>
            <p className={`video-end-team${v.local >= 1.7 ? " on" : ""}`}>{END.team}</p>
            <p className={`video-end-ask${v.local >= 3.4 ? " on" : ""}`}>{END.ask}</p>
            <p className={`video-end-small${v.local >= 1.7 ? " on" : ""}`}>{END.small}</p>
          </div>
        </div>
      )}
      {!options.capture && (
        <div className="video-hud">
          <strong>{v.done ? "Finished" : v.playing ? "Playing" : "Paused"}</strong> · {clock} of{" "}
          {Math.floor(totalSeconds() / 60)}:{String(totalSeconds() % 60).padStart(2, "0")} · beat{" "}
          {v.beat + 1} of {BEATS.length}: {beat.id}
          <span>Space starts and pauses · R restarts · ← → skip a beat</span>
        </div>
      )}
    </>
  );
}
