# Push 5 — Lead → Work Order → Job

1. Run `supabase/migrations/005_lead_to_work_order.sql` in the Supabase SQL editor. No files to delete.
2. Settings → Integrations:
   - Google Maps: key with Maps JavaScript API + Places API (New), billing on, HTTP-referrer restricted to your site. Paste it in.
   - Twilio (SMS; needs 10DLC registration) and Resend (email; verified sending domain). Until set, Send offers text/email app, copy link, or "I sent it myself".
3. Flow: Lead -> estimate sent by text/email link (/e/token) -> customer approves + signs -> lead "Ready to schedule" -> office picks a time on the week grid -> Create work order -> Job.
4. Visits store start + duration only (end is derived).
5. Not carried over: Sales Route, Deferred Scope, Assemblies, Material Selections, Subcontractors/Portal, Budget, Job Costs, Draws, Pay Apps, Lien Waivers, Punch List, Warranty, Messages, Email.
