# Executable bundle input review

Claude session67893 remains the sole active002e writer. This is a review of the unfinished
tree, not rejection of a completed implementation. No builder interruption or app edit.

## Exact input preservation

A finite keyless probe imported only validateBundle and the static QUOTE_BUNDLE fixture;
it did not execute generated JavaScript or start a browser/worker. It passed two serialized
JSON bundles differing only in the first check's input own property:

```json
{"__proto__":{"marker":"retained"},"copies":100}
```

The other input omitted `__proto__`. Both were accepted and produced the same digest.
The rebuilt first input had only `copies` as an own key, inherited marker `retained`, and
its canonical representation omitted `__proto__`. Source: appBundle.ts jsonValue builds
objects using ordinary `{}` plus property assignment. canonicalJson enumerates own keys.

Before accepting002e, preserve JSON own keys safely (or explicitly reject unsupported keys
with an actionable validator error). Add a regression through the public validator taking
serialized JSON, including nested input/expected values and canonical round trip. Distinct
accepted JSON data must not silently collapse. This probe does not demonstrate global
Object.prototype pollution, arbitrary code execution, or a live customer exploit.

## Keep the example digital

The unfinished app-fixtures.ts uses Brightleaf Print and a print-shop quote calculator.
Tony's explicit direction is AI tools, SaaS, APIs, agents, websites and online services.
Use a fictional digital-service or API-plan estimator for the working app example, preserving
its real interactive calculations and change/version tests. Label sample rates fictional.
No new pricing integration or scope expansion is needed. Recheck final fixtures/UI before
requesting a correction; Claude is still editing.

## Guest case independence: source observation to verify

Later in the same active job, supervisor.mjs writes bundle files0444 but then chowns the
containing `/work/app` directory to the untrusted uid1000. All cases reuse that tree. A
read-only file mode alone does not stop its directory owner replacing the directory entry;
the comment that each process can affect only its own case therefore needs enforcement at
the directory boundary too. Keep the bundle tree root-owned and immutable to the app uid,
with a distinct bounded scratch directory if needed, or reconstruct an independently
protected tree per case. Include attempted sibling-module replacement in real conformance.

This is unfinished-source review, not an executed guest exploit: no VM is installed and no
generated module was run on the host. Recheck the finished permissions and launcher before
claiming a failure. Also verify guest init failures in mounts/device ownership and cgroup
cleanup fail closed; the first draft uses `set -u` and ignores cgroup.kill errors. A passing
host mock cannot establish these guest properties.

## Checkpoint

Files added/changed by Astra: this pass, INDEX.md and BUILD_STATE.md. No app/contract/script/
config/Git changes, engine setup, signing, spending, deployment or research access. Required
check result recorded in BUILD_STATE when complete. Main design corrections already delivered
to Claude remain in ExecutableDesignReview; the header canary is complete and cleaned up.
Do not interrupt/relaunch the writer merely to deliver these additional review observations.
Full002e engine/preview proof and all six milestone gates remain open.
