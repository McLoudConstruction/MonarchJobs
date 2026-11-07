# Push 5b — address lookup key moves to the server

Unzip over the repo (after Push 5). No database change.

DELETE these two files if they exist (a zip cannot delete):
  lib/googleMapsLoader.js
  app/api/integrations/google-maps-key/route.js

Vercel: add environment variable GOOGLE_MAPS_API_KEY (Production + Preview), then redeploy.
Google Cloud key: API restriction = "Places API (New)" only. Do NOT use a website (referrer) restriction
on this key: requests now come from Vercel's servers, not the browser. The Google Maps panel in
Settings > Integrations is gone; the key is no longer stored in the database or sent to browsers.
If the variable is missing, address fields simply stay plain inputs.
If you saved a Google key in Settings during Push 5, it is harmlessly ignored.
