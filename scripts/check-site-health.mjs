#!/usr/bin/env node
// Public smoke test for the live site. deploy-production runs it after each
// deploy and rolls back on failure; site-health runs it every 15 minutes.
// Exit 0 healthy, 1 a check failed, 2 the site could not be reached at all.
import { fileURLToPath } from 'node:url';

export const DEFAULT_BASE_URL = 'https://veyrnox.ai';
const ATTEMPTS = 3;
const RETRY_DELAY_MS = 10_000;
const TIMEOUT_MS = 20_000;

// Anonymous requests only. /api/v1/health answers 401 without a session,
// which proves the middleware and the Worker are both up.
export const CHECKS = [
    { path: '/', status: 200, html: true, contains: 'Veyrnox' },
    { path: '/pricing', status: 200, html: true, contains: 'Veyrnox' },
    { path: '/robots.txt', status: 200, contains: 'Sitemap:' },
    { path: '/sitemap.xml', status: 200, contains: '<urlset' },
    { path: '/api/v1/health', status: 401, json: true },
];

export function assessResponse(check, { status, contentType = '', body = '' }) {
    const problems = [];
    if (status !== check.status) problems.push(`status ${status}, expected ${check.status}`);
    if (check.html && !contentType.includes('text/html')) problems.push(`content-type ${contentType || 'missing'}, expected text/html`);
    if (check.contains && !body.includes(check.contains)) problems.push(`body is missing ${JSON.stringify(check.contains)}`);
    if (check.json) {
        let parsed;
        try { parsed = JSON.parse(body); } catch { problems.push('body is not JSON'); }
        if (parsed && typeof parsed.error !== 'string') problems.push('JSON has no error code');
    }
    return problems.map(p => `${check.path}: ${p}`);
}

async function probe(baseUrl, check, cacheBust) {
    // A fresh query string keeps a cached prerender from hiding a broken build.
    const url = new URL(check.path, baseUrl);
    url.searchParams.set('smoke', cacheBust);
    const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) });
    return { status: response.status, contentType: response.headers.get('content-type') || '', body: await response.text() };
}

export async function checkSite(baseUrl, { attempts = ATTEMPTS, delayMs = RETRY_DELAY_MS, fetchOne = probe } = {}) {
    let last = { problems: [], unreachable: 0 };
    for (let attempt = 1; attempt <= attempts; attempt++) {
        const cacheBust = `${Date.now()}-${attempt}`;
        const problems = [];
        let unreachable = 0;
        for (const check of CHECKS) {
            try {
                problems.push(...assessResponse(check, await fetchOne(baseUrl, check, cacheBust)));
            } catch (error) {
                unreachable++;
                problems.push(`${check.path}: unreachable (${error.name})`);
            }
        }
        last = { problems, unreachable };
        if (problems.length === 0) return last;
        if (attempt < attempts) await new Promise(r => setTimeout(r, delayMs));
    }
    return last;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const baseUrl = process.env.SITE_HEALTH_BASE_URL || DEFAULT_BASE_URL;
    const { problems, unreachable } = await checkSite(baseUrl);
    if (problems.length === 0) {
        console.log(`${baseUrl}: all ${CHECKS.length} checks passed.`);
    } else {
        console.error(`${baseUrl}: ${problems.length} problem(s) after ${ATTEMPTS} attempts`);
        for (const p of problems) console.error(`- ${p}`);
    }
    process.exitCode = problems.length === 0 ? 0 : unreachable === CHECKS.length ? 2 : 1;
}
