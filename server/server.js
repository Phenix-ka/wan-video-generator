// server.js — Wan Video Generator API + static frontend.
// Node >= 22.5 (built-in node:sqlite). See README.md for deployment.
const express = require('express');
const path = require('path');
const db = require('./db');
const auth = require('./auth');
const worker = require('./worker');
const payments = require('./payments');

const PORT = parseInt(process.env.PORT || '3000', 10);
const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');
const STARTER_CREDITS = 5;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // base64 image uploads

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.FRONTEND_URL || '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Effective settings: DB settings (owner-editable) override env vars.
function getSettings() {
  const stored = db.getAllSettings();
  return {
    worker_provider: stored.worker_provider || process.env.WORKER_PROVIDER || '',
    worker_url: stored.worker_url || process.env.WORKER_URL || '',
    worker_api_key: stored.worker_api_key || process.env.WORKER_API_KEY || '',
    worker_endpoint_id: stored.worker_endpoint_id || process.env.WORKER_ENDPOINT_ID || '',
    paypal_client_id: stored.paypal_client_id || process.env.PAYPAL_CLIENT_ID || '',
    paypal_client_secret: stored.paypal_client_secret || process.env.PAYPAL_CLIENT_SECRET || '',
    paypal_mode: stored.paypal_mode || process.env.PAYPAL_MODE || 'sandbox',
    btcpay_url: stored.btcpay_url || process.env.BTCPAY_URL || '',
    btcpay_api_key: stored.btcpay_api_key || process.env.BTCPAY_API_KEY || '',
    btcpay_store_id: stored.btcpay_store_id || process.env.BTCPAY_STORE_ID || '',
    paddle_api_key: stored.paddle_api_key || process.env.PADDLE_API_KEY || '',
    stripe_secret_key: stored.stripe_secret_key || process.env.STRIPE_SECRET_KEY || '',
    lemonsqueezy_api_key: stored.lemonsqueezy_api_key || process.env.LEMON_SQUEEZY_API_KEY || '',
  };
}

function settingsStatus(settings) {
  const paypal = payments.paypalConfig(settings);
  const btcpay = payments.btcpayConfig(settings);
  return {
    demo_mode: !worker.isWorkerConfigured(settings),
    worker_connected: worker.isWorkerConfigured(settings),
    worker_provider: worker.workerConfig(settings).provider || null,
    payments: {
      paypal: Boolean(paypal.clientId && paypal.secret),
      btcpay: Boolean(btcpay.url && btcpay.apiKey && btcpay.storeId),
      paddle: Boolean(settings.paddle_api_key),
      stripe: Boolean(settings.stripe_secret_key),
      lemonsqueezy: Boolean(settings.lemonsqueezy_api_key),
    },
  };
}

// ---- public ----
app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'wan-video-generator', ...settingsStatus(getSettings()) });
});

// ---- auth ----
app.post('/api/auth/register', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password || String(password).length < 8) {
    return res.status(400).json({ ok: false, error: 'INVALID_INPUT', message: 'Email and a password of at least 8 characters are required.' });
  }
  if (db.getUserByEmail(email)) {
    return res.status(409).json({ ok: false, error: 'EMAIL_TAKEN', message: 'An account with this email already exists.' });
  }
  const role = (db.countUsers() === 0 || auth.isOwnerEmail(email)) ? 'owner' : 'user';
  const user = db.createUser(email, auth.hashPassword(password), role);
  db.addLedger(user.id, STARTER_CREDITS, 'Starter credits — welcome', null);
  res.status(201).json({ ok: true, token: auth.signToken(user), user: auth.publicUser(user), balance: STARTER_CREDITS });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  const user = email ? db.getUserByEmail(email) : null;
  if (!user || !auth.checkPassword(password || '', user.password_hash)) {
    return res.status(401).json({ ok: false, error: 'INVALID_CREDENTIALS', message: 'Wrong email or password.' });
  }
  res.json({ ok: true, token: auth.signToken(user), user: auth.publicUser(user), balance: db.getBalance(user.id) });
});

