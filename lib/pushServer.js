// Server only. Sends Web Push for notification rows that already exist in the database.
import webpush from 'web-push';
import { getAdmin } from '@/lib/supabaseAdmin';
import { buildPayload, isGoneStatus } from '@/lib/pushState';

let configured = false;
function configure() {
  if (configured) return true;
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!pub || !priv || !subject) return false;
  webpush.setVapidDetails(subject, pub, priv);
  configured = true;
  return true;
}

// Sends one payload to each subscription. Dead subscriptions are removed.
async function deliver(admin, jobs) {
  let sent = 0;
  let failed = 0;
  const gone = [];
  const worked = [];

  await Promise.all(
    jobs.map(async ({ sub, payload, urgency }) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload),
          { TTL: 60 * 60 * 12, urgency }
        );
        sent += 1;
        worked.push(sub.id);
      } catch (e) {
        failed += 1;
        if (isGoneStatus(e?.statusCode)) gone.push(sub.id);
        else console.error('push failed', e?.statusCode, e?.body || e?.message);
      }
    })
  );

  if (gone.length) await admin.from('push_subscriptions').delete().in('id', gone);
  if (worked.length) await admin.from('push_subscriptions').update({ last_used_at: new Date().toISOString() }).in('id', [...new Set(worked)]);
  return { sent, failed, removed: gone.length };
}

export async function sendPushForNotifications(ids) {
  if (!configure()) return { sent: 0, skipped: ids.length, reason: 'VAPID keys are not set on the server.' };
  const admin = getAdmin();

  const { data: notes } = await admin
    .from('notifications')
    .select('id,user_id,tier,title,body,url,dedupe_key,read_at,resolved_at')
    .in('id', ids);
  const live = (notes || []).filter((n) => !n.resolved_at);
  if (!live.length) return { sent: 0, skipped: ids.length };

  const userIds = [...new Set(live.map((n) => n.user_id))];
  const { data: subs } = await admin
    .from('push_subscriptions')
    .select('id,user_id,endpoint,p256dh,auth')
    .in('user_id', userIds);

  const jobs = live.flatMap((n) =>
    (subs || []).filter((s) => s.user_id === n.user_id).map((s) => ({
      sub: s,
      payload: buildPayload(n),
      urgency: n.tier === 'info' ? 'normal' : 'high',
    }))
  );
  return deliver(admin, jobs);
}

// "Send me a test": goes straight to this person's phones, no database row.
export async function sendTestPush(userId) {
  if (!configure()) return { sent: 0, reason: 'VAPID keys are not set on the server.' };
  const admin = getAdmin();
  const { data: subs } = await admin.from('push_subscriptions').select('id,user_id,endpoint,p256dh,auth').eq('user_id', userId);
  if (!subs?.length) return { sent: 0, reason: 'No phone is subscribed for this account yet.' };
  const payload = { title: 'Test notification', body: 'Push notifications are working on this phone.', url: '/notifications', tag: 'test' };
  return deliver(admin, subs.map((sub) => ({ sub, payload, urgency: 'normal' })));
}
