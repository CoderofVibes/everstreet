# M2: generated application bundle, isolated checks and preview

P0/L, explicit dispatch after001i/001j composition and before further broad product expansion.
This is the next substantive M2 path; keep004b,005c and every other milestone. Do not start while
another writer is active. Split into bounded reviewable commits; do not call M2 complete from an
adapter or fake worker. Read002 parent, BUILD_RUNTIME, MANAGED_RUNTIME, PLATFORM_VISION and UI
direction first. Preserve the working extraction product and its customer/NEAR continuity.

## Product result

A founder describes a small digital web application, gets a versioned generated file bundle,
sees actual checks run in an isolated worker, and uses its preview in Studio. They can request a
change, inspect the difference, restore a prior checked version and recover an interrupted build.
Start with one genuine executable web application (for example a fictional quote calculator or
document-result web client). Label its supported browser behavior and absent backend honestly.
This opens the executable-product path; it does not make every SaaS/agent/service type complete.

Preserve conversation, budget/cancel/retry, versions and readable progress. Distinguish code
generated, deterministic checks passed, preview running, model evaluations passed and released.
A generated bundle or successful compiler output alone must never claim a usable product.

## Grounded gap

artifacts.ts accepts extraction_spec/1 only,64KiB, and build.ts advertises that or
product_proposal/1. BUILD_RUNTIME sections8/9 remain design-only. Current managed model extraction
is real implemented orchestration over injected/live-configured providers, but it executes no
generated JavaScript or package. Do not rebrand it as executable-code isolation.

## Design and implementation

1. Document the artifact/worker/preview trust boundaries and one concrete execution engine before
   coding. Astra's preferred candidate is a dedicated Linux microVM worker using Firecracker and
   its jailer, subject to a real capability check. Existing WSL alone is not a security boundary.
   Never fall back to Node eval/vm, a host shell, unrestricted child process, or plain Docker.
   Use existing supported capacity when available; no new paid service, billing change or weakened
   host protections. Keep privileged host provisioning explicit and separate from app changes;
   if a host decision is required, finish a concrete setup proposal and independent code first.
2. Add a separately versioned bounded file-bundle format, immutable digest/provenance and a fixed
   platform-owned check recipe. The model chooses files within permitted paths, never commands,
   host mounts, network settings, credentials or runner identity. Reject traversal, absolute paths,
   duplicate/case-colliding names, links, device paths, decompression/size explosions and ambiguous
   encodings. Prefer an explicit bounded file list over archive extraction. Preserve existing
   extraction artifacts/revisions and all current request fingerprints and ownership checks.
3. Extend the provider/build contract deliberately: capture expected artifact kind in the request
   identity, validate returned kind, store generation and execution records separately. A paid
   provider attempt must not rerun because a deterministic check needs retry. No default API spend.
4. Implement one actual worker adapter, not only its interface: fixed binary/image identities,
   verified capability preflight, request binding to business/project/revision/digest/attempt/owner
   epoch, bounded files/events/output, cancel/deadline/cleanup, and restart outcome reconciliation.
   No platform DB, source checkout, cloud metadata, credentials, daemon socket, host paths or network
   are mounted into a job. No package install scripts or arbitrary dependency downloads on host.
   Use a pinned reviewed toolchain/base; any dependency support is explicit and isolated.
5. Bound CPU, memory, processes, writable disk, execution time and total concurrency. One local
   worker initially. Limits must be enforced by the chosen engine/host and verified; command flags
   or a mock's reported limit are insufficient. Record per-job peak use where supported. Clean up
   the job and children on success/failure/cancel/crash; no leaked worker eating Tony's RAM.
6. Copy output out through a validated allowlist and rehash it. Use a distinct preview serving
   boundary with opaque-origin sandbox/CSP and a narrow validated message protocol. No platform
   cookies/credentials, parent DOM, arbitrary navigation/popups/downloads, or network access.
   Specify browser-script resource risks separately; backend worker bounds do not automatically
   limit an iframe. Reject unsupported preview behavior rather than hiding that limitation.
7. Integrate the supported path into Studio with honest capability/readiness states. Preview must
   actually do the artifact's advertised behavior. Preserve drafts/version history and transfer
   identity; deny the former owner's reads/edits and late outputs after ownership changes. Existing
   running customer releases are not silently replaced by a new build or a worker failure.

## Evidence required

- Meaningful protocol/validator/lifecycle tests with deterministic worker doubles, labelled as
  doubles. Prove cross-project/epoch/digest mismatch, stale/duplicate results, partial output,
  cancellation and restart recovery. No fake passed isolation check when engine is absent.
- A finite real-engine conformance suite, when an authorized capable host exists: a benign app
  builds/runs; synthetic canary host file and another job's files remain inaccessible; attempted
  network/metadata connections fail; memory/process/output/time abuse is stopped within limits;
  cancelled/orphaned work is cleaned up; host stays responsive. Never use real secrets as canaries.
- Browser review of working app, edit/rebuild/version restore, refresh/recovery, unavailable engine,
  failed check and ownership change. Test preview messaging and boundary with fictional inputs.
- Full check/web build and exact local commits/report. Record engine/image/policy identity and
  evidence sources. Without actual engine evidence, report implementation and unverified execution
  separately and leave this job/M2 in review. No equivalence claim from pure tests.

## Known environment and references

November4 read-only inventory: Ubuntu is installed but no WSL distributions were running. Earlier
PowerShell PATH inventory found neither docker nor podman. No Linux tools, KVM capability or
dedicated runner were verified. Astra intentionally did not start WSL or inspect unrelated files.

Firecracker requires usable /dev/kvm and guest kernel/rootfs; production use is designed around
its jailer. This is a proposed engine, not a claim it is installed or safe merely by name.
[Official setup](https://github.com/firecracker-microvm/firecracker/blob/main/docs/getting-started.md),
[jailer](https://github.com/firecracker-microvm/firecracker/blob/main/docs/jailer.md).
gVisor is an alternative application-kernel approach, not the same VM boundary; its convenience
runsc do exposes the host filesystem read-only by default, so do not use that shortcut here.
[Official security introduction](https://gvisor.dev/docs/architecture_guide/intro/).

Exact Opus5.5/high subscription; no API calls without explicit budget, no signing/deployment,
new spending, push/public release/submission/real data/Day One. Research library remains unread,
ignored and unstaged. Scope searches to named allowed files/directories. Stop for Astra review.
