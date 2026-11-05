// Relaydesk, the fictional SaaS workflow example (docs/design/WORKFLOW_ENGINE.md): its saved
// prototype, shared by the engine's unit tests and the end-to-end flow. Fictional data only.

import type { Prototype } from "../src/products.ts";

/** Relaydesk's prototype: a support request form, and the board it feeds. */
export const RELAYDESK_PROTOTYPE: Prototype = {
  schema: 1,
  screens: [
    {
      id: "request",
      kind: "form",
      title: "New support request",
      fields: [
        { key: "subject", label: "Subject", type: "text", options: [] },
        { key: "details", label: "What happened", type: "long_text", options: [] },
        { key: "urgency", label: "Urgency", type: "choice", options: ["low", "normal", "high"] },
      ],
      submit_label: "Send request",
    },
    {
      id: "desk",
      kind: "list",
      title: "Desk",
      source: "request",
      stages: ["Received", "Assigned", "Resolved"],
    },
  ],
};
