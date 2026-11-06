# First-use review: Everstreet, 2026-11-05

Reviewer: a newcomer working through six personas in the brief's order, using only the product in
the browser at http://127.0.0.1:8820/. Widths 1440 px and 390 px; dark scheme checked once.
Screenshots are in `reports/first-use-shots/`.

## The five worst (one line each; detail in the section of the same name at the end)

1. Rosa cannot get anything real to sell from the front door: Product studio loops between "build
   one first" and "builds can't be started here" (#19), and the route that works is never pointed to (#29).
2. A customer cannot use Ledgerline: after enrolling the device as told, authorizing fails with
   "This request names a key that isn't yours", then a three-minute lockout (#65, #66).
3. Owner desks say "Nothing is waiting" while a customer request has waited 19 hours and a sale is
   in progress (#38, #41, #57).
4. The seller's sale price is "180 000 000 base units of tusd.near" with "no verified
   denomination"; the buyer sees "180 TUSD" for the same deal (#42, #77).
5. Signed out and signed in, the marketplace shows "0 of 0 businesses" and every listing badge
   says "Testing interest" or "Shaping" whatever its real state (#7, #74, #5, #34, #72).

Findings follow in persona order; "what worked well", the judge's understanding and the counts are at the end.

## Findings

### Persona 1: hackathon judge, not signed in, five minutes

**After one minute** (home page): it is a place to build an online product (AI API, SaaS, agent,
portal), run it, and sell the business "on NEAR" so customers keep what they paid for. The Ledgerline
sample card on the right is the only thing to press that shows the product doing something. I could
not yet tell what "Discover / Build / Operate / Acquire" would each contain or which one shows the
"works" proof.

**After five minutes**: I ran the sample (worked), opened "What works today" (four of six stages say
"Partly"), opened Acquire (zero businesses for sale), Explore (three businesses, all "Testing
interest", "Open for customers (0)"), and the Ledgerline example's Operate and Acquire tabs (a
testnet sale record with 10 transactions). What I believe: the on-chain sale part is real and has
evidence; the "build" part is a form that saves a brief; the marketplace is empty when signed out.

1. **Confuses** · Judge · Home, http://127.0.0.1:8820/ · Arrived at the site for the first time.
   Expected to be signed out. The header read "Acting as Rosa Lind" and the menu said "Signed in as
   rosa.near" before I had done anything, and a "Continue building: Clausemark, Revision 2, 2 min
   ago" section was on the home page. I had to sign out to become a stranger. The menu also offers
   two different exits, "Sign out of Everstreet" and "Disconnect Synthetic demo wallet from this
   browser (you stay signed in here)"; I could not tell which one a person wants. Likely a leftover
   from the browser profile, but it is what a judge opening the demo link would see.
   `00-leftover-signin-menu.jpg`

2. **Noise** · Judge · Every page · Two demo banners stacked at the top say nearly the same thing:
   "Demo: simulated history (fictional) · fictional businesses and people · no real money moves /
   NEAR testnet only · test dollars, no value" and then "Demo: simulated history, synthetic wallet
   and chain · Fictional people, businesses and test tokens. 30 days produced by the real flows on a
   simulated clock; not testnet evidence." The second banner's "30 days produced by the real flows
   on a simulated clock" I re-read twice and still could not use. On the phone the two banners take
   about a third of the first screen. `01j-home-phone-top.jpg`

3. **Confuses** · Judge · Home, http://127.0.0.1:8820/ · The "Example businesses" section says
   "They are never offered for sale", but the Ledgerline card under it has an "Acquire" button and
   says "built, used, sold". I re-read the section to work out that "Acquire" here means "see how it
   was sold", not "buy it". `01d-home-bottom.jpg`

4. **Noise** · Judge · Home · The same three businesses (Ledgerline, Relaydesk, Signalwatch) appear
   twice in a row: as "Example businesses" cards and again directly below as the "On Everstreet now"
   list, with a different label ("Testing interest · Software or API · by Delphine Marsh"). I could
   not tell if those were the same things or different ones. `01d-home-bottom.jpg`

5. **Confuses** · Judge · Home and Explore, http://127.0.0.1:8820/explore · "Testing interest" is
   used as a status badge on every listed business without being explained. On Explore the tab
   "Open for customers (0)" says none of them can be used, yet the home page invites me to "Paste an
   invoice" into Ledgerline, and later personas use it as customers. Two places disagree. `01f-explore.jpg`

6. **Confuses** · Judge · Home · "On Everstreet now" says "Published businesses on this computer,
   software first. Classes and services are earlier fictional examples." The filter then offers
   Services, Classes, Products that return nothing. "On this computer" is a strange thing for a
   website to say; I did not know whether the list was global or local.

7. **Blocks** (for the judge's purpose) · Judge · Acquire, http://127.0.0.1:8820/acquire · The home
   page promises "Explore acquisitions: Businesses for sale, with numbers you can check." The page
   shows "0 of 0 businesses open to buyers" and "No business matches all of these yet", with a
   full-height filter panel for zero results. Signed out, there is nothing to judge here. I guessed
   that signing in might change this; nothing on the page says so. `01e-acquire-empty-judge.jpg`

8. **Confuses** · Judge · Home sample result, http://127.0.0.1:8820/ · The result's "What a real
   run would record" uses "unit", "the offer's retention period", "stand-in model" and "outcome is
   extracted" before any of them is defined. The two buttons "Follow it into Operate" and "Follow
   it into Acquire" meant nothing to me until I clicked one. `01b-home-sample-run.jpg`

9. **Noise** · Judge · Home, "What works today, from idea to handover" · A collapsed box that, when
   opened, lists six stages with "Works now" / "Partly" labels and a sentence each. It explains the
   product's state rather than helping me act; four of six are "Partly". Honest, but as a judge it
   lowered my confidence before I had seen the strongest part (the sale record). `01c-home-what-works.jpg`

10. **Confuses** · Judge · Ledgerline example, http://127.0.0.1:8820/example/ledgerline?tab=acquire
    · "The former owner was refused afterwards: 404, 404" and "owner founder (generation 1) → buyer
    (generation 2)" are shown with no explanation of what "404" or "generation" mean here. A
    terminal command ("Check this record yourself: npx tsx scripts/verify-rehearsal.ts ...") is
    printed on a web page for a non-developer. The transaction list shows truncated ids
    ("FAhRe9EE9n...") with labels like "appoint", "purchase step shell", "fund" that are not
    explained. `01h-example-ledgerline-acquire.jpg`

11. **Confuses** · Judge · Ledgerline example Operate tab,
    http://127.0.0.1:8820/example/ledgerline?tab=operate · "tUSD", "contract views", "checkpoint",
    "block" and "derived: contract views × the offer's price" are used without definition. "AI
    compute: not shown" is a card whose value is the words "not shown". `01i-example-ledgerline-operate.jpg`

12. **Confuses** · Judge · Site-wide · The second navigation row changes with each top tab (Home /
    Explore / Requests / Find a solution under Discover; Product studio / Bring a product / Start a
    business / Expert help under Build; Acquisitions / Handovers / Portfolio under Acquire). I kept
    losing the row I had just used. "Requests" and "Find a solution" sound like the same thing.

13. **Polish** · Judge · Home, dark scheme, http://127.0.0.1:8820/ · With the browser set to dark,
    the site renders exactly as in light. Not wrong, but nothing adapts. `01l-home-dark.jpg`

14. **Polish** · Judge · Home at 390 px · The header stacks banner, banner, logo + "Menu", and a
    four-item tab row before any content; the hero starts about 520 px down. The "Software and AI"
    filter chip wraps to two lines while its neighbours are one line. No sideways scrolling.
    `01j-home-phone-top.jpg`, `01k-home-phone-lower.jpg`

15. **Polish** · Judge · Home · The page ends on the dark "Built to change hands intact" box with no
    footer; there is no "about", "who made this" or link to the evidence for someone judging.

16. **Noise** · Judge · Build, http://127.0.0.1:8820/build · Signed out, the Build page shows the
    whole product form (four product-kind cards each with a "Needs:" list), then "Sign in to see
    your projects". I filled nothing because I was not sure the form would keep anything without
    signing in; nothing says. `01g-build-signed-out.jpg`

### Persona 2: Rosa Lind (rosa.near), first day, wants to start a business

**Where I got to**: two different routes. (a) The home page box took me into "Product studio" and a
brief for "Recipe Reader" (an AI API): I completed the brief 7/7, but could not build, release or
offer anything because the studio says builds are not connected. (b) "Start a business" gave a
six-question wizard that ended in a published, bookable page for a service ("Card to Cookbook",
$40 per project) at http://127.0.0.1:8820/b/card-to-cookbook. Route (b) got me something real; the
home page never pointed me at it.

17. **Noise** · Rosa · Sign-in dialog, http://127.0.0.1:8820/ · "Sign in or join" opens a dialog
    with three paragraphs about what signing in proves and does not do, then "Continue with
    Synthetic demo wallet". I skimmed all of it; the one thing I needed was the button. After
    signing in, the header says "Acting as Rosa Lind", which made me wonder whether I was Rosa or
    someone acting for her. `02-signin-dialog.jpg`

18. **Confuses** · Rosa · Home after sign-in, http://127.0.0.1:8820/ · On my "first day" the home
    page already showed "Continue building: Clausemark, Revision 2, 5 min ago", and /start later
    said "You have 2 businesses in progress: Recipe Reader, Clausemark". I never made Clausemark.
    (Leftover state, but a first-day founder would think someone else had used her account.)

19. **Blocks** · Rosa · Product studio, http://127.0.0.1:8820/build/539ffb49-...?view=builds ·
    I typed my idea into the home page box and pressed "Start building". I expected to be walked
    toward a product I could offer. The studio's Builds tab says "No build provider is connected.
    ... Builds can't be started here, and none is simulated." The Service tab says "No checked
    version yet. Build one on the Builds tab." The business desk says "Build a product in Studio,
    test a release and offer it to customers." Three screens send me round in a circle; none says
    what I can do instead. The product's own front-page promise ("Describe it in your words") ends
    here. `02g-studio-service-tab.jpg`

20. **Confuses** · Rosa · Product studio first landing,
    http://127.0.0.1:8820/build/539ffb49-7606-422c-86a1-7e048e125a63 · After "Start building" I
    landed on a screen with nine tabs (Preview, Proposal, Brief, Checks, Versions, Builds, Web
    app, Service, Continuity), a left "Companion" column, a right "Trying" column, a breadcrumb
    "Untitled business / Untitled product", a "Prototype only" badge and a status row "Release: Not
    released · Customer offer: None". The preview in the middle showed a form with "Document type:
    Invoice / Receipt / Contract", nothing to do with recipes. I did not know where my words had
    gone until I found the Brief tab. `02b-studio-first-landing.jpg`

21. **Noise** · Rosa · Product studio, same URL · The orange "AI drafting isn't connected here.
    Generated builds are not connected in this environment. Nothing is generated, run or tested by
    AI here yet; shape the brief and prototype by hand and every saved revision is kept." paragraph
    appears three times on one screen once "Progress and status" is open: in the left column, in
    the "Build" status tile, and again on the Builds tab. `02e-studio-progress-status.jpg`

22. **Confuses** · Rosa · Product studio Brief, ...?view=brief · "Pricing assumption": I chose
    "Per use" and typed a note, pressed Done and saved. The brief then read "Not decided yet · 0.20
    per recipe, prepaid packs of 50", and the header's next step was still "Choose how and what
    customers would pay". The amount box only appears after picking a kind and nothing said it was
    required. I had to reopen the section to find it. `02d-studio-pricing-not-decided.jpg`

23. **Noise** · Rosa · Product studio Brief · "Problem" and "Where it started" show the same
    sentence (my original words) twice, one in quotation marks. `02c-studio-brief.jpg`

24. **Confuses** · Rosa · Product studio header · The business was called "Untitled business" and
    silently became "Recipe Reader" when I named the product; the breadcrumb then read "Recipe
    Reader / Recipe Reader". I did not choose a business name and did not know a business and a
    product were two things.

25. **Confuses** · Rosa · Continuity tab, ...?view=continuity · The header's "Next: review
    continuity" button stays as the next step while I am on the Continuity tab, and nothing on it
    can be clicked. Four "Missing" dependencies ("Model provider for customer requests", "Where the
    product runs", "Usage counted per customer", "Customer payments") are listed with no way to
    supply any. I could not tell what to do next. `02f-studio-continuity.jpg`

26. **Confuses** · Rosa · Web app tab, ...?view=app · This tab offers "Describe the app" and
    "Generate the first version" with "Spend at most (cents of this business's AI budget)", while
    the Builds tab says nothing can be generated here. Two tabs disagree about whether AI is
    available.

27. **Noise** · Rosa · Service and Builds tabs · "Runtime budget", "AI budget for this business",
    "Used $0.000000 · counted 0¢ · reserved 0¢", "Held for unsettled work", "each request holds its
    worst case until it settles", "to a millionth of a cent". Budget paragraphs for a product that
    does not exist yet; six-decimal dollars.

28. **Confuses** · Rosa · Business desk, http://127.0.0.1:8820/desk/ed9b0aa9-... · A row of links
    "Value · Team · Ownership and continuity · Sale and handover · Successor rehearsal" sits above a
    tab row "Overview · Performance · Products · Customers and growth": two navigation rows, and
    "Successor rehearsal" is a term I had not met. A badge "Page private" and "1 product · 0
    released · 0 offered to customers". The footnote "From this business's own records as of
    2026-11-06 05:17 UTC" is a day ahead of today's date. `02i-desk-recipe-reader.jpg`

29. **Confuses** · Rosa · Start a business, http://127.0.0.1:8820/start · This page ("No wallet, no
    paperwork, no business plan") is the natural first-day start, but it is three clicks deep
    (Build > Start a business) and the home page's big box leads to Product studio instead.
    Clicking the "I have an idea" card created a new "Untitled business" immediately, without
    asking, so I now own three businesses. `02h-start-a-business.jpg`

30. **Polish** · Rosa · Offer wizard, http://127.0.0.1:8820/studio/f8b61a68-... · In the "Start a
    business" flow the sub-navigation appeared to highlight "Bring a product", not "Start a
    business".

31. **Confuses** · Rosa · Offer wizard, question 6 · After ticking "I have confirmed I can deliver"
    and continuing, the preview still said "Proposed, not confirmed yet" and the Publish step said
    "You have not confirmed every detail". Going back via "1. Shape the offer" restarted at question
    1 and I had to press Next five times to reach question 6; the "Still to decide" list on the
    right names the missing item but is not clickable. (On the second attempt, ticking with a
    direct click worked, so the first miss may have been my input; the five-step walk back is the
    product's.) `02l-publish-step.jpg`

32. **Confuses** · Rosa · Offer wizard "Make it yours" step · The "Why you" box shows my experience
    answer in grey placeholder text ("Pulled from your experience answer; edit it here"). It looks
    filled but is not; if I had not retyped it, I believe the page would have been blank there. The
    same pattern on "Offer headline" is a real value. Two boxes that look the same behave
    differently. `02k-make-it-yours-placeholder.jpg`

33. **Confuses** · Rosa · Offer wizard step bar · Clicking "4. Publish" in the step bar took me to
    step 2 "Make it yours", not to Publish.

34. **Polish** · Rosa · Public page, http://127.0.0.1:8820/b/card-to-cookbook · The page badge says
    "Testing interest" while the offer card on the same page says "Confirmed by the founder" and
    the desk says the next step for a customer is "Ask to book". I would not call a bookable,
    confirmed offer "testing interest". `02n-public-page.jpg`

35. **Noise** · Rosa · Desk for Card to Cookbook, http://127.0.0.1:8820/desk/c5bf5ede-... · The
    "Books" section for a one-hour-old business carries a paragraph on earned vs. prepaid revenue,
    test dollars vs. US dollars and "Contribution ... counting a test dollar as $1. It is not real
    profit", plus "AI spend ... to a millionth of a cent" and a ten-option "Add a cost" form. The
    useful part (three "Today" to-dos and a ready-made message to send) is at the top and good.
    `02o-desk-card-to-cookbook.jpg`

36. **Polish** · Rosa · Product studio at 390 px · The nine-tab strip scrolls sideways with a
    visible scrollbar under it; Versions, Builds, Web app, Service and Continuity are off-screen.
    Otherwise the brief reads well on the phone. `02p-studio-phone.jpg`

### Persona 3: Delphine Marsh (delphine.near), runs three businesses, checking on them today

**Where I got to**: Operate showed three businesses, each "Published · Shaping", with no numbers.
Every desk said "Nothing is waiting right now." I found the one real thing to do (a customer
request received 19 hours ago in Relaydesk) only by opening the Products tab, and moved it to
Assigned. I refreshed the stale on-chain evidence for Signalwatch. I could not tell, from any
screen, what my Signalwatch sale price is in money.

37. **Confuses** · Delphine · Operate, http://127.0.0.1:8820/desk · "Your businesses" lists three
    cards with only "Published · Shaping" and "Open desk". No revenue, no open requests, no sale in
    progress. "Shaping" is a status I had not seen explained; it is also the status of Rosa's
    brand-new page, which cannot be the same stage as a business with 43 customers. The page does
    not answer "how are they doing". `03-your-businesses.jpg`

38. **Blocks** · Delphine · Relaydesk desk, http://127.0.0.1:8820/desk/ca527b75-...  · The desk
    header and the "Waiting now" panel both say "Nothing is waiting right now" / "Nothing is waiting
    on you or the system in these records". The Products tab on the same desk shows "Customer
    requests: 4 open · 39 resolved" with one in "Received" updated 19 h ago. A customer has been
    waiting 19 hours and the desk says nothing needs me. I would have left. `03g-relaydesk-products-requests.jpg`

39. **Confuses** · Delphine · Relaydesk Products tab, same URL · Requests are shown only as
    eight-character codes ("44c25e67", "93cd185d") with "Updated 18 h ago"; the subject ("Password
    reset email late") appears only after clicking. Clicking a card highlights it, but the detail
    opens below all 39 resolved cards, off-screen; I thought the click had done nothing until I
    scrolled. `03n-request-detail-bottom.jpg`

40. **Confuses** · Delphine · Request detail · "Move to Assigned" assigned it to "Your team" with
    no choice of who. Priya is the only case worker; nothing says she will see it.

41. **Confuses** · Delphine · Signalwatch desk, http://127.0.0.1:8820/desk/a7ca9807-... ·
    Signalwatch is mid-sale (buyer.near has a proposal in escrow), yet the desk Overview says
    "Nothing is waiting right now" and the sale is not mentioned anywhere on the Overview. The only
    hint that a sale exists is on My activity ("You take part in 1 sale of a digital business. Open
    your receipts") and in "Ownership and continuity" under "Needs attention: A sale is proposed."
    Three places, three different stories. `03c-signalwatch-overview.jpg`, `03b-my-activity.jpg`

42. **Blocks** · Delphine · Sale and handover,
    http://127.0.0.1:8820/desk/a7ca9807-0a9e-49be-a992-f15e9b3f3da5/handover · The price of my own
    sale is "180 000 000 base units of tusd.near" and customer obligations "1 544 000 000 base
    units". The page says "No dollar value is shown: this page has no verified denomination for the
    asset." Elsewhere the same token is shown as "1.5 TUSD (exact: 1,500,000 base units)", so the
    product does know the denomination. I cannot tell whether I am selling for $180 or $180,000.
    `03d-signalwatch-handover.jpg`

43. **Confuses** · Delphine · Sale and handover, same URL · Steps 3 "The contract closes the sale"
    and 4 "Apply the close here" are both marked CURRENT. The only button is "Check the contract's
    outcome…" and a link "Sell directly through your wallet". Nothing on the page tells me what I,
    the seller, am waiting for or should do (accept? wait for the buyer?). "Accepted by: nobody yet"
    on my own proposal made me wonder whether I had to accept my own deal.

44. **Confuses** · Delphine · Sale and handover vs. Ownership and continuity · The same offer
    deadline is shown as "11/21/2026, 4:08:00 AM" on one page and "2026-11-21T12:08:00.738Z" (raw
    machine format) on the other, eight hours apart. "Read at block 1985 (stale)" appears four
    times on the handover page.

45. **Confuses** · Delphine · Performance, ...?view=performance · "Today's balances: Payments are
    off. Nothing is shown as $0." and "Latest whole month: −$36.00 from $0.00 in Sep 2026", while
    the table lower on the same page says Oct 2026 earned 56 (test dollars) from 14 charged uses,
    and the chart shows a cost bar and a contribution line of −$36 for Oct with no visible earned
    bar. Two parts of one page disagree about whether the business earned anything in October.
    `03e-signalwatch-performance.jpg`, `03f-performance-chart.jpg`

46. **Confuses** · Delphine · Performance, same URL · "Books" says "Contribution subtracts one
    from the other only as a demo, counting a test dollar as $1"; "Economics" further down says
    "No profit or margin is shown: revenue is in each offer's token and cost in USD, and they aren't
    converted here." Both cannot be true.

47. **Confuses** · Delphine · Performance vs. Ownership and continuity · "What customers are still
    owed: Unknown. More was earned than recorded as prepaid here" on Performance; "Prepaid by
    customers, not yet used: 1,544,000,000 base units of tusd.near" on Ownership. One page says
    unknown, the other gives an exact figure.

48. **Noise** · Delphine · Performance · The four "Digital operations" tiles and the "Customer
    uses" chart repeat the Overview exactly. The "Books" paragraph is the same text as on Rosa's
    empty desk. Figures such as "$0.045600", "3.3600¢", "0.2400¢", "to a millionth of a cent" and
    "Building the product: $0.000000 in the last 6 months over 1 requests".

49. **Confuses** · Delphine · Every desk Overview · An orange box "No background worker has run on
    this server: units wait until one runs or the customer settles." I do not know what a
    background worker is or whether that is my problem. The footnote "From this business's own
    records as of 2026-11-06 05:22 UTC" is tomorrow's date.

50. **Polish** · Delphine · Desk Overview chart · The "Customer uses" bar chart labels every empty
    month "0" but puts no figure on the one month with data (Oct, 14). The legend lists six states
    ("Awaiting settlement (not yet read back)", "Reserved, not yet settled", "Never reserved") for
    a chart that only ever shows one. `03c-signalwatch-overview.jpg`

51. **Confuses** · Delphine · Value, http://127.0.0.1:8820/desk/a7ca9807-.../value · "No range
    yet" with the calculation "Plan: 40 customers a month × $0 × 12 = $0". The product is sold at a
    price and earned 56 test dollars last month, but the valuation uses a planned price of $0 and a
    default "8 h/week × $30/h" of my own time, so the business is worth less than nothing. A buyer
    has already offered to buy it. `03h-signalwatch-value.jpg`

52. **Noise** · Delphine · Successor rehearsal, .../rehearsal · A full page (two paragraphs of
    explanation) whose single button "Run a rehearsal" is disabled: "AI products aren't rehearsed
    yet". All three of my businesses are AI products. `03i-successor-rehearsal.jpg`

53. **Confuses** · Delphine · Ownership and continuity, .../continuity · "Needs attention: The
    evidence shown is stale. Refresh to read it again." I pressed "Refresh evidence"; it worked
    ("Recorded a newer block"). "A sale is proposed" stays under "Needs attention" with no action.
    "Of which the owner can withdraw now: 36,000,000 base units" has no withdraw button. The "Also
    read one month (optional, yyyymm)" box is pre-filled "202611". `03j-continuity-stale.jpg`

54. **Confuses** · Delphine · Ledgerline desk, http://127.0.0.1:8820/desk/e49fe607-... · "Invoice
    reader v2 · Offered to customers · draft differs": "draft differs" from what? 25 of 81 runs
    "not usable" and 25 "returned", still "Nothing is waiting". `03k-ledgerline-overview.jpg`

55. **Polish** · Delphine · Sale and handover at 390 px · The page scrolls sideways (content 413 px
    wide in a 390 px viewport); the "Exact terms" card is cut off at the right edge.
    `03m-handover-phone-overflow.jpg`

56. **Polish** · Delphine · Desk Overview at 390 px · The "Customer uses" chart shows only Jun, Jul,
    Aug (all zero) and must be scrolled inside its box to reach the one month with data. The
    "Public page · Value · Team ..." link row wraps to two lines above a tab strip that is itself
    cut off ("Custon"). `03l-desk-phone-chart.jpg`

57. **Noise** · Delphine · Inbox, http://127.0.0.1:8820/inbox · "Nothing yet" in both sections
    while a customer request has been waiting 19 hours; the inbox and the desk's requests are
    different things, and nothing says so.

### Persona 4: Priya Raman (priya.near), helps out on Relaydesk, doing today's work

**Where I got to**: Operate told me I had no businesses and offered to start one. My work board
turned up under My activity > "Teams and invitations". On it I opened an assigned request, wrote
a note and moved it to Resolved; that part worked and showed my note in the request's history.

58. **Blocks** · Priya · Operate, http://127.0.0.1:8820/desk · As a case worker, the Operate page
    says "Your businesses: Nothing here yet. Start with an idea, or let us help you find one" with
    a "Start a business" button and a "Start another" button (another what?). Nothing points to the
    business I work on. I only found the board because My activity had a link.
    `04-priya-operate-empty.jpg`

59. **Confuses** · Priya · My activity, http://127.0.0.1:8820/activity · The board link is a bare
    row "Relaydesk · Case worker" with a "Leave" button next to it, under a paragraph explaining
    what a team member is not allowed to do. "Leave" is the most prominent control on the row I
    need to click to start my day. `04b-priya-activity.jpg`

60. **Confuses** · Priya · My activity, same URL · "My products: Relaydesk support desk from
    Relaydesk · Recent uses: completed · one unit used · 1 days ago" (nine rows). I am staff on
    Relaydesk; this says I have been buying and using it as a customer. I could not tell whether
    those are my uses or the customers' requests I handled.

61. **Confuses** · Priya · Use page, http://127.0.0.1:8820/uses/18356f8e-... · Opening one of
    those "recent uses" shows a four-step tracker where step 4 "Your result" is CURRENT and
    "Ready", then immediately below it a section "Before your first use: Buy uses with your own
    wallet, then enroll this device ..." with "You hold 0 TUSD in this account, and the contract
    shows 91 uses ready for you", "Make this device's key", "Review revoking the key in slot 0 (for
    a lost device)". A finished use and a never-started one on the same page; "slot 0", "enroll
    this device" and "register with the token" are unexplained. `04c-use-page-before-first-use.jpg`

62. **Confuses** · Priya · Team board, http://127.0.0.1:8820/team/ca527b75-... · The board is
    three columns of eight-character codes with "Updated 18 h ago". No subject, no customer, no
    urgency until a card is clicked, and the detail opens below the 40 resolved cards at the foot
    of the page. On the phone the columns stack, so the detail is after all 40 resolved cards.
    `04d-team-board.jpg`, `04e-team-board-phone.jpg`

63. **Noise** · Priya · Team board, same URL · The paragraph "Team membership is access inside
    Everstreet only. A member isn't an owner, a signer or an operator on the business's contract,
    holds no keys and can't move money, release, sell or change the team." is shown on My
    activity, on the board and on the owner's Team page. On the board it is the first thing under
    the title, before the work.

64. **Polish** · Priya · Request detail · After resolving, the note I wrote appears under "3.
    Resolved · Your team · just now" and a green "Resolved" badge. Good. But "Your team" is shown
    for every step rather than who did it; Delphine and I look the same in the history.
    `04f-request-resolved.jpg`

### Persona 5: Cara Okafor (cara.near), uses Ledgerline on an invoice, checks what she got and paid

**Where I got to**: I found Ledgerline, pasted an invoice, enrolled "this device" and pressed
"Authorize this one use". It stopped with "This request names a key that isn't yours." Cancelling
locked me out of a new request for three minutes. I never got my invoice read. I could open an
earlier result (one that was returned because the invoice date was missing) and it was clear and
honest. I could not find a single place that says what I have paid in total.

65. **Blocks** · Cara · Use page, http://127.0.0.1:8820/use/f78de48b-... · I pasted an invoice,
    pressed "Add your document", then "Make this device's key" and "Ask my wallet to enroll exactly
    this" (both succeeded: "Ready: the contract shows this device's key enrolled"). Then "Authorize
    this one use" failed: "This request names a key that isn't yours." The device the page just
    enrolled is the one it then rejects. No way forward was offered except "Cancel this request".
    `05d-authorize-key-not-yours.jpg`

66. **Blocks** · Cara · Use page, same URL · After cancelling, the page said "The authorization
    prepared for your stopped request stays valid on the contract until 9:36:57 PM. To keep your
    units safe, a new request for them can start only after that." That is a three-minute lockout
    with a "Check again" button and no document box; my pasted invoice was gone from view. A
    customer who hit a product bug is then made to wait. `05f-cancelled-lockout-phone.jpg`

67. **Confuses** · Cara · Use page, same URL, on first arrival · The page is headed "Before your
    first use" while telling me "You hold 10 TUSD in this account, and the contract shows 80 uses
    ready for you" and listing eight previous uses underneath. It is not my first use. Two columns
    ("Buy uses" with a prefilled "10" and "Total: 4 TUSD", and "Use this product on this device"
    with "Make this device's key", "Review revoking the key in slot 0 (for a lost device)") sit
    above the actual document box, which is below the fold. I read about keys and slots before I
    found where to paste. `05c-use-page-top.jpg`

68. **Confuses** · Cara · Use page · The enrolment review lists "Deposit: 1 yoctoNEAR (the
    contract requires exactly 1)", "Gas: up to 30 Tgas", "Key slot: 1", "This device's public key:
    d97de437...". I was asked to approve things I cannot evaluate; nothing says what happens if I
    press "Not now".

69. **Confuses** · Cara · Use page and My activity · "Authorizing isn't available here ...
    Authorizing uses isn't connected on this server yet: there is no wallet here, and nothing is
    signed for you" appeared under "Ready to review" before I enrolled the device, then the
    "Authorize this one use" button appeared after enrolling. The page told me authorizing was
    impossible and then offered it.

70. **Confuses** · Cara · My activity, http://127.0.0.1:8820/activity · "Recent uses: Invoice
    reader v2 · ended, unit returned · unit returned · 2 days ago" says "unit returned" twice. No
    totals: how many units I bought, how many used, what I paid. The use page says "80 units free,
    20 used, as read from NEAR block 1884 at 11/3/2026" (two days stale), the business page says
    "0.4 TUSD" per use; I had to multiply myself to guess I have spent 8 TUSD, and nothing
    confirms it. `05a-cara-activity.jpg`

71. **Polish** · Cara · Earlier use, http://127.0.0.1:8820/uses/db095f5e-... · Step 4 said "Your
    result: Ready. Only you can read it." until I pressed "Show my result"; it then changed to
    "NEEDS CHECKING: Not a complete extraction." The warning should be there before I open it. The
    result itself ("Missing: Invoice date", unit returned, nothing charged, fields in a table, Copy
    JSON, Download) was clear. `05e-returned-result.jpg`

72. **Confuses** · Cara · Ledgerline page, http://127.0.0.1:8820/b/ledgerline · The page badge
    says "Shaping" and the side note says "Its digital product is offered above. Nothing else is
    open to book here yet", while Explore lists it under "Testing interest" and "Open for customers
    (0)". It is open for customers; three pages describe it three ways. `05b-ledgerline-page.jpg`

73. **Noise** · Cara · Use page · "Check the contract again" appears three times on one screen
    (under Buy uses, under the device section, and under the request). "Result kept for: 30 days,
    readable only by you here. How long this product keeps your result for you to open. It isn't a
    statement about copies kept by any service it uses." is a disclaimer on a disclaimer.

### Persona 6: Noah Brandt (buyer.near), mid-purchase of Signalwatch

**Where I got to**: Acquire showed me a buying-profile form and "0 of 0 businesses open to buyers";
Portfolio said "No businesses yet · Considering (0)". My deal was under Handovers (reached from My
activity's "Open your receipts"). The sale page was the clearest screen in the product: price in
TUSD, what is and is not included, a six-step tracker, and an "Accept version 1" review that said
exactly what would be sent. I accepted; the page now says "Waiting for the seller to accept."

74. **Confuses** · Noah · Acquire, http://127.0.0.1:8820/acquire · Signed in as the buyer with
    180 TUSD in escrow on a live deal, the Acquire page opens with a blank "Set up a buying
    profile" form and a listing of "0 of 0 businesses open to buyers". Nothing says a deal of mine
    is in progress or where it is. The business I am buying is not listed anywhere here.
    `06-acquire-buyer-profile.jpg`, `06b-acquire-zero-listings-buyer.jpg`

75. **Confuses** · Noah · Portfolio, http://127.0.0.1:8820/portfolio · "No businesses yet.
    Considering (0): Nothing shortlisted. Former (0)." A buyer who has funded escrow and is one
    acceptance from owning Signalwatch would expect it under "Considering" at least. The page also
    shows two unlabelled pills "Oct 8 – Nov 6" and "Nov 6, 05:29 UTC" (tomorrow's date).
    `06d-portfolio-empty.jpg`

76. **Confuses** · Noah · Handovers, http://127.0.0.1:8820/handovers · The deal is reached via
    "Business handovers ... Open your receipts" on My activity; the word "receipts" did not make me
    think of a purchase in progress. The card shows "Deal: Number 1, version 1 · Recorded
    10/31/2026" and a "Check the contract's outcome…" button, but not the price, the step we are
    at, or that it is waiting for me. `06c-handovers.jpg`

77. **Confuses** · Noah vs. Delphine · Sale page, http://127.0.0.1:8820/sales/a7ca9807-... · The
    buyer's page shows "Price 180 TUSD" and "Prepaid, not yet used: 1544 TUSD"; the seller's page
    for the same deal shows "180 000 000 base units of tusd.near" and says no denomination is
    known. The same deal is shown in money on one side and in raw units on the other.
    `06e-sale-page.jpg`, `03d-signalwatch-handover.jpg`

78. **Confuses** · Noah · Sale page, same URL · After my acceptance was recorded, "Other actions:
    Take your escrow back · Cancel the offer" are still offered. I did not know whether "Cancel
    the offer" cancels the seller's offer or my acceptance, or whether taking escrow back would
    undo what I just did. `06g-after-accept.jpg`

79. **Noise** · Noah · Sale page, same URL · The terms block (Price, Seller · buyer, Deal, Accepted
    by, Escrow, Offer open until ...) appears twice: once in "Exact terms, as the contract shows
    them" and again in "Review: Accept this version". The right column ("Authority the buyer
    receives", "Customer obligations that stay with the business", "Not included") restates the
    "Included / Not included" lists on the left. Base-58 transaction ids ("9e5bCnLuHufjF5...") are
    printed in full with no label of what they are for.

80. **Confuses** · Noah · Accept review · "Attached NEAR 0.000000000000000000000001 NEAR", "Gas: up
    to 30 Tgas", "Request: accept_sale", "Sent to signalwatch.demo.near". The review is honest but
    a buyer is asked to approve values with 24 decimal places and no plain reading of them. The
    offer deadline is shown as "Nov 21, 2026, 04:08 AM PST (2026-11-21 12:08:00 UTC)" here and
    "11/21/2026, 4:08:00 AM" two sections below. `06f-accept-review.jpg`

81. **Polish** · Noah · Acquire at 390 px · The page scrolls sideways (content 535 px wide in a
    390 px viewport). The sale page itself fits the phone and reads well.
    `06i-acquire-phone-overflow.jpg`, `06h-sale-page-phone.jpg`

## The five worst

1. **Rosa cannot get anything real to sell from the front door.** The home page's big "What do you
   want to build?" box leads into a Product studio whose Builds tab says builds cannot be started,
   whose Service tab says build one first, and whose business desk says build and test a version:
   a loop with no exit (#19). The route that works, "Start a business", is three clicks away and
   never pointed to (#29).
2. **A customer cannot use Ledgerline.** After enrolling the device key as instructed, "Authorize
   this one use" fails with "This request names a key that isn't yours", and cancelling imposes a
   three-minute lockout with no way to retry (#65, #66).
3. **The owner's desks say "Nothing is waiting" while work and a sale are waiting.** A customer
   request sat 19 hours in "Received" and the Signalwatch sale is in progress; neither appears on
   the Overview, the business list, or the Inbox (#38, #41, #57).
4. **The seller sees her sale price as "180 000 000 base units of tusd.near" with "no verified
   denomination", while the buyer sees "180 TUSD" for the same deal** (#42, #77). Performance,
   Value and Ownership pages also disagree on what was earned and what customers are owed (#45,
   #46, #47, #51).
5. **Signed out, the marketplace and the catalogue are empty or contradictory.** Acquire shows "0
   of 0 businesses" even to the buyer mid-deal (#7, #74), Explore says "Open for customers (0)"
   while three products are offered to customers, and every status badge says "Testing interest"
   or "Shaping" regardless of state (#5, #34, #37, #72).

## What worked well

- The six-question "Start a business" wizard: one question per screen, a live customer-view
  preview on the right, a "Still to decide" list that shrinks as you go, a plain-language publish
  screen ("Here is exactly what publishing does"), and a first-week to-do list with a ready-to-send
  message. Rosa went from nothing to a public, bookable page in a few minutes.
- The buyer's sale page: the six-step tracker, "Included / Not included" in plain words, and an
  acceptance review that states what will be recorded and what cannot be guaranteed. Accepting
  worked and the page updated to "Waiting for the seller to accept."
- Honest results for customers: a use whose invoice lacked a date was returned uncharged, with the
  missing field named and the rest shown in a table with Copy JSON and Download.
- The home-page sample run: one click, a believable extraction, and a note on what a real run would
  charge.
- "Refresh evidence" on Ownership and continuity did what it said and reported the new block.
- The case board: moving a request to Assigned and to Resolved with a note worked first time, and
  the note appeared in the request's history.
- No sideways scrolling on most phone screens; text stays readable at 390 px.

## What I understood the product to be (judge, after five minutes)

Everstreet is a place to shape a small online product (an AI API, a SaaS tool, an agent or a
portal), publish a page for it, take prepaid customer payments through a contract on NEAR testnet,
and later sell the whole business so that the buyer gets control and the customers keep exactly what
they paid for. The strongest proof is a recorded testnet sale of an example business; the building
and running parts are visibly unfinished, and the marketplace shows nothing for sale.

## Counts by severity

- Blocks: 7 (#7, #19, #38, #42, #58, #65, #66)
- Confuses: 47
- Noise: 15
- Polish: 12
- Total: 81
