// Slice 0 runner (ADR-0080). Serves the spike page, drives real desktop Chrome through playwright-core, samples the browser's memory,
// then checks every rendered MP4 with ffprobe and ffmpeg (colours, text, audio tones, frame count, duration).
//
//   PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core  node scripts/editor-spike/run.mjs <media dir> <out dir> [s1 s2 s3 s4 s5]
//
// playwright-core is NOT a repo dependency: install it in a scratch folder and point PLAYWRIGHT_CORE at it. Needs ffmpeg and ffprobe.
import http from 'node:http';
import { createRequire } from 'node:module';
import { execFileSync, spawnSync } from 'node:child_process';
import { createReadStream, createWriteStream, mkdirSync, mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { S1, S2, S5, COMPAT } from './scenarios.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const [mediaDir, outDir, ...only] = process.argv.slice(2);
if (!mediaDir || !outDir || !process.env.PLAYWRIGHT_CORE) {
    console.error('usage: PLAYWRIGHT_CORE=<dir> node run.mjs <media dir> <out dir> [s1 s2 s3 s4 s5]');
    process.exit(2);
}
mkdirSync(outDir, { recursive: true });
const want = name => !only.length || only.includes(name);
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_CORE);

const files = {
    '/spike.html': [path.join(here, 'spike.html'), 'text/html'],
    '/spike.mjs': [path.join(here, 'spike.mjs'), 'text/javascript'],
    '/mediabunny.mjs': [path.join(root, 'node_modules/mediabunny/dist/bundles/mediabunny.min.mjs'), 'text/javascript'],
};
const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'POST' && url.pathname.startsWith('/out/')) {
        const name = path.basename(url.pathname);
        req.pipe(createWriteStream(path.join(outDir, name))).on('finish', () => res.end('ok'));
        return;
    }
    let file = files[url.pathname]?.[0], type = files[url.pathname]?.[1];
    if (!file && url.pathname.startsWith('/media/')) { file = path.join(mediaDir, path.basename(url.pathname)); type = 'application/octet-stream'; }
    if (!file || !existsSync(file)) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': type });
    createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

// Peak resident memory of everything Chrome started for this run, in MB.
const profile = mkdtempSync(path.join(tmpdir(), 'slice0-'));
let peakRss = 0;
const sample = () => {
    const rows = spawnSync('ps', ['-axo', 'rss=,command='], { encoding: 'utf8' }).stdout.split('\n').filter(l => l.includes(profile));
    peakRss = Math.max(peakRss, rows.reduce((n, l) => n + (parseInt(l, 10) || 0), 0) / 1024);
};
const timer = setInterval(sample, 250);

const context = await chromium.launchPersistentContext(profile, { channel: 'chrome', headless: process.env.HEADED ? false : true });
const page = context.pages()[0] || await context.newPage();
page.on('pageerror', e => console.log('  [page error]', e.message));
await page.exposeFunction('reportProgress', (name, done, total) => process.stdout.write(`\r  ${name}: ${done}/${total} frames   `));
await page.goto(`${base}/spike.html`);
await page.waitForFunction(() => window.spikeReady === true, null, { timeout: 30000 });
const env = await page.evaluate(() => ({ ua: navigator.userAgent, memoryApi: window.spike.hasMemoryApi, engine: window.spike.version }));
console.log('browser:', env.ua, '| mediabunny', env.engine);

