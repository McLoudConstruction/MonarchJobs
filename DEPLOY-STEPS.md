# MonarchJobs: Phase 0 deploy steps

Push 1 of the build. This zip contains the whole app, so unzip it into the empty repo and commit.

## 1. Push the code
Unzip into the repo root (so package.json is at the top), then commit and push to `main`.
Vercel will build it; the first build will fail or show errors until step 3 is done. That is expected.

## 2. Create the Supabase project and run migrations
1. In Supabase create a project named MonarchJobs (region close to Missouri).
2. Open SQL Editor and run, in order, each file once:
   - `supabase/migrations/001_core_staff_settings_audit.sql`
   - `supabase/migrations/002_integrations_and_webhooks.sql`
3. Authentication > Providers > Email: keep email/password on. Turn OFF "Allow new users to sign up"
   (staff are added by the owner; the login page has no sign-up).
4. Authentication > Users > Add user: create YOUR account first with a password.
   The first account created becomes the active owner automatically.
   Anyone added later starts inactive until you activate them in Settings > Users.

## 3. Add environment variables in Vercel
Project Settings > Environment Variables (Production, Preview, Development):

| Name | Where to get it |
| --- | --- |
| NEXT_PUBLIC_SUPABASE_URL | Supabase > Project Settings > API |
| NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY) | same page (publishable / anon key) |
| SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) | same page (secret / service role key; keep private) |
| INTEGRATION_ENCRYPTION_KEY | run `openssl rand -hex 32` and paste the output |
| NEXT_PUBLIC_SITE_URL | the production URL, no trailing slash |
| CRON_SECRET | any long random string (used from Phase 1) |

Save a copy of INTEGRATION_ENCRYPTION_KEY somewhere safe. If it is lost or changed, saved
Stripe and Square keys cannot be decrypted and must be entered again.
Redeploy after adding the variables.

## 4. Check it works
1. Open the site, sign in with your owner account.
2. Settings > Business: fill in and save.
3. Settings > Integrations: Stripe and Square show "Not connected". Each shows its webhook URL.

## 5. Connecting Stripe and Square (when the client is ready)
Stripe: Developers > Webhooks > Add endpoint, paste the Stripe webhook URL from Settings,
send all events for now, copy the signing secret. In Settings paste the publishable key, secret
key and signing secret, Save, then Test connection.

Square: Developer dashboard > Webhooks > Add subscription, paste the Square webhook URL,
copy the signature key. In Settings paste the access token, location ID and signature key,
choose the environment, Save, then Test connection.
The Square webhook URL registered in Square must exactly match the one shown in Settings.

Secret values are encrypted before they are stored, are never shown again (only the last 4
characters), and leaving a field blank when saving keeps the stored value.

## Local development
`cp env.local.example .env.local`, fill it in, `npm install`, `npm run dev`. `npm test` runs the
encryption and webhook signature tests.
