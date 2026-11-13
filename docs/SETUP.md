# Setting up the Jaggi family tree

This takes about 30 minutes, once. Everything here is free.

You will:

1. Turn on GitHub Pages so the site is online.
2. Create a free Supabase project (the database, logins and photo storage).
3. Load the family tree into it and make yourself the admin.
4. Point the site at Supabase.
5. Set up sign-in emails.
6. Invite the family.

Until step 4 is done the site still works in **preview mode**: anyone can browse the tree from the PDFs, but nobody can sign in or make changes.

---

## 1. Turn on GitHub Pages

1. Open the repository on GitHub → **Settings** → **Pages**.
2. Under **Build and deployment → Source**, choose **GitHub Actions**.
3. Go to the **Actions** tab, open **Deploy site to GitHub Pages**, and click **Run workflow** (it also runs on every change to `main`).

The site will be at **https://skjaggi.github.io/Jaggis-from-Chakwal-family-tree/**.

## 2. Create the Supabase project

1. Go to <https://supabase.com>, sign up (signing in with GitHub is easiest).
2. Click **New project**.
   - Name: `jaggi-family-tree`
   - Database password: click **Generate** and save it in your password manager. You won't need it day to day.
   - Region: the one closest to most of the family.
   - Plan: **Free**.
3. Wait a minute or two for it to finish setting up.

## 3. Load the tree and make yourself admin

1. Open [`supabase/setup.sql`](../supabase/setup.sql) on GitHub and click **Copy raw file** (the copy icon above the file).
2. In Supabase, open **SQL Editor** → **New query**, and paste.
3. Near the top, change `YOUR-EMAIL@example.com` to your own email (keep the quotes).
4. Click **Run**. The result should say *Setup finished: 70 people loaded, admin invite for …*.

This creates the tables and privacy rules, adds the 70 people from the PDFs, and makes you the admin, linked to *Sunil Kumar Jaggi* in the tree. (`schema.sql` and `seed.sql` are the same thing in two parts, for reference.)

## 4. Point the site at Supabase

1. In Supabase, open **Project Settings → API** (in newer dashboards: **Project Settings → Data API** for the URL and **API Keys** for the key).
2. Copy the **Project URL** and the **anon public** key. (Never use the `service_role` / secret key in the site.)
3. In GitHub, open [`site/js/config.js`](../site/js/config.js), click the pencil to edit, and fill in:

   ```js
   supabaseUrl: 'https://abcdefgh.supabase.co',
   supabaseAnonKey: 'eyJhbGciOi...',
   ```

4. Commit the change to `main`. The site redeploys in about a minute.

The anon key is meant to be public. What it can do is limited by the database's privacy rules, which are tested in `supabase/tests/`.

## 5. Set up sign-in emails

Family members sign in with their email: they type it in, get an email, and tap the link. No passwords.

1. In Supabase, open **Authentication → URL Configuration**.
   - **Site URL**: `https://skjaggi.github.io/Jaggis-from-Chakwal-family-tree/`
   - **Redirect URLs**: add the same address.
2. Open **Authentication → Sign In / Providers** (or **Providers → Email**). Make sure **Email** is enabled and **Allow new users to sign up** is **on**. Don't worry: the database only lets invited emails create a login. Everyone else sees "This email hasn't been invited yet".
3. **Add the sign-in code to the emails** (strongly recommended). Open **Authentication → Emails → Templates**. In **both** the **Confirm signup** template (used the first time someone signs in) and the **Magic Link** template (used after that), add this line under the link and save:

   ```html
   <p>Or type this code on the sign-in screen: <strong>{{ .Token }}</strong></p>
   ```

   With the code, people sign in right in the browser they are using. A link tapped in a phone's mail app often opens inside the mail app's own browser, so they end up signed in there but not in Safari or Chrome. Links are also single-use and only the newest one works.

