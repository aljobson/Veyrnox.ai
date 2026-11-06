import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const STAGING_ORIGIN = 'https://veyrnox-ai-staging.al-jobson.workers.dev';
const STAGING_SUPABASE = 'https://yrqzwqywxfesmbvhzjgj.supabase.co';
const STAGING_ANON_KEY = 'sb_publishable_bAxQiodzBhI6bV7lmo9gMQ_Hlg9_Ish';
const MODEL_ID = 'kling-o1-reference';
const APPROVAL = 'owner-approved-2026-11-06';
const EXPECTED_USD = Object.freeze({ 5: 0.84, 10: 1.68, controlledFailure: 0.84 });
const CREDITS = Object.freeze({ 5: 47, 10: 94 });
const POLL_MS = 15_000;
const DEADLINE_MS = 18 * 60_000;
const OUTPUT_DIR = path.resolve('kling-o1-probe-evidence');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function probeSpendCeiling() {
  return EXPECTED_USD[5] + EXPECTED_USD[10] + EXPECTED_USD.controlledFailure;
}

export function assertProbeEnvironment(env = process.env) {
  if (env.GITHUB_EVENT_NAME !== 'workflow_dispatch') throw new Error('Kling probe requires a manual workflow dispatch');
  if (env.KLING_O1_PROBE_APPROVED !== APPROVAL) throw new Error('Kling probe approval is absent or stale');
  if (Number(env.KLING_O1_PROBE_MAX_USD) !== 5) throw new Error('Kling probe requires the fixed $5 cap');
  if (probeSpendCeiling() > 5) throw new Error('Kling probe scenarios exceed the approved spend cap');
  if (!UUID.test(env.KLING_O1_EXPECTED_WORKER_VERSION || '')) throw new Error('Kling probe requires the verified staging Worker version');
  if (!env.E2E_EMAIL || !env.E2E_PASSWORD) throw new Error('Kling probe requires the confirmed staging E2E account');
  return { origin: STAGING_ORIGIN, supabase: STAGING_SUPABASE, workerVersion: env.KLING_O1_EXPECTED_WORKER_VERSION };
}

export function generationBody({ duration, keys, idempotencyKey, prompt }) {
  if (![5, 10].includes(duration) || keys?.length !== 3) throw new Error('Invalid Kling probe generation shape');
  return {
    model_id: MODEL_ID,
    idempotency_key: idempotencyKey,
    confirmed_credits: CREDITS[duration],
    inputs: { prompt, duration_seconds: duration },
    references: [
      { slot: 'video', origin: 'upload', key: keys[0] },
      { slot: 'image', origin: 'upload', key: keys[1] },
      { slot: 'image', origin: 'upload', key: keys[2] },
    ],
    consent: true,
  };
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const now = () => new Date().toISOString();
const idempotency = label => `kling-o1-${label}-${crypto.randomUUID()}`;

async function jsonResponse(response) {
  const text = await response.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { invalid_json: true }; }
  return { response, body };
}

