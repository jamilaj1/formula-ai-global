/**
 * crypto.js — webhook signature verification using Web Crypto API.
 *
 * Both Stripe and Paystack sign their webhooks with HMAC. Without this
 * verification, an attacker could POST fake events and upgrade themselves
 * to any plan for free.
 */

/** Constant-time comparison of two same-length hex strings. */
export function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Compute hex HMAC of `message` using `secret` and the given hash algorithm.
 * @param {string} secret
 * @param {string} message
 * @param {'SHA-256'|'SHA-512'} hash
 */
export async function hmacHex(secret, message, hash) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Verify a Stripe webhook signature.
 * Header format: `t=<timestamp>,v1=<hex_sha256>`
 * Signed payload = `${timestamp}.${rawBody}`
 *
 * @param {string} rawBody
 * @param {string} signatureHeader
 * @param {string} secret
 * @param {number} [toleranceSeconds=300] reject events older than this
 */
export async function verifyStripeSignature(
  rawBody,
  signatureHeader,
  secret,
  toleranceSeconds = 300
) {
  if (!signatureHeader || !secret) return false;
  const parts = Object.fromEntries(
    signatureHeader.split(',').map((p) => {
      const idx = p.indexOf('=');
      return idx === -1 ? [p, ''] : [p.slice(0, idx), p.slice(idx + 1)];
    })
  );
  if (!parts.t || !parts.v1) return false;
  const timestamp = parseInt(parts.t, 10);
  if (!Number.isFinite(timestamp)) return false;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > toleranceSeconds) return false;

  const expected = await hmacHex(secret, `${parts.t}.${rawBody}`, 'SHA-256');
  return constantTimeEqual(expected, parts.v1);
}

/**
 * Verify a Paystack webhook signature.
 * Header: `x-paystack-signature` = hex HMAC-SHA512 of the raw body.
 */
export async function verifyPaystackSignature(rawBody, signatureHeader, secret) {
  if (!signatureHeader || !secret) return false;
  const expected = await hmacHex(secret, rawBody, 'SHA-512');
  return constantTimeEqual(expected, signatureHeader);
}
