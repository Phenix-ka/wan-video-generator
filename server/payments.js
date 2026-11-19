// payments.js — credit packs, PayPal + BTCPay Server (Lightning).
//
// PayPal is the primary fiat rail. BTCPay Server is the primary crypto rail
// (Lightning for $1 videos). Paddle / Stripe / Lemon Squeezy keys can be
// saved in Settings, but checkout for those providers is NOT wired yet —
// the API says so plainly instead of pretending to charge.
//
// Nothing charges until keys are saved. Every crediting path is idempotent
// (ledger `ref` is unique), so a double webhook or a double confirm can
// never credit twice.
const db = require('./db');

const PACKS = {
  single:  { id: 'single',  name: '1 video',            price: 1.00,  credits: 1 },
  pack10:  { id: 'pack10',  name: '10 videos',          price: 8.00,  credits: 10 },
  pack30:  { id: 'pack30',  name: '30 videos',          price: 20.00, credits: 30 },
  monthly: { id: 'monthly', name: 'Monthly — 30 videos', price: 15.00, credits: 30 },
};

function paypalBase(mode) {
  return mode === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
}
function paypalConfig(settings) {
  return {
    clientId: settings.paypal_client_id || process.env.PAYPAL_CLIENT_ID || '',
    secret: settings.paypal_client_secret || process.env.PAYPAL_CLIENT_SECRET || '',
    mode: settings.paypal_mode || process.env.PAYPAL_MODE || 'sandbox',
  };
}
function btcpayConfig(settings) {
  return {
    url: (settings.btcpay_url || process.env.BTCPAY_URL || '').replace(/\/$/, ''),
    apiKey: settings.btcpay_api_key || process.env.BTCPAY_API_KEY || '',
    storeId: settings.btcpay_store_id || process.env.BTCPAY_STORE_ID || '',
  };
}

async function paypalAccessToken(cfg) {
  const res = await fetch(`${paypalBase(cfg.mode)}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + Buffer.from(`${cfg.clientId}:${cfg.secret}`).toString('base64'),
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`PayPal auth failed (${res.status}) — check client ID / secret.`);
  return (await res.json()).access_token;
}

// Create a PayPal order for a pack. Returns the approval URL the buyer visits.
async function createPaypalOrder(user, pack, settings, origin) {
  const cfg = paypalConfig(settings);
  if (!cfg.clientId || !cfg.secret) {
    return { ok: false, error: 'PAYMENTS_NOT_CONNECTED', provider: 'paypal', message: 'PayPal is not connected yet. Add your PayPal client ID and secret in Settings.' };
  }
  const token = await paypalAccessToken(cfg);
  const res = await fetch(`${paypalBase(cfg.mode)}/v2/checkout/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [{
        amount: { currency_code: 'USD', value: pack.price.toFixed(2) },
        description: `Wan Video Generator — ${pack.name}`,
        custom_id: `${user.id}:${pack.id}`,
      }],
      application_context: {
        return_url: `${origin}/?paypal=success`,
        cancel_url: `${origin}/?paypal=cancelled`,
        brand_name: 'Wan Video Generator',
        user_action: 'PAY_NOW',
      },
    }),
  });
  if (!res.ok) throw new Error(`PayPal order failed (${res.status}): ${await res.text()}`);
  const order = await res.json();
  const approve = (order.links || []).find((l) => l.rel === 'approve');
  return { ok: true, provider: 'paypal', orderId: order.id, approvalUrl: approve ? approve.href : null };
}

