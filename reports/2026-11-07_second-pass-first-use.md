# Second cold pass, first use (November 7, 2026, evening)

Reviewer: cold, nothing read but the brief. Site http://127.0.0.1:8820/, wallet control :8821.
Screenshots: `reports/first-use-shots/2026-11-07-pass2/` (the browser tool returns images only to the
reviewer; where no file exists the screen is described in the finding).

## The five worst

1. **Blocks** · The big "Start building" box ends at a wall: Customer access refuses in three different sentences ("no contract on the chain here" / "isn't connected to a v3 contract" / "isn't bound to a contract"), and the desk's one "needs you" item leads to a read-only page with no action (findings 24, 27).
2. **Blocks** · Inboxes are wrong about sales: Delphine's still says the sale "waits for your acceptance" after she accepted; Noah's never mentions a deal that is waiting on him, before or after the close (findings 41, 61).
3. **Confuses** · What customers are owed is three numbers: 186 units on the proof page's headline, 389 prepaid uses on the portfolio, 1556 TUSD on the sale page; the proof page leads with the one that matches nothing else (finding 67).
4. **Blocks** · Cara pastes a plain invoice and gets three verdicts on one screen: "Needs checking: not a complete extraction", "Ended without a result", "Your result is ready"; then "Not this kind of document" (finding 57).
5. **Blocks** · Rosa cannot try her own product: the Try tab wants JSON with field names it never shows; and the only money step without its own review is the tALT swap, signed inside another step's click (findings 22, 63).

## Findings

### Persona 1 · Hackathon judge, not signed in

Route taken: home → "The run, proved" card (1 click) → /proof/ledgerline. Then "The example business" link at the
foot of the proof page → /example/ledgerline?tab=acquire (2 clicks), Operate tab (3), Try tab (4), "What we tried to
break" (5). Total time about five minutes. I believed the sale happened: the close transaction and all eight
transactions link to testnet.nearblocks.io (noted, not followed) and the contract account name is a plain testnet
account. What I did not believe on sight is explained in findings 2, 4 and 6: the self-attested rows carry the same
visual weight as the chain reads.

1. **Confuses** · Judge · /proof/ledgerline · The hero card reads "CUSTOMER · PREPAID BEFORE THE SALE / 80 → 79" with
   chips "100 bought", "80 at close". Nothing on the card says what the unit is. I only knew it was "uses" because I had
   read the home card first ("kept 80 unused uses"); landing here from a shared link, 80 of what? Expected the unit in
   the card ("80 uses → 79"). Screenshot `02-judge-proof-top-1440.jpg`, `08-judge-proof-390.jpg`.
2. **Confuses** · Judge · /proof/ledgerline · Four evidence badges ("● Testnet final read", "≡ Everstreet record",
   "◆ Testnet receipt", "⬡ Light-client proof") appear with no legend. I guessed "Everstreet record" meant "we say so,
   not the chain"; the page never says that. The honesty is good; the reader has to infer it. Expected one line under
   the title or a hover (i) explaining the four.
3. **Noise** · Judge · /proof/ledgerline · "Record 371e532b3f57 · commit e2c7c1c" under the title means nothing to a
   newcomer; and /attacks shows "Commit 3bf895f", a different commit. Two evidence pages, two commits, neither explained.
