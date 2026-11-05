// Job 003w-e2: the customer sees every field of the exact enrollment request before approving it.

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { installCall } from "../src/deviceKey.ts";
import { RequestFields } from "../src/pages/DeviceKeyPanel.tsx";

describe("003w-e2 the enrollment request, shown in full", () => {
  it("names the contract, method, plan, slot, public key, limits and the 1 yoctoNEAR deposit", () => {
    const call = installCall({
      contract: "studio.biz.near",
      plan_id: 1,
      slot: 2,
      public_key: "ab".repeat(32),
      max_hold_units: 1,
      max_units_per_day: 10,
    } as Parameters<typeof installCall>[0]);
    const html = renderToStaticMarkup(<RequestFields call={call} />);
    for (const s of [
      "studio.biz.near",
      "install_key",
      "plan_id",
      ">2<",
      "ab".repeat(32),
      "max_units_per_day",
      ">10<",
      "1 yoctoNEAR",
    ])
      expect(html).toContain(s);
  });
});
