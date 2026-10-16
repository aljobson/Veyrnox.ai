#!/usr/bin/env node
// Public smoke test for the live site. deploy-production runs it after each
// deploy and rolls back on failure; site-health runs it every 15 minutes.
// Exit 0 healthy, 1 a check failed, 2 the site could not be reached at all.
import { fileURLToPath } from 'node:url';
import { readFile, writeFile } from 'node:fs/promises';

export const DEFAULT_BASE_URL = 'https://veyrnox.ai';
const ATTEMPTS = 3;
const RETRY_DELAY_MS = 10_000;
const TIMEOUT_MS = 20_000;

// Anonymous requests only. /api/v1/health answers 401 without a session,
// which proves the middleware and the Worker are both up.
export const CHECKS = [
    { path: '/', status: 200, html: true, contains: 'Veyrnox' },
    { path: '/pricing', status: 200, html: true, contains: 'Veyrnox' },
    { path: '/tools', status: 200, html: true, contains: 'Bring your own file' },
    { path: '/robots.txt', status: 200, contains: 'Sitemap:' },
    { path: '/sitemap.xml', status: 200, contains: '<urlset' },
    { path: '/api/v1/health', status: 401, json: true },
];

const STATIC_ASSET_ATTRIBUTE = /\b(?:src|href)\s*=\s*["'](\/_next\/static\/[^"'<>\\\s]+)["']/gi;

export function extractStaticAssetPaths(html) {
    return [...new Set(
        [...html.matchAll(STATIC_ASSET_ATTRIBUTE)]
            .map((match) => match[1].replaceAll('&amp;', '&')),
    )];
}

function validateStaticAssetPaths(paths) {
    if (!Array.isArray(paths)) throw new Error('Static asset manifest must contain an assets array.');
    return [...new Set(paths.map((path) => {
        if (typeof path !== 'string' || /[\s\\#]/.test(path)) {
            throw new Error(`Invalid static asset path: ${JSON.stringify(path)}`);
        }
        const parsed = new URL(path, 'https://manifest.invalid');
        if (parsed.origin !== 'https://manifest.invalid' || !parsed.pathname.startsWith('/_next/static/')) {
            throw new Error(`Invalid static asset path: ${JSON.stringify(path)}`);
        }
        return path;
    }))];
}

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

export function assessAssetResponse(path, { status, contentType = '', cacheControl = '' }) {
    const problems = [];
    if (status !== 200) problems.push(`status ${status}, expected 200`);
    if (contentType.includes('text/html')) problems.push('returned HTML instead of a static asset');
    if (!/\bmax-age=31536000\b/i.test(cacheControl) || !/\bimmutable\b/i.test(cacheControl)) {
        problems.push(`cache-control ${cacheControl || 'missing'}, expected immutable one-year cache`);
    }
    return problems.map((problem) => `${path}: ${problem}`);
}

async function probe(baseUrl, check, cacheBust) {
    // A fresh query string keeps a cached prerender from hiding a broken build.
    const url = new URL(check.path, baseUrl);
    url.searchParams.set('smoke', cacheBust);
    const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) });
    return { status: response.status, contentType: response.headers.get('content-type') || '', body: await response.text() };
}

async function probeAsset(baseUrl, path) {
    const response = await fetch(new URL(path, baseUrl), {
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const result = {
        status: response.status,
        contentType: response.headers.get('content-type') || '',
        cacheControl: response.headers.get('cache-control') || '',
    };
    await response.body?.cancel();
    return result;
}

export async function checkSite(baseUrl, {
    attempts = ATTEMPTS,
    delayMs = RETRY_DELAY_MS,
    fetchOne = probe,
    fetchAsset = probeAsset,
    requiredAssets = [],
    verifyAssets = true,
} = {}) {
    const priorAssets = validateStaticAssetPaths(requiredAssets);
    let last = { problems: [], unreachable: 0, requests: CHECKS.length, assets: priorAssets };
    for (let attempt = 1; attempt <= attempts; attempt++) {
        const cacheBust = `${Date.now()}-${attempt}`;
        const problems = [];
        let unreachable = 0;
        let discoveredAssets = [];
        for (const check of CHECKS) {
            try {
                const response = await fetchOne(baseUrl, check, cacheBust);
                problems.push(...assessResponse(check, response));
                if (check.html) discoveredAssets = [...discoveredAssets, ...extractStaticAssetPaths(response.body || '')];
            } catch (error) {
                unreachable++;
                problems.push(`${check.path}: unreachable (${error.name})`);
            }
        }
        const assets = [...new Set([...priorAssets, ...discoveredAssets])];
        if (verifyAssets) {
            for (const path of assets) {
                try {
                    problems.push(...assessAssetResponse(path, await fetchAsset(baseUrl, path)));
                } catch (error) {
                    unreachable++;
                    problems.push(`${path}: unreachable (${error.name})`);
                }
            }
        }
        const requests = CHECKS.length + (verifyAssets ? assets.length : 0);
        last = { problems, unreachable, requests, assets };
        if (problems.length === 0) return last;
        if (attempt < attempts) await new Promise(r => setTimeout(r, delayMs));
    }
    return last;
}

function optionValue(arguments_, name) {
    const index = arguments_.indexOf(name);
    if (index === -1) return undefined;
    if (!arguments_[index + 1] || arguments_[index + 1].startsWith('--')) {
        throw new Error(`${name} requires a file path.`);
    }
    return arguments_[index + 1];
}

async function readAssetManifest(path) {
    const manifest = JSON.parse(await readFile(path, 'utf8'));
    return validateStaticAssetPaths(manifest.assets);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const baseUrl = process.env.SITE_HEALTH_BASE_URL || DEFAULT_BASE_URL;
    try {
        const arguments_ = process.argv.slice(2);
        const capturePath = optionValue(arguments_, '--capture-assets');
        const manifestPath = optionValue(arguments_, '--asset-manifest');
        if (capturePath && manifestPath) throw new Error('Capture and manifest modes cannot be combined.');
        const requiredAssets = manifestPath ? await readAssetManifest(manifestPath) : [];
        const result = await checkSite(baseUrl, { requiredAssets, verifyAssets: !capturePath });
        if (result.problems.length === 0) {
            if (capturePath) {
                await writeFile(capturePath, `${JSON.stringify({ version: 1, assets: result.assets }, null, 2)}\n`);
                console.log(`${baseUrl}: captured ${result.assets.length} referenced static asset(s).`);
            } else {
                console.log(`${baseUrl}: all ${CHECKS.length} page checks and ${result.assets.length} asset checks passed.`);
            }
        } else {
            console.error(`${baseUrl}: ${result.problems.length} problem(s) after ${ATTEMPTS} attempts`);
            for (const problem of result.problems) console.error(`- ${problem}`);
        }
        process.exitCode = result.problems.length === 0 ? 0 : result.unreachable === result.requests ? 2 : 1;
    } catch (error) {
        console.error(`${baseUrl}: ${error.message}`);
        process.exitCode = 1;
    }
}
