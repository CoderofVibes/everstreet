// Job 003w-e1 (§9.2): where a redirect-style wallet returns. The fragment's answer is accepted only
// for this browser's stored, unexpired attempt with the same state, and used once; the fragment is
// removed from history at once, and the page goes to the stored same-origin destination.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "../router.tsx";
import { useSession } from "../session.tsx";

export function SignInReturn() {
  const { completeWalletReturn } = useSession();
  const { go } = useRouter();
  const [text, setText] = useState("Checking your wallet's answer…");
  const once = useRef(false);
  useEffect(() => {
    if (once.current) return;
    once.current = true;
    const fragment = window.location.hash;
    window.history.replaceState(null, "", window.location.pathname);
    completeWalletReturn(fragment).then((out) => {
      if (out.kind === "signed_in") go(out.destination);
      else if (out.kind !== "stale")
        setText("message" in out ? out.message : "That sign-in didn't finish; start again.");
    });
  }, [completeWalletReturn, go]);
  return (
    <div className="page">
      <h1>Signing in</h1>
      <p aria-live="polite">{text}</p>
    </div>
  );
}
