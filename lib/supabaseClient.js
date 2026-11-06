import { createClient } from '@supabase/supabase-js';

// Browser client. Created lazily so builds without env vars do not crash.
// NEXT_PUBLIC_ variables are baked in at build time: after adding or changing them
// in Vercel, redeploy for the change to take effect.
let client;

export function isSupabaseConfigured() {
  return !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

export function getSupabase() {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase is not configured: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are missing from this build.');
  }
  if (!client) {
    client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    );
  }
  return client;
}
