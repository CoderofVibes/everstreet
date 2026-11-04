# Implement Everstreet's approved identity and first connected UI slice

**Why (Tony):** "Can you remember all of this and start to implement it please? I like everything
you just listed out" after approving Astra's complete UI replan. The no-building hold is lifted.

## Read first

docs/design/EVERSTREET_UI_DIRECTION.md is the accepted visual/interaction authority. It replaces
old dark-rail/mint-primary direction. Preserve PLATFORM_VISION's six milestones and AUTHORITY.
No new approval needed for this bounded implementation. Never inspect the separate project.

## Starting state and ownership

Claude90429 was interrupted during001e at Tony's planning hold. Its unfinished changes are in
server/src/publication.ts, web/src/api.ts, web/src/publication.ts, PublicPage/PublicProfile/Explore,
styles.css, new DigitalStorefront.tsx, publication-example.test.ts and DIGITAL_STOREFRONT.md.
Inspect actual status/diff before continuing; preserve useful example/snapshot/recovery work.
001d1 is committed a3ba11c/reportac09247. No Git resets, blanket stage or discarded work.
Check on resume stops at six noControlCharactersInRegex lint errors in the unfinished publication
sanitizer. Repair and validate the partial001e work before treating it as a complete baseline.
The stale prior hold in BUILD_STATE is explicitly superseded by Tony's latest approval.

## This job delivers

1. A short design packet before broad edits: exact tokens, type hierarchy, navigation destination
   mapping and two compositional alternatives within the approved luminous direction applied
   to Discover/Studio/Acquire. Pick the stronger system with a concrete reason. Other surfaces
   can be described in the packet; do not build the entire roadmap in one giant change.
2. Shared UI foundation: mineral/paper canvas, blue-black ink, cobalt primary, restrained warm
   accents, semantic status colors; clear body/display/mono hierarchy; consistent focus, controls,
   spacing, borders and restrained depth. Use actual contrast checks. Existing local/system fonts.
   Translucency only on navigation/floating tools with readable opaque fallback. Reduced motion.
3. Stable global navigation: Discover/Build/Operate/Acquire in an airy desktop header, compact
   contextual subnavigation where helpful; profile/inbox/My activity utilities. Mobile labelled
   equivalent. Preserve every old route, current actor/business context, signed-out entry,
   multi-role navigation, customer history, import/opportunities/handovers reachability. Update
   active-route logic meaningfully; no inaccessible hover-only or icon-only essential controls.
4. Discovery/Home/Explore and public digital storefront: purposeful typography, large usable
   product example/preview, clear audience/promise/identity/action, varied hierarchy. Finish001e's
   explicit owner-reviewed fictional input/output examples and snapshot/privacy behavior in the
   new system. Preserve legacy/mixed/coming-soon/no-example/multi-product states. No fake stats,
   artificial live demos, runtime claims or private acquisition leaks.
5. Existing studio/operations/acquisition/customer routes remain usable under the new shell.
   They inherit baseline tokens but are not declared redesigned until their separate composition
   and behavior jobs. Identify those follow-up jobs in the report; leave all milestones open.

## Acceptance

Existing publication revision identity and private/live separation, exact offer binding, examples
and canaries, access fencing, customer continuity and legacy behavior still pass. Meaningful
navigation tests for deep links/active destination/multi-role/small screen, not CSS snapshots that
mirror implementation. npm check and webbuild. A labelled isolated preview demonstrates the
new shell and first vertical slice through actual routes using fictional content; no server/main
credentials or live services. Record screenshot dimensions/states actually checked, not assumed.

Astra reviews1440/1280/390, keyboard/zoom/reduced-motion and core flow. Claude owns all local
commits, reports repaired001e separately if helpful, then this job. Stop for Astra review after
the first connected slice. Do not wait for Tony's routine design approval; do not launch extra
writers. Local commits only; no push/release/submission/spend/mainnet/liveprovider/RPC/wallet/
main wiring/signing/deploy/real data/research access or assessment/Day One.

P0/L for approved design reset. Follow-up studio/operations/acquisition work is still required.
