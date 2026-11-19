# Go-to-market — Wan Video Generator

Free-first launch plan. DRAFT — nothing published, nothing spent, no new accounts created.

**The honest math, first:** this is a $1/video tool. "Millions" needs volume — roughly 1,000,000 videos sold, or ~35,000 monthly subscribers at $15/mo. That is a distribution problem, not a pricing problem. The plan below is about getting the first 100 paying users, not the first million dollars.

---

## Step 1 — Deploy + smoke-test the live site (before any post)

- [ ] Push `wan-saas/` to GitHub and import in Vercel (frontend, free).
- [ ] VPS up, `docker compose up -d`, HTTPS via Caddy, API URL set in `frontend/config.js`.
- [ ] GPU worker connected (RunPod serverless or Vast.ai pod) — verify a REAL render end-to-end, not a demo sample.
- [ ] PayPal live keys in Settings + micropayments rate requested; test a real $1 purchase and confirm the credit lands.
- [ ] BTCPay/Lightning: invoice → pay → credit lands. If BTCPay isn't ready yet, launch PayPal-only and say so.
- [ ] Smoke test as a fresh user: sign up → 5 free credits → generate → download → buy 1 video → credit lands.
- [ ] Replace every `[SITE-URL]` in the launch kit with the real URL. Do not post anything with the placeholder still in it.

**Gate:** no launch post goes out until a stranger could sign up, pay $1, and get a real video. Demo mode is fine for testing, not for selling.

---

## Step 2 — Product Hunt launch (draft)

**Name:** Wan Video Generator
**Tagline:** Turn an image + a prompt into a 5-second AI video — for $1.
**Description (first 2 lines):** Upload a photo, describe the motion, get a 720p video. No subscription, no GPU of your own — $1 a video, 5 free on signup. Powered by the open-source Wan 2.2 model.
**Topics:** Artificial Intelligence, Video, Creator Tools, No-Code
**First comment (maker's comment):**
> Hey hunters! I built this because AI video tools kept asking $15–30/month for clips I'd use twice. Wan Video Generator is pay-per-video: $1 a clip, 5 free to start, PayPal or Lightning. It runs the open-source Wan 2.2 model — your image in, 5-second 720p video out. Happy to answer anything about the model, the pricing, or what's next. What would you animate first?

**Launch day:** Tuesday–Thursday, post at 00:01 PT (Product Hunt day starts at midnight Pacific). Have the demo videos ready to link in the gallery.

---

## Step 3 — 3 demo videos to post (concepts + prompts)

⚠️ **Do NOT post the bundled demo samples (`demo-clinic.mp4`, `demo-product.mp4`) as real renders** — they are ffmpeg test-pattern clips, labeled DEMO SAMPLE in the app. Posting them as product output would be a fake claim. Use these concepts instead:

**Video 1 — "The photo that moved" (the hook video, post first)**
- Concept: a still product photo on screen for 1 second, then it animates — camera pushes in, steam rises, light shifts. Split-screen: left = the still, right = the video.
- Needs a REAL Wan render. Prompt example: image = product photo, prompt = "slow cinematic push-in, soft light shifting, steam rising gently, photorealistic, 5 seconds".
- Use on: TikTok, Reels, Shorts. This is the video the launch posts link to.

**Video 2 — "How it works in 15 seconds" (the explainer)**
- Concept: screen recording of the Studio tab — type a prompt, hit generate, video appears, download button. No voiceover needed; on-screen text: "1. Upload → 2. Describe → 3. Download".
- Works in demo mode (the UI is real even if the render is a sample — label it "demo" on screen if the sample shows). Best once the worker is live.
- Use on: YouTube Shorts (pinned), Product Hunt gallery, landing page hero.

**Video 3 — "What would you animate?" (the engagement video)**
- Concept: 3 quick before/afters in one clip — a portrait that blinks/smiles, a landscape with moving clouds, a product shot with a slow orbit. End card: "What would you animate? $1 a video — link in bio."
- Prompts: portrait — "subtle smile, slight head tilt, natural blink, photorealistic"; landscape — "clouds drifting slowly, trees swaying gently, golden hour"; product — "slow orbit around the product, studio lighting, clean background".
- Needs REAL Wan renders. Use on: TikTok + Instagram, repost the best-performing one to Facebook.

---

## Step 4 — Free channels (in order)

1. **Product Hunt** (Step 2) — one shot, do it when the site is truly live.
2. **Reddit — r/SideProject** — "I built a $1 AI video generator (Wan 2.2) — 5 free videos, no subscription". Post the demo video, link in comments, answer questions for a day. No self-promo spam; one post.
3. **Reddit — r/StableDiffusion** — same angle, model-focused: open-source Wan 2.2, pay-per-use instead of a subscription. Only if the rules allow a Show & Tell post — read them first.
4. **X (Twitter)** — the hook video + one line: "Your still photo just moved. $1." Pin it. Reply to AI-video threads with the demo, not with ads.
5. **TikTok / Instagram / YouTube Shorts** — the 3 demo videos (Step 3), one a day, same hook. Bio link = site URL.

**Cadence:** launch week = Product Hunt day 1, Reddit day 2, then one short a day for a week. After that, post when there is a new real render worth showing — not on a forced schedule.

---

## Step 5 — What NOT to do

- **No paid ads before the first organic sales.** $1/video margins cannot carry ad spend until you know the conversion rate from a free trial. First 10 paying users must come free.
- **No fake reviews, testimonials, or user counts.** Never invent "loved by 10,000 creators". Say "5 free videos" — that's a real offer, not a claim.
- **No "best / #1 / fastest" claims** until a benchmark exists. "Cheapest per video" is only true vs. named competitors with a dated comparison — don't claim it without one.
- **No posting demo samples as real renders** (see Step 3). One caught fake demo kills trust in a $1 product.
- **No new features before the first sale.** The funnel is: live site → demo video → first $1. A new style preset is not the bottleneck; distribution is.
- **No discounting below $1** to "get users". The price IS the hook. Discount the packs, not the single video.

---

## Notes (FR, interne — ne pas publier)

- Le lancement attend le vrai moteur GPU : sans rendu réel, on vend une démo, pas un produit. Ne pas poster avant le smoke test complet (étape 1).
- Vercel est connecté ; le dépôt GitHub `wan-video-generator` reste à créer par Stephan, puis push + import Vercel.
- Les 5 crédits gratuits sont le meilleur aimant : tout le copy pousse l'essai gratuit, pas l'achat.
- Prochaine brique après le lancement : mesurer — d'où viennent les inscrits, combien convertissent en payants — puis décider (SEO, nouveaux styles, affiliation).
