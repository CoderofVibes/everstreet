# Everything in Everstreet

The full feature list, moved out of the README so its opening stays short. Everything below
exists in the code; some of it runs only in the legacy local preview (classes, bookings and the
v2 payment and deal flows), not in `npm run demo`.

## Other ways to start it

- **Legacy local preview:** double-click **`Start Everstreet.cmd`**, or run `npm run app`, then
  open http://localhost:8800. It fills in four fictional example businesses and looks for local
  NEAR testnet keys for its booking and payment demos.
- **Composed entry** (`docs/design/APPLICATION_COMPOSITION.md`):
  `npm run entry -- --config <absolute path>` with a config like `config/everstreet.example.json`.
  It reads one explicit config, refuses mainnet, never searches for keys and lists what is
  unavailable at `/api/system/capabilities`. Offline browser review: `npm run web:build`, then
  `npx tsx scripts/preview-entry.ts configured` → http://127.0.0.1:8870.

## What you can do

- **Build a digital product** in the product studio (`/build`): describe an idea, choose an AI
  API, SaaS workflow, agent service or client portal, and shape a brief (audience, problem,
  promised result, features, pricing assumption) and a clickable prototype of its screens.
  Every save is an immutable revision you can compare and restore; the project belongs to a
  business and moves with it if the business is sold. AI generation is not connected yet and
  the studio says so: the prototype runs no model and stores nothing. Design for the build
  runtime: `docs/design/BUILD_RUNTIME.md`.
- **Start a business** three ways: with an idea, with help finding one (four questions → three
  small directions), or from something you already sell.
- **Shape the offer** in a six-question interview while the customer's view of your offer fills in
  beside you; anything still undecided is listed and shown to customers as undecided.
- **Make it yours**, **preview** exactly what a visitor sees, then **publish** after a plain review of
  what publishing does. Drafts stay private until then.
- **Find a solution**: search everything published, with the words each result matched. Nobody
  pays to rank higher.
- **Respond as a visitor** ("Tell me when it opens", or ask to book / order / get access once the
  founder confirms the details). Contact details are shared only if the visitor ticks the box.
- **Run it from your desk**: responses arrive as tasks, replies go back to the visitor's inbox, and
  the first-week plan ticks itself off as you fill in what was missing.
- **Take real bookings** (classes): the founder opens dated sessions; places, the waitlist and
  automatic moving-up live in **OpenSeat**, the booking service, which runs beside Everstreet with
  its own database. Its waitlist worker acts only when OpenSeat's contract on **NEAR testnet**
  says it is authorized, and the customer's booking shows who moved them up and under which
  authority generation.
- **My activity**: a customer's bookings (live status, calendar file, cancel), the requests they
  posted and founders' replies, messages, and updates from businesses they follow.
- **Explore**: Starting now, Open for customers, What people need, Following.
- **Need board**: when search can't find it, post the request (anonymously, with an expiry);
  founders whose offer fits see it on their desk and reply.
- **Search with constraints**: "class under $40, online" becomes removable chips; hard limits
  filter first, each result says why it is there, and an empty result says which limit ruled
  things out with a one-click relax and a way back.
- **Be seen**: founder profiles, updates for followers, a share kit with a trackable link, and
  "how people found you" (own link, Everstreet, a request, unknown). Pages can be reported.
- **Take real payments on NEAR testnet**: the founder turns payments on and chooses the promises
  the business keeps (refund window, reserve). That creates the business's own testnet account
  running the v2 contract from shared code by hash, born with no keys, owned by the founder's
  own account. Customers "Pay $35 and book" from their own testnet account in test dollars
  (tUSD, no value). The contract holds customer money until the founder marks the order
  delivered, refunds a cancellation inside the window by itself, and never lets the owner
  withdraw customer money or the reserve. The founder's **Money** panel is read from the
  contract: customers' money, earned, withdrawable, this month's books, each order with its
  transaction links, and withdrawals. A dropped connection is reconciled from the chain
  (an order id is paid at most once).
