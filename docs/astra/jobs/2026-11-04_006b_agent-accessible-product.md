# An Everstreet product that an external agent can use

P1/L, M6 extension after native customer and acquisition continuity are accepted. Tony approved
in chat: "I like your assessment - make it so". Queued, explicit dispatch only.

## Experience

A founder can expose one supported released service to an authenticated machine client. The
client discovers its purpose, input/output shape, price and availability, consumes an explicitly
authorized use, and receives its result and receipt. Human and machine use share the same product,
customer entitlement and business identity. Acquisition preserves legitimate customer access.

## Implementation and acceptance

- Start with the existing managed document-to-data product. Add a bounded capability description
  and an authenticated API path using existing admission, authorization, settlement, retention
  and recovery. Add an MCP interface over that same path; do not call an ordinary HTTP endpoint
  MCP without implementing and testing its supported protocol. Verify current primary protocol
  documentation and pinned-library support during design, before choosing a version/transport.
- Separate discovery from authorized execution. The customer grants limited explicit authority;
  an agent cannot acquire owner control or silently increase spending, limits or retention.
  No arbitrary upstream proxy, server customer wallet or broad reusable secret in public metadata.
- Durable request identity survives client retry, lost response and restart without duplicate
  execution/charge. Revocation, expiry, wrong customer/business/version and malformed requests
  fail before dispatch where appropriate; already-authorized settlements retain their guarantees.
- An independent synthetic client performs discovery, authorization, use, result and retry through
  actual configured routes. Customer access survives a synthetic business sale; old administrative
  authority ends. Add protocol conformance and version-rejection checks, not only internal calls.
- Founder UI explains enablement, limits and actual readiness; an unavailable integration stays
  unavailable. Test desktop/phone/keyboard configuration and errors. API/MCP identity and receipt
  claims match the existing product's actual capabilities.
- Required checks/build, bounded fixture cleanup, local commits/report. Real hosted clients,
  credentials, inference and public endpoints require their separate external gates.

Keep006a web-app lifecycle,006c rehearsals and remaining M6 families/team ownership. Cross-chain
payments are not required for this native entitlement interface. No new spend/deploy/publication,
real customer data, Day One or research-library access. Exact Claude Opus5.5/high, one writer.
