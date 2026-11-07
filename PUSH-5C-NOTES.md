# Push 5c — only what you are missing after Push 5 + 5b

No database change. Do NOT re-run migration 005 (it is already applied).

Adds the four files left out of the first Push 5 zip (lead detail page, new lead page, estimate send route,
customer approve route) plus the server-side Google key change (5b), if you did not apply 5b yet.

DELETE if present: lib/googleMapsLoader.js and app/api/integrations/google-maps-key/route.js
Vercel env var: GOOGLE_MAPS_API_KEY (Places API (New) restriction only, no website restriction).
