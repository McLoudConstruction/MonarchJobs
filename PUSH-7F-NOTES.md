# Push 7f: Settings tabs, logo upload, "Not signed in" fix

Unzip over the repo (after Push 7e) and push. Nothing to delete.

## One database step (required before the logo works)
Run `supabase/migrations/006_branding_logo.sql` once in the Supabase SQL Editor. It adds `settings.logo_path` and creates a public storage bucket named `branding` (PNG, JPG, WebP, 2 MB max). Uploads happen only through the server (owner only), so no storage write policies are created.
Run it before deploying: the customer estimate page now reads `logo_path`.

## What changed
- **Settings is now tabs** (underline tabs, same style as the job tabs): Business, Users, Price list, Integrations. The open tab is kept in the URL (`/settings#integrations`), so refresh and links land on the same tab.
- **Logo upload** on the Business tab, under the business details: choose a file, see a preview on a checkerboard (so transparency is visible), click Upload. Replace and Remove are there too. The file type is checked from the file's contents, not its name; SVG is not accepted (SVGs can carry scripts). Each upload gets a new file name so browsers never show an old logo, and the previous file is deleted. Changes are written to the audit log.
- **The logo shows at the top of the customer estimate page** (`/e/[token]`), above the business name. It is not in the staff app's dark sidebar; say so if you want it there too.
- **"Not signed in" on Integrations fixed.** The page saved your login token when it loaded and kept sending that same token. Supabase replaces it about every hour, so on a page left open (or reopened from a backgrounded tab) the server rejected the old token with "Not signed in" even though you were still signed in. Every API call now reads the current token from the session (refreshing it if needed), and the stored token is updated when Supabase refreshes it. This also covers the estimate send button and the visit status buttons, which use the same helper.

## Files
New: `supabase/migrations/006_branding_logo.sql`, `lib/branding.js`, `app/api/branding/logo/route.js`, `components/settings/BrandingSection.js`, `tests/branding.test.mjs`, `PUSH-7F-NOTES.md`
Changed: `app/settings/page.js`, `lib/useAuth.js`, `app/e/[token]/page.js`, `app/api/public/estimate/[token]/route.js`
