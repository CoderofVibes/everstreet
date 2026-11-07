# First-use review: Everstreet (November 7, 2026)

Cold review, product used only through the browser pane at http://127.0.0.1:8820/ (wallet control on 8821).
Screens looked at 1440 px wide, 390 px (phone) and once in dark. Written as I went, persona by persona.

## The five worst

1. Rosa's "Start building" route (the big box on the home page) dead-ends after release at "This business isn't connected to a v3 contract here", with no way anywhere to connect one; the product can never be sold to a customer that way (finding 30).
2. Cara cannot use Ledgerline: the only "Use" buttons on its page lead to a release that answers "This release isn't the active one" (finding 66).
3. The judge has no visible route to the proof: the home page has no footer and no link to the recorded sale, proofs or attack records; the only way in is a small link that appears after running the sample (finding 1).
4. The product cannot say which chain it is on: "synthetic chain" on the sale page and banner, "NEAR testnet" on the handover page and the example, for the same business (findings 19, 44, 82).
5. Buying with another token: the swap's "Sign with my wallet" opens the wallet's sign-in-as picker (Delphine included), adds an unlisted "Register my signing key" step, and the 225 tALT deposit moves money with no review panel (findings 78, 79).

Counts: Blocks 4 · Confuses 58 · Noise 13 · Polish 13 · total 88 findings.

## Findings

### Persona 1: hackathon judge, not signed in (home, example, acquire)

After one minute: a site where you describe a product idea, sign in and "start"; a sample
invoice-reading demo in the right column; a list of three businesses "by Delphine Marsh";
something about NEAR and selling businesses in a dark block at the bottom. I understood "build
and sell online businesses, ownership on NEAR", but not what I could do without signing in, nor
where the proof was.

After five minutes: the proof is a page called "Ledgerline, example business, its history is a
verified NEAR testnet run" with a checkpoint table and 8 transaction links to testnet.nearblocks.io.
I only reached it because the sample run on the home page grew a "See the sale" link; nothing on
the home page is labelled recorded run, proof, or evidence. I believed the sale happened (8 explorer
links with named actions, block numbers in the table). I did not get chain evidence that the former
owner's later attempts were refused: those two items are tagged "the app's record of the run", not
"NEAR testnet, final", and there is no attack record anywhere I could find.

