// app.js — Wan Video Generator frontend (vanilla JS, no build step).
const API = (window.WAN_API_URL || '').replace(/\/$/, '');
const $ = (id) => document.getElementById(id);

let token = localStorage.getItem('wan_token') || '';
let me = null;
let status = null;
let pollTimer = null;

async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(opts.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || data.error || `Request failed (${res.status})`);
  return data;
}

function show(el, visible) { el.hidden = !visible; }
function setError(el, msg) { el.textContent = msg || ''; el.hidden = !msg; }

// ---- session ----
async function refreshMe() {
  try {
    const data = await api('/api/me');
    me = data.user;
    status = data;
    $('creditCount').textContent = data.balance;
    show($('creditPill'), true);
    show($('userEmail'), true);
    $('userEmail').textContent = me.email;
    show($('logoutBtn'), true);
    show($('demoBadge'), !!data.demo_mode);
    show($('demoNote'), !!data.demo_mode);
    show($('settingsTabBtn'), me.role === 'owner');
    show($('authView'), false);
    show($('appView'), true);
    if (me.role === 'owner') loadSettings();
    loadLibrary();
    renderPacks(data);
  } catch {
    signOut(true);
  }
}
function signOut(silent) {
  token = ''; me = null;
  localStorage.removeItem('wan_token');
  show($('appView'), false);
  show($('authView'), true);
  show($('creditPill'), false);
  show($('userEmail'), false);
  show($('logoutBtn'), false);
  show($('demoBadge'), false);
  if (!silent) location.reload();
}
$('logoutBtn').addEventListener('click', () => signOut(false));

$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const data = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: $('loginEmail').value, password: $('loginPassword').value }) });
    token = data.token; localStorage.setItem('wan_token', token);
    setError($('loginError'), '');
    refreshMe();
  } catch (err) { setError($('loginError'), err.message); }
});
$('registerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const data = await api('/api/auth/register', { method: 'POST', body: JSON.stringify({ email: $('regEmail').value, password: $('regPassword').value }) });
    token = data.token; localStorage.setItem('wan_token', token);
    setError($('regError'), '');
    refreshMe();
  } catch (err) { setError($('regError'), err.message); }
});

// ---- tabs ----
document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.tab-panel').forEach((p) => { p.hidden = true; });
    $('tab-' + btn.dataset.tab).hidden = false;
    if (btn.dataset.tab === 'library') loadLibrary();
  });
});

// ---- studio ----
let imageDataUrl = '';
$('jobImage').addEventListener('change', () => {
  const file = $('jobImage').files[0];
  if (!file) { imageDataUrl = ''; show($('imagePreview'), false); return; }
  if (file.size > 5 * 1024 * 1024) { setError($('jobError'), 'Image must be under 5 MB.'); return; }
  const reader = new FileReader();
  reader.onload = () => {
    imageDataUrl = reader.result;
    $('imagePreviewImg').src = imageDataUrl;
    show($('imagePreview'), true);
  };
  reader.readAsDataURL(file);
});

$('jobForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  setError($('jobError'), '');
  $('generateBtn').disabled = true;
  try {
    const data = await api('/api/jobs', {
      method: 'POST',
      body: JSON.stringify({
        prompt: $('jobPrompt').value,
        style: $('jobStyle').value,
        format: $('jobFormat').value,
        imageName: $('jobImage').files[0] ? $('jobImage').files[0].name : null,
        imageDataUrl: imageDataUrl || null,
      }),
    });
    $('creditCount').textContent = data.balance;
    showJobResult(data.job);
    watchJob(data.job.id);
  } catch (err) {
    setError($('jobError'), err.message);
  } finally {
    $('generateBtn').disabled = false;
  }
});

function showJobResult(job) {
  show($('jobResult'), true);
  $('jobResultTitle').textContent = 'Your video — job #' + job.id;
  $('jobResultStatus').textContent = `Status: ${job.status}` + (job.sample_id ? ' — DEMO SAMPLE (not a real render)' : '');
  const video = $('jobResultVideo');
  if (job.video_url) {
    video.src = API + job.video_url;
    show(video, true);
  } else {
    show(video, false);
  }
  $('jobResult').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function watchJob(jobId) {
  clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    try {
      const { job } = await api('/api/jobs/' + jobId);
      showJobResult(job);
      if (job.status === 'completed' || job.status === 'failed') {
        clearInterval(pollTimer);
        refreshMe();
      }
    } catch { clearInterval(pollTimer); }
  }, 3000);
}

