// Slice 1 export check (ADR-0080): drives the REAL editor modules (app/veyrnox/_lib/editor*.mjs) in desktop Chrome, then verifies the
// MP4 with ffprobe and ffmpeg. Same setup as run.mjs: PLAYWRIGHT_CORE=<dir> node scripts/editor-spike/slice1.mjs <media dir> <out dir>
import http from 'node:http';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { createReadStream, createWriteStream, mkdirSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const [mediaDir, outDir] = process.argv.slice(2);
if (!mediaDir || !outDir || !process.env.PLAYWRIGHT_CORE) { console.error('usage: PLAYWRIGHT_CORE=<dir> node slice1.mjs <media dir> <out dir>'); process.exit(2); }
mkdirSync(outDir, { recursive: true });
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_CORE);
const LIB = ['editorTimeline.mjs', 'editorMedia.mjs', 'editorExport.mjs', 'videoEnhance.mjs'];
const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'POST' && url.pathname.startsWith('/out/')) { req.pipe(createWriteStream(path.join(outDir, path.basename(url.pathname)))).on('finish', () => res.end('ok')); return; }
    let file, type = 'application/octet-stream';
    if (url.pathname === '/slice1.html') { file = path.join(here, 'slice1.html'); type = 'text/html'; }
    else if (url.pathname === '/mediabunny.mjs') { file = path.join(root, 'node_modules/mediabunny/dist/bundles/mediabunny.min.mjs'); type = 'text/javascript'; }
    else if (url.pathname.startsWith('/lib/') && LIB.includes(path.basename(url.pathname))) { file = path.join(root, 'app/veyrnox/_lib', path.basename(url.pathname)); type = 'text/javascript'; }
    else if (url.pathname.startsWith('/media/')) file = path.join(mediaDir, path.basename(url.pathname));
    if (!file || !existsSync(file)) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': type });
    createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const context = await chromium.launchPersistentContext(mkdtempSync(path.join(tmpdir(), 'slice1-')), { channel: 'chrome', headless: true });
const page = context.pages()[0] || await context.newPage();
page.on('pageerror', e => console.log('  [page error]', e.message));
await page.goto(`http://127.0.0.1:${server.address().port}/slice1.html`);
await page.waitForFunction(() => window.s1?.ready === true, null, { timeout: 30000 });

const results = [];
const check = (label, ok, detail = '') => { results.push({ label, ok }); console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`); };
const probe = f => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-show_streams', '-show_format', '-of', 'json', f], { encoding: 'utf8' }));
const frameAt = (f, t) => {
    const w = 64, h = 36;
    const u = execFileSync('ffmpeg', ['-v', 'error', '-ss', String(t), '-i', f, '-frames:v', '1', '-vf', `scale=${w}:${h}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 24 });
    let r = 0, g = 0, b = 0, n = 0, sx = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 3; r += u[i]; g += u[i + 1]; b += u[i + 2]; if (u[i] > 225 && u[i + 1] > 225 && u[i + 2] > 225) { n++; sx += x; } }
    const px = (x, y) => [u[(y * w + x) * 3], u[(y * w + x) * 3 + 1], u[(y * w + x) * 3 + 2]];
    return { avg: [r, g, b].map(v => Math.round(v / (w * h))), boxX: n ? sx / n : null, left: px(1, 18), mid: px(32, 18) };
};
const tones = (f, t) => {
    const fs = 8000, n = 4000;
    const pcm = execFileSync('ffmpeg', ['-v', 'error', '-ss', String(t), '-t', '0.5', '-i', f, '-vn', '-ac', '1', '-ar', String(fs), '-f', 's16le', '-'], { maxBuffer: 1 << 24 });
    const x = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.length / 2)), out = {};
    for (const hz of [220, 330, 440, 880]) { let re = 0, im = 0; for (let i = 0; i < Math.min(n, x.length); i++) { const a = 2 * Math.PI * hz * i / fs; re += x[i] * Math.cos(a); im -= x[i] * Math.sin(a); } out[hz] = Math.round(Math.hypot(re, im) / n); }
    return out;
};

console.log('\nmedia probes');
const media = await page.evaluate(async () => {
    const out = {};
    for (const [file, id] of [['a.mp4', 'l-1'], ['b.mp4', 'l-2'], ['c.mp4', 'l-3'], ['music.wav', 'l-4'], ['noaudio.mp4', 'l-5']]) out[id] = await window.s1.load(file, id);
    return out;
});
check('five fixtures load and pass the browser check', Object.values(media).every(m => !m.error), JSON.stringify(Object.values(media).map(m => m.error || `${m.kind} ${m.frames}f`)));
check('a silent video is recorded as having no audio', media['l-5'].hasAudio === false && media['l-1'].hasAudio === true);

