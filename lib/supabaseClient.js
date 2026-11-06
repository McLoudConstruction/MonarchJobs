import { createClient } from '@supabase/supabase-js';

// Browser client. Created lazily so builds without env vars do not crash.
// NEXT_PUBLIC_ variables are baked in at build time: after adding or changing them
// in Vercel, redeploy for the change to take effect.
let client;

// Accepts either name for the public key: the older "anon key" or the newer "publishable key".
// Each variable is referenced literally so Next.js can inline it into the browser build.
function publicKey() {
  return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
}

export function isSupabaseConfigured() {
  return !!(process.env.NEXT_PUBLIC_SUPABASE_URL && publicKey());
}

export function getSupabase() {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase is not configured: NEXT_PUBLIC_SUPABASE_URL and the public key (NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY) are missing from this build.');
  }
  if (!client) {
    client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      publicKey()
    );
  }
  return client;
}