- **Books**: month by month, revenue (what was delivered, not what was paid in advance), direct
  costs, overhead and profit. Revenue since payments went on is read from the business's
  contract and labelled "Verified on NEAR · testnet"; costs are what the founder enters (once or
  every month); the examples' earlier months are labelled "Seeded history · fictional".
- **Value**: what the business could be worth, as an explainable scenario model (`scenario-v1`):
  operating profit minus the work a successor would have to do or pay for, annualized, times
  illustrative multiples. The full calculation, every input with its source, what the estimate
  doesn't know yet, exactly what changed since last time, every past version, and private
  "Try a change" what-ifs. It is an estimate, not an appraisal, an offer or advice.
- **Share my numbers** (off by default): last month's revenue, costs and profit, and the estimate
  with its labels, on the public page.
- **Hand off a task**: a founder appoints someone to answer customers and mark orders delivered.
  They are appointed on the business's contract with their own account and never get the
  founder's key; they work from "Businesses you help". Revoke, and the contract refuses them.
- **Buying profiles**: an owner-operator, a business buying a business, a small investment firm,
  or a customer cooperative sets up a buying profile under their own account, says how they'd
  own it, and adds teammates with research, evidence or approve roles.
- **Sell on your terms**: a founder chooses closed, private introductions (invited teams only),
  an anonymous teaser (coarse bands, no name) or a named acquisition profile, sets an optional
  asking price, and picks which numbers buyers see. Customers never see any of it, and sharing
  numbers on the public page does not list a business.
- **Search acquisitions**: a written brief fills the same visible filters (kind, remote, asking
  price, estimate range that overlaps or fits within yours, months of history, owner hours,
  verified on NEAR). Each result says why it matches and what is unknown; businesses without an
  estimate are set aside only by the estimate filter, which says how many and lets you include
  them. Asking price and estimate are always separate. Shortlist and compare up to three.
- **Evidence rooms**: a buyer asks for specific evidence, for a purpose and a number of days;
  the founder sees the team and grants, narrows or declines. The room shows only what was
  granted: monthly books with sources, the estimate with a button to reproduce it from the rows,
  the team's own private assumptions, customer activity in aggregate (small counts suppressed),
  and a preliminary list of what a sale would cover and its status. Access is checked on every
  visit; when the founder ends it or it expires, the room stops working. The founder sees how
  often it was opened.
- **Deals on NEAR**: the founder proposes exact terms to a team that asked for access: price in
  test dollars, expiry, handover, what control the buyer receives, what stays with the business,
  separate transfer items, what's excluded, and an evidence snapshot. The terms are frozen and
  their fingerprint goes on the business's contract with the price and both accounts. The
  team's accepting account funds the exact price (held by the contract), and both people accept
  that exact version; any revision clears both acceptances and shows what changed. The second
  acceptance closes the sale on chain, once. Everstreet then follows the contract: the business,
  its page and records move to the buyer, old helpers and grants end, customers keep their
  bookings, money and refund rights. The seller claims proceeds from the contract (a failed
  payout stays visible and can be retried) and can try a real owner action to see the
  contract refuse it. The buyer gets a first shift: confirm control, appoint their own team,
  serve customers who paid before the sale. The public page records the change of hands.
- **Switch people** from the top-right menu (legacy local preview only) to see each side. Try: as
  Theo, cancel his Nov 14 place in My activity; within seconds Ana (waiting) gets it. Then as Mara,
  turn on payments on Juniper's desk, and as another person pay for the Nov 7 session.

## Not yet

Group-controlled ownership (a co-op buys through its representative's account),
financing and earn-outs, a public notice period before a close, researched market multiples, AI drafting (drafts come from templates today), sign-in with a real identity (people's
testnet keys are kept on this computer in the local preview), paid waitlists, and payments for
kinds other than classes.
