// worker.js — GPU worker client + demo-mode fallback.
//
// Real rendering happens on a GPU worker (Vast.ai pod, RunPod serverless
// endpoint, or any custom server). The worker contract is documented in
// README.md ("Worker API contract"). Until a worker is configured, jobs run
// in clearly-labeled DEMO MODE and complete with a bundled sample video —
// the app never pretends a demo result is a real render.
const db = require('./db');

const DEMO_DELAY_MS = 8000;
const SAMPLES = [
  { id: 'clinic', url: '/samples/demo-clinic.mp4', match: ['clinic', 'dental', 'dentist', 'medical'] },
  { id: 'product', url: '/samples/demo-product.mp4', match: [] },
];

function pickSample(job) {
  const hay = `${job.prompt || ''} ${job.style || ''}`.toLowerCase();
  for (const s of SAMPLES) {
    if (s.match.some((w) => hay.includes(w))) return s;
  }
  return SAMPLES[SAMPLES.length - 1];
}

function workerConfig(settings) {
  return {
    provider: settings.worker_provider || process.env.WORKER_PROVIDER || '',
    url: (settings.worker_url || process.env.WORKER_URL || '').replace(/\/$/, ''),
    apiKey: settings.worker_api_key || process.env.WORKER_API_KEY || '',
    endpointId: settings.worker_endpoint_id || process.env.WORKER_ENDPOINT_ID || '',
  };
}
function isWorkerConfigured(settings) {
  const c = workerConfig(settings);
  if (c.provider === 'runpod') return Boolean(c.endpointId && c.apiKey);
  if (c.provider === 'custom' || c.provider === 'vastai') return Boolean(c.url);
  return false;
}

async function submitToWorker(job, cfg) {
  const payload = {
    job_id: job.id,
    prompt: job.prompt,
    style: job.style,
    format: job.format,
    duration_seconds: 5,
    resolution: '720p',
    image_data_url: job.image_data || undefined,
  };
  if (cfg.provider === 'runpod') {
    const res = await fetch(`https://api.runpod.ai/v2/${cfg.endpointId}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({ input: payload }),
    });
    if (!res.ok) throw new Error(`RunPod error ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return { workerJobId: String(data.id), videoUrl: data.output && data.output.video_url ? data.output.video_url : null };
  }
  // custom / vastai: the worker runs our documented contract.
  const res = await fetch(`${cfg.url}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cfg.apiKey ? { 'X-API-Key': cfg.apiKey } : {}) },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Worker error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return {
    workerJobId: data.job_id ? String(data.job_id) : null,
    videoUrl: data.video_url || null,
  };
}

async function checkWorkerJob(job, cfg) {
  if (cfg.provider === 'runpod') {
    const res = await fetch(`https://api.runpod.ai/v2/${cfg.endpointId}/status/${job.worker_job_id}`, {
      headers: { Authorization: `Bearer ${cfg.apiKey}` },
    });
    if (!res.ok) throw new Error(`RunPod status error ${res.status}`);
    const data = await res.json();
    if (data.status === 'COMPLETED') {
      return { status: 'completed', videoUrl: (data.output && data.output.video_url) || null };
    }
    if (data.status === 'FAILED') return { status: 'failed', error: 'Worker reported failure.' };
    return { status: 'processing' };
  }
  if (!job.worker_job_id) return { status: 'processing' };
  const res = await fetch(`${cfg.url}/jobs/${encodeURIComponent(job.worker_job_id)}`, {
    headers: { ...(cfg.apiKey ? { 'X-API-Key': cfg.apiKey } : {}) },
  });
  if (!res.ok) throw new Error(`Worker status error ${res.status}`);
  const data = await res.json();
  if (data.status === 'completed') return { status: 'completed', videoUrl: data.video_url || null };
  if (data.status === 'failed') return { status: 'failed', error: data.error || 'Worker reported failure.' };
  return { status: 'processing' };
}

// One poll tick: advance every pending job.
async function pollOnce(getSettings) {
  const settings = getSettings();
  const configured = isWorkerConfigured(settings);
  const cfg = workerConfig(settings);
  for (const job of db.pendingJobs()) {
    try {
      if (!configured) {
        // DEMO MODE: complete with a labeled sample video after a short delay.
        const age = Date.now() - new Date(job.created_at.replace(' ', 'T') + 'Z').getTime();
        if (age >= DEMO_DELAY_MS) {
          const sample = pickSample(job);
          db.updateJob(job.id, { status: 'completed', sample_id: sample.id, video_url: sample.url });
        }
        continue;
      }
      if (!job.worker_job_id) {
        const { workerJobId, videoUrl } = await submitToWorker(job, cfg);
        if (videoUrl) {
          db.updateJob(job.id, { status: 'completed', video_url: videoUrl });
        } else {
          db.updateJob(job.id, { status: 'processing', worker_job_id: workerJobId });
        }
        continue;
      }
      const result = await checkWorkerJob(job, cfg);
      if (result.status === 'completed' && result.videoUrl) {
        db.updateJob(job.id, { status: 'completed', video_url: result.videoUrl });
      } else if (result.status === 'failed') {
        db.updateJob(job.id, { status: 'failed', error: result.error });
      } else if (result.status === 'completed' && !result.videoUrl) {
        db.updateJob(job.id, { status: 'failed', error: 'Worker finished without a video URL.' });
      }
    } catch (e) {
      console.error(`[worker] job ${job.id}:`, e.message);
      // Do not fail the job on a transient worker error; retry next tick.
      // If the worker endpoint itself is unreachable for a long time the job
      // stays "processing" — visible in the Library, never silently dropped.
    }
  }
}

function startPoller(getSettings) {
  setInterval(() => { pollOnce(getSettings).catch((e) => console.error('[worker] poll error:', e.message)); }, 10000);
  // Run once at startup so jobs left pending by a restart resume.
  pollOnce(getSettings).catch((e) => console.error('[worker] poll error:', e.message));
}

module.exports = { workerConfig, isWorkerConfigured, pickSample, pollOnce, startPoller, DEMO_DELAY_MS };
