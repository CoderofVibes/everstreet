// The launch studio: (find an idea →) guided interview → make it yours → preview → publish.
// The offer card on the right changes as the founder answers; every answer saves.

import { type ReactNode, useEffect, useState } from "react";
import { api, type Project, type PublicBusiness } from "../api.ts";
import { Link, useRouter } from "../router.tsx";
import { useSession } from "../session.tsx";
import { FAMILY_LABEL, OfferCard } from "../ui.tsx";
import { StorefrontView } from "./PublicPage.tsx";

type StepId = "explore" | "interview" | "yours" | "preview" | "publish" | "launched";

const STEP_LABEL: Record<StepId, string> = {
  explore: "Find an idea",
  interview: "Shape the offer",
  yours: "Make it yours",
  preview: "Preview",
  publish: "Publish",
  launched: "Find your first people",
};

const QUESTIONS: {
  key: string;
  ask: string;
  hint: string;
  render: (v: Answers, set: (k: string, val: string | boolean) => void) => ReactNode;
}[] = [
  {
    key: "audience",
    ask: "Who is this for?",
    hint: "Name the people you can serve. Being specific makes it easier for the right people to say yes.",
    render: (v, set) => (
      <>
        <Field
          label="The people you will serve"
          hint="e.g. Adults who have never tried printmaking"
        >
          <textarea
            className="input"
            value={str(v.audience)}
            onChange={(e) => set("audience", e.target.value)}
          />
        </Field>
        <Field
          label="Who it is not for (optional)"
          hint="e.g. Children under 12, experienced printmakers"
        >
          <input
            className="input"
            value={str(v.not_for)}
            onChange={(e) => set("not_for", e.target.value)}
          />
        </Field>
      </>
    ),
  },
  {
    key: "outcome",
    ask: "What do they want to do or change?",
    hint: "One clear result, in their words. This becomes your offer's headline.",
    render: (v, set) => (
      <Field label="The result they get" hint="e.g. Make your first three linocut prints">
        <input
          className="input"
          value={str(v.outcome)}
          onChange={(e) => set("outcome", e.target.value)}
        />
      </Field>
    ),
  },
  {
    key: "deliverable",
    ask: "What exactly will they get?",
    hint: "What happens, how long it takes, and what is included. Only promise what you can deliver.",
    render: (v, set) => (
      <>
        <Field
          label="What they receive"
          hint="e.g. A 90-minute session; you leave with three prints"
        >
          <textarea
            className="input"
            value={str(v.deliverable)}
            onChange={(e) => set("deliverable", e.target.value)}
          />
        </Field>
        <Field
          label="What is included (optional)"
          hint="e.g. All materials, tea, a carving tool to keep"
        >
          <input
            className="input"
            value={str(v.includes)}
            onChange={(e) => set("includes", e.target.value)}
          />
        </Field>
      </>
    ),
  },
  {
    key: "evidence",
    ask: "What have you already made or learned?",
    hint: "Past work, a sample, or why you can do this. It goes on your idea page, in your words.",
    render: (v, set) => (
      <Field
        label="Your experience"
        hint="e.g. Ten years of printmaking; I taught a library workshop last spring"
      >
        <textarea
          className="input"
          value={str(v.evidence)}
          onChange={(e) => set("evidence", e.target.value)}
        />
      </Field>
    ),
  },
  {
    key: "price",
    ask: "What will the first offer cost?",
    hint: "Pick a price you would be glad to be paid. You can make the very first one free to learn faster.",
    render: (v, set) => (
      <>
        <div className="grid-2">
          <Field label="Price" hint="e.g. $35">
            <input
              className="input"
              value={str(v.price)}
              onChange={(e) => set("price", e.target.value)}
            />
          </Field>
          <Field label="Per" hint="What one price buys">
            <select
              className="input"
              value={str(v.price_unit) || "per person"}
              onChange={(e) => set("price_unit", e.target.value)}
            >
              {[
                "per person",
                "per session",
                "per hour",
                "per item",
                "per month",
                "per project",
                "per 1,000 requests",
              ].map((u) => (
                <option key={u}>{u}</option>
              ))}
            </select>
          </Field>
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={Boolean(v.first_free)}
            onChange={(e) => set("first_free", e.target.checked)}
          />
          <span>Make the first one free while I test it</span>
        </label>
      </>
    ),
  },
  {
    key: "when",
    ask: "How will you deliver the first order?",
    hint: "When, where, and how many at once. Customers see anything you leave blank as not decided yet.",
    render: (v, set) => (
      <>
        <div className="grid-2">
          <Field label="When" hint="e.g. Saturday mornings in November">
            <input
              className="input"
              value={str(v.when)}
              onChange={(e) => set("when", e.target.value)}
            />
          </Field>
          <Field label="Where" hint="An address, or “Online”">
            <input
              className="input"
              value={str(v.where)}
              onChange={(e) => set("where", e.target.value)}
            />
          </Field>
        </div>
        <Field label="How many at once (optional)" hint="Leave blank if it does not apply">
          <input
            className="input"
            inputMode="numeric"
            value={str(v.capacity)}
            onChange={(e) => set("capacity", e.target.value.replace(/\D/g, ""))}
            style={{ maxWidth: 160 }}
          />
        </Field>
        <label className="check">
          <input
            type="checkbox"
            checked={Boolean(v.confirmed)}
            onChange={(e) => set("confirmed", e.target.checked)}
          />
          <span>
            I have confirmed I can deliver at this time and place.
            <br />
            <small className="muted">
              Until you tick this, visitors can only ask to hear when it opens.
            </small>
          </span>
        </label>
      </>
    ),
  },
];