1. **Blocks** (for the judge's job, not for navigation). Judge, home page http://127.0.0.1:8820/.
   I looked for the thing that proves it works. The home page has no footer, no link to a
   recorded run, proofs, evidence or attack records. The only route is: run the Ledgerline
   sample, then notice two small links ("See the owner's view", "See the sale") that appear
   under the result. A judge who does not press "Run the sample" never finds the proof. Expected:
   a visible "See the recorded sale / proof" link above the fold. Shots:
   01-home-desktop-top.jpg, 02-home-desktop-bottom.jpg, 03-home-sample-run.jpg.
2. **Confuses**. Judge, home page. Two navigation rows: "Discover · Build · Operate · Acquire" and
   under it "Home · Explore · Asked for · Find a solution". "Discover" and "Home" both go to "/".
   "Asked for" meant nothing to me (it points at /opportunities). "Find a solution" vs "Explore":
   I could not tell them apart without clicking. On the example page the global nav says
   "Operate" and "Acquire" and the page's own tabs say "Operate" and "Acquire" too; I clicked the
   wrong one once and landed on /desk.
3. **Confuses**. Judge, home page. "My activity" and "Inbox" are shown in the header while signed
   out, next to "Sign in or join". I did not know whether they would work or bounce me.
4. **Noise**. Judge, home page (and phone). Signalwatch appears twice back to back: a large
   featured card ("Use Signalwatch / See the product page") and immediately below it the same
   Signalwatch row in the "On Everstreet now" list with the same two lines. On the phone it is the
   whole screen twice. Shot: 10-home-phone-signalwatch-twice.jpg.
5. **Confuses**. Judge, home page. Chips "AI API · prototype only" and "Client portal · prototype
   only": a dashed sub-chip inside a chip. I did not know whether "prototype only" was a warning,
   a state, or a filter, nor why "SaaS workflow" arrives pre-selected.
6. **Noise**. Judge, home page bottom block "Built to change hands intact". Bullet "Revenue on the
   books comes from the contract. Operating costs are what the founder enters; the AI cost of
   running a product is recorded from the provider's reported usage wherever a runtime is
   connected." is explaining, not helping me act; I skipped it. Shot: 02-home-desktop-bottom.jpg.
7. **Confuses**. Judge, home page sample result. "A real run would charge one use for this
   result." I did not know what "one use" costs or in what unit; the unit (tUSD, 0.15 each) only
   appears on the example page. Shot: 03-home-sample-run.jpg.
8. **Confuses**. Judge, example page http://127.0.0.1:8820/example/ledgerline?tab=operate. The
   banner says "ITS HISTORY IS A VERIFIED NEAR TESTNET RUN" and the table has block numbers, but
   nothing on this tab is a link: no explorer, no account, no way to verify. The links are on the
   Acquire tab, folded inside "The transactions (8)". A claim of "verified" with no link on the
   same screen made me doubt it. Shot: 04-example-ledgerline-operate.jpg.
9. **Confuses**. Judge, example page, Operate tab. Terms used before they are explained: "tUSD",
   "generation 1 / generation 2", "checkpoint", "the app's record of the run" vs "NEAR testnet,
   final". I guessed tUSD = test dollars and generation = owner number; I was not sure.
10. **Confuses**. Judge, example page, Acquire tab, "The transactions (8)". Entries read as raw
    action names: "create plan", "appoint", "purchase step shell customer · customer",
    "purchase 100 customer". "step shell" is jargon; I could not map these to the story told
    above them (buyer takes control, customer keeps 80 uses). Shot: 05-example-ledgerline-acquire-txns.jpg.
11. **Noise**. Judge, example page, Try tab (http://127.0.0.1:8820/example/ledgerline). It is the
    same "EXAMPLE BUSINESS · SAMPLE DATA" box as on the home page, pixel for pixel; and the page
    footer link "A recorded testnet sale" points at this same page (Acquire tab). Shot:
    06-example-ledgerline-try.jpg.
12. **Confuses**. Judge, home page vs example page. Two different Ledgerlines share a name: the
    example business that was "sold" to a buyer (/example/ledgerline) and the live business
    "Ledgerline · AI API · by Delphine Marsh · Available to use" (/b/ledgerline) in the list below.
    I was not sure whether Delphine is the founder or the buyer in the recorded sale, or whether
    these are the same business.
13. **Confuses**. Judge, http://127.0.0.1:8820/acquire. A full filter panel (kind, asking price,
    estimate range, months of history, owner hours, verified revenue, successor) and a free-text
    "describe what you're looking for" box, for one listing. Several filters say nothing until
    you read their help text ("Scenario model, not an appraisal"; "Range overlaps mine / Whole
    range within mine"). Shot: 07-acquire-desktop.jpg.
14. **Confuses**. Judge, Relaydesk listing
    http://127.0.0.1:8820/acquire/l/062fb014-3762-474b-a60c-94535cd2a063. "Revenue: Earned in
    TUSD, per use" is not a number; "Asking price $12,000" is in dollars while revenue is in
    "TUSD" (and the example page writes it "tUSD"). "Ownership on NEAR: Not yet: payments are off"
    sits next to "Revenue earned in TUSD per use": if payments are off, what is earned? Shot:
    08-acquire-relaydesk-listing.jpg.
15. **Polish**. Judge, Relaydesk listing. "What customers buy" is a heading with an empty card
    under it. "Named profile" chip is unexplained.
16. **Polish**. Judge, all pages, dark colour scheme. With prefers-color-scheme: dark the site
    renders exactly as in light (body background stays rgb(244,246,251)). Not unreadable, but
    there is no dark theme at all. Shot: 11-example-operate-dark-scheme-ignored.jpg.
17. **Polish**. Judge, example page Operate tab, "Still owed to the customer at the sale" card.
    The "NEAR testnet, final" badge is stretched to the card's full width as a thin empty pill
    with the text in its left corner; the other badges are compact. Shot: 04-example-ledgerline-operate.jpg.
18. **Polish**. Judge, phone 390 px. The secondary row (Home / Explore / Asked for / Find a
    solution) and "Sign in or join" are hidden behind a "Menu" button while the primary four
    stay visible; the demo banner wraps to two lines. No horizontal scroll (scrollWidth 390).
    Shot: 09-home-phone-top.jpg.
19. **Confuses**. Judge, home page. The demo banner "Demo · simulated history · Fictional people
    and test tokens · synthetic wallet and chain" is the only place "synthetic chain" appears,
    but the example page says the sale is a "verified NEAR testnet run" with public explorer
    links. Which is it: synthetic chain or real testnet? I re-read both twice.

### Persona 2: Rosa Lind (rosa.near), first day, wants to start a business

How far I got: two routes exist and I took both. (a) The big "Describe it in your words" box on
the home page put me in a "Product studio" where I named a product, saved three brief revisions,
compiled a build, ran six checks, released it and published a public page; then it stopped at
"Set up a customer offer": "This business isn't connected to a v3 contract here", with no way to
connect one. Nothing is sellable from that route. (b) The small "Start a business" link (/start)
is a six-question wizard that ended with a live page, a $45 per session offer, and "Ask to
book". That route gave me something real to sell in about ten minutes and was the clearest
sequence of screens in the whole product.

20. **Confuses**. Rosa, home page http://127.0.0.1:8820/. I wanted to start a business. The page
    offers "Start building" (the big box), "Start a business" (a small card), "Bring a product"
    and the nav items "Build" and "Operate". I could not tell which was for me; I took the big
    box because it was big. Only later did I find the wizard at /start is the one named for my
    goal. Shot: 01-home-desktop-top.jpg.
21. **Confuses**. Rosa, sign-in dialog. "Join to start a business, follow one, or ask for a
    service." then a tiny orange line "Review harness: Synthetic demo wallet is synthetic. It is
    not a real wallet or account." (says synthetic twice). The wallet then shows a picker that
    names every person and their role ("the seller: owns the businesses", "the buyer:
    Signalwatch's sale"), which told me the plot before I had played it. Shots:
    12-signin-dialog.jpg, 13-wallet-picker.jpg.
22. **Confuses**. Rosa, Product studio http://127.0.0.1:8820/build/85ab2928-…?view=brief.
    Pressing "Start building" dropped me, without a word, into a workspace with a breadcrumb
    "Product studio / Untitled business", nine tabs (Preview, Proposal, Brief, Checks brief 3/7,
    Versions 1, Builds, Web app, Service, Continuity), a Read/Edit switch, a left "COMPANION ·
    BRIEF" column and a right "TRYING · Brief" column. An "Untitled business" and "Revision 1 ·
    saved just now" were created for me; I had saved nothing. I did not know where to look first.
    The one thing that helped was the "Next: Give it a working name" button. Shot: 14-rosa-studio-brief.jpg.
23. **Confuses**. Rosa, Product studio brief. The brief arrived pre-filled with "Core features:
    Add a work item with the details that matter · Move items through stages · See everything in
    progress at a glance" and "Foundation: SaaS workflow: A team tracks its work through stages in
    a shared web app." None of that is my idea (meeting notes to follow-up email); my text was put
    under "Problem". I had to delete the starter features. The foundation "can't be edited here".
24. **Noise**. Rosa, Product studio, left column. "Product work log. Belongs to the business,
    with its accepted decisions. If the business is sold, the new owner gets it." and "Shape the
    business brief in words; proposals open beside your revision. It doesn't change the web app's
    code." explain; they never help me act. A yellow box "AI drafting isn't available here. Edit
    the brief yourself" raised a question (why not?) it does not answer.
25. **Confuses**. Rosa, Product studio brief, Edit mode. Clicking a part highlights it in the
    middle column, which looks like the field, but typing happens in the right column; the label
    "Product name" is shown in both places. The amount field for pricing only appears after
    choosing "Monthly", so I wrote the price into the note first ("About 19 a month"), and the
    saved line read "Monthly, amount not set · About 19 a month per consultant". Shot:
    15-rosa-brief-pricing-edit.jpg.
26. **Polish**. Rosa, Product studio, scrolled. The sticky site header covers the breadcrumb row
    ("Product studio / Business desk") so only the bottom half of it shows. Shot: 16-rosa-brief-rev3.jpg.
27. **Confuses**. Rosa, Product studio, Builds tab (?view=builds). Card title "Compile revision
    3" and its button "Compile revision 3" say the same thing; the text says "Your form becomes
    the request customers fill in, and your board's stages become the steps" but I never made a
    form or a board. After the build it reads "Build of revision 3 · Built and checked ·
    workflow-compiler · attempt not started": built, yet "attempt not started". "Artifact
    workflow_spec/1 · 05bf165cfa35 · 544 bytes", "Cost: None: nothing was sent", "Reserved:
    Nothing held", "up to $0.00 reserved (worst case)" are developer and billing jargon for a
    build that costs nothing. Shot: 17-rosa-build-done.jpg.
28. **Confuses**. Rosa, Service tab, Evaluate and release. The word "checks" means three things
    within one screen height: the studio tab "Checks brief 7/7", the card "Release checks", and
    the card "Checks and release". The results footer reads "Release checks invoice-release/1 ·
    your cases version none · model — · workflow-validator/1 · cost 0¢": my product is a workflow,
    not an invoice product, and the card above it says the checks are "workflow-validator/1".
    Two labels for one thing, one of them wrong. Shot: 18-rosa-service-checks.jpg.
29. **Noise**. Rosa, Service tab after release. The build id "b668db7b" is printed five times on
    one screen (header "Release: Build b668db7b… (revision 3) released", "Active version Build
    b668db7b since …", "Released build b668db7b · digest 05bf165c · since …", "Build b668db7b
    revision 3 · digest 05bf165c", "Latest check · build b668db7b"). The header truncates an
    8-character id with an ellipsis. Shot: 19-rosa-released.jpg.
30. **Blocks**. Rosa, Service tab, Customer access (?view=service&task=customers). The "Next:
    Set up a customer offer" button sends me here, where a red box says "This business isn't
    connected to a v3 contract here.", then a "Try again" button, then the same red sentence
    again. The form fields "Contract plan number" and "Keep results for (days)" are drawn but
    not usable. Nothing on the page, the business desk, or "Ownership and continuity" offers a
    way to connect a contract; the desk's "1 thing needs you" links straight back to this page.
    "v3 contract" is never explained. I could not make the product sellable by this route.
    Shots: 20-rosa-customer-access-v3-error.jpg, 24-rosa-continuity-no-contract.jpg.
31. **Confuses**. Rosa, same page, "Where it stands · All 12 readiness items". Items such as
    "Metering: The platform submits as meter.near", "Background maintenance: last heartbeat
    2026-11-07T11:56:27.192Z", "Protected storage … (synthetic-test-only)", "Customer
    authorization: The app ships no signer or wallet connection" are operations detail with
    nothing for me to do. The same moment is written three ways on this screen and the desk:
    "2026-11-07T11:56:28.014Z", "11/7/2026, 3:56:28 AM" and "Nov 7, 2026, 3:57 AM PST" (the
    public page later adds "2026-11-07 11:58 UTC"). Shot: 21-rosa-readiness-items.jpg.
32. **Confuses**. Rosa, Product studio header, "Progress and status" expander. Eight cards (Brief
    and prototype, Build, Checks, Release, Customer offer, Sale and handover, Brief checks, Public
    profile): "Checks" and "Brief checks" are two cards, and "Public profile: Not published" has
    no link to the place where you publish it (which is on the business desk, Products tab).
    Shot: 22-rosa-progress-and-status.jpg.
33. **Confuses**. Rosa, Business desk http://127.0.0.1:8820/desk/842d8356-…. The "Untitled
    business" had been renamed "Follow-up Desk" (my product's name) without telling me, and
    tagged "Software or API" although I chose "SaaS workflow". Six links (Value, Team, Ownership
    and continuity, Sale and handover, Successor rehearsal, Agent purchases) plus four tabs
    (Overview, Performance, Products, Customers) on day one; "Successor rehearsal" and "Agent
    purchases" meant nothing to me. Shot: 23-rosa-business-desk.jpg.
34. **Confuses**. Rosa, Business desk, Products tab. "Edit page and legacy offering" opens a
    second, different "studio" (/studio/…, the offer wizard) while "Open studio" opens the Product
    studio (/build/…). "legacy offering" is a term I never met. Shot: 25-rosa-desk-products.jpg.
35. **Noise**. Rosa, Public profile http://127.0.0.1:8820/desk/842d8356-…/public. The three
    validation rules are shown twice on the right (as bullets, then again as one sentence under
    the disabled button). Shot: 26-rosa-public-profile-empty.jpg.
36. **Confuses**. Rosa, Start a business http://127.0.0.1:8820/start → /studio/0aa62696-….
    I typed "Rosa's Garden Coaching" in "A name (optional; change it any time)" and pressed
    Start; the wizard opened as "UNTITLED BUSINESS" and the Name field on "Make it yours" was
    empty. I typed it a second time. Shots: 30-rosa-offer-wizard-q1.jpg, 32-rosa-make-it-yours-name-lost.jpg.
37. **Noise**. Rosa, offer wizard. The right column repeats itself: the "Still to decide"
    checklist lists the same six questions the left column asks one by one, and the "Save and
    come back later" button is there as well as the auto-"Saved 3:59 AM" stamp at the top.
38. **Polish**. Rosa, Product studio at 390 px. The header stack (banner, nav, breadcrumb, Next
    button, Release/Customer offer/Progress row, nine tabs wrapped onto three rows, "Show the
    companion", Active version / Running products / Runtime budget, three task tabs) is a full
    screen and a half before the first content card. No horizontal scroll (scrollWidth 390).
    Shot: 35-rosa-studio-phone.jpg.
39. **Confuses**. Rosa, http://127.0.0.1:8820/desk "Your businesses". Both businesses say
    "Published", but Follow-up Desk cannot take a customer (no offer, no contract) and Rosa's
    Garden Coaching can ("Ask to book"). The list gives no hint which one is actually open.
    Shot: 34-rosa-your-businesses.jpg.

### Persona 3: Delphine Marsh (delphine.near), runs three businesses

What I did: Operate → "Your businesses" (three cards, no numbers) → Signalwatch desk → accepted
the sale as seller → approved a 6.3 TUSD supplier invoice → read Agent purchases → Relaydesk
desk (4 open requests, left for Priya) → Ledgerline desk → Inbox → Ownership and continuity,
Sale and handover, Successor rehearsal. The business with the agent-run supplier budget and the
feed on another chain is Signalwatch; the business that gets purchases from AI agents is also
Signalwatch (Relaydesk and Ledgerline both show "No 402 offers yet").

40. **Confuses**. Delphine, home page after sign-in http://127.0.0.1:8820/. The page still leads
    with "What do you want to build?" and a describe-your-idea box; what an owner of three live
    businesses needs (what needs me, how they're doing) is nowhere above the fold. "Continue
    building" lists "Ledgerline · Untitled product · No promised result yet · Revision 1" for a
    business that is live and "Available to use"; those cards are not clickable (only "All
    projects" is).
41. **Confuses**. Delphine, http://127.0.0.1:8820/desk "Your businesses". Three cards each say
    only "Published" and "Open desk". No revenue, no uses, no "needs you" count. I had to open
    each desk to find out that Signalwatch had a sale waiting and Relaydesk had four open
    requests. The Inbox (/inbox) does list them, but nothing on the Operate page points there.
    Shot: 36-delphine-your-businesses.jpg.
42. **Noise**. Delphine, Signalwatch desk http://127.0.0.1:8820/desk/dbc48b96-…. "1 sale in
    progress: waiting for your acceptance" is a big blue header button and, in the same
    viewport, the single bullet under "Waiting now · NEEDS YOU", both linking to the same page.
    "Customer uses requested 14 / 14 charged" and "Usable results delivered 14 / of 14 runs"
    repeat the same figure. Shot: 37-delphine-signalwatch-desk.jpg.
43. **Confuses**. Delphine, Signalwatch desk. "1 thing needs you" counted only the sale; the
    supplier invoice "Awaiting your approval" (6.3 TUSD, submitted Nov 1) was not counted and is
    only visible inside "Supplier allowance" or as a small orange chip on the sale page. Two
    places disagree about what needs me.
44. **Confuses**. Delphine, sale page http://127.0.0.1:8820/sales/dbc48b96-…. Header: "BUSINESS
    CONTRACT ON THE SYNTHETIC CHAIN". The same business's "Sale and handover" page header:
    "BUSINESS CONTRACT ON NEAR TESTNET". The judge's example page says "verified NEAR testnet
    run" and the demo banner says "synthetic wallet and chain". I could not tell which chain this
    sale is on. Shots: 38-delphine-sale-page.jpg, 49-delphine-handover-near-testnet-label.jpg.
45. **Confuses**. Delphine, sale page, "Deal 1" card. Labels I did not understand: "Control:
    Generation 1", "Mode: Direct", "Books: Per-use economics", "Floor kept 0 TUSD", "Control
    sequence 4" (then 5 after I accepted), "Deal digest" and "Terms hash" as 64-character hex.
    "Customer rights: 1556 TUSD prepaid, carried over" next to "Price 180 TUSD" made me re-read:
    I am selling for 180 a business holding 1,556 of customer money. Also: "Not included … The
    signalwatch.example domain and its DNS account" in the terms, but "Included at close ·
    Domains, provider accounts, secrets: In progress" a few lines lower. Shot: 39-delphine-sale-terms-digest.jpg.
46. **Confuses**. Delphine, sale page after accepting. The status line reads "Waiting for the
    buyer to fund and accept." while the card beside it says "Escrow · Funded · 180 TUSD" and
    step 2 "Escrow funded" is marked completed. Shot: 41-delphine-sale-accepted.jpg.
47. **Confuses**. Delphine, sale page and Supplier allowance, "Ask my wallet for exactly this".
    I expected a wallet window to appear and ask me to sign. Nothing appeared: the page updated
    by itself (the acceptance, and later the invoice) and scrolled to the bottom to "Your wallet
    requests here" with a raw transaction id and no link. On the sale page there was no success
    message at the top until I scrolled up. Shots: 40-delphine-accept-review.jpg.
48. **Noise**. Delphine, "Review: Accept this version" panel. "Attached NEAR
    0.000000000000000000000001 NEAR" and three lines later "Attached NEAR 1 yoctoNEAR (the
    smallest unit: a confirmation, not a payment)": the same value twice in two notations.
    "Price 180 TUSD (180000000 base units)", "Network fee limit up to 30 Tgas" are for engineers.
49. **Confuses**. Delphine, Supplier allowance http://127.0.0.1:8820/desk/dbc48b96-…/allowance.
    The invoice is 6.3 TUSD; the grant says "Per payment 2 TUSD hard cap" and "Owner review:
    Above 5 TUSD · exact invoice". I could not tell whether approving overrides the 2 TUSD cap,
    or what happens to an invoice between 2 and 5. The invoice has no description of what was
    supplied. "This week 12.6 / 60 TUSD" did not match the visible payments (Nov 1: 0.9 + 6.3)
    and did not change after I paid 6.3; "Budget" went from 47.4 to 41.1 while "This week"
    stayed 12.6. Shot: 42-delphine-supplier-allowance.jpg.
50. **Confuses**. Delphine, Supplier allowance after approving. The panel said "Done" but the
    invoice card and the table still said "Awaiting your approval" and "Reserved 6.3 TUSD" until
    I reloaded the page; after reload the card had gone and the row said "Paid". Shot:
    43-delphine-invoice-done-still-awaiting.jpg.
51. **Confuses**. Delphine, Agent purchases http://127.0.0.1:8820/desk/dbc48b96-…/agent-purchases.
    Each card leads with "HTTP response 402 · exact offer" and "Reason: No units yet"; the totals
    box counts "402 offers 4". I do not know what a 402 is. Two of the four cards are
    "Registration step … Offered: Registration first" and are indistinguishable from the real
    purchase except by a chip. "Purchase transaction" is written under the confirmed card but is
    not a link. There is nothing for me to do on this page and it does not say so. Shot:
    44-delphine-agent-purchases.jpg.
52. **Confuses**. Delphine, Ledgerline desk http://127.0.0.1:8820/desk/84cb7ee9-…. "Nothing is
    waiting right now" beside "Invoice reader v2 · Offered to customers · brief has unreleased
    changes". "81 uses · 56 charged · 25 returned" and "25 not usable": I guessed returned means
    refunded. The product is called "Invoice reader v2" here and "Ledgerline" everywhere else.
    Ledgerline's desk has no "Successor rehearsal" link while Relaydesk's does, and no "Supplier
    allowance" while Signalwatch's does, so the row of links differs per business without saying
    why. Shot: 46-delphine-ledgerline-desk.jpg.
53. **Confuses**. Delphine, Inbox http://127.0.0.1:8820/inbox. After I accepted the sale, the
    inbox still said "Signalwatch: A sale is in progress: its terms wait for acceptance" under
    "Needs you" (the desk header had already changed to "Nothing needs you right now · 1 waiting
    on the system"). Shot: 47-delphine-inbox.jpg.
54. **Confuses**. Delphine, Ownership and continuity http://127.0.0.1:8820/desk/dbc48b96-…/continuity.
    "Amounts are exact base units of the asset account; no decimals or dollar value are assumed"
    sits under figures written "1,556 TUSD", "56 TUSD", "36 TUSD" (and the sale page writes "180
    TUSD (180000000 base units)"). "The business's own funds 56 TUSD" vs "Withdrawable by the
    owner 36 TUSD": the 20 TUSD difference is not explained. The feed on the other chain is not
    on this page ("Not shown or verified here: which chain the endpoint serves"); the only place
    I found it was one row on the sale page ("External feed · Controller role · synthetic EVM
    chain"). Shot: 48-delphine-signalwatch-continuity.jpg.
55. **Noise**. Delphine, Sale and handover http://127.0.0.1:8820/desk/dbc48b96-…/handover. The
    main column has "Authority the buyer receives" and "Customer obligations that stay with the
    business"; the right column repeats both as "Authority that changes" and "Customer rights
    that stay" with the same 1,556 TUSD figures. Shot: 49-delphine-handover-near-testnet-label.jpg.
56. **Confuses**. Delphine, Sale and handover. On this page the second nav row switched from "My
    businesses · Inbox · Help requests" to "Acquisitions · Handovers · Portfolio" (the buyer's
    row) although I am on my own business's desk. Three pages describe the same sale with three
    vocabularies: /sales (6 steps, "Both accept (closes)"), /handover (5 steps, "The contract
    closes the sale"), /continuity ("Transfer in progress").
57. **Polish**. Delphine, Successor rehearsal http://127.0.0.1:8820/desk/798b85a8-…/rehearsal.
    Clear and convincing, but "Download the record ebebce80e10c09ad… · also included in the
    handover record" is plain text, not a link. "Observed: Answer: 409 operator_not_authorized"
    is raw. Shot: 50-delphine-successor-rehearsal.jpg.
58. **Polish**. Delphine, Signalwatch desk at 390 px. Fine: no horizontal page scroll, the chart
    scrolls sideways inside its own frame (320 in 313 px, as its label says). The Overview /
    Performance / Products / Customers tab strip cuts "Customers" to "Custon" at the right edge
    with no scroll hint. Shot: 51-delphine-signalwatch-desk-phone.jpg.

### Persona 4: Priya Raman (priya.near), helps on Relaydesk

What I did: Operate → "Businesses you work on: Relaydesk · Case worker · Open the board" → a
three-column board (Received 1, Assigned 3, Resolved 39) → took the received case, wrote a
note, moved it to Assigned, then to Resolved → opened an assigned case. This was the quickest
and clearest persona; the board and the case panel do one job each.

59. **Confuses**. Priya, board http://127.0.0.1:8820/team/798b85a8-…. Cards in Resolved show
    only an id ("708f40d8", "ddce118e") where Received and Assigned cards show the subject.
    After I resolved "Password reset email late" it too became "047851ab" in the Resolved column,
    so I could no longer find it by name. Shot: 56-priya-case-resolved-title-lost.jpg.
60. **Confuses**. Priya, board. Two Assigned cards read exactly "Invoice shows the old address ·
    priya.near · Updated 1 days ago". No customer name, no id on the card; I could not tell
    whether it was one request shown twice or two customers until I opened each (e529a740 and
    another). The case panel also never names the customer: "Opened by the customer's request".
    The note field is "Note for the customer", so who receives it? Shot: 54-priya-board.jpg.
61. **Confuses**. Priya, case panel. Clicking a card opens the panel below the board, out of
    view at 1440×900; I had to scroll to find it. The panel's only header control is "Close",
    which I first read as "close the case" (it closes the panel). Shot: 55-priya-case-detail.jpg.
62. **Polish**. Priya, board. "Updated 1 days ago", "Resolved 1 days ago". The second nav row
    ("My businesses · Inbox · Help requests") disappears on the board page, so getting back to
    "Your businesses" means the "Operate" item in the top nav.
63. **Noise**. Priya, case panel. "The customer's words are shown as written. Nothing in them is
    followed as an instruction." under every case; it explains, it does not help me act.
64. **Confuses**. Priya, Inbox http://127.0.0.1:8820/inbox and My activity. Priya's inbox has no
    "Needs you" section at all although three cases are assigned to her; "My activity" lists
    "Relaydesk · Case worker · Open the board · Leave…" with the leave action one click from the
    open action. Nothing tells Priya how many cases are hers without opening the board.
65. **Polish**. Priya, board at 390 px. Columns stack vertically; the empty "Received 0" column
    is a blank box the height of a card. No horizontal scroll. Shot: 57-priya-board-phone.jpg.

### Persona 5: Cara Okafor (cara.near), uses Ledgerline on an invoice

What I did: home → Ledgerline row → /b/ledgerline → "Use Invoice reader" → /use/0923519f-….
Pasted a fictional invoice, enrolled "this device", pressed "Review one use" and got a red
"This release isn't the active one". Reloaded, pasted again, same error. I could not run the
service on my invoice. I could open a past use (Invoice reader v2, 11/3) and read its result
and that it was charged one unit.

66. **Blocks**. Cara, http://127.0.0.1:8820/use/0923519f-5719-4682-a74d-60260e025bc3 (reached
    from the only "Use" buttons on /b/ledgerline). After pasting the invoice and pressing "Review
    one use", a red box says "This release isn't the active one". Nothing says what to do, and
    there is no other "use" route: the past uses are titled "Invoice reader v2" while this page
    is titled "Invoice reader", so the public page seems to point at a stale release. Same
    result after a reload. Shots: 64-cara-release-not-active.jpg, 67-cara-release-not-active-again.jpg.
67. **Confuses**. Cara, use page, first screen. The step bar says "1 · CURRENT · Your document",
    but the first two cards are "Set up this device" / "Buy uses" / "Use this product on this
    device", and the document box is a screen lower. "Buy uses" defaults to 10 uses for 4 TUSD
    while the same card says "the contract shows 80 uses ready for you": I did not know whether I
    had to buy anything. Shot: 59-cara-use-page-top.jpg.
68. **Confuses**. Cara, use page, "Use this product on this device". Four paragraphs about a key
    "made on this device", "slot 1", "The key's private half can't be copied out of this browser",
    "This device has a key waiting to be enrolled. The contract doesn't show it yet; you can ask
    your wallet again with the same key." I did not know whether enrolling was required until
    the document button turned into "Set up this device first" with the note "Enroll this
    device's key below" (the device card is above the document, not below). The enrollment
    review ("Enrolls this device's key in slot 1 · Holds of at most 1 use; at most 10 uses a day
    · Cost 1 yoctoNEAR") is clear once you get there. Shots: 61-cara-set-up-device-first.jpg,
    62-cara-enroll-device-review.jpg.
69. **Confuses**. Cara, /b/ledgerline. The business is "Ledgerline" and the product is
    "Invoice reader" (and "Invoice reader v2" in my history); the two "Use" buttons on the page
    ("Use Invoice reader" and "Use this product") go to the same place. The public page does not
    show the price; I only learned "0.4 TUSD per use" on the use page. Shot: 58-cara-ledgerline-page.jpg.
70. **Confuses**. Cara, what I paid. No screen gives a total. The past use page says "One unit
    used" and "80 units free, 20 used, as read from synthetic-chain block 1841"; My activity says
    "Invoice reader v2 from Ledgerline · 12 requests, 8 charged, 4 returned". 20 used on one
    page, 8 charged on the other, and the amount (8 × 0.4 = 3.2 TUSD) is for me to work out.
    "returned" is never defined. Shots: 65-cara-past-use.jpg.
71. **Confuses**. Cara, use page, "Recent uses" column. Relaydesk support desk uses are listed
    on the Ledgerline use page between the Invoice reader ones, so the column mixes products.
72. **Polish**. Cara, past use http://127.0.0.1:8820/uses/545334ca-…. The result is a clean
    six-row table with "Copy JSON" and "Download", "Every required field found", and "Kept for
    you until 12/3/2026". Good. The only odd note: "Due date · Not stated" is shown in the same
    style as a found value. Shot: 66-cara-past-result.jpg.
73. **Noise**. Cara, use page. "Nothing is reserved or charged by reviewing." appears in the step
    bar, under the Review button, and in the "Your unit" card ("Nothing is reserved until you
    authorize one use"): three times on one screen.

### Persona 6: Noah Brandt (buyer.near), buying Signalwatch

What I did: Acquire → "Your deals in progress · Buying Signalwatch · Open the sale". The escrow
was already funded in TUSD, so to try my other token I pressed "Withdraw your escrow", collected
the returned escrow, opened "Fund from another token · NEAR Intents", took a quote (225 tALT →
180 TUSD), deposited, signed the swap, withdrew the TUSD, funded the escrow again, and accepted.
The sale closed; I then went through "Your first shift" (moved the feed role, granted the
supplier allowance), the handoff proof, the desk, Handovers and Portfolio. The money story was
mostly followable: every chain action had a review panel listing the exact amount, except the
tALT deposit (see 79).

74. **Confuses**. Noah, http://127.0.0.1:8820/acquire, /handovers, /portfolio, /inbox. The same
    single deal is shown on three pages, each as a one-line card with "Open the sale"; the Inbox
    shows nothing about it. I did not know which of Acquisitions, Handovers or Portfolio was
    "my" page for a purchase. Shots: 69-noah-acquire-deals.jpg, 71-noah-handovers.jpg, 72-noah-portfolio.jpg.
75. **Confuses**. Noah, sale page http://127.0.0.1:8820/sales/dbc48b96-…. Nothing on the site
    shows what tokens I hold or how much. The page says the escrow wants 180 TUSD; that I have
    tALT only appears as a button label ("Quote in tALT") inside a folded "Fund from another
    token · NEAR Intents" section that only exists while the escrow is unfunded. Before I
    withdrew, that route was invisible. Shot: 70-noah-sale-page.jpg.
76. **Confuses**. Noah, sale page, Other actions. "Withdraw your escrow (undoes your acceptance)"
    was offered while my row said "Awaiting acceptance" (I had not accepted). Its review says my
    escrow "becomes your returned-escrow claim": I did not know a claim meant a second step
    ("Collect your returned escrow", request claim_party_guarded) before the money was back in
    my account. Shots: 73-noah-withdraw-escrow-review.jpg, 76-noah-collect-returned-escrow-review.jpg.
77. **Confuses**. Noah, sale page, "Fund from another token". The quote "225 tALT → 180 TUSD ·
    until 04:17:55 AM" gives no rate, fee or who takes the 45-token difference (Everstreet is
    named as the solver). "Solver · Everstreet · solver.synthetic.near" and "Verifier ·
    intents.synthetic.near" meant nothing to me. The deadline is a clock time with no "in N
    minutes". Shot: 78-noah-talt-quote.jpg.
78. **Blocks** (almost: I guessed through it). Noah, "Sign the swap" step. Pressing "Sign with my
    wallet" opened the wallet's "Synthetic wallet: sign in as" account picker listing all seven
    people, Delphine included, instead of a signing prompt; after I picked myself the step
    changed to "Register my signing key", a step the list never mentioned, and only then to
    "Sign the swap". The step list said four steps; it took six clicks. Shot: 80-noah-swap-sign-shows-account-picker.jpg.
79. **Confuses**. Noah, "Deposit 225 tALT". Every other movement of money opened a "Review:"
    panel with amount, contract and "Ask my wallet for exactly this"; the deposit of 225 tALT
    happened on one click with no review and no confirmation. This is the one step where I
    could not say afterwards exactly what left my account. Shot: 79-noah-talt-deposited.jpg.
80. **Confuses**. Noah, after "Withdraw 180 TUSD to my account". The last line of the list, "Fund
    escrow · confirmed by the business contract", has no button beside it; the action is the
    blue "Fund escrow" button in the page header, which had been there the whole time. I looked
    for it next to the step first. Shot: 82-noah-tusd-delivered.jpg.
81. **Noise**. Noah, sale page, "Your wallet requests here". After the close this list holds six
    entries (Accept, Fund escrow, Collect, Take your escrow back, Fund escrow, Register with the
    token), newest first, each with a raw 44-character transaction id and no link. Shot: 86-noah-sale-closed.jpg.
82. **Confuses**. Noah, closed sale page. "Propose a resale" is offered as the second button the
    moment the sale closes. "Seller collects the proceeds · NOT SHOWN · only the seller sees
    their own collection" is a greyed step in my progress bar. The header says "BUSINESS
    CONTRACT ON THE SYNTHETIC CHAIN" while the first-shift list says "You control Signalwatch on
    the synthetic chain" and the Handovers page says "NEAR testnet" for the same business.
83. **Confuses**. Noah, Handoff proof http://127.0.0.1:8820/sales/dbc48b96-…/proof. Three
    different figures for what customers are owed: "186 units carried over" here, "1556 TUSD
    prepaid" on the sale page, "389 prepaid uses · 1,556.00 TUSD" on Portfolio. "Check it with
    npx tsx scripts/verify-receipt.ts <file> --live" is a developer command on a buyer's page.
    "Attack suite · What we tried to break · On NEAR testnet · A recorded handoff" is printed
    under "Evidence sources" but none of it is a link; "Light-client proof: Not attached";
    "Code hash: None (synthetic chain)". Shot: 87-noah-handoff-proof.jpg.
84. **Confuses**. Noah, Signalwatch desk as new owner http://127.0.0.1:8820/desk/dbc48b96-….
    "Nothing is waiting right now" while the sale page still listed two to-dos (feed role,
    supplier allowance) and the Handovers page lists "Your first steps as the new owner" with a
    different set of steps. Three to-do lists for the same close. Shot: 88-noah-desk-as-new-owner.jpg.
85. **Confuses**. Noah, first-shift review "Supplier allowance · grant". The effect says "The
    agent can pay the allowed suppliers within these caps" but no caps are shown in the review;
    I approved caps I could not see. After both to-dos the line reads "granted for generation 2
    · Allowance" where "Allowance" looks like a link but is not in the link list. Shot: 90-noah-grant-allowance-review.jpg.
86. **Confuses**. Noah, Portfolio http://127.0.0.1:8820/portfolio after the close. Units mix on
    one screen: "Earned 52.00 TUSD", "Customer compute 3.12¢ USD", "Operating $47.00 founder",
    "Budget this month 0.24¢ of $200.00", "Tokens 14,300 in 3,380 out", "Prepaid uses 389 ·
    1,556.00 TUSD". I could not tell which of these are mine now, which are the seller's
    history, or what "founder" and "runtime" labels on the figures mean. "Control sheets and
    notes · Received from Delphine Marsh 11/7/2026 · Control sheet" is a term I never met.
87. **Polish**. Noah, Handovers "Applied here Nov 7, 2026, 4:17 AM PST (contract control step
    8)" and the desk's Products tab "Price on the contract (plan 1): 4 TUSD (exact: 4,000,000
    base units of tusd.near) per use": base units again next to a decimal amount.
88. **Polish**. Noah, closed sale page and proof page at 390 px. Both stack cleanly with no
    horizontal scroll; the six progress steps become six stacked bars; the handoff proof's
    evidence badges ("Synthetic run, block 2204") wrap under each value. Shots:
    91-noah-sale-closed-phone.jpg, 92-noah-proof-phone.jpg.

## What worked well

- The "Start a business" wizard (/start → /studio/…): six plain questions, a live preview of
  the offer on the right, a "Ready to be seen?" page that says exactly what publishing does, and
  a "Your first week" list after publishing. The clearest sequence in the product.
- Every chain action (accept, fund, collect, approve an invoice, enrol a device, move the feed
  role) opens a "Review:" panel with the amount, the contract, what it does, what cannot be
  guaranteed, and an "Ask my wallet for exactly this" button. I always knew what I was about to
  sign, with one exception (the tALT deposit).
- The "Next: …" button in the Product studio header always named a sensible next step.
- The Relaydesk case board: three columns, a note field, one button per stage. Priya's day took
  two minutes.
- The buyer's "Your first shift" checklist after the close, with the two to-dos as buttons.
- The customer's past-use page: result table, "Copy JSON", "Download", "Kept for you until …",
  and a clear "one unit charged".
- The "Successor rehearsal" page explains an unusual idea (a dress rehearsal of the buyer's first
  shift) in one paragraph and shows each check with expected and observed.
- No horizontal scrolling anywhere at 390 px; charts scroll inside their own frame and say so.
- The demo banner, "Fictional terms in a simulated history" and "Synthetic run" badges never let
  me think anything was real.

## What the product is (as the judge, after five minutes)

Everstreet is a place to build a small online business (an AI API, a workflow app or a
bookable service), put it in front of customers who pay per use, and later sell the whole thing
to a buyer on NEAR so that the customers' prepaid uses and results survive the change of owner.
The proof offered is one recorded sale of an example business, Ledgerline, with eight
transaction links to the NEAR testnet explorer and a checkpoint table; what I could not find
from the home page was any attack record, and the site could not decide whether its chain is
"synthetic" or "NEAR testnet".

## Counts by severity

Blocks 4 · Confuses 58 · Noise 13 · Polish 13 · total 88 findings.
