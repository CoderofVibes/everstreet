// Lays Tony's voice lines under the trimmed picture of the self-playing video (docs/VIDEO.md).
//
//   npx tsx scripts/mix-video.ts <picture.mp4> <folder with 01.wav … 16.wav> <out.mp4>
//
// For each beat (web/src/video/beats.ts): finds the speech in its line (silence detection) and
// keeps the line whole, its own pauses as Tony said them, from just before the first word to just
// after the last. The line starts speaking 0.15 s after its beat starts. A line longer than its beat
// is never sped up or cut: the beat's last picture frame is held until the line has finished, so
// every caption still changes with its beat. Two beats with time to spare are shortened (SHORTER)
// so the whole stays under 2:20.
//
// Under everything runs a bed of Tony's own room tone (Nov 11: silence between takes sounded
// chopped): the quiet before and after the words in each take, joined with crossfades and looped.
// Each line fades in over it and the bed fades out under it, so the noise never drops away or
// doubles. Then the whole is cleaned (high-pass, light noise reduction) and raised to -16 LUFS by
// one fixed gain, so the room tone stays level.
// Prints each beat's times. Never overwrites a file.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, unlinkSync } from "node:fs";
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
/** Seconds from a beat's start to the first word. */
const LEAD = 0.15;
/** Room kept before the first word and after the last (the line's own breath and room). */
const PRE = 0.12;
const POST = 0.15;
/** Seconds the picture keeps after a line ends, before the next beat. */
const TAIL = 0.05;
/** Crossfade between a line and the room tone. */
const FADE = 0.06;

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
  const { spans, total: takeLength } = speech(file);
  if (!spans.length) throw new Error(`no speech found in ${file}`);
  const first = (spans[0] as [number, number])[0];
  const last = (spans.at(-1) as [number, number])[1];
  const piece = [Math.max(0, first - PRE), last + POST] as [number, number];
  const lead = first - piece[0];
  const length = piece[1] - piece[0];
  const dur = Math.min(b.dur, SHORTER[b.id] ?? b.dur);
  const ends = LEAD - lead + length;
  if (ends + TAIL > dur && dur < b.dur) throw new Error(`${b.id}: its line no longer fits`);
  const hold = Math.max(0, ends + TAIL - dur);
  return { id: b.id, file, piece, lead, length, ends, hold, dur, total: takeLength };
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

// The voice: each line, faded at its edges, placed at its beat's new start.
let starts = 0;
const voiceParts: string[] = [];
const voiceLabels: string[] = [];
const windows: [number, number][] = [];
plan.forEach((p, i) => {
  const at = starts + LEAD - p.lead;
  windows.push([at, at + p.length]);
  voiceParts.push(
    `[${i + 1}:a]atrim=start=${p.piece[0].toFixed(3)}:end=${p.piece[1].toFixed(3)},asetpts=PTS-STARTPTS,afade=t=in:d=${FADE},afade=t=out:st=${(p.length - FADE).toFixed(3)}:d=${FADE},adelay=${Math.round(at * 1000)}[l${i}]`,
  );
  voiceLabels.push(`[l${i}]`);
  starts += p.dur + p.hold;
});
const total = starts;

// The room tone: the quiet before and after the words in every take, joined with crossfades.
const room: [number, number, number][] = [];
plan.forEach((p, i) => {
  const head: [number, number] = [0.15, p.piece[0] + p.lead - 0.25];
  const tail: [number, number] = [p.piece[1] - POST + 0.25, p.total - 0.1];
  for (const [a, b] of [head, tail]) if (b - a >= 0.4) room.push([i + 1, a, b]);
});
if (room.length < 4) throw new Error("not enough quiet in the takes to make room tone");
const XF = 0.08;
const roomParts = room.map(
  ([input, a, b], k) =>
    `[${input}:a]atrim=start=${a.toFixed(3)}:end=${b.toFixed(3)},asetpts=PTS-STARTPTS[r${k}]`,
);
let chain = "[r0]";
room.slice(1).forEach((_, k) => {
  roomParts.push(`${chain}[r${k + 1}]acrossfade=d=${XF}[x${k + 1}]`);
  chain = `[x${k + 1}]`;
});
const roomLength = room.reduce((n, [, a, b]) => n + (b - a), 0) - XF * (room.length - 1);
// Looped to the length of the video; out under each line, with the same fade as the line.
const inside = windows
  .map(([a, b]) => `clip(min((t-${a.toFixed(3)})/${FADE},(${b.toFixed(3)}-t)/${FADE}),0,1)`)
  .reduce((acc, x) => `max(${acc},${x})`);
