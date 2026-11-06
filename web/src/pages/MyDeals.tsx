// First-use review #74/#75/#76: a person's sales in progress, wherever they look for them
// (Acquire, Portfolio): which business, buying or selling, and one link to the sale. Read from
// their own handover receipts (GET /api/me/v3/handovers); only deals still in progress.

import { useActorRead } from "../actorRead.ts";
import { Link } from "../router.tsx";
import { useSession } from "../session.tsx";

interface Deal {
  id: string;
  name: string;
  role: "buyer" | "seller";
}

const fetchDeals = async (): Promise<Deal[]> => {
  const r = await fetch("/api/me/v3/handovers", { credentials: "same-origin" });
  if (!r.ok) return [];
  const d = (await r.json().catch(() => ({}))) as {
    handovers?: {
      business?: { id?: unknown; name?: unknown };
      receipt?: { role?: unknown; status?: unknown };
    }[];
  };
  const out: Deal[] = [];
  for (const h of d.handovers ?? []) {
    const id = h.business?.id;
    const role = h.receipt?.role;
    if (typeof id !== "string" || (role !== "buyer" && role !== "seller")) continue;
    if (h.receipt?.status !== "recorded") continue;
    if (out.some((x) => x.id === id)) continue;
    out.push({
      id,
      role,
      name: typeof h.business?.name === "string" ? h.business.name : "A business",
    });
  }
  return out;
};

/** The person's deals in progress, as a short list; nothing when there are none. */
export function MyDeals({ only }: { only?: "buyer" | "seller" }) {
  const { person } = useSession();
  const { state } = useActorRead(person?.id ?? null, fetchDeals);
  const deals = (state.data ?? []).filter((d) => !only || d.role === only);
  if (deals.length === 0) return null;
  return (
    <section className="card my-deals" aria-labelledby="my-deals">
      <h2 id="my-deals">{only === "buyer" ? "Buying" : "Your deals in progress"}</h2>
      <ul className="plain">
        {deals.map((d) => (
          <li key={d.id}>
            <span>
              {d.role === "buyer" ? "Buying" : "Selling"} <strong>{d.name}</strong>
            </span>
            <Link to={`/sales/${d.id}`} className="btn btn-primary btn-sm">
              Open the sale
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
