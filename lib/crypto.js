import crypto from 'crypto';

// AES-256-GCM. Output format: base64(iv).base64(tag).base64(ciphertext)
function getKey() {
  const k = process.env.INTEGRATION_ENCRYPTION_KEY;
  if (!k || !/^[0-9a-fA-F]{64}$/.test(k)) {
    throw new Error('INTEGRATION_ENCRYPTION_KEY must be set to 64 hex characters (openssl rand -hex 32).');
  }
  return Buffer.from(k, 'hex');
}

export function encryptJson(obj) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const enc = Buffer.concat([cipher.update(JSON.stringify(obj), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, enc].map((b) => b.toString('base64')).join('.');
}

export function decryptJson(payload) {
  const [iv, tag, enc] = payload.split('.').map((p) => Buffer.from(p, 'base64'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return JSON.parse(dec.toString('utf8'));
}
