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