async function signIn(env) {
  const result = await jsonResponse(await fetch(`${STAGING_SUPABASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: STAGING_ANON_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ email: env.E2E_EMAIL, password: env.E2E_PASSWORD }),
  }));
  if (!result.response.ok || !result.body.access_token || !UUID.test(result.body.user?.id || '')) {
    throw new Error(`Staging sign-in failed (${result.response.status})`);
  }
  return { token: result.body.access_token, authId: result.body.user.id };
}

function client(token) {
  async function request(route, init = {}) {
    const headers = new Headers(init.headers || {});
    headers.set('authorization', `Bearer ${token}`);
    if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
    const result = await jsonResponse(await fetch(`${STAGING_ORIGIN}/api/v1${route}`, { ...init, headers }));
    return { status: result.response.status, ok: result.response.ok, body: result.body };
  }
  return { request };
}

async function ffmpeg(args) {
  await execFileAsync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { maxBuffer: 1024 * 1024 });
}

async function probeMedia(file) {
  const { stdout } = await execFileAsync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height,r_frame_rate', '-show_entries', 'format=duration', '-of', 'json', file]);
  return JSON.parse(stdout);
}

async function syntheticMedia(root) {
  const files = {
    qualifying: path.join(root, 'qualifying-24fps-5s.mp4'),
    short: path.join(root, 'short-24fps-2s.mp4'),
    controlled: path.join(root, 'controlled-20fps-5s.mp4'),
    image1: path.join(root, 'image1-red-circle.png'),
    image2: path.join(root, 'image2-blue-yellow.png'),
  };
  await ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=24', '-t', '5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', files.qualifying]);
  await ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=24', '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', files.short]);
  await ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=20', '-t', '5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', files.controlled]);
  await ffmpeg(['-f', 'lavfi', '-i', 'color=c=#d92f3f:s=1280x720', '-vf', 'drawbox=x=440:y=160:w=400:h=400:color=white:t=fill', '-frames:v', '1', files.image1]);
  await ffmpeg(['-f', 'lavfi', '-i', 'color=c=#173b8f:s=1280x720', '-vf', 'drawbox=x=0:y=80:w=1280:h=80:color=#ffd21f:t=fill,drawbox=x=0:y=560:w=1280:h=80:color=#ffd21f:t=fill', '-frames:v', '1', files.image2]);
  return { files, metadata: {
    qualifying: await probeMedia(files.qualifying),
    short: await probeMedia(files.short),
    controlled: await probeMedia(files.controlled),
  } };
}

async function upload(api, file, contentType) {
  const bytes = await readFile(file);
  const grant = await api.request('/uploads', { method: 'POST', body: JSON.stringify({ content_type: contentType, size_bytes: bytes.length }) });
  if (!grant.ok || typeof grant.body.upload_url !== 'string' || typeof grant.body.key !== 'string') {
    throw new Error(`Upload reservation failed (${grant.status}:${grant.body.error || 'unknown'})`);
  }
  const headers = new Headers(grant.body.headers || { 'content-type': grant.body.content_type });
  const put = await fetch(grant.body.upload_url, { method: 'PUT', headers, body: bytes });
  if (!put.ok) throw new Error(`Source upload failed (${put.status})`);
  return grant.body.key;
}

async function uploadScenario(api, video, pictures) {
  return [
    await upload(api, video, 'video/mp4'),
    await upload(api, pictures[0], 'image/png'),
    await upload(api, pictures[1], 'image/png'),
  ];
}

async function balance(api) {
  const result = await api.request('/balance');
  if (!result.ok || !Number.isFinite(result.body.balance)) throw new Error(`Balance read failed (${result.status})`);
  return result.body;
}

async function ledger(api) {
  const result = await api.request('/ledger');
  if (!result.ok || !Array.isArray(result.body.entries)) throw new Error(`Ledger read failed (${result.status})`);
  return result.body.entries;
}

async function jobs(api) {
  const result = await api.request('/jobs?limit=50');
  if (!result.ok || !Array.isArray(result.body.jobs)) throw new Error(`Job list failed (${result.status})`);
  return result.body.jobs;
}

async function waitTerminal(api, jobId) {
  const started = Date.now();
  let latest;
  while (Date.now() - started < DEADLINE_MS) {
    const result = await api.request(`/jobs/${jobId}`);
    if (!result.ok) throw new Error(`Job read failed (${result.status})`);
    latest = result.body;
    if (['succeeded', 'failed'].includes(latest.state)) return latest;
    await sleep(POLL_MS);
  }
  throw new Error(`Job ${jobId} did not finish inside the probe deadline (${latest?.state || 'unknown'})`);
}

async function downloadAsset(api, jobId, destination) {
  const meta = await api.request(`/jobs/${jobId}/asset`);
  if (!meta.ok || typeof meta.body.url !== 'string') throw new Error(`Asset link failed (${meta.status})`);
  const response = await fetch(meta.body.url);
  if (!response.ok) throw new Error(`Asset download failed (${response.status})`);
  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(destination, bytes);
  return { mime_type: meta.body.mime_type, size_bytes: bytes.length, probe: await probeMedia(destination) };
}

async function submit(api, body) {
  return api.request('/generations', { method: 'POST', body: JSON.stringify(body) });
}

async function successfulScenario({ api, duration, keys, evidence }) {
  const before = await balance(api);
  const body = generationBody({ duration, keys, idempotencyKey: idempotency(`${duration}s`), prompt:
    '@Image1 is the red-and-white subject identity. @Image2 is the blue-and-yellow palette and lighting. Preserve the source video motion and camera exactly.' });
  const response = await submit(api, body);
  if (!response.ok || !UUID.test(response.body.job_id || '')) throw new Error(`${duration}s submit failed (${response.status}:${response.body.error || 'unknown'})`);
  const terminal = await waitTerminal(api, response.body.job_id);
  if (terminal.state !== 'succeeded') throw new Error(`${duration}s generation did not succeed (${terminal.error_code || terminal.state})`);
  const output = path.join(OUTPUT_DIR, `output-${duration}s.mp4`);
  const asset = await downloadAsset(api, response.body.job_id, output);
  const after = await balance(api);
  const record = { duration, jobId: response.body.job_id, before, balanceAfterSubmit: response.body.balance_after, after, terminal, asset };
  evidence.scenarios.push(record);
  return record;
}

async function shortScenario({ api, keys, evidence }) {
  const beforeBalance = await balance(api), beforeLedger = await ledger(api);
  const response = await submit(api, generationBody({ duration: 5, keys, idempotencyKey: idempotency('short'), prompt: 'Pre-debit validation probe with ordered synthetic references.' }));
  const afterBalance = await balance(api), afterLedger = await ledger(api);
  if (response.status !== 400 || response.body.error !== 'source_too_short') throw new Error(`Short-source probe returned ${response.status}:${response.body.error || 'unknown'}`);
  if (afterBalance.balance !== beforeBalance.balance || afterLedger[0]?.id !== beforeLedger[0]?.id) throw new Error('Short-source probe changed the ledger or balance');
  evidence.scenarios.push({ kind: 'source-too-short', response: { status: response.status, error: response.body.error }, before: beforeBalance, after: afterBalance, debitRecorded: false });
}

async function controlledFailureScenario({ api, keys, evidence }) {
  const beforeBalance = await balance(api), beforeJobs = await jobs(api);
  const response = await submit(api, generationBody({ duration: 5, keys, idempotencyKey: idempotency('20fps'), prompt:
    '@Image1 is the red-and-white subject identity. @Image2 is the blue-and-yellow palette. Preserve the 20 fps source motion.' }));
  let jobId = response.body.job_id;
  if (!UUID.test(jobId || '')) {
    await sleep(2_000);
    const old = new Set(beforeJobs.map(job => job.job_id));
    const created = (await jobs(api)).filter(job => !old.has(job.job_id) && job.model_id === MODEL_ID);
    if (created.length !== 1) throw new Error(`Controlled failure created ${created.length} discoverable jobs after ${response.status}:${response.body.error || 'unknown'}`);
    jobId = created[0].job_id;
  }
  const terminal = await waitTerminal(api, jobId);
  const afterBalance = await balance(api), entries = await ledger(api);
  const jobEntries = entries.filter(entry => entry.job_id === jobId);
  const record = { kind: 'controlled-20fps', submit: { status: response.status, error: response.body.error || null }, jobId,
    before: beforeBalance, after: afterBalance, terminal, ledger: jobEntries };
  if (terminal.state === 'failed') {
    if (!terminal.refunded || afterBalance.balance !== beforeBalance.balance || !jobEntries.some(entry => entry.kind === 'generation_refund')) {
      throw new Error('Controlled provider failure did not prove debit and refund');
    }
    record.refundProved = true;
  } else if (terminal.state === 'succeeded') {
    record.refundProved = false;
    record.providerAccepted20fps = true;
    record.asset = await downloadAsset(api, jobId, path.join(OUTPUT_DIR, 'output-controlled-20fps.mp4'));
  } else throw new Error(`Controlled failure ended in ${terminal.state}`);
  evidence.scenarios.push(record);
}

async function run() {
  const gate = assertProbeEnvironment();
  await mkdir(OUTPUT_DIR, { recursive: true });
  const evidence = { startedAt: now(), finishedAt: null, status: 'running', environment: 'staging', workerVersion: gate.workerVersion,
    modelId: MODEL_ID, approvedProviderUsd: 5, maximumProviderUsd: probeSpendCeiling(), authId: null, catalog: null, media: null, scenarios: [] };
  const scratch = await mkdtemp(path.join(tmpdir(), 'veyrnox-kling-o1-'));
  const save = async () => writeFile(path.join(OUTPUT_DIR, 'evidence.json'), JSON.stringify(evidence, null, 2));
  try {
    const catalogResponse = await fetch(`${STAGING_ORIGIN}/api/catalog`);
    const catalog = await catalogResponse.json();
    const model = (catalog.models || catalog.data || catalog).find?.(row => row.id === MODEL_ID);
    const image = model?.capabilities?.media?.image, video = model?.capabilities?.media?.video;
    if (!catalogResponse.ok || model?.credits !== 47 || JSON.stringify(model?.durations) !== '[5,10]' || image?.maxFiles !== 2 || video?.minSeconds !== 3 || video?.minSide !== 720) {
      throw new Error('Live staging Kling O1 contract does not match the approved probe');
    }
    evidence.catalog = { credits: model.credits, durations: model.durations, media: model.capabilities.media };
    const auth = await signIn(process.env); evidence.authId = auth.authId;
    const api = client(auth.token);
    const initial = await balance(api);
    if (initial.balance < CREDITS[5] + CREDITS[10] + CREDITS[5]) throw new Error(`Staging account has ${initial.balance} credits; 188 are required`);
    const media = await syntheticMedia(scratch); evidence.media = media.metadata;
    await save();
    await successfulScenario({ api, duration: 5, keys: await uploadScenario(api, media.files.qualifying, [media.files.image1, media.files.image2]), evidence }); await save();
    await successfulScenario({ api, duration: 10, keys: await uploadScenario(api, media.files.qualifying, [media.files.image1, media.files.image2]), evidence }); await save();
    await shortScenario({ api, keys: await uploadScenario(api, media.files.short, [media.files.image1, media.files.image2]), evidence }); await save();
    await controlledFailureScenario({ api, keys: await uploadScenario(api, media.files.controlled, [media.files.image1, media.files.image2]), evidence });
    evidence.status = 'complete'; evidence.finishedAt = now(); await save();
    console.log(JSON.stringify({ status: evidence.status, workerVersion: evidence.workerVersion, authId: evidence.authId,
      maximumProviderUsd: evidence.maximumProviderUsd, scenarios: evidence.scenarios.map(s => ({ kind: s.kind || `${s.duration}s`, jobId: s.jobId, state: s.terminal?.state, refunded: s.terminal?.refunded })) }));
  } catch (error) {
    evidence.status = 'failed'; evidence.finishedAt = now(); evidence.error = error.message; await save(); throw error;
  } finally { await rm(scratch, { recursive: true, force: true }); }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  run().catch(error => { console.error(error.message); process.exitCode = 1; });
}
