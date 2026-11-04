# Verified identity must replace the preview session path

This sharpens the already-required003w identity integration. It does not change the roadmap,
claim a deployed security incident, or authorize external accounts/signing. The current app
is still a local development application.003v remains the sole active implementation job.

## Actual current behavior

Astra read the account routes in server/src/app.ts and session methods in server/src/store.ts.
`localPreview:false` disables people listing and actor switching, but POST /api/session still
creates a new person and session from a name alone. It does NOT select an existing person with
that name; do not describe this as impersonating an existing account. The cookie has a90-day
browser maxAge, while personForToken joins sessions/people without a server-side age check.

A finite independent probe used the actual everstreetApi, Store and openDb(':memory:') with
localPreview:false, no listeners, adapters, credentials or network. It created one fictional
person through the route, changed that test session's created_at to2000-01-01, then requested
/api/me with its cookie and attempted the preview actor-switch route. Result, exit0 in1.05s:

```json
{"localPreview":false,"nameOnlySignupStatus":201,"oldSessionAuthenticated":true,"actorSwitchStatus":404,"sideEffects":"in-memory only; no listener/provider/chain"}
```

The database was closed in finally. Tokens and identifiers were never printed. This proves
that disabling actor switching alone is insufficient for the configured identity path; it
does not prove any real account, chain or public deployment was accessed.

## Concrete acceptance for the003w identity sub-job

- Make verified configured identity an explicit mode/capability. Name-only creation and preview
  sessions cannot become authenticated configured identities merely because a flag changed.
  If guest drafts are supported, keep their authority explicit and require verified linking
  before account-bound operations; never merge people solely by display name or client accountId.
- Review existing sessions at the mode boundary. A cookie minted by fictional preview must not
  silently gain configured-mode authority when a durable database is reopened in another mode.
  Test that actual transition, including sign-out and authenticated reopening.
- Enforce session expiry/revocation on the server, with an explicit policy and finite lifetime.
  Browser cookie expiry alone does not enforce expiry for clients that retain/send a token.
  Use an injected clock to test boundary times and revoke/renew/logout behavior. Do not log tokens.
- Cover name-only POST, actor switch, existing preview token, expired token, valid verified
  identity and wrong/replayed challenge through actual routes. Keep account proof distinct
  from customer device use-key authorization as WalletIntegrationAlignment requires.
- Retain the approachable experience: explain sign-in, cancellation, expired sessions and
  reconnect plainly; preserve private unsent drafts without disclosing them after actor change.

No new identity implementation or tests were edited by Astra in this pass. Claude owns the
bounded implementation and local commits. The new note,003w cross-reference,INDEX and ignored
BUILD_STATE are the only Astra changes here. Existing protected-store tests were source-reviewed:
their Promise.all nonce case uses one synchronous store and does not cover the separately
reproduced cross-connection capacity race. Keep that correction pending until independently
verified. Host setup approval remains pending; no installation or download. All six milestones
remain open; research stays unread/local-only; no Git writes or other-project access.

Required check33439 passed lint/types;1176 tests passed, two new003v tests failed and one
Linux-only test was skipped (125 files). Failures were the in-progress rotation-after-restart
expectation (no k2 objects for the second request) and maintenance's kept-input expectation
(the pass also performs ordinary input retention). Claude is still implementing these tests;
this is not final acceptance or a newly diagnosed production fault. No broad repeat until the
tree is stable or a concrete correction requires it.
