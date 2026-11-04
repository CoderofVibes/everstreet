// Job 003u1: one private read for a page, sequenced. Only the newest load may change state; a
// closed loader (the page unmounted on an actor or business switch) changes nothing; success
// clears any earlier error; losing access (401/403/404) drops the data at once; any other failure
// keeps what was confirmed and can be retried.

export interface LoadState<T> {
  data: T | null;
  error: string | null;
  /** refused: access is gone (data dropped); failed: couldn't check now (retry). */
  status: "loading" | "ready" | "refused" | "failed";
}

export const initialLoad = <T>(): LoadState<T> => ({ data: null, error: null, status: "loading" });

/** Any API error with an HTTP status (api.ts and api5.ts each have their own ApiError class). */
const lost = (e: unknown) => {
  const status = (e as { status?: unknown } | null)?.status;
  return typeof status === "number" && [401, 403, 404].includes(status);
};

export function latestLoader<T>(
  get: () => Promise<T>,
  set: (patch: Partial<LoadState<T>>) => void,
) {
  let seq = 0;
  let closed = false;
  const current = (n: number) => !closed && n === seq;
  return {
    load(): Promise<void> {
      const n = ++seq;
      return get().then(
        (data) => {
          if (current(n)) set({ data, error: null, status: "ready" });
        },
        (e) => {
          if (!current(n)) return;
          const message = (e as Error).message;
          set(
            lost(e)
              ? { data: null, error: message, status: "refused" }
              : { error: message, status: "failed" },
          );
        },
      );
    },
    /** Mounted again (React may re-run an effect): answers to earlier loads are dropped. */
    open() {
      closed = false;
      seq++;
    },
    close() {
      closed = true;
    },
  };
}
