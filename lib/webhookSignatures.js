import crypto from 'crypto';

function safeEqual(a, b) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// Stripe: header "t=...,v1=...,v1=..." ; signed payload is `${t}.${rawBody}` (HMAC-SHA256, hex).
export function verifyStripeSignature(rawBody, header, secret, toleranceSec = 300, nowSec = Math.floor(Date.now() / 1000)) {
  if (!header || !secret) return false;
  const parts = header.split(',').map((p) => p.trim().split('='));
  const t = parts.find(([k]) => k === 't')?.[1];
  const sigs = parts.filter(([k]) => k === 'v1').map(([, v]) => v);
  if (!t || sigs.length === 0) return false;
  if (Math.abs(nowSec - Number(t)) > toleranceSec) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  return sigs.some((s) => safeEqual(s, expected));
}

// Square: HMAC-SHA256 (base64) of notificationUrl + rawBody, header x-square-hmacsha256-signature.
export function verifySquareSignature(rawBody, header, signatureKey, notificationUrl) {
  if (!header || !signatureKey || !notificationUrl) return false;
  const expected = crypto
    .createHmac('sha256', signatureKey)
    .update(notificationUrl + rawBody)
    .digest('base64');
  return safeEqual(header, expected);
}
