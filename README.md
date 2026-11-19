# Wan Video Generator

Turn an image + a prompt into a 5-second 720p AI video. **1 credit = 1 video.**

- **Pricing:** 1 video **$1** · 10 videos **$8** · 30 videos **$20** · Monthly **$15** for 30 videos. New accounts start with 5 free credits.
- **Payments:** PayPal first (ask PayPal for the **micropayments rate — 5% + $0.05** — much cheaper on $1 videos), **Lightning via BTCPay Server** as the primary crypto rail, Paddle second. Stripe and Lemon Squeezy keys can be saved; their checkout is **not wired yet** — the app says so instead of pretending to charge.
- **Engine:** Wan 2.2 (Apache 2.0 — commercial use allowed, no revenue cap, no rights claimed over generated videos).
- **Cost to run:** frontend free (Vercel) + ~$5/mo VPS + GPU on demand (Vast.ai ~$0.25–0.50/hr for a 4090, ~$0.15/hr interruptible; RunPod Community $0.34/hr). With the Lightning LoRA (~50 clips/GPU-hour) GPU cost is ~$0.01 per video.

## Honest state of this repo

- **Demo mode until a GPU worker is connected.** Without a worker, jobs complete after a few seconds with a clearly-labeled **DEMO SAMPLE** video. The app never presents a sample as a real render.
- **Nothing charges until payment keys are added.** Buy buttons return `Payments not connected yet` (HTTP 503) until PayPal or BTCPay keys are saved in Settings.
- **No real secrets anywhere in this repo.** All keys live in `.env` (server) or in the owner Settings tab (stored in SQLite, shown masked). Never commit `.env`.

## Project layout

```
frontend/          Static single-page app (HTML/CSS/JS, dark mode, responsive)
  index.html       Tabs: Studio, Library, Credits & pricing, Settings (owner)
  app.js           Auth, job creation + polling, packs, settings
  config.js        API base URL ("" = same origin; set to your VPS URL on Vercel)
  samples/         Bundled demo videos (demo-clinic.mp4, demo-product.mp4)
server/            Node.js + Express + SQLite (built-in node:sqlite, no native deps)
  server.js        REST API + static frontend
  db.js            Users, credits ledger, jobs, settings
  auth.js          bcrypt + JWT, owner role
  worker.js        GPU worker client (custom contract + RunPod) + demo fallback
  payments.js      Packs, PayPal orders/capture, BTCPay invoices/webhooks
docker-compose.yml VPS deployment (one container: API + frontend)
vercel.json        Frontend on Vercel (free)
.env.example       Every variable, documented, no real secrets
```

## Quick start (local)

```bash
cp .env.example .env          # then set JWT_SECRET at minimum
cd server && npm install && cd ..
node server/server.js         # http://localhost:3000
```

Create an account in the app — the first account is the owner (sees Settings). You start with 5 credits. Generate a video: in demo mode it returns a labeled sample.

## Deploy for real (to profit from it)

### 1. Frontend — Vercel (free)
1. Push this repo to GitHub.
2. Import it in Vercel (framework: **Other / static**, output directory: `frontend` — `vercel.json` already sets it).
3. Edit `frontend/config.js` and set `window.WAN_API_URL` to your API URL (step 2).

### 2. API server — VPS ~$5/mo
1. Rent a small VPS (e.g. Hetzner CX22 ~€4.50/mo, or any Ubuntu 22.04+ box with Docker).
2. `git clone` this repo, `cp .env.example .env`, set `JWT_SECRET` (long random string) and `OWNER_EMAIL`.
3. `docker compose up -d --build` — the API listens on port 3000 and serves the frontend too.
4. Point a domain at the VPS and put Caddy or nginx in front for HTTPS, e.g. Caddy:
   ```
   your-domain.com {
     reverse_proxy localhost:3000
   }
   ```
   (Caddy gets a free TLS certificate automatically.)

### 3. GPU worker — Vast.ai or RunPod
The server does **not** render video itself. It POSTs jobs to a worker:

**Option A — RunPod serverless (easiest):** create a serverless endpoint running a Wan 2.2 worker (ComfyUI or the official `generate.py` + a small HTTP wrapper), then set in Settings: provider `runpod`, endpoint ID, API key.

**Option B — Vast.ai pod (cheapest):** rent a 24 GB GPU (RTX 4090 ~$0.25–0.50/hr, ~$0.15/hr interruptible), run the worker API below, then set provider `vastai` (or `custom`) + worker URL + API key. Use the **Lightning LoRA (4 steps)** — ~50 clips per GPU-hour, ~$0.01/video.

