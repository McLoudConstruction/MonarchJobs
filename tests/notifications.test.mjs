import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NOTIFICATION_TYPES, TIERS, typesForRole, groupedTypesForRole, isTypeEnabled, urlPath, badgeCount, timeAgo,
} from '../lib/notificationTypes.js';
import { urlBase64ToUint8Array, isIosDevice, pushStatus, buildPayload, isGoneStatus } from '../lib/pushState.js';

test('every type has a label, a valid role list and a group', () => {
  for (const [key, t] of Object.entries(NOTIFICATION_TYPES)) {
    assert.ok(t.label, key);
    assert.ok(t.group, key);
    assert.ok(t.roles.length && t.roles.every((r) => ['owner', 'office', 'tech'].includes(r)), key);
  }
  assert.ok(TIERS.action && TIERS.info && TIERS.alert);
});

test('office mirrors the owner, except owner-only types', () => {
  const owner = typesForRole('owner').map((t) => t.key);
  const office = typesForRole('office').map((t) => t.key);
  assert.deepEqual(office, owner.filter((k) => k !== 'staff_signup'));
  assert.ok(owner.includes('staff_signup'));
});

test('techs never see owner-side or money types, and owners never see tech-side ones', () => {
  const tech = typesForRole('tech').map((t) => t.key);
  for (const k of ['new_lead', 'estimate_approved', 'staff_signup', 'tech_on_the_way', 'job_completed', 'scope_changed']) {
    assert.ok(!tech.includes(k), k);
  }
  const owner = typesForRole('owner').map((t) => t.key);
  for (const k of ['visit_assigned', 'visit_reminder', 'day_summary', 'job_info_changed']) assert.ok(!owner.includes(k), k);
  assert.ok(!tech.some((k) => /pay|invoice|money/.test(k)));
});

test('the owner map has on the way, started and completed', () => {
  const owner = typesForRole('owner').map((t) => t.key);
  for (const k of ['tech_on_the_way', 'job_started', 'job_completed']) assert.ok(owner.includes(k), k);
});

test('grouping keeps every type once, in order', () => {
  const groups = groupedTypesForRole('tech');
  assert.equal(groups.flatMap((g) => g.types).length, typesForRole('tech').length);
  assert.equal(new Set(groups.map((g) => g.group)).size, groups.length);
});

test('a type is on unless a preference turned it off', () => {
  assert.equal(isTypeEnabled({}, 'new_lead'), true);
  assert.equal(isTypeEnabled(null, 'new_lead'), true);
  assert.equal(isTypeEnabled({ new_lead: false }, 'new_lead'), false);
  assert.equal(isTypeEnabled({ new_lead: true }, 'new_lead'), true);
});

test('urlPath drops the tab and query so opening the page counts as reading', () => {
  assert.equal(urlPath('/jobs/abc#estimate'), '/jobs/abc');
  assert.equal(urlPath('/leads/1?x=2#y'), '/leads/1');
  assert.equal(urlPath(''), '');
});

test('the badge counts unread, unresolved notifications only', () => {
  assert.equal(badgeCount([
    { read_at: null, resolved_at: null },
    { read_at: '2026-11-11', resolved_at: null },
    { read_at: null, resolved_at: '2026-11-11' },
    { read_at: null, resolved_at: null },
  ]), 2);
  assert.equal(badgeCount([]), 0);
  assert.equal(badgeCount(undefined), 0);
});

test('timeAgo', () => {
  const now = new Date('2026-11-11T18:00:00Z');
  assert.equal(timeAgo('2026-11-11T17:59:40Z', now), 'Just now');
  assert.equal(timeAgo('2026-11-11T17:50:00Z', now), '10 min ago');
  assert.equal(timeAgo('2026-11-11T15:00:00Z', now), '3 hr ago');
  assert.equal(timeAgo('2026-11-10T17:00:00Z', now), 'Yesterday');
  assert.equal(timeAgo('2026-11-08T18:00:00Z', now), '3 days ago');
});

test('VAPID public key converts from base64url to bytes', () => {
  // "hello world" in base64url without padding
  const bytes = urlBase64ToUint8Array('aGVsbG8gd29ybGQ');
  assert.equal(Buffer.from(bytes).toString(), 'hello world');
  // url-safe characters
  assert.deepEqual([...urlBase64ToUint8Array('-_8')], [251, 255]);
});

test('iPhone and iPad are detected, including iPadOS posing as a Mac', () => {
  assert.equal(isIosDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', 5), true);
  assert.equal(isIosDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5), true);
  assert.equal(isIosDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 0), false);
  assert.equal(isIosDevice('Mozilla/5.0 (Linux; Android 14; Pixel 8)', 5), false);
});

test('push status walks through the cases a person can be in', () => {
  const base = { configured: true, supported: true, ios: false, standalone: false, permission: 'default', subscribed: false };
  assert.equal(pushStatus({ ...base, configured: false }), 'unconfigured');
  assert.equal(pushStatus({ ...base, ios: true, supported: false }), 'needs_install'); // Safari tab has no PushManager
  assert.equal(pushStatus({ ...base, ios: true, standalone: true }), 'off');           // installed to Home Screen
  assert.equal(pushStatus({ ...base, supported: false }), 'unsupported');
  assert.equal(pushStatus({ ...base, permission: 'denied' }), 'denied');
  assert.equal(pushStatus(base), 'off');
  assert.equal(pushStatus({ ...base, permission: 'granted', subscribed: false }), 'off');
  assert.equal(pushStatus({ ...base, permission: 'granted', subscribed: true }), 'on');
});

test('push payload is short and keeps its tag so updates replace instead of stacking', () => {
  const p = buildPayload({ id: 7, title: 'New visit', body: 'Tue 9 AM', url: '/jobs/1', dedupe_key: 'visit:1:assigned', gate_code: '1234' });
  assert.deepEqual(p, { id: 7, title: 'New visit', body: 'Tue 9 AM', url: '/jobs/1', tag: 'visit:1:assigned' });
  assert.equal(buildPayload({ id: 8, title: 'x' }).tag, 'n-8');
  assert.equal(buildPayload({ id: 8, title: 'x' }).url, '/dashboard');
});

test('only 404 and 410 mean the subscription is gone', () => {
  assert.equal(isGoneStatus(410), true);
  assert.equal(isGoneStatus(404), true);
  assert.equal(isGoneStatus(500), false);
  assert.equal(isGoneStatus(undefined), false);
});
