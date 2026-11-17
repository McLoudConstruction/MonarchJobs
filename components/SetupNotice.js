import CenterCard from '@/components/CenterCard';

export default function SetupNotice() {
  return (
    <CenterCard maxWidth={520}>
      <h2 className="auth-welcome">Setup needed</h2>
      <p className="hint auth-sub">
        This build does not have its Supabase settings. In Vercel, open Project Settings, then Environment
        Variables, and add <code>NEXT_PUBLIC_SUPABASE_URL</code> and <code>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code> (or <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>) for
        Production. Then open Deployments and redeploy the latest one. These values are applied at build time, so a
        redeploy is required after adding them.
      </p>
    </CenterCard>
  );
}