**Option C — custom server:** any server implementing the worker contract.

#### Worker API contract
```
POST {WORKER_URL}/generate        (header X-API-Key if set)
  Body: { job_id, prompt, style, format, duration_seconds: 5,
          resolution: "720p", image_data_url? }
  → 200 { job_id }            (async)  or  { video_url } (sync)

GET  {WORKER_URL}/jobs/{job_id}
  → 200 { status: "queued" | "processing" | "completed" | "failed",
          video_url?, error? }
```
`video_url` must be a URL the browser can load (public URL or a proxied path). The server polls every 10 s. A job that stays `processing` is visible in the Library — never silently dropped.

> VRAM reality check: the official Wan 2.2 TI2V-5B path needs **24 GB VRAM**. A free Colab T4 (16 GB) will very likely run out of memory. The reliable free path is **ComfyUI with offloading (832×480)**. Weights total ~34 GB (diffusion shards ~20 GB + VAE 2.8 GB + T5 encoder 11.4 GB).

### 4. Payments
**PayPal (primary):** create a REST API app at developer.paypal.com (sandbox first), paste client ID + secret in Settings → Payments, switch mode to `live`. Then ask PayPal support for the **micropayments rate (5% + $0.05)** — on a $1 video the standard rate costs $0.33, micropayments only $0.10. PayPal webhook: set it to `https://your-domain.com/api/webhooks/paypal` (event `CHECKOUT.ORDER.COMPLETED`); the server verifies every webhook by re-fetching the order from PayPal, so a forged payload cannot credit anything. The buy flow also works without a webhook (capture on return).

**BTCPay Server — Lightning (primary crypto):** install BTCPay on the same VPS (see [docs.btcpayserver.org](https://docs.btcpayserver.org/)), create a store, enable the Lightning payment method, create an API key (Greenfield, `btcpay.store.canmodifystoresettings` + invoice permissions), paste URL + API key + store ID in Settings. Webhook: `https://your-domain.com/api/webhooks/btcpay` — the server verifies each invoice by fetching it back from BTCPay. **Your personal wallets (Wallet of Satoshi, Zeus) can receive payments but cannot issue the app's invoices** — that is what BTCPay/LNbits is for. Wallet of Satoshi POS remains great for manual/direct sales.

**Paddle (5% + $0.50, merchant of record — handles sales tax):** keys can be saved in Settings, but checkout is not wired yet. Same for **Stripe** and **Lemon Squeezy**. The app says so plainly; use PayPal or BTCPay for now.

**Crypto alternatives:** NOWPayments (~0.5–1%, hosted, 300+ coins) can replace BTCPay if you prefer hosted. Coinbase Commerce was shut down in March 2026 — do not use it.

## API reference

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/api/health` | — | Status: demo mode, worker, payments |
| POST | `/api/auth/register` | — | Email + password (8+ chars) → token, 5 starter credits |
| POST | `/api/auth/login` | — | → token + balance |
| GET | `/api/me` | user | Profile + balance + status |
| GET | `/api/credits` | user | Balance, ledger, packs |
| POST | `/api/credits/buy` | user | `{pack, provider}` → PayPal approval URL or BTCPay checkout URL |
| POST | `/api/credits/confirm-paypal` | user | `{orderId}` → capture + credit (idempotent) |
| GET | `/api/jobs` | user | Your jobs |
| POST | `/api/jobs` | user | `{prompt, style, format, imageName?, imageDataUrl?}` — costs 1 credit |
| GET | `/api/jobs/:id` | user | One job |
| GET/PUT | `/api/settings` | owner | Worker + payment keys (masked on read) |
| POST | `/api/webhooks/paypal` | — | PayPal webhook (verified by re-fetch) |
| POST | `/api/webhooks/btcpay` | — | BTCPay webhook (verified by re-fetch) |

## Security notes

- Passwords are bcrypt-hashed; sessions are JWT (7 days). Set a long random `JWT_SECRET`.
- Secrets are stored in SQLite and returned masked (`••••••••abcd`). Sending a masked value back keeps the stored secret.
- Credit grants are idempotent (unique ledger `ref` per payment), so duplicate webhooks cannot double-credit.
- Never put keys in code, in git, or in chat. Rotate a key in Settings if one leaks.

## License

MIT. Wan 2.2 itself is Apache 2.0 (Alibaba) — commercial use allowed, no revenue cap, no rights claimed over generated videos. This repo is not legal advice.
