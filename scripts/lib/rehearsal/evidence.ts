// business-v3 testnet rehearsal evidence (V3_TESTNET_APPROVAL_PACKET.md §5). One sanitized record
// per example: every fact carries its source, and the body is digested with the same canonical
// JSON as the portable handover record so the offline verifier can check it. Never written here:
// keys, cookies, bearer tokens, customer document text or results (only their identities).
//
// Sources: chain_final (a finalized transaction or a view at final finality), app_recorded (what
// the app's own routes answered), unknown (an outcome not known; never filled in).

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { canonical, sha256 } from "../../../server/src/handoverVerify.ts";
import type { Json, WalletCall, Who } from "./journey.ts";

export const EVIDENCE_FORMAT = "everstreet-v3-rehearsal";
export const EVIDENCE_VERSION = 1;
const EXPLORER = "https://testnet.nearblocks.io/txns/";
const SECRETISH = /ed25519:[1-9A-HJ-NP-Za-km-z]{60,}|evs_agent_|"private_key"|"secret"/;

export interface RunHeader {
  example: string;
  network: "testnet" | "synthetic";
  label: "synthetic dry run" | "NEAR testnet";
  commit: string;
  contract: { account: string; wasm_sha256: string; code_hash_expected: string };
  accounts: Record<string, string>;
  model: string;
}

export class Recorder {
  private readonly steps: Json[] = [];
  private readonly checkpoints: Json[] = [];
  private n = 0;
  constructor(readonly header: RunHeader) {}

  /** Continues an earlier, stopped record (its steps and checkpoints kept as they were). */
  static resume(prior: Json, note: Json) {
    const r = new Recorder(prior.header as RunHeader);
    for (const x of prior.steps as Json[]) r.steps.push(x);
    for (const x of prior.checkpoints as Json[]) r.checkpoints.push(x);
    r.n = r.steps.length;
    r.app("resumed", { previous_outcome: prior.outcome, ...note });
    return r;
  }

  /** A transaction a person signed: what was asked, its hash and finalized outcome, and what the app concluded. */
  tx(
    step: string,
    who: Who,
    account: string,
    call: WalletCall,
    out: { hash: string; ok: boolean; receipts?: Json[]; error?: string },
    appResolution: Json | null,
  ) {
    this.steps.push({
      n: ++this.n,
      step,
      kind: "transaction",
      signer: { role: who, account },
      call: {
        receiver: call.receiverId,
        method: call.methodName,
        deposit: call.deposit,
        gas: call.gas,
        // Arguments are kept: they are public on chain anyway. Messages and keys are never args.
        args: call.args,
      },
      chain: {
        source: this.header.network === "testnet" ? "chain_final" : "synthetic",
        hash: out.hash,
        explorer: this.header.network === "testnet" ? `${EXPLORER}${out.hash}` : null,
        succeeded: out.ok,
        error: out.error ?? null,
        receipts: out.receipts ?? null,
      },
      app: appResolution === null ? null : { source: "app_recorded", resolution: appResolution },
    });
  }

  /** What the app's own routes reported (never chain evidence). */
  app(step: string, facts: Json) {
    this.steps.push({ n: ++this.n, step, kind: "app", source: "app_recorded", facts });
  }

  /** Chain views at a named moment (final finality on testnet). */
  async checkpoint(name: string, views: Json) {
    this.checkpoints.push({
      name,
      source: this.header.network === "testnet" ? "chain_final" : "synthetic",
      at: new Date().toISOString(),
      views: JSON.parse(JSON.stringify(views)) as Json, // a snapshot, never a live reference
    });
  }

  /** The record: header, steps, checkpoints, outcome, and digests over the canonical sections. */
  build(outcome: { completed: boolean; stopped_at?: string; reason?: string }) {
    const body = {
      header: this.header,
      steps: this.steps,
      checkpoints: this.checkpoints,
      outcome,
    };
    const sections = Object.fromEntries(
      Object.entries(body).map(([k, v]) => [k, sha256(canonical(v))]),
    );
    const record = {
      format: EVIDENCE_FORMAT,
      version: EVIDENCE_VERSION,
      ...body,
      digests: { sections, record: sha256(canonical(sections)) },
    };
    const text = JSON.stringify(record, null, 2);
    if (SECRETISH.test(text))
      throw new Error("evidence would contain key or token material: refused");
    return { record, text };
  }

  write(path: string, outcome: { completed: boolean; stopped_at?: string; reason?: string }) {
    const { text } = this.build(outcome);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
    return path;
  }
}

/** Offline integrity check of a rehearsal record: digests and the absence of secret material. */
export function verifyRehearsal(raw: string) {
  const problems: string[] = [];
  let r: Json;
  try {
    r = JSON.parse(raw) as Json;
  } catch {
    return { ok: false, problems: ["not JSON"] };
  }
  if (r.format !== EVIDENCE_FORMAT || r.version !== EVIDENCE_VERSION)
    problems.push("unknown format");
  for (const k of ["header", "steps", "checkpoints", "outcome"]) {
    if (!(k in r)) problems.push(`missing ${k}`);
    else if (r.digests?.sections?.[k] !== sha256(canonical(r[k])))
      problems.push(`${k} digest differs`);
  }
  if (r.digests?.record !== sha256(canonical(r.digests?.sections ?? {})))
    problems.push("record digest differs");
  if (SECRETISH.test(raw)) problems.push("contains key or token material");
  return { ok: problems.length === 0, problems };
}
