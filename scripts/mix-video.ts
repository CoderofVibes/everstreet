// Lays Tony's voice lines under the trimmed picture of the self-playing video (docs/VIDEO.md).
//
//   npx tsx scripts/mix-video.ts <picture.mp4> <folder with 01.wav … 16.wav> <out.mp4>
//
// For each beat (web/src/video/beats.ts): finds the speech in its line (silence detection), keeps
// the pauses between phrases but shortens any longer than 0.4 s, and places the speech 0.15 s after
// the beat starts. A line longer than its beat is never sped up or cut: the beat's last picture
// frame is held until the line has finished (plus 0.2 s), so every caption still changes with its
// beat. Two beats with time to spare are shortened (SHORTER) so the whole stays under 2:20. The voice is cleaned (high-pass, light noise reduction), set to -16 LUFS for the web, and
// silence fills the rest. Prints each beat's planned and final times. Never overwrites a file.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { BEATS, beatStart } from "../web/src/video/beats.ts";

const [picture, voices, out] = process.argv.slice(2);
if (!picture || !voices || !out)
  throw new Error("usage: mix-video.ts <picture.mp4> <voices> <out.mp4>");
if (existsSync(out)) throw new Error(`${out} exists; choose a new number`);

const bin = (() => {
  const root = join(process.env.LOCALAPPDATA ?? "", "Microsoft", "WinGet", "Packages");
  const pkg = readdirSync(root).find((d) => d.startsWith("Gyan.FFmpeg"));
  if (!pkg) return "";
  const dir = readdirSync(join(root, pkg)).find((d) => d.startsWith("ffmpeg-"));
  return dir ? join(root, pkg, dir, "bin") : "";
})();
const ffmpeg = bin ? join(bin, "ffmpeg.exe") : "ffmpeg";
const LEAD = 0.15;
const TAIL = 0.2;
const MAX_PAUSE = 0.4;
const PAUSE = 0.35;
const PAD = 0.06;
/**
 * Beats with time to spare, shortened in the edit to keep the whole under X's 2:20 (Nov 11, with
 * Tony's lines): the close's picture has settled by 11.5 s, and the closing slide needs 6 s.
 */
const SHORTER: Record<string, number> = { close: 11.5, end: 6 };

/** The speech in a line: [start, end] spans between silences. */
function speech(file: string): { spans: [number, number][]; total: number } {
  const err = spawnSync(
    ffmpeg,
    ["-hide_banner", "-i", file, "-af", "silencedetect=noise=-42dB:d=0.3", "-f", "null", "-"],
    { encoding: "utf8" },
  ).stderr;
  const total = Number(
    /Duration: (\d+):(\d+):([\d.]+)/
      .exec(err)
      ?.slice(1)
      .reduce((a, x, i) => a + Number(x) * ([3600, 60, 1][i] ?? 0), 0) ?? 0,
  );
  const starts = [...err.matchAll(/silence_start: ([\d.e-]+)/g)].map((m) =>
    Math.max(0, Number(m[1])),
  );
  const ends = [...err.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]));
  // Silences as [start, end]; speech is what lies between them.
  const silences = starts.map((s, i) => [s, ends[i] ?? total] as [number, number]);
  const spans: [number, number][] = [];
  let at = 0;
  for (const [s, e] of silences) {
    if (s > at + 0.05) spans.push([at, s]);
    at = e;
  }
  if (total > at + 0.05) spans.push([at, total]);
  return { spans, total };
}

