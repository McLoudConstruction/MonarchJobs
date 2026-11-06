import { createClient } from '@supabase/supabase-js';

// Server only. Uses the service role key, which bypasses RLS. Never import in client code.
let admin;
export function getAdmin() {
  if (!admin) {
    admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      // Accepts the older "service role key" or the newer "secret key".
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );
  }
  return admin;
}

export async function writeAudit({ actor, action, entity, entityId, details }) {
  try {
    await getAdmin().from('audit_log').insert({
      actor_id: actor?.id ?? null,
      actor_email: actor?.email ?? null,
      action,
      entity: entity ?? null,
      entity_id: entityId ?? null,
      details: details ?? {},
    });
  } catch (e) {
    console.error('audit log write failed', e);
  }
}
