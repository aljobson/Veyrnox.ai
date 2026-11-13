// STAGING/capped probe of the published video templates.
//
// Nine templates, chosen from the offline fidelity audit: paid ones prove a template submits, debits, runs and
// (on failure) refunds; "blocked-needs-video" ones must be refused with no debit. Dry-run by default: it reads
// the public staging catalog and template list, prints the plan and the credit total, and spends nothing.
// `--run` signs in with E2E_EMAIL / E2E_PASSWORD (a staging test account) and submits.
//
//   STAGING/capped, from the repo root:
//     read "E2E_EMAIL?Staging test email: " && read -s "E2E_PASSWORD?Staging test password: " \
//       && export E2E_EMAIL E2E_PASSWORD && node scripts/probe-video-templates-staging.mjs --run; unset E2E_PASSWORD
//
// It imports the repo's template modules, so run it in place, not from a copy. Never run against production: the
// origin is a constant. The cap is in credits; the dollar figure is an estimate from the Kling O1 probe's rate.
import { mkdir, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { audit } from './audit-template-fidelity.mjs';
import { BROKEN_TEMPLATE_IDS } from '../app/veyrnox/_lib/brokenTemplateIds.js';

export const STAGING_ORIGIN = 'https://veyrnox-ai-staging.al-jobson.workers.dev';
export const STAGING_SUPABASE = 'https://yrqzwqywxfesmbvhzjgj.supabase.co';
const STAGING_ANON_KEY = 'sb_publishable_bAxQiodzBhI6bV7lmo9gMQ_Hlg9_Ish';
export const DEFAULT_MAX_CREDITS = 280;
export const USD_PER_CREDIT_ESTIMATE = 0.84 / 47; // Kling O1 probe: 47 credits = $0.84 provider cost
const POLL_MS = 15_000, DEADLINE_MS = 20 * 60_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KLING = 'kling-3.0-i2v', FAST = 'seedance-2.0-fast', REFERENCE = 'seedance-2.0-reference';

/** The nine probes: [label, predicate over an audit contract]. First match by id order, never reused. */
const PICKS = [
  ['kling safe (photo)', c => c.class === 'like-for-like-safe' && c.modelId === KLING && c.duration === 10],
  ['kling blocked A', c => c.class === 'blocked-needs-video' && c.modelId === KLING],
  ['kling blocked B', c => c.class === 'blocked-needs-video' && c.modelId === KLING],
  ['fast safe A (text)', c => c.class === 'like-for-like-safe' && c.modelId === FAST && c.requiredReferences.imageMin === 0],
  ['fast safe B (text)', c => c.class === 'like-for-like-safe' && c.modelId === FAST && c.requiredReferences.imageMin === 0],
  ['fast blocked', c => c.class === 'blocked-needs-video' && c.modelId === FAST && c.requiredReferences.imageMin >= 1],
  ['reference bound, 1 photo, 5s', c => c.class === 'bound' && c.modelId === REFERENCE && c.slotCount === 1 && c.duration === 5],
  ['reference bound, 2 photos, 5s', c => c.class === 'bound' && c.modelId === REFERENCE && c.slotCount === 2 && c.duration === 5],
  ['reference blocked', c => c.class === 'blocked-needs-video' && c.modelId === REFERENCE],
];

export function selectProbeSet(contracts) {
  const rows = Object.values(contracts).sort((a, b) => a.id.localeCompare(b.id));
  const used = new Set();
  return PICKS.map(([label, test]) => {
    const hit = rows.find(c => !used.has(c.id) && !BROKEN_TEMPLATE_IDS.includes(c.id) && test(c));
    if (!hit) throw new Error(`No template matches probe slot "${label}"`);
    used.add(hit.id);
    return { label, contract: hit };
  });
}

/** Credits a request is quoted at: the model's 5-second price per started five seconds (clipCredits). */
export const quoteCredits = (unitCredits, seconds) => unitCredits * Math.ceil((Number(seconds) || 5) / 5);
export const paid = pick => pick.contract.class !== 'blocked-needs-video';
export const photoCount = c => (c.class === 'bound' ? c.slotCount : Math.max(c.requiredReferences.imageMin, c.class === 'blocked-needs-video' ? 1 : 0));

export function projectedCredits(picks, unitByModel) {
  return picks.filter(paid).reduce((sum, p) => sum + quoteCredits(unitByModel[p.contract.modelId], p.contract.duration), 0);
}

export function generationBody(pick, keys, unitByModel, idempotencyKey) {
  const c = pick.contract;
  const inputs = { prompt: c.photoPrompt, duration_seconds: c.duration, ...(c.aspect ? { aspect_ratio: c.aspect } : {}), ...(c.negativePrompt ? { negative_prompt: c.negativePrompt } : {}) };
  return {
    model_id: c.modelId, template_id: c.id, idempotency_key: idempotencyKey,
    confirmed_credits: quoteCredits(unitByModel[c.modelId], c.duration), inputs,
    ...(keys.length ? { references: keys.map(key => ({ slot: 'image', origin: 'upload', key })), consent: true } : {}),
  };
}

// A plain 512x512 PNG made in memory (no ffmpeg): above the 256 px photo minimum, with a gradient so it is not blank.
export function syntheticPng(size = 512) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = buf => { let c = 0xffffffff; for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]), out = Buffer.alloc(8 + data.length + 4);
    out.writeUInt32BE(data.length, 0); body.copy(out, 4); out.writeUInt32BE(crc(body), 8 + data.length); return out;
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 2;
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) { const o = y * (size * 3 + 1) + 1 + x * 3; raw[o] = (x * 255 / size) | 0; raw[o + 1] = (y * 255 / size) | 0; raw[o + 2] = 140; }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function json(response) { const text = await response.text(); try { return { status: response.status, ok: response.ok, body: text ? JSON.parse(text) : {} }; } catch { return { status: response.status, ok: response.ok, body: { invalid_json: true } }; } }
const publicGet = route => fetch(`${STAGING_ORIGIN}${route}`).then(json);