console.log('\nedit and export');
// a: all 4 s; b: trimmed to source frames 30..120 (3 s) at half volume; c: portrait 2 s; music under everything at 30%.
const exported = await page.evaluate(async media => {
    const { TL, EX, blobs } = window.s1;
    let t = TL.emptyTimeline();
    const must = r => { if (r.error) throw new Error(r.error); return r; };
    for (const m of Object.values(media)) t = must(TL.addMedia(t, m));
    t = must(TL.addVideoClip(t, 'l-1'));
    t = must(TL.addVideoClip(t, 'l-2'));
    t = must(TL.addVideoClip(t, 'l-3'));
    t = must(TL.trimClip(t, 'video', 'v2', { in: 30, len: 90 }));
    t = must(TL.setVolume(t, 'video', 'v2', 0.5));
    t = must(TL.addAudioClip(t, 'l-4', { start: 0, len: 9 * 30 }));
    t = must(TL.setVolume(t, 'audio', 'a4', 0.3));
    const doc = JSON.parse(JSON.stringify(t));
    const problem = TL.validateTimeline(doc);
    const progress = [];
    const t0 = performance.now();
    const blob = await EX.exportTimeline(t, blobs, { onProgress: p => progress.push(p.stage) });
    const ms = Math.round(performance.now() - t0);
    const up = await fetch('/out/slice1-main.mp4', { method: 'POST', body: blob });
    return { problem, bytes: blob.size, type: blob.type, ms, total: TL.totalFrames(t), up: up.ok, stages: [...new Set(progress)] };
}, media);
check('the timeline validates', exported.problem === null, String(exported.problem));
check('export produced an MP4 blob', exported.type === 'video/mp4' && exported.bytes > 1000 && exported.up, `${exported.bytes} bytes in ${exported.ms} ms`);
check('progress reported audio, encode and done', ['audio', 'encode', 'done'].every(s => exported.stages.includes(s)), exported.stages.join(','));
const file = path.join(outDir, 'slice1-main.mp4');
const p = probe(file), v = p.streams.find(s => s.codec_type === 'video'), a = p.streams.find(s => s.codec_type === 'audio');
check('H.264 video and AAC stereo audio', v?.codec_name === 'h264' && a?.codec_name === 'aac' && a.channels === 2, `${v?.codec_name} ${v?.width}x${v?.height} / ${a?.codec_name} ${a?.channels}ch`);
check(`frame count = timeline length (${exported.total})`, Number(v?.nb_read_frames) === exported.total, `${v?.nb_read_frames}`);
check('A/V within 0.1 s of each other and of the timeline', Math.abs(Number(v.duration) - exported.total / 30) < 0.1 && Math.abs(Number(a.duration) - Number(v.duration)) < 0.12, `video ${v?.duration}, audio ${a?.duration}`);
const f1 = frameAt(file, 1), f5 = frameAt(file, 5), f85 = frameAt(file, 8.5), f4 = frameAt(file, 4.1);
check('t=1 is clip A (blue)', f1.avg[2] > f1.avg[0] + 60, `avg ${f1.avg}`);
check('t=5 is clip B (red)', f5.avg[0] > f5.avg[2] + 60, `avg ${f5.avg}`);
check('the trim starts clip B one second in (box near its 1 s position)', f4.boxX !== null && Math.abs(f4.boxX - 13) <= 3, `box x ${f4.boxX?.toFixed(1)} of 64`);
check('t=8.5 portrait clip is letterboxed (black sides, green middle)', f85.left.every(x => x < 25) && f85.mid[1] > 120, `left ${f85.left} mid ${f85.mid}`);
const t1 = tones(file, 1), t5 = tones(file, 5), t85 = tones(file, 8.5);
const top = o => Object.entries(o).sort((x, y) => y[1] - x[1])[0][0];
check('t=1 clip tone 440 over the music bed', top(t1) === '440' && t1[220] > 50, JSON.stringify(t1));
check('t=5 clip B tone 880 at half volume (about half of full), music still present', top(t5) === '880' && t5[880] > 800 && t5[880] < 1300 && t5[220] > 50, JSON.stringify(t5));
check('t=8.5 clip C tone 330', top(t85) === '330', JSON.stringify(t85));

