// Job 002e: the REAL isolated check engine adapter (EXECUTABLE_PRODUCTS §5). The platform host
// (Windows Node) never runs generated code: it spawns one fixed command line into the configured
// WSL2 distribution, where the root-owned launcher (scripts/worker-host) runs the job in a jailed
// Firecracker microVM. The caller passes only a verb; the job travels on stdin, bounded; the
// answer comes back on stdout, bounded, and is validated by appChecks.validateRun.
//
// Construct it only when a worker host is explicitly configured: it starts WSL when used, so
// nothing creates it by default. UNVERIFIED until scripts/worker-host/conformance.mjs passes.

import { spawn } from "node:child_process";
import type { CheckEngine, CheckJob, EngineIdentity } from "./appChecks.ts";

export interface WslEngineOptions {
  /** The WSL distribution the reviewed setup was installed in (no default). */
  distro: string;
  /** Path of wsl.exe; fixed unless a test passes a double. */
  wsl?: string;
  /** Stdout bound for any verb. */
  maxOutput?: number;
  /** Wall clock for one verb's process, beyond the launcher's own deadlines. */
  timeoutMs?: number;
}

const DISTRO = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const RUNNER = "everstreet-runner";
const LAUNCH = "/opt/everstreet-worker/bin/launch";

/** The fixed argv for a verb. Nothing a model or caller supplies reaches it except a validated id. */
export function launchArgs(distro: string, verb: "preflight" | "run" | "cleanup", id?: string) {
  if (!DISTRO.test(distro)) throw new Error("Invalid WSL distribution name");
  const args = ["-d", distro, "-u", RUNNER, "--", "sudo", "-n", LAUNCH, verb];
  if (verb === "cleanup") {
    if (!id || !/^es-[0-9a-f]{12}-[0-9]{1,6}$/.test(id)) throw new Error("Invalid job id");
    args.push(id);
  }
  return args;
}

/** The launcher's jail id for a job: the same derivation as host-launch.mjs. */
export const jailId = (job: CheckJob) =>
  `es-${job.check_id.replace(/-/g, "").slice(0, 12)}-${job.attempt}`;

export class WslFirecrackerEngine implements CheckEngine {
  constructor(readonly opts: WslEngineOptions) {
    if (!DISTRO.test(opts.distro)) throw new Error("Invalid WSL distribution name");
  }

  /** Runs one verb; resolves the last JSON line of stdout, bounded; kills it on abort/deadline. */
  private call(args: string[], stdin: string, signal: AbortSignal): Promise<unknown> {
    const max = this.opts.maxOutput ?? 128 * 1024;
    return new Promise((resolve, reject) => {
      if (signal.aborted) return reject(new Error("aborted"));
      const child = spawn(this.opts.wsl ?? "wsl.exe", args, {
        stdio: ["pipe", "pipe", "ignore"],
        windowsHide: true,
        shell: false,
      });
      let out = Buffer.alloc(0);
      let failed: Error | null = null;
      const stop = (why: string) => {
        failed ??= new Error(why);
        child.kill("SIGKILL");
      };
      const timer = setTimeout(
        () => stop("The worker host didn't answer in time"),
        this.opts.timeoutMs ?? 90_000,
      );
      const onAbort = () => stop("aborted");
      signal.addEventListener("abort", onAbort, { once: true });
      child.stdout.on("data", (d: Buffer) => {
        if (out.length + d.length > max) stop("The worker host's answer was too large");
        else out = Buffer.concat([out, d]);
      });
      child.on("error", (e) => stop(`The worker host couldn't be started: ${e.message}`));
      child.on("close", () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        if (failed) return reject(failed);
        const line = out.toString("utf8").trim().split("\n").pop() ?? "";
        try {
          resolve(JSON.parse(line));
        } catch {
          reject(new Error("The worker host's answer wasn't JSON"));
        }
      });
      child.stdin.end(stdin);
    });
  }

  async preflight(signal: AbortSignal) {
    let raw: unknown;
    try {
      raw = await this.call(launchArgs(this.opts.distro, "preflight"), "", signal);
    } catch (e) {
      return { ok: false as const, reason: e instanceof Error ? e.message : "preflight failed" };
    }
    const r = (raw ?? {}) as Record<string, unknown>;
    if (r.ok !== true)
      return {
        ok: false as const,
        reason: typeof r.reason === "string" ? r.reason.slice(0, 300) : "not ready",
      };
    const id = r.engine as Record<string, unknown> | undefined;
    const fields = [
      "engine",
      "firecracker",
      "firecracker_sha256",
      "kernel_sha256",
      "guest_image_sha256",
      "lock_sha256",
      "recipe",
    ];
    if (!id || fields.some((f) => typeof id[f] !== "string" || !(id[f] as string).length))
      return {
        ok: false as const,
        reason: "The worker host didn't identify its engine completely",
      };
    if (id.engine !== "firecracker")
      return { ok: false as const, reason: "The worker host reported an unexpected engine" };
    const identity = Object.fromEntries(fields.map((f) => [f, id[f] as string])) as EngineIdentity;
    return { ok: true as const, identity };
  }

  run(job: CheckJob, signal: AbortSignal) {
    return this.call(launchArgs(this.opts.distro, "run"), JSON.stringify(job), signal);
  }

  async cleanup(job: CheckJob) {
    const c = new AbortController();
    await this.call(launchArgs(this.opts.distro, "cleanup", jailId(job)), "", c.signal).catch(
      () => {},
    );
  }
}
