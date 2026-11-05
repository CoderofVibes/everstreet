// Job 003w-e2: the customer sees every field of the exact enrollment request before approving it.

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { installCall, revokeCall } from "../src/deviceKey.ts";
import { REVOKE_CONSEQUENCE, RequestFields } from "../src/pages/DeviceKeyPanel.tsx";

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
    const html = renderToStaticMarkup(<RequestFields call={call} account="cara.testnet" />);
    for (const s of [
      "studio.biz.near",
      "install_key",
      "plan_id",
      ">2<",
      "ab".repeat(32),
      "max_units_per_day",
      ">10<",
      "1 yoctoNEAR",
      "cara.testnet",
      "up to 30 Tgas",
      "Enrolls this device&#x27;s key in slot 2",
    ])
      expect(html).toContain(s);
  });

  it("revocation names the acting account, slot, deposit and gas, and says what stops and what still settles", () => {
    const html = renderToStaticMarkup(
      <RequestFields call={revokeCall("studio.biz.near", 1, 3)} account="cara.testnet" />,
    );
    for (const s of [
      "cara.testnet",
      "studio.biz.near",
      "Revokes the key in slot 3",
      "1 yoctoNEAR",
      "up to 30 Tgas",
      "revoke_key",
    ])
      expect(html).toContain(s);
    expect(REVOKE_CONSEQUENCE).toMatch(/stops serving now/);
    expect(REVOKE_CONSEQUENCE).toMatch(/already signed can still be settled/);
  });
});
