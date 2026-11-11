// @vitest-environment jsdom
//
// The self-playing video's script (web/src/video/beats.ts) against the committed recording and the
// rules it is recorded under: every page a beat opens is one its viewer walked, the whole video
// fits X's limit without Premium (2:20), captions are short enough to read at 1280 by 720, and a
// shot that could be misread carries where its data comes from. The player itself is checked by
// playing it (npm run video:check).

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { tourData } from "../../scripts/lib/tourData.ts";
import {
  BEATS,
  beatAt,
  beatStart,
  captionAt,
  END,
  EXPLORERS,
  resolveRoute,
  totalSeconds,
  VOICE,
  videoProblems,
} from "../src/video/beats.ts";
import { compile, videoOptions } from "../src/video/Video.tsx";

describe("the video's script", () => {
  it("fits in 2:20, and every beat is long enough to read its captions", () => {
    expect(totalSeconds()).toBeLessThanOrEqual(140);
    expect(new Set(BEATS.map((b) => b.id)).size).toBe(BEATS.length);
    for (const b of BEATS) {
      expect(b.captions.length, b.id).toBeGreaterThanOrEqual(1);
      expect(b.captions.length, b.id).toBeLessThanOrEqual(2);
      expect(b.captions[0]?.at, b.id).toBe(0);
      b.captions.forEach((c, i) => {
        // Two lines at most at the caption's size, and on screen long enough to read them.
        expect(c.text.length, c.text).toBeLessThanOrEqual(112);
        const until = b.captions[i + 1]?.at ?? b.dur;
        expect(until - c.at, c.text).toBeGreaterThanOrEqual(Math.max(3, c.text.length / 22));
      });
    }
  });

  it("opens only pages the committed recording holds, as the viewer who walked them", () => {
    const data = tourData();
    expect(videoProblems(data)).toEqual([]);
    expect(videoProblems({ viewers: data.viewers, stops: {} }).length).toBeGreaterThan(0);
    expect(resolveRoute("{sale}/x", { sale: "/sales/1" })).toBe("/sales/1/x");
    expect(resolveRoute("{gone}", {})).toBeNull();
  });

  it("tells the sale's story across the recorded states, in order", () => {
    const viewers = BEATS.flatMap((b) => b.cues.flatMap((c) => ("go" in c && c.as ? [c.as] : [])));
    // Before the sale, then the close, then each person after it.
    const first = (v: string) => viewers.indexOf(v);
    for (const v of ["delphine", "agent", "noah", "noah-closed", "delphine-after", "cara-after"])
      expect(first(v), v).toBeGreaterThanOrEqual(0);
    expect(first("noah")).toBeLessThan(first("noah-closed"));
    expect(first("noah-closed")).toBeLessThan(viewers.lastIndexOf("noah-after"));
    expect(first("delphine")).toBeLessThan(first("delphine-after"));
  });

  it("labels what a shot could be mistaken for", () => {
    for (const b of BEATS.filter((x) => x.kind === "app" && x.strip === "demo"))
      expect(b.label, b.id).toMatch(/^Recorded demo · /);
    const proof = BEATS.filter((b) => b.strip === "proof" && b.kind !== "end");
    expect(proof.map((b) => b.id)).toEqual(["proof", "explorers"]);
    for (const b of proof) expect(b.label).toMatch(/^Recorded on NEAR testnet/);
    // The explorer pages are Ledgerline's testnet runs, never the synthetic Signalwatch sale.
    expect(BEATS.find((b) => b.id === "explorers")?.label).toContain("Ledgerline");
    expect(EXPLORERS.map((e) => e.where)).toEqual([
      "NEAR testnet",
      "NEAR testnet",
      "NEAR testnet",
      "Ethereum Sepolia",
    ]);
  });

  it("ends on the closing slide", () => {
    expect(BEATS.at(-1)?.kind).toBe("end");
    expect(END.name).toBe("Everstreet");
    expect(END.team).toContain("(GPT-6 Astra)");
    expect(END.team).toContain("(Claude Opus 5.5)");
    expect(END.ask).toBe("What can you create?");
  });

  it("has one voice line per beat that fits it, and the guide carries the same lines and times", () => {
    const guide = readFileSync("docs/VIDEO.md", "utf8");
    expect(Object.keys(VOICE)).toEqual(BEATS.map((b) => b.id));
    BEATS.forEach((b, i) => {
      const line = VOICE[b.id] as string;
      // About 2.5 words a second.
      expect(line.split(/s+/).length, b.id).toBeLessThanOrEqual(b.dur * 2.6);
      const t = beatStart(i);
      const starts = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
      expect(guide, b.id).toContain(`| ${i + 1} | ${starts} | ${b.dur} s | ${b.id} | ${line} |`);
    });
    const total = totalSeconds();
    expect(guide).toContain(
      `The video ends at ${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}.`,
    );
  });

  it("keeps time by the beat list", () => {
    expect(beatAt(0)).toEqual({ index: 0, local: 0 });
    const second = beatStart(1);
    expect(beatAt(second).index).toBe(1);
    expect(beatAt(second - 0.01).index).toBe(0);
    expect(beatAt(totalSeconds() + 5).index).toBe(BEATS.length - 1);
    const b = BEATS[0];
    if (!b) throw new Error("no beats");
    expect(captionAt(b, 0)?.text).toBe(b.captions[0]?.text);
    expect(captionAt(b, b.dur - 0.01)?.text).toBe(b.captions.at(-1)?.text);
  });
});

describe("the video player", () => {
  it("turns a click into a ring, then a press, in time order", () => {
    const ops = compile([
      { at: 2, click: "Search", lead: 0.5 },
      { at: 0, go: "/find", as: "delphine" },
      { at: 2.2, card: "A name" },
    ]);
    expect(ops.map((o) => `${o.kind}@${o.at}`)).toEqual([
      "go@0",
      "ring@2",
      "card@2.2",
      "press@2.5",
    ]);
  });

  it("reads its settings from the address, and only when asked for", () => {
    expect(videoOptions("")).toBeNull();
    expect(videoOptions("?video=0")).toBeNull();
    expect(videoOptions("?video=1")).toEqual({
      capture: false,
      autostart: false,
      from: null,
      speed: 1,
      page: 1600,
    });
    expect(videoOptions("?video=1&capture=1&autostart=1&from=close&speed=10")).toEqual({
      capture: true,
      autostart: true,
      from: "close",
      speed: 10,
      page: 1600,
    });
    expect(videoOptions("?video=1&speed=900")?.speed).toBe(1);
    expect(videoOptions("?video=1&page=1440")?.page).toBe(1440);
    expect(videoOptions("?video=1&page=99999")?.page).toBe(1600);
  });
});
