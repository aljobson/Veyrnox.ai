import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PRODUCTION_ORIGIN = 'https://veyrnox.ai';
const SHA = /^[a-f0-9]{40}$/;
const MAX_HTML_BYTES = 1024 * 1024;

export function assertProductionTarget({ eventName, ref, workflowSha, expectedSha }) {
  if (eventName !== 'workflow_dispatch' || ref !== 'refs/heads/main') {
    throw new Error('Production QA requires a manual main dispatch');
  }
  if (!SHA.test(expectedSha || '') || expectedSha !== workflowSha) {
    throw new Error('Production QA requires the exact expected dispatch SHA');
  }
}

async function readBoundedHTML(response, within) {
  if (!/^text\/html(?:\s*;|$)/i.test(response.headers?.get('content-type') || '')) {
    throw new Error('Production release response must be HTML');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Production release body read failed');
  const decoder = new TextDecoder();
  let bytes = 0;
  let html = '';
  try {
    while (true) {
      let chunk;
      try { chunk = await within(reader.read()); } catch { throw new Error('Production release body read failed'); }
      if (chunk.done) return html + decoder.decode();
      bytes += chunk.value.byteLength;
      if (bytes > MAX_HTML_BYTES) throw new Error('Production release HTML exceeds byte ceiling');
      html += decoder.decode(chunk.value, { stream: true });
    }
  } finally { reader.cancel().catch(() => {}); reader.releaseLock(); }
}

function deploymentMarkers(html) {
  const releases = [];
  for (const [, attribute] of html.matchAll(/<(?:script|link)\b[^>]*?\s(?:src|href)\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
    let asset;
    try { asset = new URL(attribute.replaceAll('&amp;', '&'), PRODUCTION_ORIGIN); } catch { continue; }
    if (asset.origin !== PRODUCTION_ORIGIN || !asset.pathname.startsWith('/_next/static/')) continue;
    for (const value of asset.searchParams.getAll('dpl')) {
      if (!SHA.test(value)) throw new Error('Production release has malformed deployment markers');
      releases.push(value);
    }
  }
  return [...new Set(releases)];
}

export async function verifyProductionRelease(target, fetchImpl = globalThis.fetch, { timeoutMs = 30_000 } = {}) {
  assertProductionTarget(target);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) throw new Error('Invalid production release deadline');
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('Production release deadline exceeded')); }, timeoutMs); });
  const within = promise => Promise.race([promise, deadline]);
  try {
    let response;
    try {
      response = await within(fetchImpl(`${PRODUCTION_ORIGIN}/app?qa_release=${Date.now()}`, {
        cache: 'no-store', redirect: 'error', signal: controller.signal,
      }));
    } catch { throw new Error('Production release request failed'); }
    let destination;
    try { destination = new URL(response.url); } catch { throw new Error('Unexpected production release destination'); }
    if (response.status !== 200 || response.redirected || destination.origin !== PRODUCTION_ORIGIN || destination.pathname !== '/app') {
      throw new Error('Unexpected production release response');
    }
    const releases = deploymentMarkers(await readBoundedHTML(response, within));
    if (releases.length !== 1 || releases[0] !== target.expectedSha) {
      throw new Error('Production release does not match the expected dispatch SHA');
    }
    return { observedAt: new Date().toISOString(), status: response.status, pathname: '/app',
      expectedSha: target.expectedSha, workflowSha: target.workflowSha, releases };
  } finally { clearTimeout(timer); controller.abort(); }
}

async function saveEvidence(phase, evidence) {
  await mkdir('page-qa-release', { recursive: true });
  await writeFile(`page-qa-release/${phase}.json`, JSON.stringify(evidence, null, 2));
}

export async function runProductionReleaseCheck(phase, options = {}) {
  if (!['before', 'after'].includes(phase)) throw new Error('Production release phase must be before or after');
  const { env = process.env, fetchImpl = globalThis.fetch, saveEvidence: save = saveEvidence } = options;
  const target = { eventName: env.GITHUB_EVENT_NAME, ref: env.GITHUB_REF,
    workflowSha: env.GITHUB_SHA, expectedSha: env.QA_EXPECTED_SHA };
  let evidence;
  try { evidence = await verifyProductionRelease(target, fetchImpl); }
  catch (error) {
    await save(phase, { phase, observedAt: new Date().toISOString(), error: error.message });
    throw error;
  }
  await save(phase, { ...evidence, phase });
  return evidence;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runProductionReleaseCheck(process.argv[2]).then(proof => console.log(JSON.stringify(proof))).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
