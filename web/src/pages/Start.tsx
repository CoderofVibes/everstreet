import { useEffect, useState } from "react";
import { api, type Project } from "../api.ts";
import { Link, useRouter } from "../router.tsx";
import { useSession } from "../session.tsx";

const CHOICES: { route: Project["route"]; title: string; text: string }[] = [
  {
    route: "idea",
    title: "I have an idea",
    text: "Answer a few questions while your offer takes shape beside you.",
  },
  {
    route: "find",
    title: "Help me find an idea",
    text: "Tell us what you are good at and who you know. Get three small directions to try.",
  },
  {
    route: "started",
    title: "I've already started",
    text: "Bring what you already sell and give it a page people can find.",
  },
];

export function Start() {
  const { go } = useRouter();
  const { person, requireSignIn } = useSession();
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<Project["route"] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existing, setExisting] = useState<Awaited<ReturnType<typeof api.projects>>["projects"]>(
    [],
  );

  useEffect(() => {
    if (person)
      api
        .projects()
        .then((r) => setExisting(r.projects))
        .catch(() => {});
  }, [person]);

  const begin = async (route: Project["route"]) => {
    // First-use review #29: choosing a card asks first (a name); nothing is created by a click.
    if (picked !== route || (route === "started" && !name.trim())) {
      setPicked(route);
      return;
    }
    if (
      !person &&
      !(await requireSignIn(
        "Join to save your work as you go. Nothing is public until you publish it.",
      ))
    )
      return;
    setBusy(true);
    try {
      const p = await api.startProject(route, name.trim() || undefined);
      go(`/studio/${p.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  // Review #18: product-studio projects belong to the studio, not this wizard's list.
  const unfinished = existing.filter((p) => !p.published_at && !p.product_studio);

  return (
    <div className="page">
      <div className="eyebrow">Start a business</div>
      <h1 className="display" style={{ fontSize: 44 }}>
        Where are you starting from?
      </h1>
      <p className="muted" style={{ fontSize: 18 }}>
        No wallet, no paperwork, no business plan. You leave with a page you are proud to share and
        a plan for your first week. Everything stays private until you publish it.
      </p>

      {unfinished.length > 0 && (
        <div className="notice ok" style={{ marginTop: 20 }}>
          You have {unfinished.length === 1 ? "a business" : `${unfinished.length} businesses`} in
          progress:{" "}
          {unfinished.map((p, i) => (
            <span key={p.id}>
              {i > 0 && ", "}
              <Link to={`/studio/${p.id}`}>{p.name}</Link>
            </span>
          ))}
          .
        </div>
      )}

      <div className="choices">
        {CHOICES.map((c) => (
          <button
            key={c.route}
            type="button"
            className="card link choice"
            disabled={busy}
            onClick={() => begin(c.route)}
          >
            <h2>{c.title}</h2>
            <p className="muted" style={{ margin: 0 }}>
              {c.text}
            </p>
          </button>
        ))}
      </div>

      {picked && (
        <form
          className="card"
          style={{ marginTop: 20, maxWidth: 560 }}
          onSubmit={(e) => {
            e.preventDefault();
            begin(picked);
          }}
        >
          <label className="field">
            <span>
              {picked === "started"
                ? "What is your business called?"
                : "A name (optional; change it any time)"}
            </span>
            <input
              className="input"
              // biome-ignore lint/a11y/noAutofocus: the field the person just asked for
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Juniper Print Studio"
            />
          </label>
          <button
            className="btn btn-primary"
            type="submit"
            disabled={(picked === "started" && !name.trim()) || busy}
          >
            Start
          </button>
        </form>
      )}
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}
