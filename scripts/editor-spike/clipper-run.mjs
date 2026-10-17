// Slice C check (ADR-0105): runs the real clip finder in desktop Chrome on make-clip-fixtures.sh output, compares its loudness windows with an
// independent ffmpeg measurement, and checks the ranking against the known loud shots. Needs ffmpeg and playwright-core outside the repo.
//
//   PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core node scripts/editor-spike/clipper-run.mjs <media dir> <out json>
import http from 'node:http';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { createReadStream, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const [mediaDir, outFile] = process.argv.slice(2);
if (!mediaDir || !outFile || !process.env.PLAYWRIGHT_CORE) { console.error('usage: PLAYWRIGHT_CORE=<dir> node clipper-run.mjs <media dir> <out json>'); process.exit(2); }
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_CORE);
const truth = JSON.parse(readFileSync(path.join(mediaDir, 'truth.json'), 'utf8'));

const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    let file, type = 'text/javascript';
    if (url.pathname === '/clipper.html') { file = path.join(here, 'clipper.html'); type = 'text/html'; }
    else if (url.pathname === '/mediabunny.mjs') file = path.join(root, 'node_modules/mediabunny/dist/bundles/mediabunny.min.mjs');
    else if (/^\/lib\/[A-Za-z0-9]+\.mjs$/.test(url.pathname)) file = path.join(root, 'app/veyrnox/_lib', path.basename(url.pathname));
    else if (url.pathname.startsWith('/media/')) { file = path.join(mediaDir, path.basename(url.pathname)); type = 'application/octet-stream'; }
    if (!file || !existsSync(file)) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': type });
    createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const context = await chromium.launchPersistentContext(mkdtempSync(path.join(tmpdir(), 'clipper-')), { channel: 'chrome', headless: true });
const page = context.pages()[0] || await context.newPage();
page.on('pageerror', e => console.log('  [page error]', e.message));
await page.goto(`http://127.0.0.1:${server.address().port}/clipper.html`);
await page.waitForFunction(() => window.cf?.ready === true, null, { timeout: 30000 });

// Independent loudness: decode with ffmpeg to mono 48 kHz floats and take the RMS of each half second.
const ffmpegWindows = (file, windowSeconds = 0.5) => {
    const pcm = execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', '48000', '-f', 'f32le', '-'], { maxBuffer: 1 << 28 });
    const x = new Float32Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.length / 4)), size = 48000 * windowSeconds, out = [];
    for (let at = 0; at < x.length; at += size) { let s = 0; const end = Math.min(x.length, at + size); for (let i = at; i < end; i++) s += x[i] * x[i]; out.push(Math.sqrt(s / (end - at))); }
    return out;
};
const correlation = (a, b) => {
    const n = Math.min(a.length, b.length), ma = a.slice(0, n).reduce((s, v) => s + v, 0) / n, mb = b.slice(0, n).reduce((s, v) => s + v, 0) / n;
    let num = 0, da = 0, db = 0;
    for (let i = 0; i < n; i++) { num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
    return num / Math.sqrt(da * db);
};
let failed = 0;
const check = (label, ok, detail = '') => { if (!ok) failed++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`); };
const fmt = p => `${p.start.toFixed(1)}-${p.end.toFixed(1)}`;
const results = [];
for (const [name, info] of Object.entries(truth)) {
    console.log(`\n${name} (${info.note || ''})`);
    const r = await page.evaluate(n => window.cf.run(n).catch(e => ({ error: e.message })), name);
    if (r.error) { check('ran', false, r.error); continue; }
    const ref = ffmpegWindows(path.join(mediaDir, name));
    const mine = r.loud.values, c = correlation(mine, ref);
    const maxDiff = Math.max(...mine.map((v, i) => Math.abs(v - (ref[i] ?? 0))));
    check('browser loudness matches an independent ffmpeg measurement', c > 0.99 && maxDiff < 0.02, `correlation ${c.toFixed(4)}, largest difference ${maxDiff.toFixed(4)} over ${mine.length} windows`);
    check(`found the ${info.cuts.length} hard cuts`, r.cutCount === info.cuts.length, String(r.cutCount));
    const top = r.picks.slice(0, 2);
    const near = (p, [s, e]) => Math.abs(p.start - s) < 0.3 && Math.abs(p.end - e) < 0.3;
    check(`the two loud shots are the top two picks ${JSON.stringify(info.loudShots)}`, info.loudShots.every(l => top.some(p => near(p, l))), r.picks.map(fmt).join(', '));
    check('the loudest shot is first and says why', near(r.picks[0], info.loudShots[0]) && r.picks[0].reasons.includes('Loud, lively audio'), r.picks[0].reasons.join('; '));
    check('the top two picks are inserted as two new clips in one edit', r.insertedOk && r.insertedClips === 2, String(r.insertedClips));
    console.log(`  time: loudness ${r.loudMs} ms, whole search ${r.totalMs} ms for ${r.duration} s of video; ${r.picks.length} picks`);
    for (const p of r.picks) console.log(`    ${fmt(p)}  score ${p.score.toFixed(2)}  ${p.reasons.join('; ')}`);
    // Words on a quiet shot: a speech-heavy quiet shot should now outrank the half-loud one.
    const talk = await page.evaluate(n => window.cf.run(n, [{ text: 'a b c d e f g h i j k l m n o p q r s t u v w x y z', start: 0, len: 140 }, { text: 'one two three four five six seven eight nine ten eleven twelve thirteen', start: 140, len: 10 }]).catch(e => ({ error: e.message })), name);
    if (!talk.error) {
        console.log(`  with captions on the first shot: ${talk.picks.map(fmt).join(', ')}`);
        check('dense speech lifts the first (quiet) shot into the top picks, loud shots still lead or follow', talk.picks.slice(0, 3).some(p => p.start < 0.3 && p.end <= 5.3 && p.reasons.some(x => /speech/.test(x))), talk.picks.map(p => `${fmt(p)}:${p.reasons[0]}`).join(' | '));
    }
    results.push({ name, ...r, correlation: c, maxDiff, withCaptions: talk.picks });
}
writeFileSync(outFile, JSON.stringify(results, null, 2));
await context.close(); server.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
