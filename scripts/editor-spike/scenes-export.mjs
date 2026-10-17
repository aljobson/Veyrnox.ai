// Slice B export check (ADR-0105): runs the real detect, split and export modules in desktop Chrome, then decodes the MP4 with ffmpeg and
// compares it with the source. Needs the make-scene-fixtures.sh clips, ffmpeg, ffprobe, and playwright-core outside the repo.
//
//   PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core node scripts/editor-spike/scenes-export.mjs <media dir> <out dir> [clip.mp4 ...]
import http from 'node:http';
import { createRequire } from 'node:module';
import { execFileSync, spawnSync } from 'node:child_process';
import { createReadStream, createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const [mediaDir, outDir, ...clips] = process.argv.slice(2);
if (!mediaDir || !outDir || !process.env.PLAYWRIGHT_CORE) { console.error('usage: PLAYWRIGHT_CORE=<dir> node scenes-export.mjs <media dir> <out dir> [clip ...]'); process.exit(2); }
mkdirSync(outDir, { recursive: true });
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_CORE);
const truth = JSON.parse(readFileSync(path.join(mediaDir, 'truth.json'), 'utf8'));
const names = clips.length ? clips : ['hard-4s.mp4', 'hard-2s.mp4', 'flash.mp4', 'heldout-3s.mp4'];

const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'POST' && url.pathname.startsWith('/out/')) { req.pipe(createWriteStream(path.join(outDir, path.basename(url.pathname)))).on('finish', () => res.end('ok')); return; }
    let file, type = 'text/javascript';
    if (url.pathname === '/scenes-export.html') { file = path.join(here, 'scenes-export.html'); type = 'text/html'; }
    else if (url.pathname === '/mediabunny.mjs') file = path.join(root, 'node_modules/mediabunny/dist/bundles/mediabunny.min.mjs');
    else if (/^\/lib\/[A-Za-z0-9]+\.mjs$/.test(url.pathname)) file = path.join(root, 'app/veyrnox/_lib', path.basename(url.pathname));
    else if (url.pathname.startsWith('/media/')) { file = path.join(mediaDir, path.basename(url.pathname)); type = 'application/octet-stream'; }
    if (!file || !existsSync(file)) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': type });
    createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const context = await chromium.launchPersistentContext(mkdtempSync(path.join(tmpdir(), 'scenes-export-')), { channel: 'chrome', headless: true });
const page = context.pages()[0] || await context.newPage();
page.on('pageerror', e => console.log('  [page error]', e.message));
page.on('console', m => { if (m.type() === 'error') console.log('  [console]', m.text()); });
await page.goto(`http://127.0.0.1:${server.address().port}/scenes-export.html`);
await page.waitForFunction(() => window.sx?.ready === true, null, { timeout: 30000 });

const probe = f => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_streams', '-show_format', '-of', 'json', f], { encoding: 'utf8' }));
// Independent oracle: where does ffmpeg's own scene filter see a cut in the exported file?
const oracleCuts = f => (spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', f, '-vf', "select='gt(scene,0.3)',metadata=print:file=-", '-an', '-f', 'null', '-'], { encoding: 'utf8' }).stdout.match(/pts_time:[0-9.]+/g) || []).map(s => Number(s.slice(9)));
const psnr = (a, b) => {
    const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', a, '-i', b, '-lavfi', 'psnr', '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
    const m = r.match(/average:([0-9.inf]+)\s+min:([0-9.inf]+)/);
    return m ? { average: m[1], min: m[2] } : { average: '?', min: '?' };
};
let failed = 0;
const check = (label, ok, detail = '') => { if (!ok) failed++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`); };
for (const name of names) {
    console.log(`\n${name}`);
    const out = `export-${name}`;
    const r = await page.evaluate(([f, o]) => window.sx.run(f, o).catch(e => ({ error: e.message })), [name, out]);
    if (r.error) { check('ran', false, r.error); continue; }
    const want = truth[name].cuts, src = path.join(mediaDir, name), file = path.join(outDir, out);
    const sp = probe(src).streams[0], op = probe(file).streams[0];
    check(`detected cuts are the hand-marked ones ${JSON.stringify(want)}`, JSON.stringify(r.frames.map(f => f / 30)) === JSON.stringify(want), JSON.stringify(r.frames.map(f => f / 30)));
    check(`${want.length + 1} pieces, no gap or overlap`, r.pieces.length === want.length + 1 && r.pieces.every(([s, l], i) => i === 0 ? s === 0 : s === r.pieces[i - 1][0] + r.pieces[i - 1][1]), JSON.stringify(r.pieces));
    check('every piece reads the source in order (in = start)', r.pieces.every(([s, , i]) => s === i));
    check('export is an MP4', r.type === 'video/mp4' && r.bytes > 1000, `${r.bytes} bytes in ${r.exportMs} ms`);
    check(`frame count equals the source (${sp.nb_read_frames})`, op.nb_read_frames === sp.nb_read_frames, `${op.nb_read_frames}`);
    const ps = psnr(src, file);
    check('exported picture matches the source frame by frame (PSNR average over 30 dB, no frame under 20 dB)', Number(ps.average) > 30 && Number(ps.min) > 20, `average ${ps.average} dB, min ${ps.min} dB`);
    // ffmpeg's own scene filter is blunter than our detector (it misses weak cuts in the source too), so the fair check is that it sees the
    // same thing in the export as in the source: no cut created, none lost, none moved.
    const seenSource = oracleCuts(src), seenExport = oracleCuts(file);
    check('an independent ffmpeg scene check sees the same cuts in the export as in the source', JSON.stringify(seenSource) === JSON.stringify(seenExport), `source ${JSON.stringify(seenSource.map(s => Number(s.toFixed(2))))}, export ${JSON.stringify(seenExport.map(s => Number(s.toFixed(2))))}`);
}
await context.close(); server.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
