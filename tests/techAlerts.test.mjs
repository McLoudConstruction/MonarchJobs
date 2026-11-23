import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NOTIFICATION_TYPES } from '../lib/notificationTypes.js';

const sql = readFileSync(new URL('../supabase/migrations/043_tech_alert_cleanup.sql', import.meta.url), 'utf8');

test('assignment wording never asks for a reply', () => {
  const t = NOTIFICATION_TYPES.visit_assigned;
  assert.match(t.hint, /nothing to confirm/i);
  assert.doesNotMatch(`${t.label} ${t.hint}`, /acknowledg|confirm receipt|must|required/i);
});

test('043 makes assignments info and tidies only technicians', () => {
  assert.match(sql, /type = 'visit_assigned' and tier <> 'info'/);
  assert.match(sql, /s\.role = 'tech'/);
  assert.match(sql, /perform public\.notif_tidy_techs\(\)/);
});

test('"Day clock" wording is gone from the app', () => {
  for (const k of ['shift_edit_request', 'shift_edit_decided']) {
    assert.doesNotMatch(NOTIFICATION_TYPES[k].label, /day clock/i);
  }
});
