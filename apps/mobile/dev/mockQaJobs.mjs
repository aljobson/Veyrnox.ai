// Development fixtures only. A small PCM WAV lets the native audio player exercise real audio.
import { createHash } from 'node:crypto';
export function audioFixture() {
    const rate = 8000, samples = rate;
    const wav = Buffer.alloc(44 + samples * 2);
    wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
    wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
    wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);
    for (let i = 0; i < samples; i++) wav.writeInt16LE(Math.round(2400 * Math.sin(2 * Math.PI * 440 * i / rate)), 44 + i * 2);
    return wav;
}
const audio = audioFixture();
export function qaAsset(job, origin) {
    const output = job.kind.split('-to-').at(-1);
    const isAudio = /audio|speech|music/.test(output);
    return { url: `${origin}/${isAudio ? 'audio.wav' : output.includes('video') ? 'clip.mp4' : 'asset.png'}`, mime_type: isAudio ? 'audio/wav' : output.includes('video') ? 'video/mp4' : 'image/png', expires_in: 900 };
}
export function mockQaJobs(req, res, url, jobs, jobState, catalog) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;
    if (url.pathname === '/audio.wav') {
        res.writeHead(200, { 'content-type': 'audio/wav', 'content-length': audio.length });
        res.end(req.method === 'HEAD' ? undefined : audio); return true;
    }
    const match = url.pathname.match(/^\/api\/v1\/jobs\/([^/]+)\/provenance$/);
    if (!match) return false;
    const job = jobs.find(j => j.id === match[1]);
    const ready = job && jobState(job) === 'succeeded';
    const asset = ready ? qaAsset(job, url.origin) : null;
    const isAudio = asset?.mime_type === 'audio/wav';
    const body = !job ? { error: 'not_found' } : !ready ? { generated: false } : {
        generated: true, model: { id: job.model_id, name: catalog.find(m => m.id === job.model_id)?.name ?? job.model_id },
        credits: job.credits, created_at: new Date(job.created).toISOString(),
        content: { mime_type: asset.mime_type, size_bytes: isAudio ? audio.length : null, sha256: isAudio ? createHash('sha256').update(audio).digest('hex') : null },
    };
    res.writeHead(job ? 200 : 404, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); return true;
}