roomParts.push(
  `${chain}aloop=loop=-1:size=${Math.floor(roomLength * 44100)},atrim=duration=${total.toFixed(3)},volume=eval=frame:volume='1-${inside}'[bedraw]`,
);

/** The bed sits this many dB up from the quiet before the takes, to match the pauses inside them. */
const BED_GAIN_DB = 1.5;
const amix = `[bedraw]volume=${BED_GAIN_DB}dB[bed];[bed]${voiceLabels.join("")}amix=inputs=${voiceLabels.length + 1}:normalize=0,highpass=f=80,afftdn=nf=-62:nr=10,atrim=duration=${total.toFixed(3)}[a]`;

// 1. The voice and the bed, cleaned, at the takes' own level.
const temp = `${out}.voice.wav`;
const voiceInputs = plan.flatMap((p) => ["-i", p.file]);
// The voice graph numbers its inputs from 1 (the picture is 0 in the final step): shift by one.
const voiceGraph = [...voiceParts, ...roomParts, amix]
  .join(";")
  .replace(/\[(\d+):a\]/g, (_m, n: string) => `[${Number(n) - 1}:a]`);
execFileSync(
  ffmpeg,
  [
    "-hide_banner",
    "-v",
    "error",
    "-y",
    ...voiceInputs,
    "-filter_complex",
    voiceGraph,
    "-map",
    "[a]",
    "-c:a",
    "pcm_s24le",
    temp,
  ],
  { stdio: "inherit" },
);

// 2. One gain for the whole track to -16 LUFS (a level that rides the quiet parts up would make
// the room tone rise and fall), with a limiter for the peaks.
const measured = spawnSync(
  ffmpeg,
  ["-hide_banner", "-i", temp, "-af", "ebur128", "-f", "null", "-"],
  {
    encoding: "utf8",
  },
).stderr;
const loudness = Number([...measured.matchAll(/\bI:\s+(-?[\d.]+) LUFS/g)].at(-1)?.[1]);
if (!Number.isFinite(loudness)) throw new Error("couldn't measure the voice's loudness");
const gain = -16 - loudness;

// 3. The picture with its holds, and the voice at that gain.
// The sound stops just after the last word (Tony, Nov 11): the closing slide holds in silence.
const lastLine = plan.at(-1);
if (!lastLine) throw new Error("no lines");
const lastWord = total - lastLine.dur - lastLine.hold + lastLine.ends - POST;
const endFade = `afade=t=out:st=${(lastWord + 0.04).toFixed(3)}:d=0.1`;
execFileSync(
  ffmpeg,
  [
    "-hide_banner",
    "-v",
    "error",
    "-i",
    picture,
    "-i",
    temp,
    "-filter_complex",
    `${cuts};${vcat};[1:a]volume=${gain.toFixed(2)}dB,alimiter=limit=0.84:level=false,${endFade},aformat=sample_rates=48000:channel_layouts=stereo[a]`,
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
unlinkSync(temp);
console.log(
  `voice: ${loudness.toFixed(1)} LUFS as recorded, raised ${gain.toFixed(1)} dB as one gain`,
);

let at = 0;
for (const p of plan) {
  const mmss = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, "0")}`;
  console.log(
    `${p.id.padEnd(15)} beat ${mmss(at)} ${String(p.dur).padStart(4)} s · words end ${(p.ends - POST).toFixed(2)} s in${p.hold ? ` · held ${p.hold.toFixed(2)} s` : ""}`,
  );
  at += p.dur + p.hold;
}
console.log(`room tone: ${room.length} quiet stretches, ${roomLength.toFixed(1)} s, looped`);
console.log(`total ${Math.floor(total / 60)}:${(total % 60).toFixed(2).padStart(5, "0")} → ${out}`);
