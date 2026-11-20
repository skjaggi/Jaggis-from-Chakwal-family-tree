# Family Tree Product: Requirements (draft)

**Status:** draft, 20 November 2026 (updated with Sunil's answers the same day). Nothing here is built yet. Items marked **Decision needed** are waiting for Sunil.

This document plans how the Jaggis of Chakwal family tree becomes a product that **any family** can sign up for, set up on their own, and use, with no technical help. The Jaggi site (https://familytree.sjaggi.com) keeps working exactly as it does today and becomes the product's first family ("tenant #1").

The requirements of the Jaggi site itself stay in [`REQUIREMENTS.md`](REQUIREMENTS.md). This document reuses everything described there and only lists what changes or is added for the product.

*Working name:* until a brand is chosen, this document calls the product **"the product"** and a family's tree **"a family site"**.

---

## 1. Goal

Turn the family tree into a product that:

1. Anyone can start in a few minutes: sign up, name their family, pick a look, add the first people, invite relatives by email.
2. Contains nothing about the Jaggi family unless the family is the Jaggi family: no Jaggi logo, names, badges, Help text, emails or seed data.
3. Is easy for people who are not technical at all, both the person who starts the tree (the family admin) and the relatives they invite.
4. Works on any phone or computer, and later from the App Store and Google Play.
5. Earns money in a way families find fair, without charging the relatives who are invited.

## 2. What exists today, and what is Jaggi-specific

The current site is about 6,000 lines of plain JavaScript plus a Supabase database. Almost all of it is general family-tree work that every family needs. The Jaggi-specific parts are few and well contained:

| Area | What is Jaggi-specific today | What the product needs instead |
|---|---|---|
| Name and logo | "Jaggis of Chakwal", the Jaggis logo images, page titles, Google site name | Family name, tagline and logo chosen in setup; a simple monogram logo is made automatically if they have none |
| Colours | Banyan teal and gold | A few colour themes to pick from, plus a custom main colour |
| Footer | "© 2026 Jaggi Family and Quantum Nexus LLC", Quantum Nexus mark | "© <year> <family name>" plus a small "Made with <product>" link |
| Help manual | Written about the Jaggi family, with Jaggi screenshots | One general manual for all families, showing the family's own name, with neutral sample screenshots |
| Founder and Creator badges | Hard-coded for Suraj and Sunil by account id | Admin can create their own special badges and give them to anyone |
| Blessings | Generation 1 named as Bakhshi Bhanna Mal Jaggi; fixed point values | Root ancestor's name filled in automatically; admin can turn Blessings on or off and adjust points |
| Branches | Branches start at Generation 4 (fixed in code and database) | Admin picks the branch level in settings (default: the root's grandchildren) |
| Welcome texts | "Welcome dear member of Jaggi Family!", invite wording, reminder wording | Wording uses the family name; the admin can edit invite and reminder texts |
| Library | Topics such as "Chakwal history", "Partition 1947", "Arya High School" | Starts with general topics (Family history, Places, Old photos, Other); admin adds their own |
| Seed data | 70 people from the two Jaggi PDFs | Every new family starts empty (or from a GEDCOM file they bring) |
| Ancestors pages | Built for one site, one domain | Built per family, only if the family turns them on (off by default) |
| Emails | Sent from the family Gmail account, "Jaggi family tree" as sender name | Sent by the product's email service, with the family name as sender name and replies going to the family admin |
| Addresses | familytree.sjaggi.com hard-coded in the email functions | Each family's own address |
| Visitor counter | GoatCounter code "jaggis-chakwal" | One counter for the product; each family sees only its own numbers |
| GEDCOM export | Source "JAGGI_FAMILY_TREE", file name jaggi-family-tree | Product name and family name |

**Conclusion:** the work is not a rewrite. It is (a) moving these items into **settings** each family controls, (b) letting one database hold **many families** safely, and (c) adding **sign-up, a setup wizard and billing**.

## 3. Build options

### 3.1 How families are hosted

| Option | What it means | Good | Not so good |
|---|---|---|---|
| **A. One shared platform (multi-tenant)** *(recommended)* | One website and one database. Every row of data carries the family it belongs to, and the database's security rules keep families apart (the same kind of rules that already keep "Family branch only" details private). Each family gets its own address, such as `smith.<product>.com`. | One thing to run, fix and improve; a new family is ready in seconds with no setup by us; cheapest to run; easiest for non-technical families | Security rules must be right (a mistake could show one family's data to another), so this needs strong automatic tests, which the project already has |
| B. A separate copy per family | Each family gets its own database and website copy | Families are completely apart | Every family needs setup by hand; every fix must be applied hundreds of times; Supabase's free plan allows only 2 projects, paid ones cost about $25 a month each, which is more than a family would pay |
| C. Self-host | Families download the code and run it themselves | Families own everything | Only technical people can do it, which is the opposite of who the product is for |

**Recommendation: A.** Offer C later, only if there is demand, as an "export everything" feature (GEDCOM + photos in a zip) rather than as self-hosting, so families never feel locked in.

### 3.2 Phone apps

| Option | What it means | Recommendation |
|---|---|---|
| **Web app + "Add to Home Screen" (PWA)** | The same website installs like an app on phones, with its own icon, and opens full screen | **First.** No app store approval, no store fees, one code base. |
| **Store apps from the same code** (Capacitor) | The website is wrapped into real App Store and Google Play apps | **Second**, once the product has paying families. Costs about $99 a year (Apple) and $25 once (Google). Apple takes 15% of payments made inside an iPhone app, so subscriptions are sold on the website. |
| Separate native apps | iPhone and Android apps written from scratch | Not recommended: two more code bases to keep in step. |

### 3.3 Technical changes (plain summary)

- **Families in the database:** a new `families` table (name, address, logo, colours, settings, plan). Every existing table gets a `family_id`. Every security rule also checks the family. The Jaggi data becomes family #1 with no change visible to Jaggi members.
- **Membership per family:** a person can belong to more than one family site with one login (for example, someone in both their own and their spouse's family tree). Roles (admin, branch admin, member) are per family.
- **Website hosting:** move from GitHub Pages to a host that handles many addresses and custom domains (Cloudflare Pages is free and supports this; Netlify and Vercel are similar). familytree.sjaggi.com keeps working.
- **Email:** Gmail cannot be used to send a product's emails. Use an email service such as Resend or Postmark (free for small volumes, then about $20 a month), sending from the product's own domain.
- **Payments:** Stripe (no monthly fee; about 3% per payment). Stripe handles cards, receipts and cancellations.
- **Supabase plan:** move to Supabase Pro (about $25 a month) before the first paying family, for daily backups and no pausing. One project serves all families.
- **Code repository:** the current repository is **public**. A product's code should live in a **private** repository so others cannot copy it. **Decision needed.**

## 4. Commercial options

### 4.1 What others charge (approximate, late 2026; to be checked before pricing)

| Product | Focus | Price |
|---|---|---|
| FamilySearch | One shared world tree, run by a church | Free |
| Ancestry | Historical records and DNA; trees free | Records about $25 to $60 a month |
| MyHeritage | Records, DNA, family sites | Free up to 250 people; about $130 to $300 a year for bigger sites and records |
| Geni | One shared world tree | Free; Pro about $120 a year |
| TribalPages and similar | Private family website with a tree | Free small sites; about $30 to $100 a year |

**Where this product fits:** the big names sell **record searching and DNA**. Few offer what this site already does well: a **private, beautiful, family-run site** where relatives fill in their own branches, with approvals, branch admins, privacy per detail, stories, a library, Blessings to keep people adding, and a printed family book. A natural first audience is **families of the South Asian diaspora** (and other close-knit extended families), where oral history is strong, records are scarce, and family elders want something to pass on.

### 4.2 Ways to charge

| Model | How it works | Comment |
|---|---|---|
| **Freemium, priced per family** *(recommended)* | Free plan for small trees; one yearly price per family for the full product. **Invited relatives never pay.** | Lets families try without risk; one decision-maker pays; relatives join freely, which grows the product |
| Price per member | Each member pays | Puts off the relatives you most need. Not recommended. |
| One-time lifetime purchase | Pay once | Simple for older buyers, but we keep paying hosting forever. Offer later, priced high, if asked for. |
| Printed book upsell | The family orders the coffee table book printed from their tree | High value, ties in with Sunil's own book; added on top of any plan |
| Custom domain add-on | Use their own address (like familytree.sjaggi.com) | Small yearly add-on |

### 4.3 Suggested plans (starting point for discussion)

| | Free | Family | Heritage |
|---|---|---|---|
| Price | $0 | about $49 a year (or $5 a month) | about $99 a year |
| People in the tree | up to 150 | unlimited | unlimited |
| Photos | up to 100 | up to 5,000 | up to 25,000 |
| Members | unlimited | unlimited | unlimited |
| Logo and colours | colours only | yes | yes |
| Branch admins and approvals | yes | yes | yes |
| Blessings, Library, Dashboard | Dashboard only | yes | yes |
| PDF family book and GEDCOM export | GEDCOM only | yes | yes, plus book design templates |
| Own address (custom domain) | no | add-on | included |
| Remove "Made with <product>" | no | no | yes |
| Help | Help manual | email help | priority help, setup call |

Printed books are ordered separately through a print-on-demand partner (for example Lulu or Blurb, which print and ship hardcover books), with the product adding a margin.

**Recommendation:** freemium per family with a yearly plan, members always free, printed books as the add-on. Start with a **free pilot** for 5 to 10 families Sunil invites (April to May 2027) before charging anyone.

**Decision needed:** price levels. Selling under Quantum Nexus LLC is under consideration (Sunil, 20 Nov 2026).

## 5. Product requirements

### 5.1 Sign-up (no technical knowledge needed)

1. A public home page explains the product with pictures, plans and a **Start your family tree** button.
2. Sign-up asks only for email and the person's name. No password: an emailed code or link, as on the Jaggi site today.
3. Optional sign-in with Google or Apple (one tap) for people who prefer it.
4. The person who signs up becomes the **family admin** of the new family site.

### 5.2 Setup wizard

A friendly step-by-step screen, one question per screen, with **Back**, **Skip for now** and a progress bar. Everything can be changed later in **Family settings**.

1. **Your family's name**, for example "The Mehtas of Lahore". A short tagline is optional.
2. **Your site's address**: suggested from the name (`mehtas-of-lahore.<product>.com`); the person can change it; the wizard says at once if it is taken.
3. **Your logo**: upload a picture, or pick one of the automatically made monograms (initials in a crest). Cropping is done on screen.
4. **Your colours**: pick one of 6 to 8 ready-made themes (with a live preview of the tree), or choose a main colour. Light and dark work automatically.
5. **Who is at the top of your tree?** Two choices: "Start with me" (they add themselves, then parents and grandparents) or "Start with our earliest ancestor" (they type that ancestor's name).
6. **Privacy**: one simple choice, with a plain explanation:
   - *Private family site* (default): only invited members see anything.
   - *Names public, details private*: like the Jaggi site today.
7. **Bring an existing tree** (optional): upload a GEDCOM file from Ancestry, MyHeritage, FamilySearch and others. *Later:* upload a photo or PDF of a hand-drawn tree and the product reads it and suggests the people (this is how the Jaggi tree was started).
8. **Add your first people**: a quick form for parents, spouse, children and siblings, all on one screen.
9. **Invite your family**: type names and emails (or paste a list); for each invitee, optionally pick their box in the tree so they land on it. WhatsApp and Copy message buttons as today.
10. **Done**: the tree opens, with a **Getting started checklist** on the Dashboard (add a photo, add 10 people, invite 3 relatives, make your first branch admin).

The whole wizard should take **under 10 minutes**.

### 5.3 Family settings (admin)

Everything the wizard asked, plus:

- **Branding:** name, tagline, logo, favicon, colours, footer text.
- **Address:** subdomain; custom domain (with plain step-by-step instructions and a "check my domain" button).
- **Privacy defaults:** site private or names public; default for new details and photos (Family branch only by default); rules for marriage dates and adoption labels (today's Jaggi rules as defaults).
- **Branches:** which generation branches start at (default: the root's grandchildren), with a preview of the branches this makes.
- **Who can invite:** any member (default) or admins only.
- **Blessings:** on or off; point values; generation multipliers; badges, including **special badges** the admin creates (name, icon, description) and gives to people, such as "Founder of our family tree".
- **Library:** on or off; topics.
- **Public ancestor pages for search engines:** off by default; when on, only for people marked as passed away, with Public details only.
- **Emails:** sender name (default: the family name), reply-to address (default: the admin), editable invite and reminder wording, with preview.
- **Admins:** add or remove other admins; transfer ownership of the family site.
- **Plan and billing:** current plan, usage (people, photos), upgrade, invoices, cancel.
- **Export everything / delete family site:** a zip with GEDCOM, photos and stories; deleting needs typing the family name and waits 30 days before it is final.

### 5.4 Everything the Jaggi site does today

Every feature in `REQUIREMENTS.md` sections 4 to 8 becomes available to every family, using the family's settings instead of Jaggi values: tree view (own line, Start tree from, search, hover balloon, compact layout, spouses), person card, suggestions and approvals, branch admins and claiming your box, Review with Undo, Members page, Missing details emails, reminders, View as, Dashboard, PDF family book (with the family's logo), GEDCOM export, Blessings, Library, Help, light and dark.

### 5.5 Help manual

- One manual for all families, written for non-technical readers, using "your family" and the family's name where it appears.
- Neutral screenshots made from a made-up sample family.
- Short "how to" videos for the three main jobs: set up your site, add people, invite relatives.
- A separate **Admin guide** for family admins.
- A help button on every screen opens the right section.

### 5.6 Product owner tools (for Sunil)

- A **product dashboard**: number of families, members, people, photos; sign-ups per week; plans and income; families near their plan limits.
- Look up a family (with their permission) to help them; read-only by default.
- Suspend a family site for abuse; send announcements to family admins.
- The product owner cannot read a family's private details without the family admin turning on "Allow support access".

### 5.7 Privacy, security and legal

- Families' data kept fully apart by database rules, tested automatically on every change (extends today's privacy tests).
- Privacy Policy and Terms of Service pages; cookie-free visitor counts.
- Living people's details private by default; anyone can ask for their own details to be removed.
- Children: no accounts for under-13s; their details are added by family and stay Family branch only.
- Daily backups (Supabase Pro), photo storage backed up too.
- Data stored in the United States at first; EU storage later if needed for European families.

### 5.8 Quality

- Works on current iPhone and Android browsers and desktop Chrome, Safari, Edge and Firefox; installable as a home-screen app.
- A tree of 5,000 people stays smooth on a mid-range phone.
- English first; names accept any script. Hindi and Punjabi screens are a good later step for the first audience.
- Accessible: large tap targets, readable font sizes, works with screen readers.

## 6. Keeping the Jaggi site working

- The Jaggi site keeps running unchanged on familytree.sjaggi.com while the product is built.
- The product is built in a new private repository started from this code. The Jaggi repository stays as it is until the switch.
- When the product is ready, the Jaggi data moves in as family #1, with the Jaggis logo, banyan colours, Founder and Creator badges (as special badges), Library topics, branch level 4 and current privacy rules all set as **its settings**. Members keep their logins, boxes, blessings and history. familytree.sjaggi.com points at the product.
- The move is done with a full backup and a rollback plan, and only with Sunil's go-ahead.

**Sunil (20 Nov 2026):** test moving the Jaggi site onto the product, as long as it is seamless for the Jaggi family. "Seamless" means:

- Same address (familytree.sjaggi.com), same look, logo, menu and Help wording for the Jaggi family.
- Nobody has to sign up again: the same emails sign in the same way; claimed boxes, roles, blessings, badges, Library links, pending suggestions and history are all kept.
- No visible downtime: the move is rehearsed first on a copy of the Jaggi data on a test address, Sunil and a few relatives try it, and only then does the real address switch over (late evening Arizona time, a few minutes at most).
- If anything is wrong, the address switches straight back to today's site, which stays untouched until the move has run well for a month.

## 7. Phases and timeline

Sunil (20 Nov 2026): spread the work over about six months, with the paid launch in **June 2027**. The coffee table book (first quarter of 2027) runs alongside.

| Phase | What | When (target) |
|---|---|---|
| 0. Settings first | Move every Jaggi-specific item in section 2 into settings, in the current code, with Jaggi values. The Jaggi site looks the same. | December 2026 to mid-January 2027 |
| 1. Many families | Families table, family-aware security rules and tests, new hosting, email service, family addresses | mid-January to February 2027 |
| 2. Sign-up and wizard | Home page, sign-up, setup wizard, Family settings, general Help manual, product dashboard | March 2027 |
| 3. Pilot | 5 to 10 families Sunil invites, free; fix what confuses them; rehearse and then make the Jaggi site move (section 6) | April to May 2027 |
| 4. Paid launch | Plans and Stripe billing, Privacy Policy and Terms (reviewed, see section 9), custom domains | **June 2027** |
| 5. Later | App Store and Google Play apps, printed book ordering, GEDCOM import improvements, read a photo of a hand-drawn tree, Hindi and Punjabi | after June 2027 |

These are targets, not promises; the pace leaves room for the book work and for what the pilot families teach us.

## 8. Running costs

Sunil (20 Nov 2026): about $50 a month is fine. Prices below are the services' published list prices as of late 2026 and should be rechecked when each is signed up for.

### 8.1 Monthly costs from the pilot onward

Nothing needs to be paid while the product is being built (December 2026 to March 2027): the free plans are enough. Paid plans start with the pilot in April 2027, because real families' photos and stories need daily backups.

| Item | What it is for | Plan | Cost a month |
|---|---|---|---|
| **Supabase** | The database for all families (people, relationships, members), sign-in, photo storage, and the small server programs that send emails | Pro: includes daily backups, 8 GB of data, 100 GB of photos, 100,000 members a month, no pausing | **$25** |
| **Email service** (Resend or Postmark) | Sending invitations, sign-in codes, reminders and receipts from the product's own address, reliably and without landing in spam | Free up to 3,000 emails a month; the next plan (50,000 a month) | **$0 during the pilot, then $20** |
| **Product domain** | The product's web address (for example `<brand>.com`) and its email address | One domain | **about $1.25** ($15 a year) |
| **Website hosting** (Cloudflare Pages) | Serving the website itself, the families' own addresses (`smith.<brand>.com`) and custom domains | Free; the first 100 custom domains are free, then about 10 cents each a month | **$0** |
| **Visitor counts** (GoatCounter) | Anonymous visit numbers, no cookies | Free for this size | **$0** |
| **Code and tests** (GitHub, private repository) | Keeping the code and running the automatic tests | Free plan includes 2,000 test minutes a month | **$0** |
| **Total** | | | **about $26 during the pilot, about $46 once launched** |

### 8.2 Costs that only come with income or later

| Item | When | Cost |
|---|---|---|
| **Stripe** (card payments) | Each payment | 2.9% + 30 cents; on a $49 yearly plan about $1.72, so the family's $49 brings in about $47.28 |
| **More photo space** | Only when all families together pass 100 GB of photos (roughly 150,000 photos) | about 2 cents per extra GB a month |
| **Bigger email plan** | Only above 50,000 emails a month | about $35 to $90 a month |
| **Apple developer account** | When the iPhone app comes (after June 2027) | $99 a year (about $8 a month) |
| **Google Play developer account** | When the Android app comes | $25 once |
| **Trademark for the brand name** | When the name is chosen | about $350 per class with the US Patent and Trademark Office, plus any lawyer fee |
| **Lawyer help** | Before the paid launch | one-off; see section 9 |

**Break-even:** at about $47 a family after Stripe fees, **one Family plan a month** (12 families a year) covers the running costs once launched.

### 8.3 What the Jaggi site costs today

Nothing: it runs on the free Supabase plan, GitHub Pages and Gmail. It keeps running this way until it moves onto the product (if decided).

## 9. Legal help (Sunil has no lawyer yet)

*This is a list of options to explore, not legal advice.* A lawyer is not needed to build the product, but should look at the documents below before families pay (June 2027), and ideally before the pilot.

### 9.1 What the product needs a lawyer for

| Need | Why |
|---|---|
| **Terms of Service** | The agreement every family admin accepts: what they may upload, who owns the family's content (the family), limits on our responsibility, cancellation and refunds |
| **Privacy Policy** | Required by law for any site that collects names and emails; must cover information about **living people added by relatives**, children's information, and US state laws such as California's |
| **Photo and copyright policy** | How to handle someone asking to remove a photo they own or that shows them |
| **Brand name and trademark** | Check the chosen name is free to use, then register it |
| **Company and insurance** | Whether selling under Quantum Nexus LLC is the right set-up (an Arizona LLC already gives personal protection), and whether to buy cyber liability insurance in case of a data breach |
| **Overseas families** | If families in the EU or UK sign up, their privacy rules (GDPR) add a few requirements |

### 9.2 Ways to get legal help, cheapest first

| Option | What you get | Rough cost |
|---|---|---|
| **Policy generators** (Termly, iubenda, TermsFeed) | Fill in a questionnaire; they write the Privacy Policy and Terms and keep them updated as laws change. A good starting draft for a lawyer to review. | free to about $15 a month |
| **SCORE** (score.org) | Free mentoring for small businesses from retired business people, some of them lawyers; good for "what do I need?" questions | free |
| **State Bar of Arizona lawyer referral** (and the Maricopa County Bar referral service) | Introduces you to a local business or technology lawyer, usually with a low-cost first half-hour consultation | about $35 to $50 for the first consultation |
| **Legal plans** (LegalZoom, Rocket Lawyer) | A monthly plan with short calls to an attorney and document reviews; trademark filing packages | about $40 a month, or a few hundred dollars for a trademark package |
| **Flat-fee lawyer marketplaces** (UpCounsel, ContractsCounsel) | Post the job ("review Terms of Service and Privacy Policy for a family history website"); lawyers quote a fixed price | about $500 to $1,500 for both documents |
| **Small-business or technology law firm** | Full review and ongoing advice | $250 to $450 an hour |

**Suggested path:** a policy generator for the drafts (now, free), a referral-service consultation to confirm what is needed (before the pilot, about $50), then a flat-fee review of the final Terms and Privacy Policy plus the trademark (spring 2027, about $1,000 to $2,000 all together).

## 10. Brand and domain names

Sunil (20 Nov 2026): suggest names that work for families in the US, India and other countries; the final choice comes closer to development.

**What makes a good name here:** short and easy to spell in any accent; plain English words that Indian, American and other families all know; nothing tied to one religion, caste, language or country; a matching **.com** available at the normal price; ideally a picture behind it. The **banyan** tree is a good picture for all audiences: it is India's national tree, a symbol of long life and shelter, well known in the US, and its branches grow down into new roots, just like a family. It also matches the look the Jaggi site already has.

### 10.1 Suggested names with a .com that is free to register

Checked on 20 Nov 2026 in the .com registry (not registered) and at Porkbun (price). An unregistered .com always costs the normal price; there are no premium .com prices from the registry. Prices are Porkbun's; GoDaddy and Namecheap charge about $11 to $25 for the first year and about $15 to $23 a year to renew.

| Name | Domain | Why it fits | First year | Renews at |
|---|---|---|---|---|
| **BanyanKin** *(top pick)* | banyankin.com | Banyan (India's tree, known everywhere) + kin (family); short, unusual, easy to remember; fits today's look | $11.81 (checked) | $11.81 |
| **Tree of Family** | treeoffamily.com | Says exactly what it is in plain English; easy for older relatives | $11.81 (checked) | $11.81 |
| **KinTapestry** | kintapestry.com | Families woven together; warm and premium-sounding, good for the printed book | $11.81 (checked) | $11.81 |
| **Banyan Lineage** | banyanlineage.com | Clear that it is about ancestry; dignified | $11.81 (checked) | $11.81 |
| **Banyan Lines** | banyanlines.com | Family lines growing from one tree | $11.81 | $11.81 |
| **KinshipMap** | kinshipmap.com | Says what it does (how everyone is related) | $11.81 | $11.81 |
| **Our Roots Tree** | ourrootstree.com | Simple, friendly | $11.81 | $11.81 |
| **Roots Ever** / **Banyan Ever** | rootsever.com, banyanever.com | "Our roots, forever" | $11.81 | $11.81 |
| **Vansh Kin** | vanshkin.com | *Vansh* is Hindi and Punjabi for lineage; strong for Indian families, less clear to others | $11.81 | $11.81 |

"(checked)" means the Porkbun price was looked up for that exact name; the others are unregistered .com names, which are always the standard price. All names still need a **trademark search** before choosing (see section 9).

### 10.2 Good names whose .com is taken

| Name | .com | Other endings free to register (first year, then yearly) |
|---|---|---|
| FamilyBanyan | **For resale at $120,000** | familybanyan.app ($8.75, then $14.93); familybanyan.family ($5.66, then $35.53) |
| Kinlines | Taken, not listed for sale | kinlines.app ($8.75, then $14.93); kinlines.family ($5.66, then $35.53) |
| OurBanyan | Taken | ourbanyan.app ($8.75, then $14.93); ourbanyan.family |
| KinRoots | **For resale at $10,000** | kinroots.family |
| KinKeeper | **For resale at $9,999** | none (.app and .family are taken too) |
| Vanshavali | **For resale at $4,595** | n/a |
| KinStory, Heritree, Rootline, KinNest | Taken, not listed for sale | .family versions free |

**Advice:** prefer a name with its **.com** free at the normal price (section 10.1). People type ".com" by habit, and emails from a .com are trusted more. A **.family** address looks charming but renews at about $35 a year. Once a name is chosen, also register the **.in** (India, about $8 a year) and possibly **.app**, so nobody else takes them: about $35 a year for all three.

## 11. Open questions for Sunil

Answered on 20 Nov 2026: brand name (decide closer to development; suggestions in section 10), running costs (about $50 a month is fine; no designer for now), timeline (launch June 2027), pilot families (Sunil will find 5 to 10), Jaggi site (test moving it over, as long as it is seamless for the family), company (selling under Quantum Nexus LLC is being considered). Still open:

1. **Pricing.** Are you comfortable with freemium and roughly $49 a year per family, members free? Or do you prefer one-time payments, or free with paid printed books only?
2. **First audience.** Start with families of the South Asian diaspora, or everyone from day one?
3. **Code.** OK to build the product in a new private repository (recommended), leaving the Jaggi repository public?
4. **Brand name.** Any favourites from section 10, so the .com can be registered before someone else takes it (about $12)?

## 12. Decisions

| Date | Decision |
|---|---|
| 20 Nov 2026 | Sunil: plan a generic, customizable product any family can set up without technical help; no Jaggi references in the product; the Jaggi site keeps working. |
| 20 Nov 2026 | Sunil: brand name decided closer to development. About $50 a month running cost is fine. No designer for now; no lawyer yet (options in section 9). Spread the work over about six months, paid launch June 2027. Sunil will find 5 to 10 pilot families. |
| 20 Nov 2026 | Sunil: the Jaggi site can be moved onto the product as a test, as long as it is seamless for the Jaggi family (see section 6). Selling under Quantum Nexus LLC is under consideration. Names should suit families in the US, India and other countries. |

## Change log

| Date | Pull request | Change |
|---|---|---|
| 20 Nov 2026 | | Brand and domain name suggestions with availability and prices (section 10); Jaggi site move as a seamless test; Quantum Nexus LLC under consideration. |
| 20 Nov 2026 | #27 | Sunil's first answers: timeline to June 2027, cost breakdown (section 8), legal help options (section 9), remaining open questions. |
| 20 Nov 2026 | #26 | First draft: Jaggi-specific inventory, build and commercial options with recommendations, product requirements, phases, costs, open questions. |
