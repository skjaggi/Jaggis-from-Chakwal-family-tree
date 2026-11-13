# Sign-in email templates

Paste these into Supabase → **Authentication → Emails → Templates**.
Supabase fills in `{{ .Token }}` (the 6-digit code) and `{{ .ConfirmationURL }}` (the link).

## Confirm signup (the first time someone signs in)

**Subject:** Your sign-in code for the Jaggi family tree: {{ .Token }}

```html
<p>Hello,</p>
<p>Here is your code to sign in to the Jaggi family tree:</p>
<p style="font-size:28px;font-weight:bold;letter-spacing:4px">{{ .Token }}</p>
<p>Go back to the family tree and type this code in the sign-in box. Or <a href="{{ .ConfirmationURL }}">tap here to sign in</a>.</p>
<p>You only need to do this once on each phone or computer. After that the site remembers you.</p>
<p>This code works once and only for the next hour. If you asked for more than one email, use the newest.</p>
<p>Need help? <a href="https://skjaggi.github.io/Jaggis-from-Chakwal-family-tree/help.html">How to use the family tree</a></p>
<p>Sunil</p>
```

## Magic Link (every sign-in after the first)

**Subject:** Your sign-in code for the Jaggi family tree: {{ .Token }}

Use the same text as above.

## Invite user (sent automatically when someone is invited)

The site sends this when the admin adds an invite on the Members page, or a family member uses **Invite**. `{{ .Data.invited_by }}` is the inviter's name in the tree.

**Subject:** {{ .Data.invited_by }} invited you to the Jaggi family tree

```html
<p>{{ if .Data.name }}Dear {{ .Data.name }},{{ else }}Hello,{{ end }}</p>
<p>{{ .Data.invited_by }} has invited you to the online family tree of the Jaggis of Chakwal, starting from Bakhshi Bhanna Mal Jaggi.</p>
<p style="margin:24px 0"><a href="{{ .ConfirmationURL }}" style="background:#7a3b12;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold">Open the family tree and sign in</a></p>
<p>This button signs you in straight away. It works once, within 24 hours. After that, open <a href="https://skjaggi.github.io/Jaggis-from-Chakwal-family-tree/">the family tree</a>, tap <strong>Sign in</strong>, enter this email address, and type the 6-digit code we email you. There is no password.</p>
<p>You only sign in once on each phone or computer. On a phone, open the site in Safari or Chrome (not inside the Gmail app) and add it to your home screen.</p>
<div style="margin:20px 0;padding:14px 16px;background:#faf1c8;border-left:4px solid #c49a3a;border-radius:6px">
<p style="margin:0 0 8px"><strong>Important, please do this first: claim your box.</strong></p>
<p style="margin:0">After you sign in, find yourself in the tree (search for your name), open your box and tap <strong>This is me</strong>. A yellow reminder at the top of the page helps you find it. If you're not in the tree yet, add yourself under your father or mother first, then claim that box. Once it's yours, your changes to your own family appear right away and the tree shows how everyone is related to you.</p>
</div>
<p>Until your box is claimed, changes you make wait for the admin to check them first. So don't worry about mistakes.</p>
<p>A short guide: <a href="https://skjaggi.github.io/Jaggis-from-Chakwal-family-tree/help.html">How to use the family tree</a></p>
```
