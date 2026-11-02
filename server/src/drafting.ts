// Deterministic drafting for the launch studio: first-business directions from the four
// "find an idea" answers, and an offer, idea page and first-week plan from the interview.
// Everything here is a starting draft the founder edits; nothing claims demand that was not
// observed ("Suggested from your answers; demand still to test").

export interface ExploreAnswers {
  skills?: string;
  reach?: string;
  time?: string;
  budget?: string;
  kinds?: string[]; // teach | make | solve | build
}

export interface Direction {
  kind: "teach" | "make" | "solve" | "build";
  family: "class" | "product" | "service" | "software";
  title: string;
  customer: string;
  offer: string;
  experiment: string;
  effort: string;
  why: string;
  /** Customer-facing: the problem, and what the founder asks visitors for right now. */
  problem: string;
  ask: string;
}

const clean = (s: string | undefined, fallback: string) => (s ?? "").trim() || fallback;

function firstSkill(skills: string) {
  return (
    skills
      .split(/,|\band\b|;|\n/)[0]
      ?.trim()
      .toLowerCase() || "what you know"
  );
}

export function directions(a: ExploreAnswers): Direction[] {
  const skill = firstSkill(clean(a.skills, ""));
  const reach = clean(a.reach, "people you already know");
  const time = clean(a.time, "a few hours a week");
  const budget = clean(a.budget, "very little money");
  const all: Direction[] = [
    {
      kind: "teach",
      family: "class",
      title: `Teach a first ${skill} session`,
      customer: `Beginners among ${reach}`,
      offer: `A small group leaves one session having made or done something real with ${skill}`,
      experiment: "Describe one session and ask who would come on a proposed date",
      effort: `Fits ${time}; costs ${budget} plus materials`,
      why: "You already know it well enough to show someone else",
      problem: `Trying ${skill} for the first time is hard to do alone, and most classes assume you already know the basics.`,
      ask: "Tell me which date would suit you",
    },
    {
      kind: "make",
      family: "product",
      title: `Make ${skill} pieces to order`,
      customer: `People among ${reach} who want something made for an occasion`,
      offer: `A small, made-to-order batch using your ${skill}`,
      experiment: "Show two samples and take one scoped request",
      effort: `Fits ${time}; materials and delivery still to check`,
      why: "Uses what you make, not only what you know",
      problem: "Something made by hand for one occasion is hard to find, and harder to ask for.",
      ask: "Tell me what you would want made",
    },
    {
      kind: "solve",
      family: "service",
      title: `Fix one ${skill} problem for someone`,
      customer: `Small businesses or households among ${reach}`,
      offer: `A fixed-scope job that solves one ${skill} problem, with a clear finish`,
      experiment: "Offer one fixed-price trial and deliver it within a week",
      effort: `Can start remotely; fits ${time}`,
      why: "Work samples matter more than equipment",
      problem: `${skill.charAt(0).toUpperCase() + skill.slice(1)} problems take time most people do not have.`,
      ask: "Tell me about the problem you need solved",
    },
    {
      kind: "build",
      family: "software",
      title: `A small tool for people who do ${skill}`,
      customer: `People who do ${skill} and repeat the same chore`,
      offer: "A simple paid tool or API that removes one repeated step",
      experiment: "Describe the tool and ask five people if they would try it",
      effort: `Building takes longer than ${time}; start with a sign-up for testers`,
      why: "Software can serve many customers once it works",
      problem: `People who do ${skill} repeat the same chore by hand, again and again.`,
      ask: "Tell me if you would try an early version",
    },
  ];
  const wanted = a.kinds?.length ? all.filter((d) => a.kinds?.includes(d.kind)) : [];
  const rest = all.filter((d) => !wanted.includes(d));
  return [...wanted, ...rest].slice(0, 3);
}

export interface InterviewAnswers {
  audience?: string;
  not_for?: string;
  outcome?: string;
  deliverable?: string;
  includes?: string;
  evidence?: string;
  price?: string;
  price_unit?: string;
  first_free?: boolean;
  when?: string;
  where?: string;
  capacity?: string;
  confirmed?: boolean;
}

