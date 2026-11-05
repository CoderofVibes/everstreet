// Job 003w-d first correction (Astra's CompositionFirstSliceReview): a modal dialog keeps the
// keyboard inside itself. On open, focus moves into the dialog (its first control, or the
// element marked data-autofocus) and the opener is remembered; Tab and Shift+Tab wrap at the
// dialog's edges instead of reaching the page behind it; Escape closes it; on close, focus
// returns to the opener if it is still on the page. The decisions are pure (tested without a
// browser); `useModalFocus` applies them to the real DOM.

import { type RefObject, useEffect, useRef } from "react";

export const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Where Tab should go when focus is at (or outside) the dialog's edge; null means the browser's
 * own move stays inside the dialog and nothing needs doing.
 */
export function wrapTarget<T>(
  focusables: readonly T[],
  active: T | null,
  shift: boolean,
): T | null {
  if (focusables.length === 0) return null;
  const first = focusables[0] as T;
  const last = focusables[focusables.length - 1] as T;
  const at = active === null ? -1 : focusables.indexOf(active);
  if (at === -1) return shift ? last : first; // focus escaped the dialog: bring it back
  if (shift && at === 0) return last;
  if (!shift && at === focusables.length - 1) return first;
  return null;
}

/** What a key does in the modal: close it, wrap focus, or nothing. */
export function modalKey<T>(
  key: string,
  shift: boolean,
  focusables: readonly T[],
  active: T | null,
): { kind: "close" } | { kind: "focus"; target: T } | { kind: "none" } {
  if (key === "Escape") return { kind: "close" };
  if (key !== "Tab") return { kind: "none" };
  const target = wrapTarget(focusables, active, shift);
  return target === null ? { kind: "none" } : { kind: "focus", target };
}

/** Applies the rules to a mounted dialog element: initial focus, contained Tab, Escape, return. */
export function useModalFocus(ref: RefObject<HTMLElement | null>, onClose: () => void) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const items = () => [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)];
    const initial = dialog.querySelector<HTMLElement>("[data-autofocus]") ?? items()[0];
    initial?.focus();
    const onKey = (e: KeyboardEvent) => {
      const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const r = modalKey(e.key, e.shiftKey, items(), active);
      if (r.kind === "close") {
        e.preventDefault();
        close.current();
      } else if (r.kind === "focus") {
        e.preventDefault();
        r.target.focus();
      }
    };
    // On the document, so a key pressed while focus is somewhere unexpected is still handled.
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      if (opener?.isConnected) opener.focus();
    };
  }, [ref]);
}