app.get('/api/me', auth.requireAuth, (req, res) => {
  res.json({ ok: true, user: auth.publicUser(req.user), balance: db.getBalance(req.user.id), ...settingsStatus(getSettings()) });
});

// ---- credits ----
app.get('/api/credits', auth.requireAuth, (req, res) => {
  res.json({ ok: true, balance: db.getBalance(req.user.id), ledger: db.listLedger(req.user.id), packs: payments.PACKS });
});

app.post('/api/credits/buy', auth.requireAuth, async (req, res) => {
  const { pack, provider } = req.body || {};
  try {
    const origin = `${req.protocol}://${req.get('host')}`;
    const result = await payments.buyPack(req.user, pack, provider || 'paypal', getSettings(), origin);
    if (!result.ok) return res.status(result.error === 'PAYMENTS_NOT_CONNECTED' ? 503 : 400).json(result);
    res.json(result);
  } catch (e) {
    console.error('[buy]', e.message);
    res.status(502).json({ ok: false, error: 'PROVIDER_ERROR', message: e.message });
  }
});

app.post('/api/credits/confirm-paypal', auth.requireAuth, async (req, res) => {
  const { orderId } = req.body || {};
  if (!orderId) return res.status(400).json({ ok: false, error: 'INVALID_INPUT', message: 'orderId is required.' });
  try {
    const result = await payments.confirmPaypalOrder(req.user, orderId, getSettings());
    if (!result.ok) return res.status(400).json(result);
    res.json(result);
  } catch (e) {
    console.error('[confirm-paypal]', e.message);
    res.status(502).json({ ok: false, error: 'PROVIDER_ERROR', message: e.message });
  }
});

// ---- jobs ----
app.get('/api/jobs', auth.requireAuth, (req, res) => {
  res.json({ ok: true, jobs: db.listJobs(req.user.id) });
});

app.post('/api/jobs', auth.requireAuth, (req, res) => {
  const { prompt, style, format, imageName, imageDataUrl } = req.body || {};
  if (!prompt || String(prompt).trim().length < 3) {
    return res.status(400).json({ ok: false, error: 'INVALID_INPUT', message: 'Describe your video in a few words.' });
  }
  if (imageDataUrl && Buffer.byteLength(imageDataUrl, 'utf8') > MAX_IMAGE_BYTES * 1.4) {
    return res.status(400).json({ ok: false, error: 'IMAGE_TOO_LARGE', message: 'Image must be under 5 MB.' });
  }
  if (db.getBalance(req.user.id) < 1) {
    return res.status(402).json({ ok: false, error: 'NOT_ENOUGH_CREDITS', message: 'You need at least 1 credit. Buy a pack to continue.' });
  }
  const job = db.createJob(req.user.id, {
    prompt: String(prompt).trim(),
    style: ['cinematic', 'fun', 'product', 'clinic'].includes(style) ? style : 'cinematic',
    format: ['9:16', '16:9', '1:1'].includes(format) ? format : '9:16',
    imageName: imageName || null,
    imageData: imageDataUrl || null,
  });
  db.addLedger(req.user.id, -1, `Video generation — job #${job.id}`, `job:${job.id}`);
  const settings = getSettings();
  res.status(201).json({ ok: true, job, demo_mode: !worker.isWorkerConfigured(settings), balance: db.getBalance(req.user.id) });
});

app.get('/api/jobs/:id', auth.requireAuth, (req, res) => {
  const job = db.getJob(parseInt(req.params.id, 10));
  if (!job || job.user_id !== req.user.id) return res.status(404).json({ ok: false, error: 'NOT_FOUND' });
  res.json({ ok: true, job });
});

