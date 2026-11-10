# Push 7e: Staff password reset

No database change. Nothing to delete. Unzip over the repo (after Push 7d) and push.
- Login page: new "Forgot password?" link.
- New /forgot-password: staff enter their email and get a reset link. Same confirmation whether or not the email has an account.
- New /reset-password: landing page for the emailed link. Choose and confirm a new password (8+ characters), then goes to the dashboard. Expired or used links show a "request a new link" message.
- New lib/passwordRules.js with tests/passwordRules.test.mjs.

One-time Supabase setting (without it the emailed link will not come back to the app):
Authentication > URL Configuration. Set Site URL to the production URL, and add
  https://<your-site>/reset-password
to Redirect URLs (add the same path on any preview or custom domain you use).
Email delivery uses Supabase's built-in sender unless custom SMTP is set (Authentication > Emails); the built-in sender is heavily rate limited, so set up SMTP (Resend works) if staff will use this regularly.
