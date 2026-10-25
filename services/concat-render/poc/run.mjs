import net from 'node:net'
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { render } from './translate.mjs'
const token = process.env.CONCAT_API_TOKEN
const dir = '/work/poc'; mkdirSync(dir, { recursive: true })
const mk = (n, src, dur) => execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', `${src}=size=1280x720:rate=30:duration=${dur}`,
  '-f', 'lavfi', '-i', 'sine=frequency=' + (n === 'a' ? 440 : 660) + ':duration=' + dur, '-shortest', '-pix_fmt', 'yuv420p', `${dir}/${n}.mp4`], { stdio: 'ignore' })
mk('a', 'testsrc2', 6); mk('b', 'smptebars', 6)
// Our schemaVersion 2 shape, from editorTimeline.mjs: frames at 30 fps.
const tl = { schemaVersion: 2, fps: 30, seq: 5, aspect: '16:9', text: [{ id: 't1', text: 'Hello Veyrnox', start: 30, len: 60, size: 9, x: 0.5, y: 0.8 }],
  media: { A: { id: 'A', kind: 'video', frames: 180, name: 'a', hasAudio: true }, B: { id: 'B', kind: 'video', frames: 180, name: 'b', hasAudio: true } },
  video: [{ id: 'v1', mediaId: 'A', in: 30, len: 90, volume: 1, transition: 0 }, { id: 'v2', mediaId: 'B', in: 0, len: 60, volume: 0.5, transition: 0 }], audio: [] }
const sock = net.connect(7420, '127.0.0.1'); let buf = ''; const w = new Map(); const ev = []
sock.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); (m.id !== undefined && w.has(m.id)) ? w.get(m.id)(m) : ev.push(m) } })
let n = 1
const call = (method, params = {}) => new Promise((res, rej) => { const id = n++; w.set(id, (m) => m.error ? rej(new Error(method + ': ' + JSON.stringify(m.error))) : res(m.result)); sock.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n') })
await call('auth', { token })
const name = 'poc-' + Date.now(), output = `${dir}/out.mp4`
const t0 = Date.now()
const r = await render(call, tl, { A: `${dir}/a.mp4`, B: `${dir}/b.mp4` }, { location: dir, name, output })
for (let i = 0; i < 600; i++) { if (ev.find((e) => e.method === 'export.done')) break; const f = ev.find((e) => e.method === 'export.failed'); if (f) throw new Error(JSON.stringify(f)); await new Promise((s) => setTimeout(s, 200)) }
console.log(JSON.stringify({ ...r, seconds: (Date.now() - t0) / 1000 }))
sock.end()
