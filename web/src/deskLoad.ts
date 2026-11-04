// Job 001c: the desk's two reads (the desk and the digital desk projection), sequenced. Only the
// newest load may change state; a closed loader (the page unmounted, e.g. on an actor or business
// switch) changes nothing; losing access (401/403/404) clears both, so a former owner's figures
// never stay on screen.

import { ApiError } from "./api.ts";

export interface DeskLoadState<D, G> {
  desk: D | null;
  digital: G | null;
  error: string | null;
  digitalError: string | null;
}

const lost = (e: unknown) => e instanceof ApiError && [401, 403, 404].includes(e.status);

export function deskLoader<D, G>(
  get: { desk: () => Promise<D>; digital: () => Promise<G> },
  set: (patch: Partial<DeskLoadState<D, G>>) => void,
) {
  let seq = 0;
  let closed = false;
  const current = (n: number) => !closed && n === seq;
  return {
    load(): Promise<void> {
      const n = ++seq;
      const digital = get.digital().then(
        (d) => {
          if (current(n)) set({ digital: d, digitalError: null });
        },
        (e) => {
          if (!current(n)) return;
          set(
            lost(e)
              ? { desk: null, digital: null, digitalError: (e as Error).message }
              : { digitalError: (e as Error).message },
          );
        },
      );
      const desk = get.desk().then(
        (d) => {
          if (current(n)) set({ desk: d, error: null });
        },
        (e) => {
          if (!current(n)) return;
          set(
            lost(e)
              ? { desk: null, digital: null, error: (e as Error).message }
              : { error: (e as Error).message },
          );
        },
      );
      return Promise.all([digital, desk]).then(() => undefined);
    },
    /** Mounted again (React may re-run an effect): accepts answers to loads started from now. */
    open() {
      closed = false;
      seq++;
    },
    close() {
      closed = true;
    },
  };
}
