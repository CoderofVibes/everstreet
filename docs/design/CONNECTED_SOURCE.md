# Connected source inspection (004b, M4)

November 5, 2026, Claude, under Tony's direct build mandate. Builds on 004a's private import
workspace. **No live connection exists:** only the labelled fictional fixture has been used. Live
GitHub verification stays pending until a separately authorized connection is configured.

## What the founder sees and does

The **Connected source** card sits in the import workspace's Overview. In order:
1. The founder chooses a configured connection and one of its allowed repositories, then
   connects.
2. They name a branch, tag or commit and read it.
3. The card shows:
   - the repository and the pinned commit (with the ref it came from);
   - whether package.json was read, with its size (its text isn't kept);
   - the deployment records, each labelled as a claim;
   - what was never read;
   - the read's calls, bytes and time.
4. "Read again" makes a new immutable inspection and report, and a comparison shows the commit
   change and the dependencies added, removed or changed.
5. Disconnect stops future reads. Earlier reports keep their provenance.

Without a configured connection the card says so; manual package.json inspection still works.

## Rules (and where they are enforced)

- **Read only, bounded** (`server/src/sourceConnect.ts`, GitHub REST 2022-11-28, GET only).
  - What is read: the repository, the commit a ref names, package.json at THAT commit, and up to
    5 deployments with 5 statuses each.
  - Limits: 12 calls, 256 KB per call, 512 KB total, an 8 s call and 20 s total deadline, and a
    64 KB manifest.
  - Redirects are refused (credentials are never forwarded). Payload URLs are dropped. Nothing is
    cloned, installed or run.
- **Honest outcomes.** Each of these is distinct:
  - not found or not accessible (private existence isn't revealed);
  - refused;
  - rate limited (retryable);
  - timed out (retryable);
  - invalid;
  - too large;
  - budget exhausted (retryable);
  - unavailable.

  Retryable failures record nothing. A missing, oversized or non-file package.json is recorded as
  "not read": its dependencies are unknown (`dependency_count: null`), never "none".
- **Pinned commit.** The ref resolves once; every later read names the SHA, so a push during the
  read can't mix commits.
- **Scope before reads.** A repository outside the connection's list is refused before any
  request.
- **Authority.** A connection row records who connected it and under which owner generation. Only
  that person, under that generation, can read through it.
  - After a sale, the buyer sees the moved reports but gets `connection_not_yours` and must
    connect their own. Nothing is read with the seller's connection.
  - The owner is fenced before and after the read (`stillControls`): a sale during a read stores
    and shows nothing.
- **Kinds of evidence in the report.**
  - `observed`: read through a connection. Read access isn't ownership, so source_ownership stays
    "detected".
  - `claimed`: a deployment record. "A claim by an integration, not proof it runs now"; hosting is
    never "verified" by it.
  - The headline stays "Not ready to transfer".
- **Credentials.** A repository-scoped connection names an environment variable
  (`credential_env`); the token is never stored, shown or exported. Config: `source.github`
  (origin fixed to `https://api.github.com`, 1 to 8 connections, explicit repositories).
- **Preview.** The preview server and `npm run app` use the fictional fixture connection,
  labelled "Fictional GitHub fixture" everywhere.

## Evidence

- `server/test/source-connect.test.ts` (7): pinning, a moving ref, scope before any request,
  missing and oversized manifests, 404/401/403/429/302/timeout, another commit's deployment, the
  call budget, malformed names and origins.
- `server/test/imports-source.test.ts` (6), through the real routes:
  - connect, read, recheck with comparison, disconnect and reconnect;
  - scope;
  - an owner change during the read;
  - the buyer refused the seller's connection, then connecting their own;
  - rate limit and missing manifest;
  - unconfigured.
- Real browser (built-in, scratch preview on 8811, fictional fixture): connect → read main →
  read v1.2.0 → comparison table at 1280; no overflow at 390.

## Not done (retained)

- A live GitHub connection: needs Tony's authorization and a configured read-only token.
- Runtime, hosting, payment and domain account connectors.
- Ownership/IP verification.
- A 1440 pass and keyboard-only traversal of the card.
