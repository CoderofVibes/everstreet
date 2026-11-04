# Connect an existing product's source and deployment evidence

P1/L, next M4 vertical slice after the approved UI rollout and its concrete corrections. Do not
start until Astra dispatches. This advances the existing-product path beyond supplied manifests;
it does not replace the remaining runtime/payment connectors or claim full M4 completion.

## Founder experience

Inside an existing private import workspace, choose Connect source, select the configured GitHub
connection and a permitted repository/ref, then inspect. Show what will be read and its limits.
Resolve the selected ref to an immutable commit before reading the selected manifest. Present
source identity/commit/path, detected dependencies, observations from deployment records, when
read, what could not be checked, and specific remaining transfer work. Recheck creates a new
immutable report with a readable comparison; prior reports remain available as historical evidence.
Supply a working route/UI/service/adapter flow, not a mock connector button or another paste box.

Use a real read-only HTTP adapter with an injected transport for finite deterministic tests.
Public repositories can use a public connection; private reads require an explicitly configured
repository-scoped credential resolver. No raw token input/storage in browser, project records,
work log or exports. Missing connection must explain how it is unavailable, never silently use
Tony's developer login. Build configured authentication seams, not new OAuth/app registration or
permission grants on Tony's account. A fictional adapter fixture demonstrates the same real routes.

## Evidence and boundaries

GitHub contents reads can target a ref and use Contents read permission. Deployments/statuses
are records published by integrations: a reported success is not independent proof the service
currently runs, that the selected commit is live, or that the founder owns transferable IP.
Official sources checked by Astra November4:
- https://docs.github.com/en/rest/repos/contents
- https://docs.github.com/en/rest/deployments/deployments
- https://docs.github.com/en/rest/deployments/statuses
Consult current primary docs while implementing; record API version/permission assumptions.

Read only validated GitHub API resource paths, an allowlisted manifest (package.json initially),
repository/commit metadata and bounded deployment/status records. Never clone/install/execute,
fetch README instructions, arbitrary files, URLs from payloads, logs, environment URLs, symlink
targets or submodules. No local filesystem connector or recursive repository scanner in this job.
Keep scripts/source bodies/credentials out of reports; use the existing manifest metadata parser.
Record omitted/truncated/unread evidence honestly, not 'no dependencies' or 'no deployment'.

Use configured HTTPS origin, explicit GET-only endpoints, escaped owner/repo/path/ref, no redirect
credential forwarding, no arbitrary base URL. Bound bytes, pages, calls and total elapsed time
independently. Settle rate limits/timeouts as retryable states without automatic retry storms.
An authenticated not-found remains 'not found or not accessible'; don't expose private existence.

Connection authorization belongs to its authorized actor/context; a business sale does not pass
that credential to the buyer. Historical business reports move with the business, but live refresh
requires the new owner's valid connection. Fence actor/owner epoch both before and after awaits,
clear pending private UI on loss, and never let a stale refresh attach evidence after transfer.
Disconnect stops future reads without falsely erasing historical report provenance. User statements,
manifest detections, source observations and deployment claims stay distinct and source-labelled.

## Acceptance

- Actual full flow through injected fixture: connect permitted repo, pin commit, inspect manifest
  plus deployment evidence, save immutable report, reopen/recheck/diff, disconnect/reconnect.
- Repository outside connection scope is refused before any fetch. Owner change during read cannot
  persist or reveal private results; buyer cannot refresh using seller credentials. Public listings,
  search, buyer rooms and exports do not gain private source evidence without existing scoped grants.
- Changed ref during read cannot mix commits; oversized/invalid manifest, permission denial, timeout,
  rate limit, missing/truncated metadata and unrelated deployment SHA give truthful partial/failure
  reports. A deployment success never sets overall transfer-ready. No outbound mutation endpoint.
-1440/390 browser keyboard/recovery/draft checks with explicit fictional source label. Avoid losing
  the current import product/dependency drafts when connection/recheck state changes.
- npm check/webbuild, finite meaningful tests and local commit/report. If a separately authorized
  live connection is absent, state live connector verification pending; do not claim live evidence.
  Stop for Astra review. Runtime/hosting account/payment connectors and real transfer remain next.

No push, publishing, remote repository writes, app registration, new grants, deployments, signing,
new spending, real customer data, research-library access or Day One. No reading this workspace's
private research/credentials as an import sample. No arbitrary code execution. Keep all six goals.
