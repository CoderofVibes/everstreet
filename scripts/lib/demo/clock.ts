// Step 7 (docs/design/DEMO_ACCOUNT.md §2): the demo process's simulated clock. `Date` (Date.now and
// `new Date()`) answers simulated time, so every record a flow writes carries the simulated day it
// happened on; setTimeout and performance timers stay real. Installed in the demo process only
// (never the application or the tests); `realTime()` lets the clock run on from the real present.

const Real = Date;
let offset = 0;

class SimulatedDate extends Real {
  // biome-ignore lint/suspicious/noExplicitAny: Date's constructor overloads
  constructor(...args: any[]) {
    if (args.length === 0) super(Real.now() + offset);
    // biome-ignore lint/suspicious/noExplicitAny: Date's constructor overloads
    else super(...(args as [any]));
  }
  static override now() {
    return Real.now() + offset;
  }
}

export const simulatedClock = {
  install() {
    globalThis.Date = SimulatedDate as unknown as DateConstructor;
  },
  /** Where the simulation starts (once, before anything is written); then it only moves on. */
  begin(ms: number) {
    offset = ms - Real.now();
  },
  /** Sets the simulated "now" (never earlier than it already is: time doesn't run backwards). */
  set(ms: number) {
    const next = ms - Real.now();
    if (next > offset) offset = next;
  },
  advance(ms: number) {
    if (ms > 0) offset += ms;
  },
  /** From here on the clock runs in real time (the simulation has reached the present). */
  realTime() {
    offset = Math.max(0, offset);
    if (offset > 0) throw new Error("the simulated clock ran past the real present");
  },
  now: () => Real.now() + offset,
  realNow: () => Real.now(),
};
