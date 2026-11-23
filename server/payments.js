'use strict';
const crypto = require('crypto');
const cfg = require('./config');
const { HttpError } = require('./validate');

const enabled = () => !!(cfg.razorpay.keyId && cfg.razorpay.keySecret);

async function createOrder(amountRupees, receipt) {
  if (!enabled()) throw new HttpError(503, 'Online payments are not configured yet. Choose cash, or ask the administrator to set the Razorpay keys.');
  let res;
  try {
    res = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Basic ' + Buffer.from(`${cfg.razorpay.keyId}:${cfg.razorpay.keySecret}`).toString('base64') },
    body: JSON.stringify({ amount: amountRupees * 100, currency: 'INR', receipt: String(receipt).slice(0, 40) }),
    signal: AbortSignal.timeout(15000),
    });
  } catch (e) { console.error('[razorpay] network error:', e.message); throw new HttpError(502, 'The payment provider is unreachable. Please try again, or pay in cash.'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.id) { console.error('[razorpay] order failed', res.status, data && data.error); throw new HttpError(502, 'The payment provider is unavailable. Please try again.'); }
  return data.id;
}

// Razorpay checkout signature: HMAC_SHA256(order_id + "|" + payment_id, key_secret)
function verifySignature(orderId, paymentId, signature, secret = cfg.razorpay.keySecret) {
  if (!secret || typeof signature !== 'string') return false;
  const expected = crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');
  const a = Buffer.from(expected), b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { enabled, createOrder, verifySignature };