// Capture a PayPal order after the buyer approved it, then credit the pack.
// Idempotent: a second capture attempt returns the same result without
// crediting twice (ledger ref paypal:<orderId> is unique).
async function confirmPaypalOrder(user, orderId, settings) {
  const cfg = paypalConfig(settings);
  if (!cfg.clientId || !cfg.secret) {
    return { ok: false, error: 'PAYMENTS_NOT_CONNECTED', provider: 'paypal' };
  }
  if (db.ledgerHasRef(`paypal:${orderId}`)) {
    return { ok: true, alreadyCredited: true, balance: db.getBalance(user.id) };
  }
  const token = await paypalAccessToken(cfg);
  const res = await fetch(`${paypalBase(cfg.mode)}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`PayPal capture failed (${res.status}): ${await res.text()}`);
  const order = await res.json();
  if (order.status !== 'COMPLETED') {
    return { ok: false, error: 'PAYMENT_NOT_COMPLETED', status: order.status };
  }
  const unit = (order.purchase_units || [])[0] || {};
  const customId = unit.custom_id || '';
  const [, packId] = customId.split(':');
  const pack = PACKS[packId];
  const amount = parseFloat(((unit.payments || {}).captures || [{}])[0].amount?.value || '0');
  if (!pack || Math.abs(amount - pack.price) > 0.01) {
    return { ok: false, error: 'AMOUNT_MISMATCH', message: 'Captured amount does not match any credit pack.' };
  }
  db.addLedger(user.id, pack.credits, `PayPal purchase — ${pack.name}`, `paypal:${orderId}`);
  return { ok: true, pack: pack.id, credits: pack.credits, balance: db.getBalance(user.id) };
}

// Create a BTCPay Server invoice (Greenfield API). Lightning is the default
// BTCPay payment method; the buyer picks it on the BTCPay checkout page.
async function createBtcpayInvoice(user, pack, settings) {
  const cfg = btcpayConfig(settings);
  if (!cfg.url || !cfg.apiKey || !cfg.storeId) {
    return { ok: false, error: 'PAYMENTS_NOT_CONNECTED', provider: 'btcpay', message: 'BTCPay Server is not connected yet. Add your BTCPay URL, API key and store ID in Settings.' };
  }
  const res = await fetch(`${cfg.url}/api/v1/stores/${encodeURIComponent(cfg.storeId)}/invoices`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `token ${cfg.apiKey}` },
    body: JSON.stringify({
      amount: pack.price,
      currency: 'USD',
      metadata: { buyerEmail: user.email, userId: String(user.id), packId: pack.id, orderId: `wan-${user.id}-${Date.now()}` },
      checkout: { redirectURL: '' },
    }),
  });
  if (!res.ok) throw new Error(`BTCPay invoice failed (${res.status}): ${await res.text()}`);
  const inv = await res.json();
  return { ok: true, provider: 'btcpay', invoiceId: inv.id, checkoutUrl: inv.checkoutLink };
}

// Verify a BTCPay invoice by fetching it back from the server (BTCPay
// webhooks carry no signature by default), then credit once.
async function handleBtcpayWebhook(body, settings) {
  const cfg = btcpayConfig(settings);
  const invoiceId = body.invoiceId;
  if (!invoiceId) return { ok: false, error: 'NO_INVOICE_ID' };
  if (db.ledgerHasRef(`btcpay:${invoiceId}`)) return { ok: true, alreadyCredited: true };
  if (!cfg.url || !cfg.apiKey || !cfg.storeId) {
    return { ok: false, error: 'PAYMENTS_NOT_CONNECTED', provider: 'btcpay' };
  }
  const res = await fetch(`${cfg.url}/api/v1/stores/${encodeURIComponent(cfg.storeId)}/invoices/${encodeURIComponent(invoiceId)}`, {
    headers: { Authorization: `token ${cfg.apiKey}` },
  });
  if (!res.ok) throw new Error(`BTCPay invoice lookup failed (${res.status})`);
  const inv = await res.json();
  if (inv.status !== 'Settled') return { ok: true, ignored: true, status: inv.status };
  const meta = inv.metadata || {};
  const userId = parseInt(meta.userId, 10);
  const pack = PACKS[meta.packId];
  if (!userId || !pack) return { ok: false, error: 'UNKNOWN_PACK_OR_USER' };
  db.addLedger(userId, pack.credits, `BTCPay (Lightning/crypto) purchase — ${pack.name}`, `btcpay:${invoiceId}`);
  return { ok: true, pack: pack.id, credits: pack.credits };
}

// Entry point for "Buy" buttons.
async function buyPack(user, packId, provider, settings, origin) {
  const pack = PACKS[packId];
  if (!pack) return { ok: false, error: 'UNKNOWN_PACK', message: `Unknown pack "${packId}".` };
  if (provider === 'paypal') return createPaypalOrder(user, pack, settings, origin);
  if (provider === 'btcpay') return createBtcpayInvoice(user, pack, settings);
  if (provider === 'paddle' || provider === 'stripe' || provider === 'lemonsqueezy') {
    return {
      ok: false,
      error: 'PROVIDER_NOT_WIRED',
      provider,
      message: `${provider} keys can be saved in Settings, but checkout for this provider is not wired yet. Use PayPal or BTCPay (Lightning) for now.`,
    };
  }
  return { ok: false, error: 'UNKNOWN_PROVIDER', message: `Unknown payment provider "${provider}".` };
}

module.exports = { PACKS, buyPack, confirmPaypalOrder, handleBtcpayWebhook, paypalConfig, btcpayConfig };