const plan = BEATS.map((b, i) => {
  const file = join(voices, `${String(i + 1).padStart(2, "0")}.wav`);
  if (!existsSync(file)) throw new Error(`missing ${file}`);
  const { spans } = speech(file);
  if (!spans.length) throw new Error(`no speech found in ${file}`);
  // Each span with a little padding; pauses between spans kept, the long ones shortened.
  const pieces = spans.map(([s, e]) => [Math.max(0, s - PAD), e + PAD] as [number, number]);
  const gaps = pieces.slice(1).map((p, j) => {
    const gap = Math.max(0, p[0] - (pieces[j] as [number, number])[1]);
    return gap > MAX_PAUSE ? PAUSE : gap;
  });
  const length = pieces.reduce((n, [s, e]) => n + (e - s), 0) + gaps.reduce((n, g) => n + g, 0);
  const dur = Math.min(b.dur, SHORTER[b.id] ?? b.dur);
  if (LEAD + length + TAIL > dur && dur < b.dur)
    throw new Error(`${b.id}: its line no longer fits`);
  const hold = Math.max(0, LEAD + length + TAIL - dur);
  return { id: b.id, file, pieces, gaps, length, hold, dur };
});

// The picture: each beat cut out and, where its line is longer, its last frame held.
const cuts = plan
  .map((p, i) => {
    const s = beatStart(i);
    const hold = p.hold > 0 ? `,tpad=stop_mode=clone:stop_duration=${p.hold.toFixed(3)}` : "";
    return `[0:v]trim=start=${s}:end=${s + p.dur},setpts=PTS-STARTPTS${hold}[v${i}]`;
  })
  .join(";");
const vcat = `${plan.map((_, i) => `[v${i}]`).join("")}concat=n=${plan.length}:v=1:a=0[v]`;

// The voice: every line's pieces and pauses, placed at its beat's new start.
let starts = 0;
const voiceParts: string[] = [];
const voiceLabels: string[] = [];
plan.forEach((p, i) => {
  const input = i + 1;
  const segs: string[] = [];
  p.pieces.forEach(([s, e], j) => {
    voiceParts.push(
      `[${input}:a]atrim=start=${s.toFixed(3)}:end=${e.toFixed(3)},asetpts=PTS-STARTPTS[a${i}_${j}]`,
    );
    segs.push(`[a${i}_${j}]`);
    const gap = p.gaps[j];
    if (gap !== undefined) {
      voiceParts.push(`anullsrc=r=44100:cl=mono,atrim=duration=${gap.toFixed(3)}[g${i}_${j}]`);
      segs.push(`[g${i}_${j}]`);
    }
  });
  const delay = Math.round((starts + LEAD) * 1000);
  voiceParts.push(`${segs.join("")}concat=n=${segs.length}:v=0:a=1,adelay=${delay}[l${i}]`);
  voiceLabels.push(`[l${i}]`);
  starts += p.dur + p.hold;
});
const total = starts;
const amix = `${voiceLabels.join("")}amix=inputs=${voiceLabels.length}:normalize=0,highpass=f=80,afftdn=nf=-62:nr=10,loudnorm=I=-16:TP=-1.5:LRA=11,apad,atrim=duration=${total.toFixed(3)},aformat=sample_rates=48000:channel_layouts=stereo[a]`;

const inputs = ["-i", picture, ...plan.flatMap((p) => ["-i", p.file])];
const graph = [cuts, vcat, ...voiceParts, amix].join(";");
execFileSync(
  ffmpeg,
  [
    "-hide_banner",
    "-v",
    "error",
    ...inputs,
    "-filter_complex",
    graph,
    "-map",
    "[v]",
    "-map",
    "[a]",
    "-c:v",
    "libx264",
    "-preset",
    "slow",
    "-crf",
    "16",
    "-pix_fmt",
    "yuv420p",
    "-r",
    "60",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-movflags",
    "+faststart",
    out,
  ],
  { stdio: "inherit" },
);

let at = 0;
for (const p of plan) {
  const mmss = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, "0")}`;
  console.log(
    `${p.id.padEnd(15)} beat ${mmss(at)} ${String(p.dur).padStart(2)} s · line ${p.length.toFixed(2)} s · ends ${(LEAD + p.length).toFixed(2)} s in${p.hold ? ` · held ${p.hold.toFixed(2)} s` : ""}`,
  );
  at += p.dur + p.hold;
}
console.log(`total ${Math.floor(total / 60)}:${(total % 60).toFixed(2).padStart(5, "0")} → ${out}`);