// ---- checks on a rendered file ----
const probeFile = f => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-show_streams', '-show_format', '-of', 'json', f], { encoding: 'utf8' }));
const frameAt = (f, t, w = 64, h = 36, hot = 225) => {
    const buf = execFileSync('ffmpeg', ['-v', 'error', '-ss', String(t), '-i', f, '-frames:v', '1', '-vf', `scale=${w}:${h}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 24 });
    const px = (x, y) => [buf[(y * w + x) * 3], buf[(y * w + x) * 3 + 1], buf[(y * w + x) * 3 + 2]];
    let r = 0, g = 0, b = 0, white = 0, textBand = 0, wx = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const [pr, pg, pb] = px(x, y);
        r += pr; g += pg; b += pb;
        if (pr > hot && pg > hot && pb > hot) { white++; wx += x; if (y >= Math.floor(h * 0.7)) textBand++; }
    }
    const n = w * h;
    return { avg: [r, g, b].map(v => Math.round(v / n)), white, textBand, boxX: white ? Math.round(wx / white) : null, left: px(1, 18), mid: px(32, 18) };
};
const tones = (f, t, list) => {
    const fs = 8000, n = fs / 2;
    const pcm = execFileSync('ffmpeg', ['-v', 'error', '-ss', String(t), '-t', '0.5', '-i', f, '-vn', '-ac', '1', '-ar', String(fs), '-f', 's16le', '-'], { maxBuffer: 1 << 24 });
    const x = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.length / 2));
    const out = {};
    for (const hz of list) {
        let re = 0, im = 0;
        for (let i = 0; i < Math.min(n, x.length); i++) { const a = 2 * Math.PI * hz * i / fs; re += x[i] * Math.cos(a); im -= x[i] * Math.sin(a); }
        out[hz] = Math.round(Math.hypot(re, im) / n);
    }
    return out;
};
const TONES = [220, 330, 440, 660, 880];
const dominant = o => Object.entries(o).sort((a, b) => b[1] - a[1])[0];

function checkS1(f, summary) {
    const p = probeFile(f), v = p.streams.find(s => s.codec_type === 'video'), a = p.streams.find(s => s.codec_type === 'audio');
    const c = (label, ok, detail) => summary.push({ label, ok, detail });
    c('H.264 video', v?.codec_name === 'h264', `${v?.codec_name} ${v?.width}x${v?.height} ${v?.avg_frame_rate}`);
    c('AAC stereo audio', a?.codec_name === 'aac' && a.channels === 2, `${a?.codec_name} ${a?.channels}ch ${a?.sample_rate} Hz`);
    c('frame count 285', Number(v?.nb_read_frames) === 285, `${v?.nb_read_frames} frames`);
    c('duration 9.5 s (A/V within 0.1 s)', Math.abs(Number(p.format.duration) - 9.5) < 0.15 && Math.abs(Number(v.duration) - Number(a.duration)) < 0.1, `container ${p.format.duration}s, video ${v?.duration}s, audio ${a?.duration}s`);
    const f1 = frameAt(f, 1), f375 = frameAt(f, 3.75), f5 = frameAt(f, 5), f85 = frameAt(f, 8.5);
    const t5 = frameAt(f, 5, 320, 180, 190), t65 = frameAt(f, 6.5, 320, 180, 190);
    c('t=1.0 is clip A (blue)', f1.avg[2] > f1.avg[0] + 60, `avg rgb ${f1.avg}`);
    c('t=1.0 moving box where expected (~x 13 of 64)', f1.boxX !== null && Math.abs(f1.boxX - 13) <= 3, `box x ${f1.boxX}`);
    c('t=3.75 is a crossfade (blue + red)', f375.avg[0] > 70 && f375.avg[2] > 70, `avg rgb ${f375.avg}`);
    c('t=5.0 is clip B (red)', f5.avg[0] > f5.avg[2] + 60, `avg rgb ${f5.avg}`);
    c('text visible at 5.0, gone at 6.5', t5.textBand > t65.textBand + 40, `near-white px in text band ${t5.textBand} vs ${t65.textBand}`);
    c('t=8.5 portrait clip letterboxed (black sides, green middle)', f85.left.every(v => v < 25) && f85.mid[1] > 120 && f85.mid[0] < 90, `left ${f85.left} mid ${f85.mid}`);
    const a1 = tones(f, 1, TONES), a375 = tones(f, 3.6, TONES), a5 = tones(f, 5, TONES), a85 = tones(f, 8.5, TONES);
    c('t=1.0 clip tone 440 Hz + 220 Hz bed', dominant(a1)[0] === '440' && a1[220] > 50, JSON.stringify(a1));
    c('t=3.6 crossfade has both 440 and 880', a375[440] > 100 && a375[880] > 100, JSON.stringify(a375));
    c('t=5.0 clip tone 880 Hz', dominant(a5)[0] === '880', JSON.stringify(a5));
    c('t=8.5 clip tone 330 Hz', dominant(a85)[0] === '330', JSON.stringify(a85));
    return p;
}

function checkS2(f, summary) {
    const p = probeFile(f), v = p.streams.find(s => s.codec_type === 'video'), a = p.streams.find(s => s.codec_type === 'audio');
    const c = (label, ok, detail) => summary.push({ label, ok, detail });
    const frames = Math.round(55.5 * 30);
    c('1080p H.264', v?.codec_name === 'h264' && v.width === 1920 && v.height === 1080, `${v?.width}x${v?.height}`);
    c(`frame count ${frames}`, Number(v?.nb_read_frames) === frames, `${v?.nb_read_frames}`);
    c('duration 55.5 s (A/V within 0.15 s)', Math.abs(Number(p.format.duration) - 55.5) < 0.2 && Math.abs(Number(v.duration) - Number(a?.duration ?? v.duration)) < 0.15, `container ${p.format.duration}s, audio ${a?.duration}s`);
    const early = frameAt(f, 2), late = frameAt(f, 53);
    c('first clip blue at 2 s, last clip amber at 53 s', early.avg[2] > early.avg[0] + 50 && late.avg[0] > late.avg[2] + 50, `${early.avg} / ${late.avg}`);
    const ta = tones(f, 2, TONES), tb = tones(f, 52, TONES);
    c('tone 440 at 2 s and 660 at 52 s', dominant(ta)[0] === '440' && dominant(tb)[0] === '660', `${JSON.stringify(ta)} / ${JSON.stringify(tb)}`);
    return p;
}

// ---- run ----
const report = { env, results: [], compat: [], checks: {} };
const run = async (key, scenario, opts) => {
    if (!want(key)) return;
    console.log(`\n${key}: ${scenario.name}`);
    peakRss = 0;
    const r = await page.evaluate(([s, o]) => window.spike.render(s, o), [scenario, opts || {}]);
    sample();
    r.peakRssMB = Math.round(peakRss);
    console.log(`\n  ${r.ok ? 'ok' : 'FAILED'} stage=${r.stage} wall=${r.wallMs} ms${r.error ? ` error=${r.error}` : ''}`);
    report.results.push(r);
    if (r.ok && r.uploaded) {
        const summary = [];
        const file = path.join(outDir, `${scenario.name}.mp4`);
        try { (key === 's1' || key === 's6' || key === 's7' ? checkS1 : key === 's2' || key === 's8' ? checkS2 : probeFile)(file, summary); } catch (e) { summary.push({ label: 'checks ran', ok: false, detail: String(e.message).slice(0, 200) }); }
        report.checks[scenario.name] = summary;
        for (const s of summary) console.log(`  ${s.ok ? 'PASS' : 'FAIL'}  ${s.label}  (${s.detail})`);
    }
};

await run('s1', S1);
if (want('s7')) { await run('s7', { ...S1, name: 's7-software-encode', hw: 'prefer-software' }); }
if (want('s6')) { await run('s6', { ...S1, name: 's6-prewarmed' }, { prewarmFirst: true }); }
await run('s2', S2);
if (want('s8')) { await run('s8', { ...S2, name: 's8-1080p-software', hw: 'prefer-software' }); }
await run('s4', { ...S1, name: 's4-cancel' }, { cancelAfterMs: 800 });
await run('s5', S5);
if (want('s3')) {
    console.log('\ns3: compatibility');
    for (const f of COMPAT) {
        const r = await page.evaluate(name => window.spike.probe(name), f);
        report.compat.push(r);
        console.log(' ', JSON.stringify(r));
    }
}

clearInterval(timer);
await context.close();
server.close();
writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(report, null, 2));
console.log(`\nresults: ${path.join(outDir, 'results.json')}`);
