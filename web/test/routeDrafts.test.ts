// Job 001k1 (Astra's ExecutableCanvasBrowserReview reproduction, now a regression): leaving the
// Studio (Build → the same project card) unmounts the Web app view and the brief companion, so
// their controllers are created again on return. Unsent text must come back for the same person,
// project and owner epoch, separately for each composer, without resurrecting a submitted draft
// or sending anything. This drives the REAL controllers the components use (Generations in the
// Web app view; BriefComposer in the conversation panel), recreated over the same storage as on
// remount and reload. The reproduction (first test) failed at e023a11: the draft came back "".

import { describe, expect, it } from "vitest";
import { ApiError } from "../src/api.ts";
import type { GenerationJob, GenerationRequest } from "../src/appApi.ts";
import { type GenerationPort, Generations } from "../src/appGenerate.ts";
import { BriefComposer } from "../src/briefComposer.ts";
import { clearProject, DRAFT_MAX } from "../src/composerDrafts.ts";
import { studioScope } from "../src/studioScope.ts";

class MemoryStorage {
  m = new Map<string, string>();
  get length() {
    return this.m.size;
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
}
class DeniedStorage {
  getItem(): string | null {
    throw new Error("denied");
  }
  setItem() {
    throw new Error("denied");
  }
  removeItem() {
    throw new Error("denied");
  }
}

const SCOPE = studioScope("person-ava", "project-1", "epoch-1");
const BUDGET = {
  max_input_tokens: 1000,
  max_output_tokens: 1000,
  max_seconds: 60,
  max_cost_cents: 10,
};
const BASE = { project_id: "project-1", revision: 1, base_job: null, budget: BUDGET };
const JOB = "00000000-0000-4000-8000-000000000001";
let n = 0;
const newKey = () => `route-key-${String(++n).padStart(6, "0")}`;

/** A generation port that records every request and answers as told. */
function port(answer: (r: GenerationRequest) => Promise<{ job: GenerationJob }>) {
  const sent: GenerationRequest[] = [];
  const p: GenerationPort & { sent: GenerationRequest[] } = {
    sent,
    generate: (r) => {
      sent.push(r);
      return answer(r);
    },
    build: async (id) => ({ job: { id, state: "queued", failure: null } }),
    cancelBuild: async (id) => ({ job: { id, state: "cancelled", failure: null } }),
  };
  return p;
}
const never = () => port(() => new Promise(() => {}));
const app = (storage: unknown, p: GenerationPort = never(), scope = SCOPE) =>
  new Generations(p, { scope, storage: storage as Storage, newKey });
const brief = (storage: unknown, scope = SCOPE) =>
  new BriefComposer({ scope, storage: storage as Storage });

describe("001k1 the app composer across a route change and reload", () => {
  it("reproduction: recreating the controller with the same storage brings the unsent draft back", () => {
    const storage = new MemoryStorage();
    app(storage).setDraft("Route retention probe");
    // Build → project card → Web app: the view (and its controller) is created again.
    expect(app(storage).getState().draft).toBe("Route retention probe");
  });

  it("an emptied composer stays empty on reopen", () => {
    const storage = new MemoryStorage();
    const g = app(storage);
    g.setDraft("something");
    g.setDraft("");
    expect(app(storage).getState().draft).toBe("");
    expect(storage.m.size).toBe(0);
  });

  it("a submitted draft never comes back as unsent text, and nothing is sent on reopen", async () => {
    const storage = new MemoryStorage();
    const p = never();
    const g = app(storage, p);
    g.setDraft("Make priority support cheaper");
    void g.submit(BASE); // in flight, no answer yet
    await Promise.resolve();
    expect(g.getState().draft).toBe("");
    const key = p.sent[0]?.key;
    // The route changes while it is in flight.
    const p2 = never();
    const back = app(storage, p2);
    expect(back.getState().draft).toBe("");
    expect(back.getState().pending).toMatchObject({
      key,
      instructions: "Make priority support cheaper",
    });
    expect(back.getState().unanswered).toBe(true);
    expect(p2.sent).toHaveLength(0); // never sent by itself
  });

  it("typed-ahead text and the exact pending request both survive, apart", async () => {
    const storage = new MemoryStorage();
    const p = never();
    const g = app(storage, p);
    g.setDraft("First request");
    void g.submit(BASE);
    await Promise.resolve();
    g.setDraft("Typed while it ran");
    const back = app(storage, never());
    expect(back.getState().draft).toBe("Typed while it ran");
    expect(back.getState().pending?.instructions).toBe("First request");
    expect(back.getState().pending?.key).toBe(p.sent[0]?.key);
    expect(back.getState().pending?.budget).toEqual(BUDGET);
  });

  it("a definite refusal restores the words, never over newer text; both survive a reopen", async () => {
    const refuse = () => port(() => Promise.reject(new ApiError(409, "refused")));
    const s1 = new MemoryStorage();
    const g1 = app(s1, refuse());
    g1.setDraft("Words to keep");
    await g1.submit(BASE);
    expect(app(s1).getState().draft).toBe("Words to keep");
    expect(app(s1).getState().pending).toBeNull();
    // Newer text typed while the request was out is not overwritten.
    const s2 = new MemoryStorage();
    let reject: (e: unknown) => void = () => {};
    const g2 = app(
      s2,
      port(
        () =>
          new Promise((_, r) => {
            reject = r;
          }),
      ),
    );
    g2.setDraft("Old words");
    const done = g2.submit(BASE);
    g2.setDraft("Newer words");
    reject(new ApiError(409, "refused"));
    await done;
    expect(app(s2).getState().draft).toBe("Newer words");
  });

  it("an acknowledged job is kept by id, completion doesn't erase newer text", async () => {
    const storage = new MemoryStorage();
    const g = app(
      storage,
      port(async () => ({ job: { id: JOB, state: "queued", failure: null } })),
    );
    g.setDraft("Change the copy");
    await g.submit(BASE);
    g.setDraft("Next idea");
    const back = app(storage);
    expect(back.getState().job).toEqual({ id: JOB, state: "unknown", failure: null });
    expect(back.getState().draft).toBe("Next idea");
    expect(back.getState().pending).toBeNull();
  });

  it("another person, project or owner epoch never sees it; the brief composer never sees it", () => {
    const storage = new MemoryStorage();
    app(storage).setDraft("Ava's app words");
    for (const other of [
      studioScope("person-ben", "project-1", "epoch-1"),
      studioScope("person-ava", "project-2", "epoch-1"),
      studioScope("person-ava", "project-1", "epoch-2"), // after a sale
    ])
      expect(app(storage, never(), other).getState().draft).toBe("");
    expect(brief(storage).getState().text).toBe("");
  });

  it("denied, corrupt, old, over-long and stale storage fail safe; the session still works", async () => {
    // Denied: the in-session draft and a request still work.
    const p = never();
    const g = app(new DeniedStorage(), p);
    g.setDraft("works anyway");
    expect(g.getState().draft).toBe("works anyway");
    void g.submit(BASE);
    await Promise.resolve();
    expect(p.sent).toHaveLength(1);
    expect(app(new DeniedStorage()).getState().draft).toBe("");
    // Corrupt, another version, another scope inside, stale, oversize: ignored and removed.
    const storage = new MemoryStorage();
    const k = `everstreet.draft.v1.app.${SCOPE}`;
    for (const bad of [
      "{not json",
      JSON.stringify({ v: 0, scope: SCOPE, at: Date.now(), text: "old schema" }),
      JSON.stringify({ v: 1, scope: "other", at: Date.now(), text: "wrong scope" }),
      JSON.stringify({ v: 1, scope: SCOPE, at: Date.now() - 8 * 86_400_000, text: "stale" }),
      JSON.stringify({ v: 1, scope: SCOPE, at: Date.now(), text: "x".repeat(DRAFT_MAX + 1) }),
      JSON.stringify({ v: 1, scope: SCOPE, at: Date.now(), text: 42 }),
    ]) {
      storage.setItem(k, bad);
      expect(app(storage).getState().draft).toBe("");
      expect(storage.getItem(k)).toBeNull();
    }
    // Over-long input isn't kept (the composer allows 2000), and keeps nothing older either.
    const g2 = app(storage);
    g2.setDraft("short");
    g2.setDraft("y".repeat(DRAFT_MAX + 1));
    expect(app(storage).getState().draft).toBe("");
  });

  it("definite access loss clears the draft, request and job (forget, and a 404 on the job)", async () => {
    const storage = new MemoryStorage();
    const g = app(
      storage,
      port(async () => ({ job: { id: JOB, state: "queued", failure: null } })),
    );
    g.setDraft("x");
    await g.submit(BASE);
    g.setDraft("private next words");
    g.forget();
    expect(storage.m.size).toBe(0);
    expect(app(storage).getState()).toMatchObject({ draft: "", pending: null, job: null });
    // A 404 reading the job also ends it.
    const g2 = app(storage, {
      ...never(),
      generate: async () => ({ job: { id: JOB, state: "queued", failure: null } }),
      build: () => Promise.reject(new ApiError(404, "gone")),
    });
    g2.setDraft("y");
    await g2.submit(BASE);
    g2.setDraft("more private words");
    await g2.refresh();
    expect(app(storage).getState()).toMatchObject({ draft: "", job: null });
  });
});

describe("001k1 the brief companion across a route change and reload", () => {
  it("restores the unsent text, separately from the app composer", () => {
    const storage = new MemoryStorage();
    brief(storage).setText("Brief route retention probe");
    app(storage).setDraft("App words");
    expect(brief(storage).getState().text).toBe("Brief route retention probe");
    expect(app(storage).getState().draft).toBe("App words");
  });

  it("an unresolved message keeps its exact key; one in flight comes back unknown, never re-sent", () => {
    const storage = new MemoryStorage();
    const b = brief(storage);
    b.setOutbox({
      text: "Also return the date",
      key: "msg-0000aaaa",
      state: "sending",
      reason: null,
    });
    b.setText(""); // the box was freed when it was sent
    const back = brief(storage);
    expect(back.getState().text).toBe(""); // the sent text is not unsent text again
    expect(back.getState().outbox).toEqual({
      text: "Also return the date",
      key: "msg-0000aaaa",
      state: "unknown",
      reason: "No clear answer arrived, so it may or may not have been sent.",
    });
    // A refusal is kept as refused, with its reason.
    back.setOutbox({ text: "x", key: "msg-0000bbbb", state: "refused", reason: "Over budget" });
    expect(brief(storage).getState().outbox).toMatchObject({
      state: "refused",
      reason: "Over budget",
    });
    // Accepted: nothing is left to show or keep.
    brief(storage).setOutbox(null);
    expect(brief(storage).getState().outbox).toBeNull();
  });

  it("typed-ahead text and a prefill are kept; a bad outbox entry is dropped", () => {
    const storage = new MemoryStorage();
    const b = brief(storage);
    b.setText("My next thought");
    b.updateText((t) => `${t}\n\nAsk again: shorter`);
    expect(brief(storage).getState().text).toBe("My next thought\n\nAsk again: shorter");
    storage.setItem(
      `everstreet.draft.v1.brief-outbox.${SCOPE}`,
      JSON.stringify({
        v: 1,
        scope: SCOPE,
        at: Date.now(),
        text: "x",
        key: "bad key!",
        state: "unknown",
      }),
    );
    expect(brief(storage).getState().outbox).toBeNull();
  });

  it("another scope never sees it; access loss for the project clears every epoch's entries", () => {
    const storage = new MemoryStorage();
    brief(storage).setText("Ava's brief words");
    expect(brief(storage, studioScope("person-ben", "project-1", "epoch-1")).getState().text).toBe(
      "",
    );
    const older = studioScope("person-ava", "project-1", "epoch-0");
    brief(storage, older).setText("from an earlier epoch");
    app(storage).setDraft("app words");
    const unrelated = studioScope("person-ava", "project-10", "epoch-1");
    brief(storage, unrelated).setText("another project");
    clearProject(storage, "person-ava", "project-1");
    expect(brief(storage).getState().text).toBe("");
    expect(brief(storage, older).getState().text).toBe("");
    expect(app(storage).getState().draft).toBe("");
    expect(brief(storage, unrelated).getState().text).toBe("another project");
  });

  it("forget clears text and outbox", () => {
    const storage = new MemoryStorage();
    const b = brief(storage);
    b.setText("t");
    b.setOutbox({ text: "o", key: "msg-0000cccc", state: "unknown", reason: null });
    b.forget();
    expect(brief(storage).getState()).toEqual({ text: "", outbox: null });
    expect(storage.m.size).toBe(0);
  });
});

/** A port whose one answer is held until the test settles it. */
function held() {
  let settle: { ok: (j: GenerationJob) => void; fail: (e: unknown) => void } = {
    ok: () => {},
    fail: () => {},
  };
  const p = port(
    () =>
      new Promise<{ job: GenerationJob }>((res, rej) => {
        settle = { ok: (job) => res({ job }), fail: rej };
      }),
  );
  return { p, settle: () => settle };
}

describe("001k1 late answers (Astra's StudioDraftLifetimeReview, reproduced first)", () => {
  it("a detached instance's late refusal can't overwrite the newer instance's draft", async () => {
    const storage = new MemoryStorage();
    const { p, settle } = held();
    const a = app(storage, p);
    a.attach();
    a.setDraft("original sent text");
    const sent = a.submit(BASE);
    await Promise.resolve();
    a.detach(); // Build → the project card: the view unmounts
    const b = app(storage, never());
    b.attach();
    b.setDraft("newer route draft");
    settle().fail(new ApiError(400, "refused"));
    await sent;
    expect(b.getState().draft).toBe("newer route draft");
    const c = app(storage, never()); // a reload, or the next return
    expect(c.getState().draft).toBe("newer route draft");
    // The kept envelope wasn't removed by the stale instance: the new one recovers the SAME
    // request (same key), and the server's answer to it is then authoritative.
    expect(c.getState().pending?.key).toBe(p.sent[0]?.key);
    expect(c.getState().unanswered).toBe(true);
  });

  it("after forget, a late refusal restores nothing, in memory or storage", async () => {
    const storage = new MemoryStorage();
    const { p, settle } = held();
    const g = app(storage, p);
    g.attach();
    g.setDraft("private unsent words");
    const sent = g.submit(BASE);
    await Promise.resolve();
    g.forget(); // definite access loss
    settle().fail(new ApiError(400, "refused"));
    await sent;
    expect(g.getState()).toMatchObject({ draft: "", pending: null, job: null });
    expect(storage.m.size).toBe(0);
    expect(app(storage).getState().draft).toBe("");
    // A late success after forget keeps nothing either.
    const h = held();
    const g2 = app(storage, h.p);
    g2.setDraft("again");
    const sent2 = g2.submit(BASE);
    await Promise.resolve();
    g2.forget();
    h.settle().ok({ id: JOB, state: "queued", failure: null });
    await sent2;
    expect(storage.m.size).toBe(0);
    expect(g2.getState().job).toBeNull();
  });

  it("a mount after a detach (React's effect re-run) writes again; a remount's instance is the writer", () => {
    const storage = new MemoryStorage();
    const g = app(storage);
    g.detach();
    g.attach();
    g.setDraft("still written");
    expect(app(storage).getState().draft).toBe("still written");
  });

  it("brief: a detached panel's late send result can't overwrite the new panel's message or text", () => {
    const storage = new MemoryStorage();
    const a = brief(storage);
    a.attach();
    const out = {
      text: "Also return the date",
      key: "msg-0000dddd",
      state: "sending" as const,
      reason: null,
    };
    a.setOutbox(out);
    a.setText("");
    a.detach();
    const b = brief(storage);
    b.attach();
    expect(b.getState().outbox?.state).toBe("unknown");
    b.setText("next thought");
    b.setOutbox(null); // resent under the same key and accepted
    // The old panel's request answers late (refused): it changes nothing kept.
    a.setOutbox({ ...out, state: "refused", reason: "late" });
    a.setText("stale");
    expect(brief(storage).getState()).toEqual({ text: "next thought", outbox: null });
  });

  it("brief: after forget, a late send result restores nothing", () => {
    const storage = new MemoryStorage();
    const b = brief(storage);
    b.setOutbox({ text: "x", key: "msg-0000eeee", state: "sending", reason: null });
    b.forget();
    b.setOutbox({ text: "x", key: "msg-0000eeee", state: "refused", reason: "late" });
    b.setText("late words");
    expect(b.getState()).toEqual({ text: "", outbox: null });
    expect(storage.m.size).toBe(0);
  });
});

describe("001k1 late DELETIONS (Astra's StudioDraftLifetimeReview follow-up, reproduced first)", () => {
  it("a detached instance's late 404 on its job read can't erase the newer instance's draft", async () => {
    const storage = new MemoryStorage();
    let failRead: (e: unknown) => void = () => {};
    const p: GenerationPort = {
      generate: async () => ({ job: { id: JOB, state: "queued", failure: null } }),
      build: () =>
        new Promise((_, rej) => {
          failRead = rej;
        }),
      cancelBuild: async (id) => ({ job: { id, state: "cancelled", failure: null } }),
    };
    const a = app(storage, p);
    a.attach();
    a.setDraft("first");
    await a.submit(BASE); // a queued job, kept by id
    const reading = a.refresh(); // its read is still out
    a.detach(); // the view unmounts
    const b = app(storage, never());
    b.attach();
    expect(b.getState().job?.id).toBe(JOB);
    b.setDraft("newer draft after return");
    failRead(new ApiError(404, "gone")); // the OLD read answers late
    await reading;
    expect(b.getState().draft).toBe("newer draft after return");
    const c = app(storage, never());
    expect(c.getState().draft).toBe("newer draft after return");
    expect(c.getState().job?.id).toBe(JOB); // the new view reads the job itself
  });

  it("a detached instance's late forget (a stale page load) can't erase the newer instance's state", () => {
    const storage = new MemoryStorage();
    const a = app(storage);
    a.attach();
    a.detach();
    const b = app(storage);
    b.attach();
    b.setDraft("kept by the mounted view");
    a.forget(); // the old view's page load answered 404 after it unmounted
    expect(app(storage).getState().draft).toBe("kept by the mounted view");
    // The same for the brief composer.
    const x = brief(storage);
    x.attach();
    x.detach();
    const y = brief(storage);
    y.attach();
    y.setText("brief words kept");
    x.forget();
    expect(brief(storage).getState().text).toBe("brief words kept");
  });

  it("the mounted instance's definite access loss still clears everything", async () => {
    const storage = new MemoryStorage();
    const p: GenerationPort = {
      generate: async () => ({ job: { id: JOB, state: "queued", failure: null } }),
      build: () => Promise.reject(new ApiError(404, "gone")),
      cancelBuild: async (id) => ({ job: { id, state: "cancelled", failure: null } }),
    };
    const g = app(storage, p);
    g.attach();
    g.setDraft("x");
    await g.submit(BASE);
    g.setDraft("private");
    await g.refresh();
    expect(app(storage).getState()).toMatchObject({ draft: "", job: null });
    const b = brief(storage);
    b.attach();
    b.setText("private brief");
    b.forget();
    expect(storage.m.size).toBe(0);
  });
});
