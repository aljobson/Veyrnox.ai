#!/usr/bin/env node
/**
 * Preview probe for the audio templates (app/veyrnox/_lib/audioTemplates.js).
 * Question: does one template of each kind (music, sound effect, voice-over) produce
 * audio that sounds right, and what does fal return?
 *
 *   PLAN   (default, free)  Print what would run and the worst-case cost.
 *   SUBMIT (--submit, PAID) One job per kind through fal's queue, then download each
 *                           result into --out (default ./audio-previews).
 *
 * Worst case: ACE-Step 1.5 $0.036 + ElevenLabs SFX v2 $0.020 + Inworld TTS $0.020 = $0.076.
 *
 * Usage:
 *   node scripts/probe-audio-template-previews.mjs
 *   FAL_KEY=... node scripts/probe-audio-template-previews.mjs --submit
 *   FAL_KEY=... node scripts/probe-audio-template-previews.mjs --submit --ids=audio-ad-jingle,audio-whoosh-pack
 *
 * Reads FAL_KEY from the environment and never prints it. Check the billed amount on
 * fal's usage page afterwards.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AUDIO_TEMPLATES } from '../app/veyrnox/_lib/audioTemplates.js';

const FAL_QUEUE_BASE = 'https://queue.fal.run';
const POLL_MS = 3000;
const TIMEOUT_MS = 15 * 60 * 1000;

const ENDPOINTS = Object.freeze({
  'ace-step-1.5': { path: 'fal-ai/ace-step-1.5', body: (t) => ({ prompt: t.prompt, duration: 60, thinking: true, num_outputs: 1 }), cost: 0.036 },
  'elevenlabs-sfx-v2': { path: 'fal-ai/elevenlabs/sound-effects/v2', body: (t) => ({ text: t.prompt, duration_seconds: 10 }), cost: 0.02 },
  'inworld-tts': { path: 'fal-ai/inworld-tts', body: (t) => ({ text: t.prompt }), cost: 0.02 },
});

const args = process.argv.slice(2);
const flag = (n) => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const submit = args.includes('--submit');
const outDir = flag('out') || './audio-previews';
const wanted = flag('ids')?.split(',').filter(Boolean);
const resume = flag('resume'); // fal request id from an earlier timed-out run; use with --ids=<one id>

const picked = wanted
  ? AUDIO_TEMPLATES.filter((t) => wanted.includes(t.id) && ENDPOINTS[t.modelId])
  : ['ace-step-1.5', 'elevenlabs-sfx-v2', 'inworld-tts'].map((m) => AUDIO_TEMPLATES.find((t) => t.modelId === m));

const total = picked.reduce((s, t) => s + ENDPOINTS[t.modelId].cost, 0);
console.log(`${submit ? 'SUBMIT' : 'PLAN'} (PROD FAL key needed only with --submit): ${picked.length} job(s), worst case $${total.toFixed(3)}`);
for (const t of picked) console.log(`  ${t.id}  ${t.modelId}  ${ENDPOINTS[t.modelId].path}`);
if (!submit) process.exit(0);

const key = process.env.FAL_KEY;
if (!key) { console.error('FAL_KEY is not set.'); process.exit(1); }
const headers = { Authorization: `Key ${key}`, 'Content-Type': 'application/json' };

const findUrl = (v) => {
  if (!v || typeof v !== 'object') return null;
  if (typeof v.url === 'string') return v.url;
  for (const x of Object.values(v)) { const u = findUrl(x); if (u) return u; }
  return null;
};

await mkdir(outDir, { recursive: true });
for (const t of picked) {
  const ep = ENDPOINTS[t.modelId];
  let job;
  if (resume) {
    // Re-attach to an already-submitted request: no new job, no new charge.
    const base = `${FAL_QUEUE_BASE}/${ep.path}/requests/${encodeURIComponent(resume)}`;
    job = { request_id: resume, status: 'IN_PROGRESS', status_url: `${base}/status`, response_url: base };
  } else {
    const res = await fetch(`${FAL_QUEUE_BASE}/${ep.path}`, { method: 'POST', headers, body: JSON.stringify(ep.body(t)) });
    if (!res.ok) { console.error(`${t.id}: submit failed ${res.status}`); continue; }
    job = await res.json();
  }
  const deadline = Date.now() + TIMEOUT_MS;
  let status = job.status;
  while (status !== 'COMPLETED' && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    status = (await (await fetch(job.status_url, { headers })).json()).status;
  }
  if (status !== 'COMPLETED') { console.error(`${t.id}: timed out (${status}) request ${job.request_id}`); continue; }
  const result = await (await fetch(job.response_url, { headers })).json();
  const url = findUrl(result);
  console.log(`${t.id}: request ${job.request_id}, output keys ${Object.keys(result).join(',')}`);
  if (!url) { console.error(`${t.id}: no audio url in result`); continue; }
  const audio = await fetch(url);
  const ext = (new URL(url).pathname.match(/\.(\w+)$/) || [, 'bin'])[1];
  await writeFile(join(outDir, `${t.id}.${ext}`), Buffer.from(await audio.arrayBuffer()));
  console.log(`  saved ${join(outDir, `${t.id}.${ext}`)}`);
}
