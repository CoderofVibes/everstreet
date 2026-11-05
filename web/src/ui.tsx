// Shared pieces: avatar, money, the offer card (the same card in the studio, the preview, the
// public page and search), and the sign-in dialog.

import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { type Action, api, type Offer, type Person } from "./api.ts";
import { useModalFocus } from "./modal.ts";
import { useSession } from "./session.tsx";

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
}

export function Avatar({ name, large }: { name: string; large?: boolean }) {
  return (
    <span className={`avatar${large ? " lg" : ""}`} aria-hidden="true">
      {initials(name) || "?"}
    </span>
  );
}

export function money(cents: number | null) {
  if (cents === null) return null;
  const digits = cents % 100 === 0 ? 0 : 2;
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

export const FAMILY_LABEL: Record<string, string> = {
  class: "Class or workshop",
  service: "Service",
  product: "Physical product",
  software: "Software or API",
  undecided: "New business",
};

export const STAGE_LABEL: Record<string, string> = {
  shape: "Shaping",
  test: "Testing interest",
  launch: "Launched",
  grow: "Growing",
};

type OfferView = Pick<
  Offer,
  | "title"
  | "outcome"
  | "audience"
  | "deliverable"
  | "includes"
  | "price_cents"
  | "price_unit"
  | "first_free"
  | "when_text"
  | "where_text"
  | "capacity"
  | "confirmed"
> & { not_for?: string };

function Fact({ value, missing }: { value: string; missing: string }) {
  return value ? (
    <dd>{value}</dd>
  ) : (
    <dd>
      <em className="unknown">{missing}</em>
    </dd>
  );
}

/** The customer's view of an offer: why this, how much, can I use it, what happens next. */
export function OfferCard({
  offer,
  family,
  action,
  footer,
}: {
  offer: OfferView;
  family: string;
  action?: Action;
  footer?: ReactNode;
}) {
  const price = offer.first_free ? "First one free" : money(offer.price_cents);
  return (
    <article className="offer-card" aria-label="Offer">
      <div className="band">
        <div className="kind">{FAMILY_LABEL[family] ?? "Offer"}</div>
        <h3>{offer.title || <span className="muted">Your offer's title appears here</span>}</h3>
      </div>
      <div className="body">
        {offer.outcome && offer.outcome !== offer.title && <p>{offer.outcome}</p>}
        <div className="price" style={{ marginBottom: 14 }}>
          {price ?? (
            <em className="unknown" style={{ fontSize: 17, fontWeight: 500 }}>
              Price not set yet
            </em>
          )}
          {price && !offer.first_free && <small> {offer.price_unit}</small>}
        </div>
        <dl className="facts">
          <dt>For</dt>
          <Fact value={offer.audience} missing="Not said yet" />
          <dt>You get</dt>
          <Fact value={offer.deliverable} missing="Not described yet" />
          <dt>When</dt>
          <Fact value={offer.when_text} missing="Date not set" />
          <dt>Where</dt>
          <Fact value={offer.where_text} missing="Place not set" />
          {offer.capacity !== null && (
            <>
              <dt>Places</dt>
              <dd>{offer.capacity}</dd>
            </>
          )}
          <dt>Status</dt>
          <dd>
            {offer.confirmed ? (
              <span className="pill lime">Confirmed by the founder</span>
            ) : (
              <span className="pill caution">Proposed, not confirmed yet</span>
            )}
          </dd>
        </dl>
        {action && (
          <p className="muted" style={{ fontSize: 14, margin: 0 }}>
            Next step for a customer: <strong>{action.label}</strong>
          </p>
        )}
        {footer}
      </div>
    </article>
  );
}

/**
 * Job 003w-b: in verified mode a name is never an identity. Signing in proves control of a NEAR
 * account through a wallet (NEP-413); this version has no wallet connection yet (sub-job
 * 003w-e), so it says so plainly instead of offering a form that can't work.
 */
/**
 * Job 003w-d first correction (CompositionFirstSliceReview): a real modal. Focus moves inside on
 * open, Tab stays inside, Escape closes, and focus returns to the opener (web/src/modal.ts).
 */
export function Modal({
  labelledBy,
  onClose,
  children,
}: {
  labelledBy: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useModalFocus(ref, onClose);
  return (
    <div ref={ref} className="overlay" role="dialog" aria-modal="true" aria-labelledby={labelledBy}>
      {children}
    </div>
  );
}

export function VerifiedSignInNotice({ reason, onClose }: { reason: string; onClose: () => void }) {
  return (
    <Modal labelledBy="signin-title" onClose={onClose}>
      <div className="dialog">
        <h2 id="signin-title">Sign in with your NEAR account</h2>
        <p className="muted">{reason}</p>
        <p>
          Here, signing in means proving you control a NEAR testnet account with your wallet. A name
          alone isn't an account. This version doesn't connect a wallet yet, so signing in isn't
          available here.
        </p>
        <div className="row">
          <button className="btn btn-quiet" type="button" data-autofocus onClick={onClose}>
            Not now
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function SignInDialog() {
  const { signInReason, finishSignIn, localPreview, identity } = useSession();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [people, setPeople] = useState<{ id: string; display_name: string }[]>([]);
  useEffect(() => {
    if (signInReason && localPreview)
      api
        .people()
        .then((r) => setPeople(r.people))
        .catch(() => {});
  }, [signInReason, localPreview]);
  if (!signInReason) return null;
  if (identity === "verified")
    return <VerifiedSignInNotice reason={signInReason} onClose={() => finishSignIn(null)} />;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const { person } = await api.join(name);
      finishSignIn(person);
      setName("");
    } catch (err) {
      setError((err as Error).message);
    }
  };
  const actAs = async (id: string) => finishSignIn((await api.actAs(id)).person as Person);
  return (
    <Modal labelledBy="signin-title" onClose={() => finishSignIn(null)}>
      <form className="dialog" onSubmit={submit}>
        <h2 id="signin-title">Join Everstreet</h2>
        <p className="muted">{signInReason}</p>
        <label className="field">
          <span>What should we call you?</span>
          <input
            className="input"
            data-autofocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
          />
        </label>
        {error && <p className="error-text">{error}</p>}
        <div className="row">
          <button className="btn btn-primary" type="submit" disabled={!name.trim()}>
            Continue
          </button>
          <button className="btn btn-quiet" type="button" onClick={() => finishSignIn(null)}>
            Not now
          </button>
        </div>
        {localPreview && people.length > 0 && (
          <div style={{ marginTop: 24 }}>
            <p className="muted" style={{ fontSize: 14, marginBottom: 8 }}>
              Local preview: continue as someone already here
            </p>
            <div className="row">
              {people.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => actAs(p.id)}
                >
                  <Avatar name={p.display_name} /> {p.display_name}
                </button>
              ))}
            </div>
          </div>
        )}
      </form>
    </Modal>
  );
}
