import { useState } from "react";
import { api } from "../api.ts";
import { useSession } from "../session.tsx";
import { Avatar } from "../ui.tsx";

export function Profile() {
  const { person, setPerson, requireSignIn } = useSession();
  const [v, setV] = useState({
    display_name: person?.display_name ?? "",
    headline: person?.headline ?? "",
    bio: person?.bio ?? "",
  });
  const [saved, setSaved] = useState(false);
  if (!person)
    return (
      <div className="page empty">
        <h2>Sign in to edit your profile</h2>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => requireSignIn("Sign in to edit your profile.")}
        >
          Sign in or join
        </button>
      </div>
    );
  return (
    <div className="page narrow">
      <div className="row" style={{ marginBottom: 24 }}>
        <Avatar name={person.display_name} large />
        <h1 className="display" style={{ fontSize: 40, margin: 0 }}>
          Your profile
        </h1>
      </div>
      <form
        className="card"
        onSubmit={async (e) => {
          e.preventDefault();
          setPerson((await api.updateMe(v)).person);
          setSaved(true);
        }}
      >
        <label className="field">
          <span>Name</span>
          <input
            className="input"
            value={v.display_name}
            onChange={(e) => {
              setV({ ...v, display_name: e.target.value });
              setSaved(false);
            }}
          />
        </label>
        <label className="field">
          <span>Headline</span>
          <small>Shown on every business you run</small>
          <input
            className="input"
            value={v.headline}
            onChange={(e) => {
              setV({ ...v, headline: e.target.value });
              setSaved(false);
            }}
          />
        </label>
        <label className="field">
          <span>About you</span>
          <textarea
            className="input"
            value={v.bio}
            onChange={(e) => {
              setV({ ...v, bio: e.target.value });
              setSaved(false);
            }}
          />
        </label>
        <div className="row">
          <button className="btn btn-primary" type="submit">
            Save
          </button>
          {saved && <span className="muted">Saved</span>}
        </div>
      </form>
    </div>
  );
}