4. **Before inviting many people**, set up your own email sender. Supabase's built-in sender only sends a handful of emails per hour, which is fine for testing but not for inviting the whole family.
   - Free option: create an account at <https://resend.com> (free tier: 3,000 emails/month), add and verify `sjaggi.com` as a sending domain, and create an API key.
   - In Supabase open **Project Settings → Authentication → SMTP Settings** (or **Authentication → Emails → SMTP**), turn on **Custom SMTP** and enter: host `smtp.resend.com`, port `465`, user `resend`, password = the Resend API key, sender e.g. `family@sjaggi.com`.
   - Then raise the email rate limit under **Authentication → Rate Limits**.

## 6. Invite the family

1. Open the site and click **Sign in**. Use the email from step 3. You'll see **Review** and **Members** in the menu.
2. Open **Members → Invite someone**. Enter their email, and pick who they are in the tree (this decides which branch's private details and photos they can see). Add the invite.
3. Send them the site link. They sign in with that email.

If someone isn't in the tree yet (for example a spouse who married in), add them first from the person panel (**Add → Spouse**), then invite them linked to that new person.

---

## How changes and privacy work

- **Names and relationships are public.** Anyone with the link can see the tree.
- **Dates, places, profession and notes** are either *Public* or *Branch only*, chosen by whoever adds them. Living people default to branch only; people who have died default to public.
- **Photos** are one per person, and also *Public* or *Branch only*.
- **Branch** means: everyone descended from your generation-4 ancestor (for you: Tapashi Ram Jaggi), your direct ancestors, your spouse's line, and the spouses of all of those. The level is set in `public.branch_level()` in `schema.sql`.
- **Every change by a member waits for your approval** under **Review**. Your own changes as admin apply straight away, and are still recorded.
- Members can see their own submissions under **My changes** and withdraw them while they're waiting.

## Keeping it running

- Supabase pauses free projects after about a week with no visitors. The **Keep database awake** workflow in this repo reads one row every three days to prevent that. If it ever does pause, open the Supabase dashboard and click **Restore**.
- Free tier limits that matter here: 500 MB database (enough for many thousands of people), 1 GB file storage (thousands of photos: the site shrinks each photo to under ~200 KB before upload), 50,000 monthly active users.
- To back up: on the site, **Export** downloads the tree as a GEDCOM file. Supabase also keeps daily backups on paid plans only, so an occasional GEDCOM export is a good habit.

## Changing the admin

You can hand over (or share) the admin role at any time. Nothing on the site needs a code change.

1. The new admin must have signed in once. Then, on **Members**, find them under *Members who have signed in* and change their role from **Member** to **Admin**. They now see **Review** and **Members** too. (You can have more than one admin.)
2. To step down, the new admin changes *your* role to **Member** on their Members page. Nobody can change their own role, so there is always at least one admin.
3. Two places still show the current admin's name; update them if you like:
   - **Sender name of the sign-in emails:** Supabase → **Authentication → Emails → SMTP Settings → Sender name** (now "Sunil Jaggi"). If the sending Gmail account changes too, also update the email and app password there.
   - **Contact line at the end of the help page:** in `site/help.html`, the line "For anything else, contact the admin (Sunil Jaggi)."
   - The sign-off "Sunil" in the *Confirm signup* and *Magic Link* templates (see `docs/email-templates.md`).

## Using sjaggi.com later

1. In the repo, **Settings → Pages → Custom domain**: enter e.g. `family.sjaggi.com`.
2. At your domain registrar, add a `CNAME` record from `family` to `skjaggi.github.io`.
3. In Supabase, update **Site URL** and **Redirect URLs** to the new address.

## Changing the starting data

The seed data lives in [`data/family.source.json`](../data/family.source.json). Once the database is live, make changes in the site instead: the seed only matters for a brand-new database. If you edit the JSON, run `node scripts/build-seed.mjs` to regenerate `site/data/seed.json` and `supabase/seed.sql`.