/** The interview's questions, in order, with the field each one fills. */
export const QUESTIONS = [
  {
    field: "audience",
    ask: "Who is this for?",
    hint: "Name the people you can serve, and who it does not fit.",
  },
  {
    field: "outcome",
    ask: "What do they want to do or change?",
    hint: "One clear result, in their words.",
  },
  {
    field: "deliverable",
    ask: "What exactly will they get?",
    hint: "What happens, how long it takes, what is included.",
  },
  {
    field: "evidence",
    ask: "What have you already made or learned?",
    hint: "A sample, past work, or why you can do this.",
  },
  {
    field: "price",
    ask: "What will the first offer cost?",
    hint: "A price and what it is per. You can make the first one free.",
  },
  {
    field: "when",
    ask: "How will you deliver the first order?",
    hint: "When, where (or online), and how many people at once.",
  },
] as const;

export function parsePriceCents(text: string | undefined): number | null {
  if (!text) return null;
  const m = text.replace(/,/g, "").match(/(\d+(?:\.\d{1,2})?)/);
  return m?.[1] ? Math.round(Number(m[1]) * 100) : null;
}

export function draftOffer(a: InterviewAnswers) {
  const outcome = (a.outcome ?? "").trim();
  const deliverable = (a.deliverable ?? "").trim();
  const capacity = a.capacity ? Number.parseInt(a.capacity, 10) : null;
  return {
    title: outcome ? outcome.charAt(0).toUpperCase() + outcome.slice(1) : deliverable,
    outcome,
    audience: (a.audience ?? "").trim(),
    not_for: (a.not_for ?? "").trim(),
    deliverable,
    includes: (a.includes ?? "").trim(),
    price_cents: parsePriceCents(a.price),
    price_unit: (a.price_unit ?? "per person").trim() || "per person",
    first_free: a.first_free ? 1 : 0,
    when_text: (a.when ?? "").trim(),
    where_text: (a.where ?? "").trim(),
    capacity: Number.isFinite(capacity) ? capacity : null,
    confirmed: a.confirmed ? 1 : 0,
  };
}

export interface OfferLike {
  title: string;
  outcome: string;
  audience: string;
  deliverable: string;
  price_cents: number | null;
  first_free: number;
  when_text: string;
  where_text: string;
  capacity: number | null;
  confirmed: number;
}

/** Facts a customer would need that are still missing; each becomes a task. */
export function missingFacts(o: OfferLike): string[] {
  const out: string[] = [];
  if (!o.audience) out.push("Say who this is for");
  if (!o.outcome) out.push("Say what the customer gets out of it");
  if (!o.deliverable) out.push("Describe exactly what they receive");
  if (o.price_cents === null && !o.first_free) out.push("Set a price, or make the first one free");
  if (!o.when_text) out.push("Pick a date or say how soon you can deliver");
  if (!o.where_text) out.push("Say where it happens, or that it is online");
  if (!o.confirmed) out.push("Confirm you can deliver on that date and place");
  return out;
}

/** What a visitor can do: interest until the details are confirmed, then an inquiry. */
export function customerAction(o: OfferLike) {
  return o.confirmed && missingFacts(o).length === 0
    ? { kind: "question" as const, label: "Ask to book" }
    : { kind: "interest" as const, label: "Tell me when it opens" };
}

export function firstWeekPlan(o: OfferLike): { title: string; detail: string }[] {
  return [
    {
      title: "Share your page with three people who might want this",
      detail: "Send the link yourself; a personal note beats a broadcast.",
    },
    {
      title: "Have one honest conversation with a likely customer",
      detail: `Ask what would make "${o.title || "your offer"}" worth it to them.`,
    },
    ...missingFacts(o).map((f) => ({
      title: f,
      detail: "Customers see this as unknown until you fill it in.",
    })),
    {
      title: "Reply to every response within a day",
      detail: "Your inbox shows who said they are interested.",
    },
  ];
}