async function signIn() {
  const { E2E_EMAIL, E2E_PASSWORD } = process.env;
  if (!E2E_EMAIL || !E2E_PASSWORD) throw new Error('Set E2E_EMAIL and E2E_PASSWORD (a staging test account) before --run');
  const r = await json(await fetch(`${STAGING_SUPABASE}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: STAGING_ANON_KEY, 'content-type': 'application/json' }, body: JSON.stringify({ email: E2E_EMAIL, password: E2E_PASSWORD }) }));
  if (!r.ok || !r.body.access_token) throw new Error(`Staging sign-in failed (${r.status})`);
  return r.body.access_token;
}

function client(token) {
  return async (route, init = {}) => json(await fetch(`${STAGING_ORIGIN}/api/v1${route}`, { ...init, headers: { authorization: `Bearer ${token}`, ...(init.body ? { 'content-type': 'application/json' } : {}) } }));
}

async function uploadPhoto(api, bytes) {
  const grant = await api('/uploads', { method: 'POST', body: JSON.stringify({ content_type: 'image/png', size_bytes: bytes.length }) });
  if (!grant.ok || !grant.body.upload_url || !grant.body.key) throw new Error(`Upload reservation failed (${grant.status}:${grant.body.error || 'unknown'})`);
  const put = await fetch(grant.body.upload_url, { method: 'PUT', headers: new Headers(grant.body.headers || { 'content-type': 'image/png' }), body: bytes });
  if (!put.ok) throw new Error(`Photo upload failed (${put.status})`);
  return grant.body.key;
}

async function waitTerminal(api, jobId) {
  const started = Date.now(); let latest = {};
  while (Date.now() - started < DEADLINE_MS) {
    const r = await api(`/jobs/${jobId}`);
    if (!r.ok) throw new Error(`Job read failed (${r.status})`);
    latest = r.body; if (['succeeded', 'failed'].includes(latest.state)) return latest;
    await sleep(POLL_MS);
  }
  return { ...latest, state: latest.state || 'unknown', timedOut: true };
}

export const unitCreditsFrom = catalog => Object.fromEntries([KLING, FAST, REFERENCE].map(id => {
  const row = (catalog.models || catalog).find?.(m => m.id === id);
  if (!row || !Number.isInteger(row.credits)) throw new Error(`Staging catalog has no usable price for ${id}`);
  return [id, row.credits];
}));

export function renderTable(results) {
  const head = '| slot | template | model | class | quoted cr | submit | job | state | charged | refunded | note |\n|---|---|---|---|---|---|---|---|---|---|---|';
  return [head, ...results.map(r => `| ${r.label} | ${r.id} | ${r.modelId} | ${r.class} | ${r.quoted} | ${r.submit ?? '(dry run)'} | ${r.jobId ?? ''} | ${r.state ?? ''} | ${r.charged ?? ''} | ${r.refunded ?? ''} | ${r.note ?? ''} |`)].join('\n');
}

async function main(argv) {
  const run = argv.includes('--run');
  const cap = Number(argv[argv.indexOf('--max-credits') + 1]) || DEFAULT_MAX_CREDITS;
  const outDir = path.resolve('.gstack/staging-template-probe');
  const picks = selectProbeSet(audit().contracts);
  const catalog = await publicGet('/api/catalog'); if (!catalog.ok) throw new Error(`Staging catalog read failed (${catalog.status})`);
  const unit = unitCreditsFrom(catalog.body);
  const projected = projectedCredits(picks, unit);
  const listing = await publicGet('/api/templates');
  const stagingIds = new Set((listing.body.templates || []).map(t => t.id));
  const stillPublic = BROKEN_TEMPLATE_IDS.filter(id => stagingIds.has(id));
  const missing = picks.filter(p => !stagingIds.has(p.contract.id)).map(p => p.contract.id);
  console.log(`STAGING ${run ? 'RUN' : 'DRY RUN'} | cap ${cap} credits | projected ${projected} credits (~$${(projected * USD_PER_CREDIT_ESTIMATE).toFixed(2)} provider, estimate)`);
  console.log(`staging lists ${stagingIds.size} templates (main: 749); ${stillPublic.length} withdrawn templates are still public there: staging has not been deployed from main.`);
  if (missing.length) throw new Error(`Probe templates missing from staging: ${missing.join(', ')}`);
  if (projected > cap) throw new Error(`Projected ${projected} credits is above the ${cap}-credit cap`);
  const results = picks.map(p => ({ label: p.label, id: p.contract.id, modelId: p.contract.modelId, class: p.contract.class, photos: photoCount(p.contract), quoted: paid(p) ? quoteCredits(unit[p.contract.modelId], p.contract.duration) : 0 }));
  if (!run) { console.log(renderTable(results)); console.log('\nNothing was sent. Add --run (with E2E_EMAIL and E2E_PASSWORD set) to spend.'); return; }

  const api = client(await signIn());
  const startBalance = (await api('/balance')).body.balance;
  if (!(startBalance >= projected)) throw new Error(`Staging account has ${startBalance} credits; ${projected} are needed`);
  const png = syntheticPng(); let spent = 0;
  await mkdir(outDir, { recursive: true });
  for (const [index, pick] of picks.entries()) {
    const row = results[index], c = pick.contract;
    if (paid(pick) && spent + row.quoted > cap) { row.submit = 'skipped'; row.note = 'cap would be exceeded'; continue; }
    try {
      const keys = []; for (let n = 0; n < row.photos; n += 1) keys.push(await uploadPhoto(api, png));
      const before = (await api('/balance')).body.balance;
      const submit = await api('/generations', { method: 'POST', body: JSON.stringify(generationBody(pick, keys, unit, `tpl-probe-${c.id.slice(0, 40)}-${crypto.randomUUID()}`)) });
      row.submit = `${submit.status}${submit.body.error ? ':' + submit.body.error : ''}`;
      if (!paid(pick)) { const after = (await api('/balance')).body.balance; row.charged = before - after; row.note = submit.status === 400 && submit.body.error === 'template_blocked' && row.charged === 0 ? 'refused before charge (as designed)' : 'UNEXPECTED: expected 400 template_blocked and no charge'; continue; }
      if (!UUID.test(submit.body.job_id || '')) { row.note = 'no job created'; continue; }
      row.jobId = submit.body.job_id; spent += row.quoted;
      const terminal = await waitTerminal(api, row.jobId); row.state = terminal.state; row.refunded = Boolean(terminal.refunded);
      row.charged = before - (await api('/balance')).body.balance; row.note = terminal.timedOut ? 'did not finish in 20 min' : (terminal.error_code || '');
    } catch (error) { row.note = `error: ${error.message}`; }
    await writeFile(path.join(outDir, 'results.json'), JSON.stringify({ startBalance, spent, results }, null, 2));
  }
  const table = renderTable(results);
  await writeFile(path.join(outDir, 'results.json'), JSON.stringify({ startBalance, spent, results }, null, 2));
  await writeFile(path.join(outDir, 'results.md'), `# Staging video template probe\n\nSpent ${spent} credits (cap ${cap}).\n\n${table}\n`);
  console.log(table); console.log(`\nSpent ${spent} credits. Written to ${outDir}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(path.resolve(process.argv[1]))) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