type Answers = Record<string, string | boolean | undefined>;
const str = (v: unknown) => (typeof v === "string" ? v : "");

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the control is passed in as children
    <label className="field">
      <span>{label}</span>
      {hint && <small>{hint}</small>}
      {children}
    </label>
  );
}

export function Studio({ id }: { id: string }) {
  const { person, requireSignIn } = useSession();
  const { go } = useRouter();
  const [project, setProject] = useState<Project | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string>("");

  // biome-ignore lint/correctness/useExhaustiveDependencies: requireSignIn changes identity every render; re-running on it would reopen the dialog
  useEffect(() => {
    if (!person) {
      requireSignIn("Sign in to continue your business.");
      return;
    }
    api
      .project(id)
      .then(setProject)
      .catch((e) => setError((e as Error).message));
  }, [id, person]);

  if (error)
    return (
      <div className="page empty">
        <h2>{error}</h2>
        <Link to="/start">Start a business</Link>
      </div>
    );
  if (!project) return <div className="page muted">Loading your business…</div>;

  const steps: StepId[] = [
    ...(project.route === "find" ? (["explore"] as StepId[]) : []),
    "interview",
    "yours",
    "preview",
    "publish",
  ];
  const current = (project.step as StepId) in STEP_LABEL ? (project.step as StepId) : "interview";
  const update = (p: Project) => {
    setProject(p);
    setSaved(`Saved ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`);
  };
  const goStep = async (s: StepId) => update(await api.step(project.id, s));

  return (
    <div className="page">
      <div className="row" style={{ marginBottom: 8 }}>
        <div className="eyebrow" style={{ margin: 0 }}>
          {project.business.name}
        </div>
        <span className="spacer" />
        <span className="saved" aria-live="polite">
          {saved}
        </span>
      </div>
      {current !== "launched" && (
        <nav className="steps" aria-label="Launch steps">
          {steps.map((s) => {
            const idx = steps.indexOf(s);
            const cur = steps.indexOf(current);
            return (
              <button
                type="button"
                key={s}
                className={`step${s === current ? " current" : idx < cur ? " done" : ""}`}
                onClick={() => (idx <= cur || s !== "publish" ? goStep(s) : undefined)}
                aria-current={s === current ? "step" : undefined}
              >
                {idx + 1}. {STEP_LABEL[s]}
              </button>
            );
          })}
        </nav>
      )}

      {current === "launched" ? (
        <Launched project={project} />
      ) : current === "preview" ? (
        <Preview
          project={project}
          onNext={() => goStep("publish")}
          onBack={() => goStep("yours")}
        />
      ) : (
        <div className="studio">
          <div>
            {current === "explore" && <Explore project={project} onUpdate={update} />}
            {current === "interview" && (
              <Interview project={project} onUpdate={update} onDone={() => goStep("yours")} />
            )}
            {current === "yours" && (
              <Yours project={project} onUpdate={update} onDone={() => goStep("preview")} />
            )}
            {current === "publish" && (
              <Publish
                project={project}
                onPublished={async () => {
                  update(await api.project(project.id));
                }}
                onBack={() => goStep("preview")}
              />
            )}
          </div>
          <aside className="studio-side" aria-label="Your offer so far">
            <div className="eyebrow" style={{ margin: 0 }}>
              Your offer, as a customer will see it
            </div>
            <OfferCard
              offer={project.offer}
              family={project.business.family}
              action={project.action}
            />
            {project.missing.length > 0 && (
              <div className="card" style={{ padding: 18 }}>
                <strong>Still to decide</strong>
                <ul className="missing-list" style={{ marginTop: 8 }}>
                  {project.missing.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              </div>
            )}
            <button type="button" className="btn btn-quiet" onClick={() => go("/desk")}>
              Save and come back later
            </button>
          </aside>
        </div>
      )}
    </div>
  );
}

function Explore({ project, onUpdate }: { project: Project; onUpdate: (p: Project) => void }) {
  const e = project.explore as Record<string, string | string[] | undefined>;
  const [v, setV] = useState({
    skills: str(e.skills),
    reach: str(e.reach),
    time: str(e.time),
    budget: str(e.budget),
    kinds: (e.kinds as string[] | undefined) ?? [],
  });
  const [busy, setBusy] = useState(false);
  const toggle = (k: string) =>
    setV({ ...v, kinds: v.kinds.includes(k) ? v.kinds.filter((x) => x !== k) : [...v.kinds, k] });
  const submit = async () => {
    setBusy(true);
    onUpdate(await api.explore(project.id, v));
    setBusy(false);
  };
  return (
    <div className="question">
      <h2>Let's find a first business that fits you</h2>
      <p className="hint">
        Four questions. "Not sure" is a fine answer; we will still suggest something small to try.
      </p>
      <Field
        label="What do people already ask you for help with?"
        hint="Skills, things you make, things you know, tools or space you have"
      >
        <textarea
          className="input"
          value={v.skills}
          onChange={(x) => setV({ ...v, skills: x.target.value })}
          placeholder="e.g. printmaking, fixing bikes, spreadsheets"
        />
      </Field>
      <Field
        label="Who could you reach for an honest conversation?"
        hint="A community or kind of customer. No contact lists needed."
      >
        <input
          className="input"
          value={v.reach}
          onChange={(x) => setV({ ...v, reach: x.target.value })}
          placeholder="e.g. my neighbours and the library art club"
        />
      </Field>
      <div className="grid-2">
        <Field label="Time you could give each week">
          <input
            className="input"
            value={v.time}
            onChange={(x) => setV({ ...v, time: x.target.value })}
            placeholder="e.g. Saturday mornings"
          />
        </Field>
        <Field label="Money you would spend to try it">
          <input
            className="input"
            value={v.budget}
            onChange={(x) => setV({ ...v, budget: x.target.value })}
            placeholder="e.g. under $100"
          />
        </Field>
      </div>
      <span className="field">
        <span>Would you rather…</span>
      </span>
      <div className="row" style={{ marginBottom: 24 }}>
        {[
          ["teach", "Teach"],
          ["make", "Make something"],
          ["solve", "Solve a problem for someone"],
          ["build", "Build a tool"],
        ].map(([k, label]) => (
          <label key={k} className="check" style={{ marginBottom: 0 }}>
            <input
              type="checkbox"
              checked={v.kinds.includes(k as string)}
              onChange={() => toggle(k as string)}
            />
            <span>{label}</span>
          </label>
        ))}
      </div>
      <button type="button" className="btn btn-primary" disabled={busy} onClick={submit}>
        {project.directions.length ? "Suggest again" : "Show me three directions"}
      </button>

      {project.directions.length > 0 && (
        <div style={{ marginTop: 32 }}>
          <h2 style={{ fontSize: 26 }}>Three small directions to try</h2>
          <p className="muted">
            Suggested from your answers; demand still to test. Choosing one only commits you to an
            experiment.
          </p>
          <div className="directions">
            {project.directions.map((d, i) => (
              <div className="card direction" key={d.title}>
                <div>
                  <span className="pill">{FAMILY_LABEL[d.family]}</span>
                  <h3
                    style={{
                      fontFamily: "var(--serif)",
                      fontWeight: 400,
                      fontSize: 22,
                      margin: "8px 0 0",
                    }}
                  >
                    {d.title}
                  </h3>
                  <dl>
                    <dt>Customer</dt>
                    <dd>{d.customer}</dd>
                    <dt>First offer</dt>
                    <dd>{d.offer}</dd>
                    <dt>Try first</dt>
                    <dd>{d.experiment}</dd>
                    <dt>Effort</dt>
                    <dd>{d.effort}</dd>
                    <dt>Why you</dt>
                    <dd>{d.why}</dd>
                  </dl>
                </div>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={async () => onUpdate(await api.choose(project.id, i))}
                >
                  Try this
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Interview({
  project,
  onUpdate,
  onDone,
}: {
  project: Project;
  onUpdate: (p: Project) => void;
  onDone: () => void;
}) {
  const [values, setValues] = useState<Answers>(project.answers);
  const [index, setIndex] = useState(0);
  const [dirty, setDirty] = useState(false);
  const q = QUESTIONS[index] as (typeof QUESTIONS)[number];
  const set = (k: string, val: string | boolean) => {
    setValues((prev) => ({ ...prev, [k]: val }));
    setDirty(true);
  };
  // Save shortly after typing stops, so the card on the right keeps up.
  useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(async () => {
      setDirty(false);
      onUpdate(await api.answer(project.id, values));
    }, 500);
    return () => clearTimeout(t);
  }, [values, dirty, project.id, onUpdate]);

  const next = async () => {
    if (dirty) {
      setDirty(false);
      onUpdate(await api.answer(project.id, values));
    }
    if (index < QUESTIONS.length - 1) setIndex(index + 1);
    else onDone();
  };
  return (
    <div className="question">
      <div className="progress" aria-hidden="true">
        <div style={{ width: `${((index + 1) / QUESTIONS.length) * 100}%` }} />
      </div>
      <p className="muted" style={{ fontSize: 14 }}>
        Question {index + 1} of {QUESTIONS.length}
      </p>
      <h2>{q.ask}</h2>
      <p className="hint">{q.hint}</p>
      {q.render(values, set)}
      <div className="row" style={{ marginTop: 8 }}>
        {index > 0 && (
          <button type="button" className="btn btn-secondary" onClick={() => setIndex(index - 1)}>
            Back
          </button>
        )}
        <button type="button" className="btn btn-primary" onClick={next}>
          {index < QUESTIONS.length - 1 ? "Next" : "Looks good, continue"}
        </button>
        <span className="spacer" />
        <button
          type="button"
          className="btn btn-quiet"
          onClick={() => setIndex(Math.min(index + 1, QUESTIONS.length - 1))}
        >
          Skip for now
        </button>
      </div>
    </div>
  );
}

function Yours({
  project,
  onUpdate,
  onDone,
}: {
  project: Project;
  onUpdate: (p: Project) => void;
  onDone: () => void;
}) {
  const { setPerson } = useSession();
  const b = project.business;
  const [v, setV] = useState({
    name: b.name === "Untitled business" ? "" : b.name,
    tagline: b.tagline,
    about: b.about,
    family: b.family,
    headline: project.owner.headline,
    bio: project.owner.bio,
    problem: project.idea.problem,
    why_me: project.idea.why_me,
    ask: project.idea.ask,
    title: project.offer.title,
  });
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    if (!v.name.trim()) {
      setError("Give your business a name");
      return false;
    }
    setError(null);
    await api.updateBusiness(b.id, {
      name: v.name,
      tagline: v.tagline,
      about: v.about,
      family: v.family,
    });
    await api.editIdea(b.id, { problem: v.problem, why_me: v.why_me, ask: v.ask });
    if (v.title !== project.offer.title) await api.editOffer(b.id, { title: v.title });
    const { person } = await api.updateMe({ headline: v.headline, bio: v.bio });
    setPerson(person);
    onUpdate(await api.project(project.id));
    return true;
  };
  return (
    <div className="question">
      <h2>Make it yours</h2>
      <p className="hint">This is what people see first. Write it the way you would say it.</p>
      <div className="card">
        <h3>Your business</h3>
        <Field label="Name">
          <input
            className="input"
            value={v.name}
            onChange={(e) => setV({ ...v, name: e.target.value })}
            placeholder="e.g. Juniper Print Studio"
          />
        </Field>
        <Field label="One line about it" hint="e.g. Beginner printmaking on Saturday mornings">
          <input
            className="input"
            value={v.tagline}
            onChange={(e) => setV({ ...v, tagline: e.target.value })}
          />
        </Field>
        <Field label="Kind of business">
          <select
            className="input"
            value={v.family}
            onChange={(e) => setV({ ...v, family: e.target.value as typeof v.family })}
          >
            {Object.entries(FAMILY_LABEL).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="Offer headline"
          hint="We drafted this from your answers; change it freely. Your edit sticks."
        >
          <input
            className="input"
            value={v.title}
            onChange={(e) => setV({ ...v, title: e.target.value })}
          />
        </Field>
        <Field label="About (optional)">
          <textarea
            className="input"
            value={v.about}
            onChange={(e) => setV({ ...v, about: e.target.value })}
          />
        </Field>
      </div>
      <div className="card">
        <h3>The idea</h3>
        <Field label="The problem you are solving">
          <textarea
            className="input"
            value={v.problem}
            onChange={(e) => setV({ ...v, problem: e.target.value })}
          />
        </Field>
        <Field label="Why you" hint="Pulled from your experience answer; edit it here">
          <textarea
            className="input"
            value={v.why_me}
            onChange={(e) => setV({ ...v, why_me: e.target.value })}
            placeholder={project.idea.evidence}
          />
        </Field>
        <Field
          label="What you are asking people for right now"
          hint="e.g. Tell me which Saturday suits you"
        >
          <input
            className="input"
            value={v.ask}
            onChange={(e) => setV({ ...v, ask: e.target.value })}
          />
        </Field>
      </div>
      <div className="card">
        <h3>About you</h3>
        <Field label="Headline" hint="e.g. Printmaker and teacher in Alder Lane">
          <input
            className="input"
            value={v.headline}
            onChange={(e) => setV({ ...v, headline: e.target.value })}
          />
        </Field>
        <Field label="A few lines about you">
          <textarea
            className="input"
            value={v.bio}
            onChange={(e) => setV({ ...v, bio: e.target.value })}
          />
        </Field>
      </div>
      {error && <p className="error-text">{error}</p>}
      <div className="row" style={{ marginTop: 16 }}>
        <button
          type="button"
          className="btn btn-primary"
          onClick={async () => (await save()) && onDone()}
        >
          Preview as a customer
        </button>
        <button type="button" className="btn btn-secondary" onClick={save}>
          Save
        </button>
      </div>
    </div>
  );
}

function asPublic(p: Project): PublicBusiness {
  return {
    slug: p.business.slug,
    name: p.business.name,
    tagline: p.business.tagline,
    about: p.business.about,
    family: p.business.family,
    stage: p.business.stage,
    published_at: p.business.published_at ?? "",
    founder: { display_name: p.owner.display_name, headline: p.owner.headline, bio: p.owner.bio },
    idea: {
      problem: p.idea.problem,
      why_me: p.idea.why_me || p.idea.evidence,
      ask: p.idea.ask,
      evidence: p.idea.evidence,
    },
    offer: p.offer,
    unknown: p.missing,
    action: p.action,
    interested: 0,
  };
}

function Preview({
  project,
  onNext,
  onBack,
}: {
  project: Project;
  onNext: () => void;
  onBack: () => void;
}) {
  return (
    <div>
      <div className="preview-banner">
        <span>
          <strong>Preview.</strong> This is exactly what a visitor will see. Nothing here is public
          yet, and the button below does nothing in preview.
        </span>
        <span className="row">
          <button type="button" className="btn btn-secondary" onClick={onBack}>
            Edit
          </button>
          <button type="button" className="btn btn-primary" onClick={onNext}>
            Continue to publish
          </button>
        </span>
      </div>
      <StorefrontView page={asPublic(project)} preview />
    </div>
  );
}

function Publish({
  project,
  onPublished,
  onBack,
}: {
  project: Project;
  onPublished: () => void;
  onBack: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const publish = async () => {
    setBusy(true);
    try {
      await api.publish(project.business.id);
      onPublished();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <div className="question review">
      <h2>Ready to be seen?</h2>
      <p className="hint">Here is exactly what publishing does.</p>
      <div className="card">
        <dl>
          <dt>Who will see it</dt>
          <dd>Anyone on Everstreet, and anyone you send the link to.</dd>
          <dt>What they can do</dt>
          <dd>
            <strong>{project.action.label}</strong>
            {project.action.kind === "interest"
              ? ". You have not confirmed every detail, so nobody can book or pay yet; people can tell you they are interested."
              : ". People can send you a booking request. No payment is taken in this version."}
          </dd>
          <dt>What you are promising</dt>
          <dd>
            {project.offer.title || "Your offer"}
            {project.offer.when_text ? `, ${project.offer.when_text}` : ""}.
          </dd>
          <dt>How you will respond</dt>
          <dd>Replies arrive in your inbox and as tasks on your desk.</dd>
          <dt>What stays private</dt>
          <dd>
            Your drafts history, and the contact details of anyone who writes to you unless they
            choose to share them.
          </dd>
          {project.missing.length > 0 && (
            <>
              <dt>Shown as not decided</dt>
              <dd>{project.missing.join("; ")}.</dd>
            </>
          )}
        </dl>
        {error && <p className="error-text">{error}</p>}
        <div className="row">
          <button
            type="button"
            className="btn btn-primary btn-lg"
            disabled={busy}
            onClick={publish}
          >
            Publish my page
          </button>
          <button type="button" className="btn btn-secondary" onClick={onBack}>
            Back to preview
          </button>
        </div>
      </div>
    </div>
  );
}

function Launched({ project }: { project: Project }) {
  const url = `${window.location.origin}/b/${project.business.slug}`;
  const [copied, setCopied] = useState(false);
  return (
    <div className="page narrow" style={{ padding: 0 }}>
      <div className="eyebrow">Published</div>
      <h1 className="display" style={{ fontSize: 44 }}>
        {project.business.name} is open to the world.
      </h1>
      <p style={{ fontSize: 18 }} className="muted">
        Your page is live. The next step is the one that matters: get it in front of the first few
        people who might want it.
      </p>
      <div className="card">
        <strong>Your page</strong>
        <div className="row" style={{ marginTop: 8 }}>
          <code
            style={{ background: "var(--paper)", padding: "8px 12px", borderRadius: 8, flex: 1 }}
          >
            {url}
          </code>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={async () => {
              await navigator.clipboard?.writeText(url).catch(() => {});
              setCopied(true);
            }}
          >
            {copied ? "Copied" : "Copy link"}
          </button>
          <Link to={`/b/${project.business.slug}`} className="btn btn-primary">
            Open it
          </Link>
        </div>
      </div>
      <div className="card">
        <h2>Your first week</h2>
        <ol style={{ paddingLeft: 20, margin: 0, display: "grid", gap: 10 }}>
          {project.plan.map((s) => (
            <li key={s.title}>
              <strong>{s.title}</strong>
              <div className="muted" style={{ fontSize: 15 }}>
                {s.detail}
              </div>
            </li>
          ))}
        </ol>
        <div className="row" style={{ marginTop: 20 }}>
          <Link to={`/desk/${project.business.id}`} className="btn btn-primary">
            Go to your desk
          </Link>
        </div>
      </div>
    </div>
  );
}
