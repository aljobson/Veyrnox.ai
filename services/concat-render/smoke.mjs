// Spike smoke test: drives concat-cli serve over JSON-RPC lines and times a render.
// Usage (inside the container, server already running):
//   CONCAT_API_TOKEN=... node /app/smoke.mjs [width height]
// Needs ffmpeg on PATH to make a 5 s test clip.
import net from 'node:net'
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'

const token = process.env.CONCAT_API_TOKEN
if (!token) throw new Error('CONCAT_API_TOKEN is required')
const [width, height] = process.argv.slice(2).map(Number)
const dir = '/work/smoke'
mkdirSync(dir, { recursive: true })
const src = `${dir}/in.mp4`
execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=5',
  '-f', 'lavfi', '-i', 'sine=frequency=440:duration=5', '-shortest', '-pix_fmt', 'yuv420p', src], { stdio: 'ignore' })

const sock = net.connect(7420, '127.0.0.1')
let buf = ''
const waiters = new Map()
const events = []
sock.on('data', (chunk) => {
  buf += chunk
  let i
  while ((i = buf.indexOf('\n')) >= 0) {
    const msg = JSON.parse(buf.slice(0, i))
    buf = buf.slice(i + 1)
    if (msg.id !== undefined && waiters.has(msg.id)) waiters.get(msg.id)(msg)
    else events.push(msg)
  }
})
let nextId = 1
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const id = nextId++
  waiters.set(id, (m) => (m.error ? reject(new Error(`${method}: ${JSON.stringify(m.error)}`)) : resolve(m.result)))
  sock.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
})
const waitEvent = (name, ms) => new Promise((resolve, reject) => {
  const t0 = Date.now()
  const tick = () => {
    const e = events.find((x) => x.method === name || x.method === 'export.failed')
    if (e) return e.method === name ? resolve(e) : reject(new Error(JSON.stringify(e)))
    if (Date.now() - t0 > ms) return reject(new Error(`timeout waiting for ${name}`))
    setTimeout(tick, 200)
  }
  tick()
})

await call('auth', { token })
console.log('version', JSON.stringify(await call('version')))
await call('project.create', { location: dir, name: `p-${Date.now()}` }).then((r) => console.log('created', JSON.stringify(r).slice(0, 300)))
const created = (await call('project.list'))
const path = JSON.stringify(created).match(/"path":"([^"]+)"/)[1]
await call('media.import', { path, file: src })
const doc = await call('project.get', { path })
const mediaId = JSON.stringify(doc).match(/"id":"(m\d+)"/)[1]
await call('edit.apply', { path, command: { op: 'addClipAtFirstFree', mediaId, start: 0 } })

const out = `${dir}/out-${width || 'native'}.mp4`
const t0 = Date.now()
await call('export.run', { path, output: out, ...(width ? { width, height } : {}) })
const done = await waitEvent('export.done', 600_000)
const secs = (Date.now() - t0) / 1000
console.log(JSON.stringify({ ok: true, out, renderSeconds: secs, clipSeconds: 5, realtimeFactor: +(secs / 5).toFixed(2), done }))
sock.end()
