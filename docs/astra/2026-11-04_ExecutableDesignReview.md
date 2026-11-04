#002e design review before engine/preview acceptance

Review of Claude design9360d8c EXECUTABLE_PRODUCTS.md while33221 was live implementing the
bundle validator. Architecture direction is retained: actual generated files, separate checks,
immutable versions and isolated engine. These corrections affect implementation, not roadmap.

## Proven browser incompatibility

Astra ran a finite own-code loopback header canary (40944,120seconds,50requests), not an app
worker or model-generated artifact. Actual browser tab47: opaque sandbox allow-scripts iframe,
index.html imports relative app.js as a module, exact proposed CSP/prefix, CORP same-origin and
no CORS response -> visible Module did not load. Same simple module with CORP cross-origin and
Access-Control-Allow-Origin:* -> Module loaded. Both stayed opaque/sandboxed; no allow-same-origin.
Screenshot preview-header-canary-2026-11-04.jpg. Browser log tool returned no entries; the visible
comparison is the evidence. Both headers changed together, so this does not isolate their
individual contribution. Server stopped and tab closed; no secrets/data/external requests.

Correct actual preview headers/resource strategy and prove module/CSS loading in the real
route, without weakening sandbox or giving preview platform credentials. Cross-origin public
capability resources need narrowly scoped token authority, lifetime and owner-epoch checks.
Do not claim that returning an HTML string proves usable preview behavior.

## Required design corrections / evidence

1. Host pids.max bounds host processes/threads in the Firecracker cgroup, not guest-kernel
   processes. A guest fork bomb is not stopped at hostpids64 merely by that setting. Specify
   guest process limits/identity/resource enforcement and finite actual verification separately.
   Similarly, host fsize doesn't bound files written inside guesttmpfs. Size the tmpfs explicitly.
   Kernel cgroup docs define membership in that kernel's process hierarchy; this distinction is
   an architectural inference, not a host measurement performed here.
   https://docs.kernel.org/admin-guide/cgroup-v2.html
2. Guest init/test recipe must not give imported untrusted JavaScript the trusted harness's
   privileges or writable raw output drive. Describe how the supervisor, completion state,
   checks and output report are protected from that code. A VM protects the host but does not
   by itself protect the guest's root reporter from another root process. Case results/engine
   identity cannot be accepted solely because untrusted code can print the expected envelope.
3. Loading every browser.js as an ES module in Node will reject ordinary top-level DOM code.
   Separate syntax/module integrity from browser behavior. Use a real appropriate isolated
   browser harness or a clear supported entry/module contract; do not label Node-import success
   a browser journey check. The first supported app must actually do its advertised UI behavior.
4. Sandbox/CSP is not a browser CPU/RAM limit. Stop removes an iframe only if the parent can
   run. Remove the unproven promise Studio stays usable under arbitrary preview loops; handle
   unsupported runtime behavior honestly and provide actual resource-bound isolation for it
   where required. Never test an uncontrolled infinite loop on Tony's browser/host. Default to
   the checked version for ordinary Preview; an unchecked state must not quietly become the
   main product path just because the real engine is not provisioned. Passing declared cases
   is not a proof arbitrary JavaScript cannot later abuse resources.
5. Sandbox blocks top navigation and forms as configured; it does not automatically prohibit
   self-navigation inside the frame. Do not claim all outbound navigation is blocked from those
   flags alone. Validate the supported app's navigation/network restrictions in the real browser.
   MDN documents opaque origin and sandbox scope:
   https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe
   https://developer.mozilla.org/en-US/docs/Web/Security/Practical_implementation_guides/CORP
6. Guest kernel/rootfs exact pins and Node patch version are not yet specified. A lock generated
   after downloading mutable latest files isn't a pre-reviewed provenance pin. Produce actual
   scoped setup artifacts and exact identities before a host approval; no install is authorized
   by this note. Ensure prerequisites include every used command (ACL/sudo/visudo/etc.), and
   rollback removes only resources actually created by this setup, not pre-existing packages.

Keep the substantive002e implementation moving. Fix design and concrete implementation before
calling adapter/preview done. Do not substitute mock passed worker, host eval, schema prototype,
or justinterfaces. Allsix and real-engine/live gates remain. No broad project scope reduction.

Files this pass: this review, INDEX, screenshot; ignored checkpoint separately. Prior goal pass
was progress (1102-test acceptance and actual Studio focus evidence). This pass adds actual
header incompatibility evidence that changes002e implementation. No research assessment.