// ---- owner settings ----
const SECRET_KEYS = new Set([
  'worker_api_key', 'paypal_client_secret', 'btcpay_api_key',
  'paddle_api_key', 'stripe_secret_key', 'lemonsqueezy_api_key',
]);
function maskedSettings(settings) {
  const out = {};
  for (const [k, v] of Object.entries(settings)) {
    out[k] = SECRET_KEYS.has(k) ? (v ? `••••••••${String(v).slice(-4)}` : '') : v;
  }
  return out;
}
app.get('/api/settings', auth.requireAuth, auth.requireOwner, (req, res) => {
  res.json({ ok: true, settings: maskedSettings(getSettings()), status: settingsStatus(getSettings()) });
});
app.put('/api/settings', auth.requireAuth, auth.requireOwner, (req, res) => {
  const body = req.body || {};
  const allowed = [
    'worker_provider', 'worker_url', 'worker_api_key', 'worker_endpoint_id',
    'paypal_client_id', 'paypal_client_secret', 'paypal_mode',
    'btcpay_url', 'btcpay_api_key', 'btcpay_store_id',
    'paddle_api_key', 'stripe_secret_key', 'lemonsqueezy_api_key',
  ];
  for (const key of allowed) {
    if (typeof body[key] !== 'string') continue;
    // A masked value (••••) means "keep the stored secret".
    if (SECRET_KEYS.has(key) && body[key].includes('•')) continue;
    db.setSetting(key, body[key]);
  }
  res.json({ ok: true, settings: maskedSettings(getSettings()), status: settingsStatus(getSettings()) });
});

// ---- payment webhooks (public endpoints, verified by re-fetching) ----
app.post('/api/webhooks/paypal', async (req, res) => {
  try {
    const event = req.body || {};
    if (event.event_type !== 'CHECKOUT.ORDER.COMPLETED') return res.json({ ok: true, ignored: true });
    const orderId = event.resource && event.resource.id;
    if (!orderId) return res.status(400).json({ ok: false, error: 'NO_ORDER_ID' });
    // Credit by looking the order up with PayPal (never trust the payload alone).
    const cfg = payments.paypalConfig(getSettings());
    if (!cfg.clientId || !cfg.secret) return res.status(503).json({ ok: false, error: 'PAYMENTS_NOT_CONNECTED' });
    const tokenRes = await fetch(`${cfg.mode === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com'}/v1/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Basic ' + Buffer.from(`${cfg.clientId}:${cfg.secret}`).toString('base64') },
      body: 'grant_type=client_credentials',
    });
    const { access_token } = await tokenRes.json();
    const orderRes = await fetch(`${cfg.mode === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com'}/v2/checkout/orders/${encodeURIComponent(orderId)}`, {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    const order = await orderRes.json();
    if (order.status !== 'COMPLETED') return res.json({ ok: true, ignored: true, status: order.status });
    const unit = (order.purchase_units || [])[0] || {};
    const [userId, packId] = String(unit.custom_id || '').split(':');
    const pack = payments.PACKS[packId];
    if (!userId || !pack) return res.status(400).json({ ok: false, error: 'UNKNOWN_PACK_OR_USER' });
    db.addLedger(parseInt(userId, 10), pack.credits, `PayPal purchase — ${pack.name}`, `paypal:${orderId}`);
    res.json({ ok: true, credited: pack.credits });
  } catch (e) {
    console.error('[webhook paypal]', e.message);
    res.status(500).json({ ok: false, error: 'WEBHOOK_ERROR', message: e.message });
  }
});

app.post('/api/webhooks/btcpay', async (req, res) => {
  try {
    const result = await payments.handleBtcpayWebhook(req.body || {}, getSettings());
    res.json(result);
  } catch (e) {
    console.error('[webhook btcpay]', e.message);
    res.status(500).json({ ok: false, error: 'WEBHOOK_ERROR', message: e.message });
  }
});

// ---- static frontend (same-origin dev / docker deployment) ----
app.use(express.static(FRONTEND_DIR));
app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ ok: false, error: 'NOT_FOUND' });
  res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
});

app.use((err, req, res, next) => {
  console.error('[server]', err.message);
  res.status(500).json({ ok: false, error: 'SERVER_ERROR', message: 'Something went wrong.' });
});

app.listen(PORT, () => {
  const settings = getSettings();
  console.log(`[wan-saas] listening on http://localhost:${PORT}`);
  console.log(`[wan-saas] demo mode: ${!worker.isWorkerConfigured(settings) ? 'ON (no GPU worker configured)' : 'OFF'}`);
  worker.startPoller(getSettings);
});
