# Jaggis of Chakwal Family Tree: Requirements

This is the requirements document for the family tree website at **https://familytree.sjaggi.com**. It describes what the site does today and what is planned next.

**Keeping it current.** Every pull request that adds or changes a feature updates this file *and* the Help page (`site/help.html`) in the same pull request, so both always match what the site does. Add a line to the [Change log](#change-log) at the bottom too.

*History:* the first version of these requirements was written as a Claude Doc on 12 November 2026 ("Jaggi Family Tree App: Requirements"). It was not updated as features shipped, so on 18 November 2026 it was brought up to date and moved here, into the repository, where each pull request can update it. The Claude Doc now points here.

---

## 1. Overview

The Jaggis of Chakwal family tree is a phone-friendly website where anyone can look at the family of **Bakhshi Bhanna Mal Jaggi** of pre-Partition Chakwal, Punjab, and invited family members can add and correct people, photos and stories.

**Goals**

- Preserve the family lineage from Bakhshi Bhanna Mal Jaggi in one shared, living record.
- Let relatives fill in their own branches without breaking what is already there.
- Let each contributor control who sees the photos and personal details they add.
- Encourage the family to contribute (Blessings and badges) and collect family history beyond the tree (Library, stories, open questions).
- Later, let any family start and run its own tree on the same platform.

**People**

- **Sunil Kumar Jaggi**: maintains the site and is the main admin ("Creator of the Jaggi Family Tree").
- **Suraj Parkash Jaggi**: admin; had the idea and made the first two family trees the site grew from ("Founder of the Jaggi Family Tree").

## 2. Releases and status

| Release | Target | Status |
|---|---|---|
| Version 1 | Thanksgiving, 26 Nov 2026 | **Live** since 13 Nov 2026, at familytree.sjaggi.com since 14 Nov. Several items first planned for version 2 shipped early: branch admins, custom domain, source and uncertainty fields on screen, edit history. |
| Version 2 | Early 2027 | Planned: linked documents (certificates, letters), GEDCOM import, "How are we related?" between any two people, automatic Library preview pictures. |
| Future | Later | Open sign-up so any family can start its own tree, self-hosting, App Store and Play Store apps, more languages, prize draws for Blessings. |

Related project: a printed **coffee table book**, *Jaggis of Chakwal* (about 50 hardcover copies, 12x12 inches or larger, about 100 pages, target first quarter 2027). Its requirements are kept separately (`Jaggis-of-Chakwal-Book-Requirements-and-Samples.pdf` in the project files).

## 3. Users and roles

| Role | Who | Can do |
|---|---|---|
| Visitor | Anyone with the link, no sign-in | See names and relationships, Public details and photos; search; view the tree from any person; Library (public links); Ancestors pages; Help. |
| Member | A relative who was invited and signed in | Everything a visitor can, plus Branch-only details for their branch; claim their own box; suggest additions and edits; add photos; suggest Library links; invite relatives; add open questions; earn Blessings. |
| Branch admin | Any member who has claimed their own box ("This is me") | Changes to their own family go live straight away (see 5.2); approve or decline other members' suggestions for their part of the tree under **Review**. |
| Admin | Sunil (and others given the Admin role, such as Suraj) | Everything: edit anything directly, approve or decline all changes, Undo, remove people and links, manage members, send emails, give or take back blessings, see visit reports. |

An admin can change any member's role on the Members page.

## 4. Sign-in, invitations and claiming your box

### 4.1 Invitations

- The site is invite-only. **Any signed-in member can invite** a relative (Invite page): email, name, and who they are in the tree. Admins can also choose the role (Member or Admin).
- The site emails the invitation (from the family's Gmail sender), with a button that signs them in. WhatsApp and Copy message buttons give a ready-made message to send from the member's own phone.
- The inviter sees the people they invited, with **Resend invitation email**.
- An invitee counts as "signed in" only once they actually sign in (`invites.accepted_at`), not when the invitation is sent.
- No open sign-up.

### 4.2 Signing in

- No passwords. The member types their email and gets an email with a **7-digit code** and a link. Either works; only the newest email works, and each works once.
- The site remembers the member on that device and browser until they sign out.
- A member removed by the admin can no longer sign in (see 9.2).

### 4.3 Claiming your box ("This is me")

- Each member claims the one box in the tree that is them. One account claims one box; each box belongs to one account.
- If the invitation was linked to that box, the claim is instant. Otherwise the inviter or the admin approves it.
- **Claim gate:** right after signing in, an invitee lands on their linked box with a pop-up, "Welcome dear member of Jaggi Family!" / "Is this you?" (once per visit), with a search to pick another box if it isn't them.
- Until they have claimed a box, any add, edit, photo, link or removal first asks them to claim. "My box isn't in the tree yet" lets them continue for that visit so they can add themselves under a parent. Admins and members with a claim waiting for approval are not asked.
- A yellow reminder banner stays at the top until the member has claimed a box.

## 5. Changing the tree

### 5.1 What a member can do

From a person's card (or the pencil on any tree box): **Suggest an edit**, **Add: Child / Spouse / Parent**, **Link to someone already in the tree**, **Add photo** / **Change or center photo** / **Remove photo**.

### 5.2 What goes live and what waits for approval

- **Live straight away (branch admin):** the member, their spouse, their descendants and the descendants' spouses: edit details, add children and spouses, change photos. Also corrections to their own deceased parents and grandparents, unless a sibling or cousin has also claimed a box under them (then those go to the admin).
- **Waits for approval:** everything else, including adding parents, brothers and sisters or cousins, and linking people already in the tree. A suggestion about someone in a branch admin's part of the tree goes to that branch admin's Review; the rest go to the admin.
- **Married-in spouses** can claim their box, edit their own details and look after their children's families, but nobody except the admin can add the parents or siblings of someone who married in (the tree stays about this family).
- **Removals are admin only:** only the admin can remove a person or undo a parent or marriage link, not even as a suggestion. This is enforced in the database.

### 5.3 Approval workflow

1. A member's suggestion is saved as a change request.
2. While it waits, the member sees it on the person's card in a yellow "Waiting for admin approval" box (only they see it) and under **My changes**, where they can withdraw it.
3. The admin or branch admin sees exactly what would change under **Review** and taps Approve or Decline, with an optional note to the member.
4. Approved changes go live. Every change records who made it and when; the card shows "Added and updated by" under Sources.
5. **Recent decisions** has **Undo**: an added person is removed again, edited details go back, a claim is taken back.

### 5.4 Forms

- Save stays pinned at the bottom of the form while scrolling. Closing with ✕ after a change asks "Save your changes?" (Keep editing, Discard changes, Save). Save errors show inside the form.
- **Gender** and **Living?** are required ("Choose..." until picked). Records saved before this rule may still be blank; the Dashboard lists them.
- After saving, a message says how many blessings the change earned or will earn.

## 6. Privacy and visibility

- Names and who is related to whom are public.
- Birth and death years, places, profession, notes and stories, and photos are each marked **Public** (anyone) or **Family branch only** (signed-in members of that branch). The admin sees everything.
- **Default:** new details and photos start as Family branch only for everyone, living or deceased. The person adding them can choose Public. Choosing Public for a living person (or someone not yet marked as passed away) shows a yellow warning that people outside the family will see it.
- **Marriage dates** (start and end dates, and notes about a marriage) are shown to everyone only when both spouses have passed away. Otherwise only the admin and members whose branch includes either spouse see them. Who is married to whom stays public.
- **Adopted, step and foster labels** are hidden from signed-out visitors for living children, who appear as ordinary children of their parents. Signed-in family see the label.
- A member's **branch** is their own line plus their spouse's line, set by who they are in the tree. Branches start at Generation 4 (for example everyone descended from Tapashi Ram Jaggi).
- Branch-only items are enforced by the database (row level security), not just hidden on screen.
- Search engine pages exist only for people marked as passed away, with Public details only (see 8.9). Because details start as Family branch only, an ancestor shows on these pages only with details someone chose to make Public. Living people are never named there.
- **Visits:** signed-in members' page views are recorded and shown only to the admin. Visitors who are not signed in are counted anonymously by GoatCounter (no cookies, no names).

## 7. Data

### 7.1 Person fields

| Field | Required | Notes |
|---|---|---|
| Title | No | For example "Bakhshi" |
| First name(s) | Yes | |
| Last name at birth | No | Maiden name for married women (database column `surname`). Shown on the tree box. |
| Married last name / other names | No | Married name, nicknames, other spellings (column `other_names`). Card shows "Also known as …". |
| Gender | Yes | Male, Female, Other |
| Living? | Yes | Living or Deceased |
| Birth year and place | No | **Years only**, never full dates; approximate allowed ("c. 1925", "1930s"). Place is free text, e.g. "Chakwal, Punjab". |
| Death year and place | No | Same rules |
| Profession | No | Free text |
| Notes / Story | No | Memories and stories ("stories = notes") |
| Sources | No | Where the information came from (e.g. "Dadi's memory", "school records") |
| What's uncertain | No | Anything not confirmed |
| Profile photo | No | One per person; square, centred by the member with drag and zoom, saved as a 640×640 JPEG |
| Visibility | Yes | Public or Family branch only, per person's details and per photo; starts as Family branch only |

### 7.2 Relationships

- Parent and child: Birth, Adopted, Step or Foster; Confirmed or Uncertain. An uncertain parent shows "?" and a dashed line (e.g. Ram Lal and Agya Lal Jaggi, father Gokal Chand **or** Chunni Lal).
- Marriages: any number per person, status married, divorced, widowed or separated, with optional dates.
- Daughters' children appear in the tree under the daughter and her husband.

### 7.3 Database tables (Supabase)

`people`, `person_details`, `parent_child`, `unions` (the tree); `change_requests` (suggestions and history); `invites`, `profiles`, `removed_members` (members); `blessing_adjustments` (manual blessings; points themselves come from the `blessings_ledger` view); `library_links`; `research_questions` (open questions); `not_duplicates`; `page_views` (member visits).

### 7.4 Seed data

The tree launched with about 70 people transcribed from the two family tree PDFs (`Jaggi_Family_Tree.pdf`, Generations 1 to 5, and `Bakhshi_Hari_Singh_Jaggi_Final_Family_Tree-v2.pdf`, Generations 1 to 6), including the uncertain-parent case, the 1933 Arya High School note and the source "family oral history and pre-Partition Chakwal archives". Members have since added more (about 100 people by 15 Nov 2026).

## 8. Features

### 8.1 Tree view

- One view: a vertical scrolling tree with the root centred at the top. Scroll with mouse wheel, two fingers or drag; pinch or **+ / −** to zoom. The bar at the top ("you are here") shows the generation and family being viewed; tap a name to go there.
- **Opens on your own line:** a signed-in member with a claimed box first sees the tree from the top ancestor with only the path down to their own box open, their box and all their descendants open, and every other branch closed. On wider screens it zooms out to show that line (never below half size); on phones it starts at their box. It applies on the first look at the main tree and again right after signing in or having a claim approved; after that, what they open or close stays as they left it. Visitors and members without a claimed box see the first three generations.
- **Show tree from here** redraws the tree from any person; the ancestor line at the top leads back up, or **Whole tree**.
- Compact layout: children without children of their own are stacked in a column; a teal circle under a box shows the number of children and opens or closes that family.
- Married-in spouses have their own smaller box with a dashed edge below their partner, joined by two gold rings.
- Each branch has its own pastel colour (top edge of the box). Long names wrap to two lines.
- Signed-in members get a pencil on each box to open its edit form.
- **Hover balloon:** resting the mouse on a box (or press and hold on a phone) shows a larger photo, years and age, birthplace, work, spouse, children, branch and how the person is related to the viewer.
- Special badges (Founder, Creator) show on those people's boxes.
- **List** view: a simple indented list for small phones.

### 8.2 Search

Search by name, including partial names; spelling variants such as Parkash / Prakash still match. Picking a result goes to that person.

### 8.3 Person card

Photo, all visible details, "Also known as", parents, spouse(s), children and siblings (each tappable), Sources with "Added and updated by", pending changes (to their author), **In the Library** links about the person, and the action buttons at the top.

### 8.4 Dashboard

- Numbers: people, generations, marriages, branches, photos, sources.
- **Needs attention:** missing birth year, birthplace, parent, photo, source; **Not known if living** and **Gender not recorded** (names open the edit form directly); **Possible duplicates**: pairs with their parents, same gender and similar spelling only, placeholder names skipped; admin **Not a duplicate** removes a pair.
- People per branch, born by period, birthplaces, earliest ancestors, common first names.
- **Open questions:** things the family is still finding out; any signed-in member can add one.
- Admin only: Visits by family members, and the public visitor summary from GoatCounter.

### 8.5 Export

- **Make the PDF:** a family book printed or saved as PDF: cover page with the full Jaggis of Chakwal logo, the tree as an indented chart, and a page per person with years, places and photo. Every page has a small logo header and the copyright footer with the Quantum Nexus mark.
- **.ged** (GEDCOM) file for Ancestry, FamilySearch, MyHeritage and other programs.
- Both include only what the viewer is allowed to see.

### 8.6 Blessings and badges

Members earn blessings ✦ for approved contributions (own-family changes count straight away):

| Contribution | Blessings |
|---|---|
| Claim your own box | 5 |
| Add a person | 5 |
| A story (Notes / Story) | 5 |
| Add a photo | 5 |
| Birth or death year, birth or death place, profession, source | 2 each |
| Other details (names, gender) | 1 each |
| Connect two people already in the tree | 3 |
| A Library link, once approved | 3 |
| Invite a relative who then signs in | 10 (to the inviter) |

- **Generation multipliers:** details about Generation 1 ×5, Generation 2 ×4, Generation 3 ×3, Generation 4 ×2.
- **Badges** (kept for good): Root Keeper (10 people), Storyteller (5 stories), Photo Finder (10 photos), Connector (3 invitees sign in). **Family Historian** moves monthly to the leader, who gets a congratulations pop-up once per month per device; admins can't hold it.
- **Special badges** given by hand: Founder of the Jaggi Family Tree (Suraj Parkash Jaggi, with a one-time thank-you pop-up) and Creator of the Jaggi Family Tree (Sunil Kumar Jaggi).
- **Blessings page:** leaderboard (this month / all time; admins are listed), the member's badges and progress, branch totals, and the member's own list of blessings.
- Admins can **Give or take back blessings** with a reason the member sees (e.g. for answering an open question, which is not scored automatically).
- A one-time **Welcome to Family Blessings** pop-up explains the rules; reopen with **How it works** or the **?** by the member's name.
- The member's photo, name, points and badges sit in the header (on phones, beside the logo).
- Not now: prize money or draws.

### 8.7 Family Library

- Library page with videos, articles and writing about the Jaggis of Chakwal, grouped by topic buttons, with search. YouTube videos play on the page with automatic thumbnails; other links open on their own site (picture link added by hand).
- Members **suggest a link** (title, topic, a note, people it is about); the form suggests a topic, and **+ New topic…** adds one. The link waits for admin approval under Review (Approve, Decline, Edit first); the member sees it as Waiting for approval and can withdraw it. Duplicate links are refused.
- Links tagged with a person show on their card under **In the Library**, with **+ Add a link about…**.
- Admin links go in straight away; the admin can edit or remove any link and mark one **family only** (signed-in members); everything else is public.

### 8.8 Admin tools

**Review:** every waiting change and Library link with exactly what would change; Approve, Decline with note; Recent decisions with Undo.

**Members page:**

- Branch admins: who claimed which box, branch size, who invited them; Remove as branch admin.
- **Missing details:** for each branch admin, how complete their branch is (photo, birth year, year of passing for deceased, birthplace, gender or Living? blank), with Show what's missing; names open the edit form. Each branch admin's card has **Write email**, which opens a draft of their personal email right in that card; **Write emails for everyone ticked** opens a draft in each ticked card. Each email thanks them as branch admin of their named branch and lists only their gaps, with tips only for the kinds of details missing. Drafts can be edited and previewed; nothing is sent until the admin sends it (one at a time, or **Send all open drafts**), and each shows Sent once it has gone. Replies go to the admin.
- Invite someone (with role).
- **Send a reminder email** to Everyone, Not signed in yet, No box claimed, or chosen people; preview before sending; each starts "Dear <first name>," and has a button to the tree.
- Invites list with signed-in status and inviter. **Remove** blocks that person's sign-in (signed out within the hour) but keeps what they added; **Restore** gives back the invite, login and, if unclaimed, their box.
- Members list with role and box, editable by the admin.

**Emails:** all automatic emails go through Supabase with the family's Gmail sender. The weekly summary email (Mondays 8am Arizona) is paused; occasional reminder emails are used instead.

### 8.9 Ancestors pages and search engines

- A daily job builds a simple public page for each person marked as passed away (Public details only), a list of Ancestors in the menu, and a sitemap for Google.
- The site name in Google is "Jaggis of Chakwal" (titles, site name signals). The site is registered in Google Search Console.

### 8.10 Look and branding

- Banyan theme: teal and gold, pastel branch colours; **light / dark** switch in the menu (remembered per device; follows the device until chosen).
- Header: Jaggis of Chakwal logo (hover or tap to enlarge), search box, full menu (Tree, List, Dashboard, My changes, Invite, Blessings, Ancestors, Library, Help, Export; Review and Members for admins; Review for branch admins), light/dark switch, Sign in / Sign out, and the signed-in member's chip (photo, blessings, badges, "?"). The header is identical on every page, including Help and Ancestors; on those pages search opens the person in the tree and Sign in opens the sign-in box on the tree. Ancestors pages keep plain visitor links in their HTML for search engines.
- Footer on every page: "© 2026 Jaggi Family and Quantum Nexus LLC. All rights reserved." with the Quantum Nexus mark.

### 8.11 Help

`site/help.html` is the user manual for every feature above, with screenshots. It is updated in the same pull request as each feature change.

## 9. Hosting and technical requirements

| Part | Service | Cost |
|---|---|---|
| Website | GitHub Pages from the public repository `skjaggi/Jaggis-from-Chakwal-family-tree`, deployed by GitHub Actions; plain HTML, CSS and JavaScript, no build step | Free |
| Address | familytree.sjaggi.com (sjaggi.com forwards there). The sjaggi.com email (Turbify) must not be disturbed: never change MX records. | Domain already owned |
| Sign-in, database, photos, emails | Supabase free tier: Postgres with row level security, storage buckets, edge functions (`send-invite`, `send-reminder`, `remove-member`, `visitor-stats`, `weekly-summary`) | Free |
| Email sender | A separate family Gmail account through Gmail SMTP and an app password. Sending from an @sjaggi.com address is a later option. | Free |
| Visitor count | GoatCounter (`jaggis-chakwal`) | Free |

- A GitHub Action reads the database every three days so the free Supabase project does not pause.
- Database changes are applied as reversible SQL with a rollback script and a backup; data is never deleted without Sunil's go-ahead.
- Tests run on every pull request: database (schema, privacy rules, approval flow) and browser (Playwright against a fake backend).

**Quality**

- Works on current iPhone and Android browsers and desktop Chrome, Safari, Edge and Firefox; phone-friendly first.
- The tree loads quickly on a phone (about 100 people today).
- English only; names accept any characters so Gurmukhi or Devanagari can be added later.

## 10. Decisions

| Date | Decision |
|---|---|
| 12 Nov 2026 | Living people's details default to Branch only; deceased to Public. *(Replaced on 17 Nov.)* |
| 12 Nov 2026 | GEDCOM export in version 1, import in version 2. |
| 12 Nov 2026 | A member's branch is their own line plus their spouse's line; branches start at Generation 4. |
| 13 Nov 2026 | Sign-in by email code or link, no passwords. |
| 13 Nov 2026 | Birth and death are recorded as years only. |
| 13 Nov 2026 | Spouses in their own smaller box (layout C); compact layout by default. |
| 13 Nov 2026 | Branch admins brought forward to version 1: claiming a box makes you branch admin of your own family; removals are admin only. |
| 14 Nov 2026 | Scroll view is the only tree view. Site moved to familytree.sjaggi.com. Any signed-in member can invite. |
| 15 Nov 2026 | Blessings rules as in 8.6; no prize money or weekly emails for now. Gender and Living? required. |
| 15 Nov 2026 | The two Sanjeev Kumar Jaggi and the two Gagan Jaggi are different people. |
| 16 Nov 2026 | Members must claim their box before making changes. |
| 17 Nov 2026 | Sunil: new details and photos default to Family branch only for everyone, including the deceased (replaces the 12 Nov rule). Marriage dates public only when both spouses have passed away; adoption labels hidden from visitors for living children. |
| 17 Nov 2026 | Family Library with admin approval. Missing details reminders per branch admin (core fields as in 8.8). Help page updated in every feature pull request. |
| 19 Nov 2026 | Sunil: the tree opens on the signed-in member's own line (path down to them, them and their descendants open, other branches closed). |
| 18 Nov 2026 | Name fields relabelled "Last name at birth" and "Married last name / other names". This requirements document lives in the repository and is updated in every feature pull request. |

## 11. Open questions

- [ ] Automatic preview pictures for non-YouTube Library links (offered, waiting for Sunil).
- [ ] Future version: how other families host their own tree (on this site under their own admin, or their own copy). Claude to suggest options before that version is planned.
- [ ] Profession typo "bussiness" for Tapashi Ram Jaggi flagged for correction.

## Change log

Newest first. Each feature pull request adds a line.

| Date | Pull request | Change |
|---|---|---|
| 19 Nov 2026 | #21 | Tree opens on the signed-in member's own line. |
| 18 Nov 2026 | #18 | Help and Ancestors pages show the same top bar as the tree (search, full role-aware menu, light/dark, Sign out, member chip). |
| 18 Nov 2026 | #14 | Requirements brought up to date with everything shipped since 12 Nov and moved into the repository. |
| 18 Nov 2026 | #15 | Privacy: marriage dates and adoption labels hidden from visitors; default Family branch only; warning when Public is chosen for a living person. |
| 18 Nov 2026 | #13 | Missing details: write and send each person's email from their own card. |
| 18 Nov 2026 | #11 | Name field labels: Last name at birth, Married last name / other names. |
| 17 Nov 2026 | #12 | Members: Missing details review with personal reminder emails. |
| 17 Nov 2026 | #10 | Help brought up to date. |
| 17 Nov 2026 | #7, #8, #9 | Family Library, suggested topics, + New topic. |
| 16 Nov 2026 | #6 | One site name, Jaggis of Chakwal, for Google. |
| 16 Nov 2026 | #4 | Branded PDF export. |
| 16 Nov 2026 | #5 | Claim your box first. |
| 16 Nov 2026 | #3 | Members page shows "Not signed in yet" correctly. |
| 15 Nov 2026 | | Blessings and badges, header chip, required Gender and Living?, duplicates rework, Founder and Creator badges. |
| 14 Nov 2026 | | Light/dark, scroll view only, logo and footer, familytree.sjaggi.com, removing members. |
| 13 Nov 2026 | | Version 1 launched: tree, search, sign-in, approvals, photos, dashboard, export, branch admins, analytics, Ancestors pages. |
