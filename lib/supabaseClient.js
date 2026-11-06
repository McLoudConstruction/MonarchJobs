import { createClient } from '@supabase/supabase-js';

// Browser client. Created lazily so builds without env vars do not crash.
let client;
export function getSupabase() {
  if (!client) {
    client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    );
  }
  return client;
}
