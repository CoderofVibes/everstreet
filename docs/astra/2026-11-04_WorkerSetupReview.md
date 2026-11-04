# Worker setup review for002e

Astra preparation while56403 owns001j1. No host changes, downloads or package installs made.
This is an implementation review note, not a claim an engine is provisioned or a completed
permission proposal. Claude002e must finish the actual scoped setup and teardown artifacts
before requesting any genuinely required host approval. Existing WorkerHostCapabilities is
the observed machine evidence. Research library remains unread/unassessed.

## Primary-source checks

Firecracker's getting-started guide requires read/write KVM access and a guest kernel/rootfs;
its demonstration setup deliberately omits the production jailer. Do not copy its broad host
access shortcuts or mutable latest-image retrieval into Everstreet's runtime. Pin and verify
the reviewed engine/image/toolchain identities in the actual002e implementation.
[Official setup](https://github.com/firecracker-microvm/firecracker/blob/main/docs/getting-started.md)

The jailer must match its statically linked Firecracker version. Its cgroup-v2 behavior has a
specific fail-open configuration trap: without cgroup parameters, a missing parent cgroup can
let the process proceed without a cgroup. Therefore flags and exit0 cannot establish limits.
Require a verified live cgroup placement and configured limits before giving a worker input;
then prove enforcement with the finite conformance workload. A present KVM device is likewise
not proof of usable virtualization.
[Official jailer](https://github.com/firecracker-microvm/firecracker/blob/main/docs/jailer.md)

Microsoft documents .wslconfig as global across WSL2 distributions, including memory and CPU.
Do not change Tony's global WSL settings for this worker or treat a WSL cap as a per-job limit.
Keep an isolated worker policy, account for guest plus hypervisor/host overhead, and leave other
projects untouched. The existing Ubuntu was stopped after Astra's bounded probe.
[Microsoft WSL settings](https://learn.microsoft.com/en-us/windows/wsl/wsl-config)

## Concrete implementation review requirements (Astra proposals, not sourced defaults)

- Initial concurrency1. Have the actual implementation propose and measure small explicit RAM,
  CPU, walltime, writable-disk, PID, log and output limits. Include teardown on timeout and parent
  crash. Guest memory alone does not cover the whole worker's host footprint.
- A platform-owned launcher accepts a bounded request identity, never arbitrary binary paths,
  mounts, namespaces or shell arguments from a model. Any privileged setup must be narrowly
  described; no general sudo permission, world-writable KVM, root generated-code execution or
  access to the source checkout/platform DB. Review the launcher as part of the trust boundary.
- Guest/toolchain acquisition is distinct from user job execution. Reproducible recipes,
  pinned versions/digests, explicit download provenance and cache bounds belong in setup.
  No dependency network during jobs; initially support a deliberately small browser app.
- Output remains adversarial: parse bounded bytes, validate names/counts/types/digests, do not
  mount an untrusted filesystem with broad privileges or trust guest success claims as host
  isolation evidence. No worker-created path may select a host output destination.
- Prefer a guest with no network device for this first path; constrain any host/guest channel
  to the job protocol, with no host service proxy. Validate actual failed network attempts.
- Preview code runs separately from the platform origin. Explicitly handle attempts to escape,
  spoof messages, navigate, fetch, open windows and consume browser resources. A sandboxed
  iframe is not a CPU/RAM quota; backend microVM limits do not bound browser JavaScript.

Keep002e open until actual-engine and browser evidence supports it. Implement the substantial
bundle/build/worker/UI path while setup is prepared; do not wait idly on a hypothetical approval
or replace the requested working product with another schema-only demonstration.

Files changed this pass: this note and INDEX; ignored BUILD_STATE updated separately. No new
job: feed this into002e after001j1. All six milestone gates and live NEAR/customer journey remain.
