// Typed calls to Everstreet's API. Errors carry the server's plain-language message.

export interface Person {
  id: string;
  display_name: string;
  headline: string;
  bio: string;
}

export interface Offer {
  id: string;
  title: string;
  outcome: string;
  audience: string;
  not_for: string;
  deliverable: string;
  includes: string;
  price_cents: number | null;
  price_unit: string;
  first_free: number;
  when_text: string;
  where_text: string;
  capacity: number | null;
  confirmed: number;
  published_at: string | null;
}

export interface Business {
  id: string;
  slug: string;
  name: string;
  tagline: string;
  about: string;
  family: "class" | "service" | "product" | "software" | "undecided";
  stage: "shape" | "test" | "launch" | "grow";
  published_at: string | null;
}

export interface Idea {
  problem: string;
  why_me: string;
  ask: string;
  evidence: string;
  published_at: string | null;
}

export interface Direction {
  kind: string;
  family: string;
  title: string;
  customer: string;
  offer: string;
  experiment: string;
  effort: string;
  why: string;
}

export interface Action {
  kind: "interest" | "question";
  label: string;
}

export interface Project {
  id: string;
  route: "idea" | "find" | "started";
  step: string;
  explore: Record<string, unknown>;
  directions: Direction[];
  answers: Record<string, string | boolean | undefined>;
  business: Business;
  offer: Offer;
  idea: Idea;
  owner: Person;
  missing: string[];
  action: Action;
  plan: { title: string; detail: string }[];
}

export interface Task {
  id: string;
  title: string;
  detail: string;
  source: string;
  done_at: string | null;
}

export interface Inquiry {
  id: string;
  kind: "interest" | "question";
  message: string;
  share_contact: number;
  reply: string | null;
  from_name: string;
  created_at: string;
  replied_at: string | null;
  business_name?: string;
  business_id?: string;
  slug?: string;
}

export interface Desk {
  business: Business;
  offer: Offer;
  idea: Idea;
  project_id: string | null;
  missing: string[];
  action: Action;
  tasks: Task[];
  inquiries: Inquiry[];
}

export interface PublicBusiness {
  slug: string;
  name: string;
  tagline: string;
  about: string;
  family: Business["family"];
  stage: Business["stage"];
  published_at: string;
  founder: { display_name: string; headline: string; bio: string };
  idea: Omit<Idea, "published_at"> | null;
  offer: Omit<Offer, "id" | "published_at"> | null;
  unknown: string[];
  action: Action;
  interested: number;
  viewer_is_owner?: boolean;
  matched?: string[];
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`);
  return data as T;
}

export const api = {
  env: () => call<{ environment: string; localPreview: boolean }>("/api/env"),
  me: () => call<{ person: Person | null }>("/api/me"),
  join: (name: string) => call<{ person: Person }>("/api/session", "POST", { name }),
  signOut: () => call<{ person: null }>("/api/session", "DELETE"),
  people: () => call<{ people: { id: string; display_name: string }[] }>("/api/people"),
  actAs: (id: string) => call<{ person: Person }>(`/api/session/as/${id}`, "POST"),
  updateMe: (fields: Partial<Person>) => call<{ person: Person }>("/api/me", "PATCH", fields),

  projects: () =>
    call<{
      projects: {
        id: string;
        step: string;
        business_id: string;
        name: string;
        slug: string;
        stage: string;
        published_at: string | null;
        inquiries: number;
      }[];
    }>("/api/projects"),
  startProject: (route: Project["route"], name?: string) =>
    call<Project>("/api/projects", "POST", { route, name }),
  project: (id: string) => call<Project>(`/api/projects/${id}`),
  explore: (id: string, answers: Record<string, unknown>) =>
    call<Project>(`/api/projects/${id}/explore`, "POST", answers),
  choose: (id: string, index: number) =>
    call<Project>(`/api/projects/${id}/choose`, "POST", { index }),
  answer: (id: string, patch: Record<string, unknown>) =>
    call<Project>(`/api/projects/${id}/answers`, "PATCH", patch),
  step: (id: string, step: string) => call<Project>(`/api/projects/${id}/step`, "POST", { step }),

  desk: (businessId: string) => call<Desk>(`/api/businesses/${businessId}`),
  updateBusiness: (businessId: string, fields: Partial<Business>) =>
    call<Desk>(`/api/businesses/${businessId}`, "PATCH", fields),
  editOffer: (businessId: string, fields: Record<string, unknown>) =>
    call<Desk>(`/api/businesses/${businessId}/offer`, "PATCH", fields),
  editIdea: (businessId: string, fields: Partial<Idea>) =>
    call<Desk>(`/api/businesses/${businessId}/idea`, "PATCH", fields),
  publish: (businessId: string) => call<Desk>(`/api/businesses/${businessId}/publish`, "POST"),
  unpublish: (businessId: string) => call<Desk>(`/api/businesses/${businessId}/unpublish`, "POST"),
  setTask: (taskId: string, done: boolean) =>
    call<{ tasks: Task[] }>(`/api/tasks/${taskId}`, "PATCH", { done }),

  inbox: () => call<{ received: Inquiry[]; sent: Inquiry[] }>("/api/inbox"),
  reply: (id: string, text: string) =>
    call<{ received: Inquiry[]; sent: Inquiry[] }>(`/api/inquiries/${id}/reply`, "POST", { text }),

  discover: (q = "") =>
    call<{ businesses: PublicBusiness[] }>(`/api/public/discover?q=${encodeURIComponent(q)}`),
  page: (slug: string) => call<PublicBusiness>(`/api/public/businesses/${slug}`),
  inquire: (slug: string, kind: Action["kind"], message: string, share_contact: boolean) =>
    call<{ id: string }>(`/api/public/businesses/${slug}/inquiries`, "POST", {
      kind,
      message,
      share_contact,
    }),
};
