// Slice A runner (ADR-0105). Serves the page, drives desktop Chrome, decodes each fixture, runs the detector with a few settings and
// prints precision, recall, time per second of video and peak memory. Needs make-scene-fixtures.sh output and playwright-core outside the repo.
//
//   PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core  node scripts/editor-spike/scenes-run.mjs <media dir> <out json>
import http from 'node:http';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { createReadStream, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scoreCuts } from '../../app/veyrnox/_lib/editorSceneDetect.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const [mediaDir, outFile] = process.argv.slice(2);
if (!mediaDir || !outFile || !process.env.PLAYWRIGHT_CORE) { console.error('usage: PLAYWRIGHT_CORE=<dir> node scenes-run.mjs <media dir> <out json>'); process.exit(2); }
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_CORE);
const truth = JSON.parse(readFileSync(path.join(mediaDir, 'truth.json'), 'utf8'));
const MAX_SECONDS = 30; // starting bound from ADR-0090

const files = {
    '/scenes.html': [path.join(here, 'scenes.html'), 'text/html'],
    '/scenes.mjs': [path.join(here, 'scenes.mjs'), 'text/javascript'],
    '/mediabunny.mjs': [path.join(root, 'node_modules/mediabunny/dist/bundles/mediabunny.min.mjs'), 'text/javascript'],
    '/lib/editorSceneDetect.mjs': [path.join(root, 'app/veyrnox/_lib/editorSceneDetect.mjs'), 'text/javascript'],
};
const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    let [file, type] = files[url.pathname] || [];
    if (!file && url.pathname.startsWith('/media/')) { file = path.join(mediaDir, path.basename(url.pathname)); type = 'application/octet-stream'; }
    if (!file || !existsSync(file)) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': type });
    createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));

const profile = mkdtempSync(path.join(tmpdir(), 'scenes-'));
let peakRss = 0;
const timer = setInterval(() => {
    const rows = spawnSync('ps', ['-axo', 'rss=,command='], { encoding: 'utf8' }).stdout.split('\n').filter((l) => l.includes(profile));
    peakRss = Math.max(peakRss, rows.reduce((n, l) => n + (parseInt(l, 10) || 0), 0) / 1024);
}, 200);

const context = await chromium.launchPersistentContext(profile, { channel: 'chrome', headless: !process.env.HEADED });
const page = context.pages()[0] || await context.newPage();
page.on('pageerror', (e) => console.log('  [page error]', e.message));
await page.goto(`http://127.0.0.1:${server.address().port}/scenes.html`);
await page.waitForFunction(() => window.scenesReady === true, null, { timeout: 30000 });

const CONFIGS = {
    default: {},
    'hard-only': { gradual: false },
    'edge-heavy': { histWeight: 0.3 },
    'hist-heavy': { histWeight: 0.7 },
};
const [diagClip, diagFrom, diagTo] = (process.env.DIAG || "").split(",");
if (diagClip) { await page.evaluate(([n, m]) => window.analyse(n, m), [diagClip, 30]); console.log((await page.evaluate(([a, b]) => window.series(+a, +b), [diagFrom, diagTo])).join("\n")); process.exit(0); }
await new Promise((r) => setTimeout(r, 1500));
const baselineRss = Math.round(peakRss);
console.log(`browser resident memory before any clip: ${baselineRss} MB`);
const results = [];
for (const [name, info] of Object.entries(truth)) {
    const decoded = await page.evaluate(([n, m]) => window.analyse(n, m), [name, MAX_SECONDS]);
    const row = { ...decoded, baselineRssMB: baselineRss, peakRssMB: Math.round(peakRss), msPerVideoSecond: Math.round(decoded.wallMs / decoded.duration), runs: {} };
    for (const [label, options] of Object.entries(CONFIGS)) {
        for (const stride of [1, 3]) {
            const r = await page.evaluate(([o, s]) => window.detect(o, s), [options, stride]);
            const tolerance = info.weak && /crossfade/.test(info.weak) ? 0.5 : 0.25;
            row.runs[`${label}/every${stride}`] = {
                ...scoreCuts(r.cuts.map((c) => c.time), info.cuts, tolerance),
                found: r.cuts.map((c) => `${c.time.toFixed(2)}${c.kind === 'gradual' ? 'g' : ''}`),
                detectMs: Math.round(r.detectMs * 10) / 10,
            };
        }
    }
    results.push(row);
    console.log(`${name}: ${decoded.frames} frames ${decoded.width}x${decoded.height} ${decoded.codec}, ${row.msPerVideoSecond} ms per video second, rss peak ${row.peakRssMB} MB`);
    for (const [k, v] of Object.entries(row.runs)) console.log(`   ${k.padEnd(18)} P ${v.precision.toFixed(2)} R ${v.recall.toFixed(2)}  found [${v.found.join(' ')}]`);
}
clearInterval(timer);
writeFileSync(outFile, JSON.stringify(results, null, 2));
await context.close();
server.close();