// ---- library ----
async function loadLibrary() {
  try {
    const { jobs } = await api('/api/jobs');
    const list = $('jobsList');
    if (!jobs.length) { list.innerHTML = '<p class="muted">No videos yet — generate your first one in the Studio.</p>'; }
    else {
      list.innerHTML = jobs.map((j) => `
        <div class="job-item">
          <div><b>#${j.id}</b> — ${escapeHtml(j.prompt)} <span class="status status-${j.status}">${j.status}</span>${j.sample_id ? '<span class="sample-tag">DEMO SAMPLE</span>' : ''}</div>
          <div class="muted">${escapeHtml(j.style)} · ${escapeHtml(j.format)} · ${new Date(j.created_at.replace(' ', 'T') + 'Z').toLocaleString()}</div>
          ${j.video_url ? `<video src="${API + j.video_url}" controls playsinline></video>` : ''}
          ${j.error ? `<p class="error">${escapeHtml(j.error)}</p>` : ''}
        </div>`).join('');
    }
    const { ledger } = await api('/api/credits');
    const ll = $('ledgerList');
    ll.innerHTML = ledger.length ? ledger.map((r) => `
      <div class="ledger-row"><span>${escapeHtml(r.reason)} <span class="muted">(${new Date(r.created_at.replace(' ', 'T') + 'Z').toLocaleDateString()})</span></span>
      <span class="${r.delta >= 0 ? 'ledger-pos' : 'ledger-neg'}">${r.delta >= 0 ? '+' : ''}${r.delta}</span></div>`).join('')
      : '<p class="muted">No credit activity yet.</p>';
  } catch { /* keep old content on error */ }
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---- credits ----
const PACKS = [
  { id: 'single', name: '1 video', price: 1, credits: 1 },
  { id: 'pack10', name: '10 videos', price: 8, credits: 10 },
  { id: 'pack30', name: '30 videos', price: 20, credits: 30 },
  { id: 'monthly', name: 'Monthly — 30 videos', price: 15, credits: 30 },
];
function renderPacks(data) {
  const connected = data && data.payments && (data.payments.paypal || data.payments.btcpay);
  $('payNote').textContent = connected
    ? 'Payments are connected. Choose a pack and a payment method — you will be redirected to approve the payment.'
    : 'Payments are not connected yet — the owner needs to add payment keys in Settings before anyone can be charged.';
  $('packs').innerHTML = PACKS.map((p) => `
    <div class="pack">
      <div class="price">$${p.price}</div>
      <div class="name">${p.name} · ${p.credits} credit${p.credits > 1 ? 's' : ''}</div>
      <select id="pay-${p.id}" aria-label="Payment method for ${p.name}">
        <option value="paypal">PayPal</option>
        <option value="btcpay">Lightning / crypto (BTCPay)</option>
      </select>
      <button class="btn btn-primary btn-small" data-pack="${p.id}">Buy</button>
    </div>`).join('');
  document.querySelectorAll('#packs button[data-pack]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      setError($('buyError'), '');
      const packId = btn.dataset.pack;
      const provider = $('pay-' + packId).value;
      btn.disabled = true;
      try {
        const res = await api('/api/credits/buy', { method: 'POST', body: JSON.stringify({ pack: packId, provider }) });
        if (res.approvalUrl || res.checkoutUrl) {
          location.href = res.approvalUrl || res.checkoutUrl;
        } else {
          setError($('buyError'), 'Payment started but no checkout URL was returned.');
        }
      } catch (err) {
        setError($('buyError'), err.message);
      } finally {
        btn.disabled = false;
      }
    });
  });
}

// PayPal return: capture the order and credit the pack.
(async function handlePaypalReturn() {
  const params = new URLSearchParams(location.search);
  const tokenParam = params.get('token');
  if (params.get('paypal') === 'success' && tokenParam && localStorage.getItem('wan_token')) {
    try {
      const res = await api('/api/credits/confirm-paypal', { method: 'POST', body: JSON.stringify({ orderId: tokenParam }) });
      if (res.ok) alert(`Payment confirmed — ${res.credits} credit(s) added. Balance: ${res.balance}.`);
    } catch (e) { alert('PayPal payment could not be confirmed: ' + e.message); }
    history.replaceState(null, '', location.pathname);
  }
})();

// ---- owner settings ----
async function loadSettings() {
  try {
    const { settings } = await api('/api/settings');
    const set = (id, key) => { const el = $(id); if (el && settings[key] !== undefined) el.value = settings[key]; };
    set('setWorkerProvider', 'worker_provider');
    set('setWorkerUrl', 'worker_url');
    set('setWorkerApiKey', 'worker_api_key');
    set('setWorkerEndpointId', 'worker_endpoint_id');
    set('setPaypalClientId', 'paypal_client_id');
    set('setPaypalClientSecret', 'paypal_client_secret');
    set('setPaypalMode', 'paypal_mode');
    set('setBtcpayUrl', 'btcpay_url');
    set('setBtcpayApiKey', 'btcpay_api_key');
    set('setBtcpayStoreId', 'btcpay_store_id');
    set('setPaddleKey', 'paddle_api_key');
    set('setStripeKey', 'stripe_secret_key');
    set('setLsKey', 'lemonsqueezy_api_key');
  } catch { /* settings load failure is non-fatal */ }
}

$('workerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  setError($('settingsError'), '');
  $('settingsSaved').hidden = true;
  try {
    await api('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({
        worker_provider: $('setWorkerProvider').value,
        worker_url: $('setWorkerUrl').value.trim(),
        worker_api_key: $('setWorkerApiKey').value,
        worker_endpoint_id: $('setWorkerEndpointId').value.trim(),
      }),
    });
    $('settingsSaved').hidden = false;
    refreshMe();
  } catch (err) { setError($('settingsError'), err.message); }
});

$('paymentsForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  setError($('settingsError'), '');
  $('settingsSaved').hidden = true;
  try {
    await api('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({
        paypal_client_id: $('setPaypalClientId').value.trim(),
        paypal_client_secret: $('setPaypalClientSecret').value,
        paypal_mode: $('setPaypalMode').value,
        btcpay_url: $('setBtcpayUrl').value.trim(),
        btcpay_api_key: $('setBtcpayApiKey').value,
        btcpay_store_id: $('setBtcpayStoreId').value.trim(),
        paddle_api_key: $('setPaddleKey').value,
        stripe_secret_key: $('setStripeKey').value,
        lemonsqueezy_api_key: $('setLsKey').value,
      }),
    });
    $('settingsSaved').hidden = false;
    refreshMe();
  } catch (err) { setError($('settingsError'), err.message); }
});

// ---- boot ----
if (token) refreshMe();