4. **Confuses** · Judge · /proof/ledgerline · "Light-client proof" row: "Proved against block header CBzboDVh…dDH8Af ·
   height 276584431" and then the badge says "block 276581443". Two different block numbers in one row with no word on
   why (I assume one is the proven block and one the later header, which the home card hinted at: "checked against a
   later block"). The row should say "block 276581443, checked against header at height 276584431".
5. **Noise** · Judge · /proof/ledgerline · "Results: Stand-in model · Everstreet record" — "Results" of what? The row
   label has no object. And "Former owner reads: Refused (404)": an HTTP code in a list that is otherwise about chain
   state; I read it twice to decide it meant the app refused, not the contract.
6. **Confuses** · Judge · /proof/ledgerline · "Check it yourself" gives two `npx tsx scripts/...` commands with no word on
   where the repository is or that you need it. A judge with only the site cannot run them. Expected a repo link or
   "from a checkout of the repo".
7. **Polish** · Judge · /proof/ledgerline · "Business contract ledgerline-v3-3b.everstreet.testnet" and the code hash
   have no explorer link, while every transaction does. The account is the one thing I would most want to click.
8. **Confuses** · Judge · /example/ledgerline?tab=acquire · "The buyer took control of" list: two of three bullets carry
   a badge, "the product, its releases and the customer offer" carries none, and under "The customer kept", "their
   earlier result, unchanged and readable only by them" carries none. So on the same screen, some claims are backed and
   some simply asserted, and the unbacked ones are not marked as such. Screenshot `04-judge-ledgerline-acquire-1440.jpg`.
9. **Polish** · Judge · /example/ledgerline?tab=acquire vs /proof/ledgerline · The same evidence badge is worded
   "NEAR testnet, final" on one page and "Testnet final read" on the other; the app's own records are "the app's record
   of the run" on one and "Everstreet record" on the other. Same thing, two names, a page apart.
10. **Confuses** · Judge · /example/ledgerline?tab=operate · The three tiles "Prepaid by the customer 15 tUSD",
    "Earned 3.3 tUSD", "Still owed 80 uses": only the third has a "NEAR testnet, final" badge. The intro says every
    *checkpoint* below is a chain read, and the table does carry block numbers, so the 80 is backed on this screen; the
    15 and 3.3 are arithmetic from the table (100 × 0.15; 22 × 0.15) but nothing says so. "Earned … at the end of the
    run" also includes the 2 uses charged after the sale, so "earned" by the founder or by the business? Not said.
    Screenshot `05-judge-ledgerline-operate-1440.jpg`.
11. **Polish** · Judge · /example/ledgerline?tab=operate · The checkpoint table has block numbers but no explorer links;
    the sentence above sends me to the other tab for the links. Backing on "the same screen" is one click away.
12. **Confuses** · Judge · /attacks · Every case carries chips "◇ Synthetic run" and "Fixture" with no explanation; the
    intro says "Fixture results: Everstreet's real routes over the synthetic chain … Not the contract's own code." So
    most of the 25 attacks are against a simulation of the contract, and only a few have a "NEAR testnet ↗" pair. The
    home card said "Attacks on the contract, each refused, with its testnet pair where one ran", which reads stronger
    than the page delivers. I hesitated over whether "25 of 25" counts for the contract. Screenshot
    `06-judge-attacks-1440.jpg`.
13. **Polish** · Judge · / (home, 1440) · The first screen is a builder's prompt box; the three proof cards sit below
    the fold edge ("A recorded sale…", "The run, proved", "What we tried to break") and are the only things a judge
    wants. They are small text links with no visual weight next to the big "Sign in and start" box. Found them in
    about ten seconds, but only because I scrolled. Screenshot `01-judge-home-1440.jpg`.
14. **Polish** · Judge · / (home, 390) · Phone layout holds: no horizontal scroll (scrollWidth 390), chips wrap, the
    proof cards stack. "AI API prototype only" chip wraps its label badge onto the chip at a slightly odd spot but is
    readable. Screenshot `07-judge-home-390.jpg`.

### Persona 2 · Rosa Lind, first day

**Big box ("What do you want to build?" → Sign in and start).** Typed "A booking page for my mobile dog grooming
van, with reminders and a waitlist", kept the pre-selected "SaaS workflow", signed in. Landed in the Product studio.
Followed the blue "Next:" button twice (name, who it's for), then Progress and status → Build → Compile → Service →
Run checks → Release this version → Customer access. The stop came at Customer access (findings 22–25). From there
the desk sent me to a page with nothing to do (finding 27). Nothing on the desk or in the studio pointed to a way
forward other than "the operator connects it in the configuration", which is not me.

**Small link ("Start a business").** Six questions, "Make it yours", preview, publish; about four minutes; the page
went live at /b/rosa-s-mobile-grooming. The stop is honest and stated on the publish screen: "No payment is taken in
this version", customers can only "Ask to book". I understood exactly why. This route is in far better shape than the
big box.

15. **Confuses** · Rosa · / (home) · The sign-in dialog's first line changes by where you came from: from the hero
    box it says "Join to save your project. It stays private to you and your business until you publish."; from the
    header's "Sign in or join" it says "Join to start a business, follow one, or ask for a service", which doesn't
    mention building at all, on a page whose headline is "What do you want to build?". Screenshot
    `09-rosa-signin-dialog.jpg`.
16. **Confuses** · Rosa · /build/…?view=brief (first screen after sign-in) · Everything at once: nine tabs (Preview,
    Proposal, Brief, Checks, Versions, Builds, Web app, Service, Continuity), a "COMPANION · BRIEF" side panel, a
    red-tinted "AI drafting isn't available here", a "TRYING / Brief" panel on the right with Undo/Redo/Save revision,
    a "Prototype only" chip, "Release: Not released · Customer offer: None", and a "Progress and status" link. I
    re-read the screen three times before settling on the one blue button that mattered ("Next: Give it a working
    name"). Screenshot `10-rosa-studio-first-screen.jpg`.
17. **Confuses** · Rosa · /build/…?view=brief · My typed sentence was filed under "Problem". It is not a problem, it
    is the product. "Core features" came pre-filled with "Add a work item with the details that matter · Move items
    through stages · See everything in progress at a glance", none of which is about dog grooming, with a small chip
    "Starter suggestions from SaaS workflow" that reads like a label, not a warning that these are placeholders.
    "Foundation: SaaS workflow: A team tracks its work through stages in a shared web app" is not a booking page.
    Nothing said "these are defaults; replace them".
18. **Noise** · Rosa · /build/…?view=brief · The companion panel: "Shape the business brief in words; proposals open
    beside your revision. It doesn't change the web app's code." and "Product work log. Belongs to the business,
    with its accepted decisions. If the business is sold, the new owner gets it." Four sentences of explanation
    before I have typed anything; "proposals", "revision", "web app's code", "work log" are all terms I had not met.
19. **Polish** · Rosa · /build/…?view=brief · After the first save the breadcrumb changed from "Untitled business" to
    "Business desk", and on the desk the business is called "Vanbook", the name I gave the product. I never named
    the business; it took the product's name without saying so. Screenshot `17-rosa-vanbook-desk.jpg`.
20. **Confuses** · Rosa · /build/… "Progress and status" strip · Two cards both called checks: "Checks · Nothing to
    check yet" (the build) and "Brief checks · 5 of 7 rules met" (the brief); the tab strip also has "Checks
    brief 5/7". Three places, two meanings, one word. Screenshot `11-rosa-progress-strip.jpg`.
21. **Confuses** · Rosa · /build/…?view=builds · After compiling, the build card says "Built and checked" and lists
    "Checks ✓ The saved form and board compile into a valid workflow", while the strip above says "Checks · Build
    70302336… not checked yet". Same screen, two answers. Also "Your form becomes the request customers fill in,
    and your board's stages become the steps": I had never seen a form or a board; the build compiled something I
    hadn't made. "Cost: None · Reserved: Nothing held · up to $0.00 reserved (worst case)" is three lines to say
    nothing happened. The "Compile revision 3" button stays offered after revision 3 is built. Screenshot
    `12-rosa-build-done.jpg`.
22. **Blocks** · Rosa · /build/…?view=service (Try) · "A test request as JSON, one text value per form field, e.g.
    {"subject": "Export fails"}". A dog groomer is asked to type JSON, and the field names are not shown anywhere on
    the page (the build said "a request form with 3 fields" without naming them). I could not try my own product.
    Expected a form with the three fields. Screenshot `13-rosa-service-try-json.jpg`.
23. **Noise** · Rosa · /build/…?view=service&task=evaluate · After Run checks, the summary line reads "Release checks
    invoice-release/1 · your cases version none · model — · workflow-validator/1 · cost 0¢". "invoice-release" on a
    grooming booking workflow is the example business leaking through; the rest is for an engineer. Screenshot
    `14-rosa-release-checks.jpg`.
24. **Blocks** · Rosa · /build/…?view=service&task=customers · The stop. Three boxes say the same thing three ways:
    blue "This business has no contract on the chain here, so nothing can be offered to customers yet. In this demo
    only the example businesses have one; on a real deployment the operator connects it in the configuration",
    red "This business isn't connected to a v3 contract here", and after I pressed Inspect plan, red "This business
    isn't bound to a contract here". "v3 contract" is never explained. I understood the *demo* reason from the
    blue box; I did not understand what I, Rosa, would do about it, here or on a real deployment, and nothing on the
    screen is clickable toward an answer. The form below (Contract plan number, Keep results, Inspect plan) is
    still enabled, so I tried it and got the third refusal. Screenshot `15-rosa-customer-access-stop.jpg`.
25. **Noise** · Rosa · /build/…?view=service&task=customers "All 12 readiness items" · "Metering: The platform
    submits as meter.near", "Protected storage … (synthetic-test-only)", "Background maintenance Running: last
    heartbeat 2026-11-07T13:12:47.449Z, last pass 2026-11-07T13:12:47.449Z", "Reading NEAR: A reader is set on this
    server". Raw timestamps and account names on a founder's screen. Also "Business page: Publish the business page
    from the studio." with no link and no tab by that name; I never found where in this studio to publish a page
    (the "Public profile · Not published" card led nowhere I could tell). Screenshot `16-rosa-readiness-list.jpg`.
26. **Confuses** · Rosa · same screen · "Customer authorization · Unavailable · The app ships no signer or wallet
    connection, so customers can't authorize a use here yet. Next: A wallet connection is a later, reviewed step;
    nothing to enter here." Yet the home page lists Ledgerline and Relaydesk as "Available to use". Either this
    line is wrong or "here" means something narrower than the site. I could not tell which.
27. **Blocks** · Rosa · /desk/86939521… (Vanbook desk) → /desk/…/continuity · The desk says "1 thing needs you" and
    shows the same long sentence twice, once as a big blue button and once under "Waiting now": "Vanbook: released;
    it needs the business's contract before customers can buy (not connected here)". Clicking it opens "Ownership
    and continuity", a page marked Read-only whose only content is "This business isn't connected to a NEAR contract
    here, so nothing below is observed" and a disabled "Refresh evidence". The thing that needs me is a thing I
    cannot do, and the page it leads to has no action. Screenshots `17-rosa-vanbook-desk.jpg`,
    `18-rosa-continuity-deadend.jpg`.
28. **Polish** · Rosa · /desk/86939521… vs /desk · The desk header says "1 product · 1 released · 0 offered to
    customers" and "Page private", while /desk (Your businesses) lists Vanbook as "Private draft, not published". The
    product is released; the business page is not. Both true, but "Private draft" next to a released product made me
    go back and check. Screenshot `24-rosa-your-businesses.jpg`.
29. **Polish** · Rosa · /start (I have an idea) · "Question 1 of 6" but the "Still to decide" list beside it has
    seven items (the seventh, "Confirm you can deliver…", is a tick box inside question 6). Small, but I counted.
    Screenshot `20-rosa-start-q1.jpg`.
30. **Polish** · Rosa · /start · The preview's "Next step for a customer" is "Tell me when it opens" until the Q6 box
    is ticked, then "Get in touch", then after "Make it yours" it is "Ask to book". Three names for the customer's
    button in four screens.
31. **Confuses** · Rosa · /start preview and /b/rosa-s-mobile-grooming · The customer-facing page has a "NUMBERS"
    box: "No responses yet. Revenue, costs and an estimate of what it's worth appear here if the founder chooses to
    share them." A customer booking a dog wash doesn't want the business's valuation on the booking page; this
    reads as a buyer's panel on a customer's page. Screenshot `21-rosa-start-preview.jpg`.
32. **Noise** · Rosa · /desk/618c5117… (service desk) · "Books · No payment or revenue records yet… until then
    revenue is not known, not zero", "Digital operations · No customer product yet. Founder trials and checks so
    far: no runtime calls (recorded zero)", "How people found you … 'Unknown' means we couldn't tell, not that nobody
    came". Three empty-state paragraphs explaining the difference between unknown and zero on a desk whose whole
    job today is "share the link with three people". Screenshot `23-rosa-service-desk.jpg`.
33. **Polish** · Rosa · 390 px · Product studio holds together (no horizontal scroll) but the nine tabs wrap onto
    three rows and "Continuity" sits alone on a line; the service desk header's five buttons wrap into an uneven
    block. Both usable. Screenshots `25-rosa-studio-390.jpg`, `26-rosa-service-desk-390.jpg`.

### Persona 3 · Delphine Marsh

Three desks. **Signalwatch** said "2 things need you": a sale waiting for my acceptance and a supplier invoice
awaiting approval; both were there and both were real. **Relaydesk** said "4 things need you" — "4 open customer
requests" — but three of the four are assigned to priya.near, so one at most is mine. **Ledgerline** said "Nothing
is waiting right now", while its product line reads "brief has unreleased changes". Approving the invoice updated
the page in place (no reload; I checked with a marker in the page) but see finding 37 for what did and didn't change.
After accepting the sale, the inbox still said the sale was waiting for my acceptance (finding 41).

34. **Polish** · Delphine · /desk (Your businesses) · Three cards, each just "Published · Open desk". Nothing on the
    list says which business needs me today; I had to open all three to find out. Expected the "2 things need you"
    count on each card. Screenshot `28-delphine-your-businesses.jpg`.
35. **Confuses** · Delphine · /desk/8dcf8a96…/allowance · The rule box: "Per payment · 2 TUSD hard cap" and then an
    invoice of 6.3 TUSD awaiting my approval. If 2 is a hard cap, how is 6.3 approvable? The "How it works" sentence
    ("Up to 2 TUSD the agent pays alone; above 5 TUSD it waits for your approval…; anything between the two is
    refused") answers it, but only after two readings, and "hard cap" is the wrong label for "pays alone up to".
    Screenshot `29-delphine-allowance.jpg`.
36. **Confuses** · Delphine · same page · "This week · 12.6 / 60 TUSD" then "Budget 47.4 · Reserved 6.3 · Available
    41.1". "Budget" here means "what is left" (60 − 12.6), not the budget (60). I did the subtraction to be sure.
37. **Confuses** · Delphine · same page, after approval · The invoice card vanished with no "Paid" confirmation; the
    only sign was the table row flipping to "Paid". "Budget" went 47.4 → 41.1 and "Reserved" 6.3 → 0, but the big
    "12.6 / 60 TUSD" did not move to 18.9, so the headline bar now disagrees with the figures under it. Screenshots
    `30-delphine-invoice-review.jpg`, `31-delphine-after-approval.jpg`.
38. **Polish** · Delphine · same page · The invoice has no description, only a supplier account name, an amount and a
    hash ("Invoice 981d9ae5…"). I approved 6.3 TUSD without the page telling me what it was for.
39. **Noise** · Delphine · same page · "Ask my wallet for exactly this" produced no wallet step at all; the action
    simply completed. The phrase sets up a step that never appears (the synthetic wallet signs silently). Same on the
    sale acceptance. If the wallet is meant to be invisible in the demo, say so once; if not, show the step.
40. **Polish** · Delphine · /sales/8dcf8a96… review box · "Attached NEAR · 0.000000000000000000000001 NEAR" and, a
    few lines later, "Attached NEAR · 1 yoctoNEAR (the smallest unit; a confirmation, not a payment)". Same value
    twice; the first form is unreadable. Also "Control sequence 4" (then 5 after my acceptance), "Mode: Direct",
    "Control: Generation 1" — labels I could not place. Screenshot `32-delphine-sale-review.jpg`.
41. **Blocks** · Delphine · /inbox after accepting the sale · "Needs you · Signalwatch · A sale is in progress: its
    terms wait for your acceptance". I had just accepted; the sale page itself says "accepted by the seller · Waiting
    for the buyer to accept". The inbox sends me back to do a thing that is done. Screenshot `33-delphine-inbox-stale.jpg`.
42. **Confuses** · Delphine · /desk/c920003c… (Relaydesk) · "4 things need you" / "4 open customer requests", but on
    the Products tab three of the four are "ASSIGNED · priya.near". The desk counts a teammate's work as mine.
    Screenshot `34-delphine-relaydesk-cases.jpg`.
43. **Polish** · Delphine · /desk/90995139… (Ledgerline) · "Nothing is waiting right now" beside "Invoice reader v2 ·
    Offered to customers · brief has unreleased changes". If unreleased changes are not a thing waiting, fine, but
    the two lines sit an inch apart and read as a contradiction. The chart's Oct bar label ("60") is clipped at the
    top edge of the plot. Screenshot `35-delphine-ledgerline-desk.jpg`.
44. **Noise** · Delphine · Relaydesk Products tab · "Price on the contract (plan 1): 1.5 TUSD (exact: 1,500,000 base
    units of tusd.near) per use, as recorded with the offer" and a link "Edit page and legacy offering" — "legacy
    offering" appears nowhere else. The desk nav differs by business (Relaydesk has "Successor rehearsal", the
    others don't) with nothing saying why.
45. **Polish** · Delphine · all three desks · "Customer uses · by the UTC month they were requested · current
    outcome" with "Focus or point at a month for its figures" and "Dashed frame: this month so far". Three lines of
    chart instructions for a two-bar chart.

### Persona 4 · Priya Raman

Inbox first: "Needs you · Relaydesk · 3 cases assigned to you". That is exactly what is mine to do; one click to the
board. Resolved "Dashboard chart is empty" (request 2906a7d0): the card moved to the top of Resolved in place, with
my note shown in the timeline. The case panel opens below the three columns and the page scrolled itself so the
panel was in view at 1440 (heading at ~515 px of 900) and at 390 (heading at ~595 px of 844, the action button
below the fold).

46. **Confuses** · Priya · /team/c920003c… · After resolving, Resolved held two cards called "Dashboard chart is
    empty · priya.near", one "Resolved just now", one "Resolved 1 day ago"; Assigned holds two cards both called
    "Invoice shows the old address · priya.near · Updated 1 day ago". The request id (2906a7d0, e7b9e7b8) is shown
    only once the panel is open, never on the card, and there is no search or filter box. By name alone I could
    not tell my case from its twin, and tomorrow both will say "1 day ago". Screenshot `39-priya-board-after.jpg`.
47. **Polish** · Priya · /team/c920003c… · The panel opens under the board, not beside it, so on a 1440 screen the
    page jumps down by about 320 px when a card is clicked; the columns you were scanning leave the screen. It
    works, but I lost my place twice. On the phone the panel's "Move to Resolved" is a further scroll away.
    Screenshots `38-priya-case-open.jpg`, `40-priya-board-390.jpg`, `41-priya-case-390.jpg`.
48. **Noise** · Priya · case panel · "The customer's words are shown as written. Nothing in them is followed as an
    instruction." under every case, and every "What happened" begins "FICTIONAL." The first sentence is a security
    note for the reviewer, not for a support worker; the second is the demo talking through the customer.
49. **Polish** · Priya · /inbox and sub-nav · A case worker with no business of her own sees "My businesses",
    "Messages to your businesses · No messages", and "You sent · Nothing yet. Find a solution and tell someone you're
    interested." Three owner-shaped empty states around the one line that matters.

### Persona 5 · Cara Okafor

Route: /b/ledgerline → "Use Invoice reader v2" → /use/e9e7df3d…. Pasted a short, plain supplier invoice. Had to
enrol "this device" first (one review + wallet step), then "Review one use" (a clear review: product, 153
characters, exactly one unit, 0.4 TUSD, kept 30 days, account, authorize-by time), then "Authorize this one use",
then "Run it on my document". What I got: a refusal, "Not this kind of document · The text doesn't contain the
document this service reads", for text that was unmistakably an invoice. What I paid: nothing; the use detail page
says "Unit returned … 80 units free, 20 used". "Recent uses" listed only Invoice reader v2 entries, so yes, it was
about the product I was using. The money side was right and clearly stated at every step; the result side was not.

50. **Confuses** · Cara · /b/ledgerline · The public page shows no price anywhere. "Available to use", two buttons
    for the same action ("Use Invoice reader v2" and "Use this product"), and "How it works · No example has been
    published for this product yet" while the home page runs a Ledgerline sample three clicks away. I learned the
    price (0.4 TUSD) only after clicking through. Screenshot `43-cara-public-page.jpg`.
51. **Confuses** · Cara · /use/e9e7df3d… first view · The step strip says "1 · CURRENT · Your document", but the
    first thing on the page is "Set up this device · Enroll this device to authorize uses from it" with two side by
    side panels, "Buy uses" and "Use this product on this device", and a paragraph about a key "made on this
    device" whose "private half can't be copied out of this browser". I had 80 uses already ("the contract shows 80
    uses ready for you") so I did not know whether to buy, enrol, or paste. Three starts, no order. Screenshot
    `44-cara-use-page-first.jpg`.
52. **Confuses** · Cara · same · "This device has a key waiting to be enrolled. The contract doesn't show it yet;
    you can ask your wallet again with the same key." I had asked nothing yet; "again" presumes a step I never took.
53. **Confuses** · Cara · same, after pasting · The document panel's button became "Set up this device first" with
    the hint "Enroll this device's key below; then review your request". The enrolment panel is above the document
    panel, not below. I scrolled down looking for it. Screenshot `45-cara-set-up-device-first.jpg`.
54. **Polish** · Cara · same · "Buy uses: Each use costs 0.4 TUSD. You hold 10 TUSD in this account, and the
    contract shows 80 uses ready for you". Two balances in one sentence (10 TUSD in the account, 80 uses = 32 TUSD
    prepaid with the business) with no word on how they relate, and a default of "10 uses · Total 4 TUSD" offered
    to someone who already has 80.
55. **Confuses** · Cara · same, after authorizing · Left panel: "Reserved · The contract shows exactly your signed
    hold of one unit." Right panel, same moment: "Your unit · One unit reserved … Not read from the contract yet."
    Does the contract show it or not? Screenshot `46-cara-reserved.jpg`.
56. **Polish** · Cara · same · Authorize and Run are two separate buttons two clicks apart ("Authorize this one
    use", then "Run it on my document"). The review had already said what the run would do; I hesitated at the
    second button wondering what I had just authorized if not the run.
57. **Blocks** · Cara · same, after the run · Three verdicts for one run on one screen: the step strip "NEEDS
    CHECKING · Not a complete extraction"; the left panel "Ended without a result · This run didn't produce a result
    you can use, so it isn't charged"; the right panel "Result · Your result is ready". After "Show my result": a
    yellow box "Not a complete extraction. The product couldn't read every required field" and under it a chip
    "Not this kind of document" with "The text doesn't contain the document this service reads". So: is it an
    incomplete extraction (some fields read) or not an invoice at all (nothing read)? The product's own public
    promise is "get its number, dates, supplier and totals back, or an honest refusal"; this is a refusal dressed as
    a partial result, for text that was plainly an invoice. Screenshots `47-cara-ended-without-result.jpg`,
    `48-cara-result-shown.jpg`.
58. **Confuses** · Cara · same · After the run, "Your unit · One unit reserved" stayed on screen with a button
    "Settle my unit · Checks the contract and charges only a delivered result, or returns the unit", while the left
    panel already said "isn't charged". I never pressed it; opening the use's own page (/uses/548017ed…) showed
    "Ended, unit returned … nothing was charged". So the unit came back by itself and the main page was stale and
    asking me to do it. Screenshot `49-cara-use-detail.jpg`.
59. **Noise** · Cara · /uses/548017ed… · "80 units free, 20 used, as read from synthetic-chain block 2091 at
    11/7/2026, 5:24:36 AM" and on the review "0.4 TUSD (exact: 400,000 base units of tusd.near)". Block numbers and
    base units on a customer's receipt.
60. **Polish** · Cara · /use at 390 px · The page stacks cleanly (no horizontal scroll) but is very long: device
    panel, buy panel, document, result, unit, recent uses in one column; the step strip wraps to four stacked
    cards before any input appears. Screenshot `50-cara-use-390.jpg`.

### Persona 6 · Noah Brandt (buyer.near)

Found the sale from Acquire ("Your deals in progress · Buying Signalwatch · Open the sale"); the inbox said nothing.
Money steps, in order, and whether I saw a review of the exact amount before the wallet was asked:

| Step | Review before the wallet? | Amount as shown |
|---|---|---|
| Withdraw escrow | Yes | "Your escrow (180000000 base units)" — not in TUSD |
| Collect returned escrow | Yes | "Amount 180 TUSD" |
| Deposit tALT into the verifier | Yes | "225 tALT" |
| Sign the swap | **No review of its own**; the quote line above ("225 tALT → 180 TUSD · 1.25 tALT per TUSD") was the only statement | — |
| Withdraw 180 TUSD from the verifier | No review; one button "Withdraw"; the step's own label carried the amount | "Withdraw 180 TUSD to my account" |
| Fund escrow | Yes | "Price 180 TUSD" |
| Accept and close | Yes | "Price 180 TUSD" |
| Grant the supplier allowance again | Review, but the caps are only in the "Exact arguments" JSON as base units | see finding 66 |

The five-step list on the Intents route was completed, but not as listed: the page offered step 3 ("Sign with my
wallet") before step 2, clicking it silently turned into step 2 ("Register my signing key"), and that one click
completed steps 2 and 3 together (status jumped to "Swapped"). Close, then "Your first shift" (two to-dos, both
done with a review), "Handoff proof", Handovers, Portfolio. Customers owed: see finding 67; I understood the
1556 TUSD figure and did not understand the other two.

61. **Blocks** · Noah · /inbox · Empty before I acted ("Messages to your businesses · No messages", "You sent ·
    Nothing yet") although the seller had accepted and the deal was waiting on me, and empty after the close. The
    seller's inbox carries sale items; the buyer's never does. I found the sale only because Acquire happens to list
    "Your deals in progress". Screenshot `62-noah-acquire.jpg`.
62. **Confuses** · Noah · /sales/8dcf8a96… "Review: Take your escrow back" · "Your escrow (180000000 base units)
    becomes your returned-escrow claim". The other three money reviews on the same page say "180 TUSD"; this one
    makes me do the decimal conversion on the step that moves my money out. Screenshot `53-noah-withdraw-review.jpg`.
63. **Confuses** · Noah · Intents route · Steps listed 1–5; after the deposit the page offered "Sign with my wallet"
    (step 3) while step 2 was still "Not yet". Clicking it did nothing visible except replace the button with
    "Register my signing key". Clicking *that* produced "Swapped" with steps 2 and 3 both ticked: the swap, the
    step that actually converts my 225 tALT, was signed inside another step's click with no review panel of its
    own. The list of steps did not match what happened. Screenshots `57-noah-sign-before-register.jpg`,
    `58-noah-swapped-one-click.jpg`.
64. **Polish** · Noah · same · The tALT route is a collapsed row ("Fund from another token · NEAR Intents") inside the
    Escrow funding card, while the big top button is "Fund escrow" (TUSD). Once opened: "Solver · Everstreet ·
    solver.synthetic.near · Synthetic", "Verifier · intents.synthetic.near": names with no explanation of what a
    solver or a verifier does for me. Screenshot `55-noah-intents-steps.jpg`.
65. **Confuses** · Noah · same, after the withdrawal · The step strip highlighted "2 · NOW · Escrow funded" while the
    card beside it said "Escrow · Not funded". The strip names the finished state, so "NOW · Escrow funded" reads
    as a statement, not a to-do.
66. **Confuses** · Noah · close page · "Grant it again" review: "Effect · The agent can pay the allowed suppliers
    within these caps while you own generation 2". No caps on the review. Under "Exact arguments" they appear as
    `"per_payment": "2000000", "per_period": "60000000", "period_ms": "604800000", "review_above": "5000000"`. I
    re-authorised a spending allowance whose limits were shown only as raw base units in JSON; Delphine's allowance
    page had put the same caps in words (2 TUSD, 60 TUSD a week, review above 5). Screenshot
    `63-noah-grant-again-json.jpg`.
67. **Confuses** · Noah · /sales/…/proof vs /sales/… vs /portfolio · What customers are owed: the proof page
    headlines "186 units carried over" and lists "Unused units of the 2 customers served here, at close · 186" and
    "All customers' prepaid value at close (the contract's total) · 1556 TUSD"; the sale page says "Customer
    rights · 1556 TUSD prepaid, carried over" and "Customers who paid before the sale keep their units · 1556 TUSD
    unused"; the portfolio says "Prepaid uses · 389 · 1,556.00 TUSD". So 1556 TUSD agrees everywhere, and 389 uses
    × 4 TUSD = 1556, but the proof page's biggest number, 186, matches nothing else, and the only clue is "served
    here" against "the contract's total". Nothing says where the other 203 units are or why the proof leads with the
    smaller figure. I understood the TUSD; I did not understand the units. Screenshots `64-noah-proof.jpg`,
    `65-noah-portfolio.jpg`, `61-noah-closed.jpg`.
68. **Noise** · Noah · /sales/…/proof · "◇ Synthetic run" on fourteen rows; "Code hash · None (synthetic chain)";
    "Access keys · 0"; "Light-client proof · Not attached"; headings "Evidence sources" and "Source key" with nothing
    readable under them; "Check it with npx tsx scripts/verify-receipt.ts <file> --live". A "Download handoff
    receipt" link exists (not followed). The one page a buyer would keep is the one with the most unexplained
    labels.
69. **Polish** · Noah · /portfolio · "Earned 52.00 TUSD · Oct 9 – Nov 7" and "Operating $47.00 · founder" for a
    business I have owned for two minutes: the seller's month and the seller's entered costs presented as mine, with
    nothing marking the close date on the chart. "Needs you today · Nothing" is right and welcome.
70. **Polish** · Noah · /handovers · "Applied here · Nov 7, 2026, 5:28 AM PST (contract control step 8)", while the
    sale page had said "Control sequence 4" then "5". Three numbers for a counter nobody explained. "Your first
    steps as the new owner" here and "Your first shift" on the sale page are two different lists for the same
    moment.
71. **Polish** · Noah · 390 px · Sale, proof and portfolio pages stack without horizontal scroll; the sale page is
    about 2,600 px tall with the primary button at the top and the Intents route far down. Screenshots
    `66-noah-sale-390.jpg`, `67-noah-proof-390.jpg`, `68-noah-portfolio-390.jpg`.

## What worked well

- The money reviews ("Review: …" panels) before Collect, Fund escrow and Accept: deal, buyer, price, what this
  does, what can't be guaranteed, and which account pays. Clear and consistent.
- The service "Start a business" route (six questions, live preview, honest publish screen: "No payment is taken in
  this version") is the best first-use path in the product.
- The blue "Next: …" button in the product studio always named one concrete thing to do.
- Cara's per-use review (product, document size, exactly one unit, 0.4 TUSD, kept 30 days, authorize-by time) and
  the charge-only-on-result rule, which held: the refused run cost nothing and the detail page said so.
- Approving the invoice and resolving a case both updated in place with no reload.
- Priya's inbox said exactly what was hers ("3 cases assigned to you") and took her there in one click.
- Every transaction on the Ledgerline proof page links to the testnet explorer; the "Everstreet record" badge is an
  honest mark even if unexplained.
- Phone layouts: no horizontal scroll on any page I measured (home, proof, studio, desk, board, use page, sale,
  portfolio).

## What I understood the product to be (judge, five minutes)

Everstreet is a place where a solo founder describes a small software or service business, gets a brief, a plain
working product and a public page, sells uses of it to customers through a NEAR contract that holds the customers'
prepaid money, and can later sell the whole business to a buyer on chain in a way that keeps those customers'
unused uses intact. The home page's proof section shows one such sale (Ledgerline) really ran on NEAR testnet;
everything else in the demo runs on a synthetic chain with test tokens.

## Counts by severity

Blocks 6 · Confuses 30 · Noise 11 · Polish 24 · total 71.