console.log('\ncancel, blockers and edge cases');
const edge = await page.evaluate(async media => {
    const { TL, EX, blobs } = window.s1;
    const must = r => { if (r.error) throw new Error(r.error); return r; };
    let t = TL.emptyTimeline();
    for (const m of Object.values(media)) t = must(TL.addMedia(t, m));
    t = must(TL.addVideoClip(t, 'l-1'));
    t = must(TL.addVideoClip(t, 'l-2'));
    const out = {};
    // 1. cancel mid-export
    const controller = new AbortController();
    const started = performance.now();
    const run = EX.exportTimeline(t, blobs, { signal: controller.signal });
    setTimeout(() => controller.abort(), 250);
    try { await run; out.cancel = 'finished'; } catch (e) { out.cancel = e.name; out.cancelMs = Math.round(performance.now() - started); }
    // 2. already-aborted signal
    const pre = new AbortController(); pre.abort();
    try { await EX.exportTimeline(t, blobs, { signal: pre.signal }); out.pre = 'finished'; } catch (e) { out.pre = e.name; }
    // 3. an empty timeline
    try { await EX.exportTimeline(TL.emptyTimeline(), blobs); out.empty = 'finished'; } catch (e) { out.empty = e.message; }
    // 4. a file that was never loaded
    try { await EX.exportTimeline(t, new Map(), {}); out.missing = 'finished'; } catch (e) { out.missing = e.message; }
    // 5. audio only (no video clips): black picture, the sound plays
    let au = TL.emptyTimeline();
    au = must(TL.addMedia(au, media['l-4']));
    au = must(TL.addAudioClip(au, 'l-4', { start: 0, len: 60 }));
    const blob = await EX.exportTimeline(au, blobs, {});
    await fetch('/out/slice1-audio-only.mp4', { method: 'POST', body: blob });
    out.audioOnly = blob.size;
    // 6. a silent video clip mixed with a sound
    let mixed = TL.emptyTimeline();
    for (const id of ['l-5', 'l-4']) mixed = must(TL.addMedia(mixed, media[id]));
    mixed = must(TL.addVideoClip(mixed, 'l-5', { in: 0, len: 60 }));
    mixed = must(TL.addAudioClip(mixed, 'l-4', { start: 0, len: 60 }));
    out.silentVideo = (await EX.exportTimeline(mixed, blobs, {})).size;
    out.blocker = await EX.exportBlocker();
    out.size = [EX.outputSize(1280, 720, 720), EX.outputSize(720, 1280, 1080), EX.outputSize(3840, 2160, 1080), EX.outputSize(0, 0)];
    out.name = [EX.exportFileName('My clip!.mp4'), EX.exportFileName('../../etc/passwd'), EX.exportFileName('')];
    return out;
}, media);
check('cancel mid-export rejects with AbortError, quickly', edge.cancel === 'AbortError' && edge.cancelMs < 3000, `${edge.cancel} after ${edge.cancelMs} ms`);
check('an already-aborted signal refuses straight away', edge.pre === 'AbortError');
check('an empty timeline is refused with a plain message', /Add a clip/.test(edge.empty), edge.empty);
check('a file that is not loaded is refused with a plain message', /not loaded/.test(edge.missing), edge.missing);
check('audio-only and silent-video timelines export', edge.audioOnly > 1000 && edge.silentVideo > 1000, `${edge.audioOnly} / ${edge.silentVideo} bytes`);
check('desktop Chrome reports no export blocker', edge.blocker === null, String(edge.blocker));
check('output sizes are even and the long edge stays at or under 1920', edge.size.every(s => s.width % 2 === 0 && s.height % 2 === 0 && Math.max(s.width, s.height) <= 1920), JSON.stringify(edge.size));
check('download names are safe', edge.name.every(n => /^[\p{L}\p{N}_-]+\.mp4$/u.test(n)), edge.name.join(' | '));
const ao = probe(path.join(outDir, 'slice1-audio-only.mp4'));
check('audio-only export has 60 frames of picture and a 2 s sound', Number(ao.streams.find(s => s.codec_type === 'video')?.nb_read_frames) === 60 && Math.abs(Number(ao.format.duration) - 2) < 0.2, `${ao.format.duration}s`);

await context.close();
server.close();
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed${failed.length ? `; FAILED: ${failed.map(f => f.label).join(' | ')}` : ''}`);
process.exit(failed.length ? 1 : 0);
