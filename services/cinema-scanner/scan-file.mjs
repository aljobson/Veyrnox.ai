import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { open, stat, unlink } from 'node:fs/promises';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';

export const MAX_VIDEO_BYTES = 2147483648;
const ALLOWED_MIME = new Set(['video/mp4', 'video/webm', 'video/quicktime']);
const ALLOWED_VIDEO_CODECS = new Set(['h264', 'hevc', 'vp8', 'vp9', 'av1']);

export async function downloadExact(url, destination, expectedSize, {
    fetcher = fetch, maxBytes = MAX_VIDEO_BYTES, timeoutMs = 900000,
} = {}) {
    if (!Number.isSafeInteger(expectedSize) || expectedSize < 1 || expectedSize > maxBytes) throw Error('invalid_expected_size');
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || !/^[a-f0-9]{32}(?:\.[a-z]{2,8})?\.r2\.cloudflarestorage\.com$/.test(parsed.hostname)) throw Error('invalid_source_url');
    const response = await fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok || !response.body) throw Error('source_unavailable');
    const declared = response.headers.get('content-length');
    if (declared !== null && Number(declared) !== expectedSize) {
        await response.body.cancel();
        throw Error('size_mismatch');
    }
    const hash = createHash('sha256');
    let bytes = 0;
    const meter = new Transform({
        transform(chunk, _encoding, callback) {
            bytes += chunk.length;
            if (bytes > expectedSize || bytes > maxBytes) return callback(Error('size_mismatch'));
            hash.update(chunk);
            callback(null, chunk);
        },
    });
    try {
        // The isolated ClamAV sidecar reads this shared-volume path as its own
        // unprivileged uid. The volume is private and the file is removed after one scan.
        await pipeline(response.body, meter, createWriteStream(destination, { flags: 'wx', mode: 0o644 }));
        if (bytes !== expectedSize) throw Error('size_mismatch');
        return { bytes, sha256: hash.digest('hex') };
    } catch (error) {
        await unlink(destination).catch(() => {});
        throw error;
    }
}

export async function runTool(command, args, { timeoutMs = 30000, maxOutputBytes = 65536 } = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = Buffer.alloc(0), stderr = Buffer.alloc(0), settled = false;
        const append = (current, chunk) => {
            if (current.length + chunk.length > maxOutputBytes) throw Error('tool_output_too_large');
            return Buffer.concat([current, chunk]);
        };
        const fail = error => { if (!settled) { settled = true; clearTimeout(timer); child.kill('SIGKILL'); reject(error); } };
        child.stdout.on('data', chunk => { try { stdout = append(stdout, chunk); } catch (error) { fail(error); } });
        child.stderr.on('data', chunk => { try { stderr = append(stderr, chunk); } catch (error) { fail(error); } });
        child.on('error', fail);
        child.on('close', code => {
            if (settled) return;
            settled = true; clearTimeout(timer);
            resolve({ code, stdout: stdout.toString('utf8').trim(), stderr: stderr.toString('utf8').trim() });
        });
        const timer = setTimeout(() => fail(Error('tool_timeout')), timeoutMs);
        timer.unref();
    });
}

export async function inspectVideo(path, expectedSize, { run = runTool } = {}) {
    const info = await stat(path);
    if (!info.isFile() || info.size !== expectedSize) throw Error('size_mismatch');
    const magic = await run('file', ['--brief', '--mime-type', '--', path], { timeoutMs: 10000, maxOutputBytes: 1024 });
    if (magic.code !== 0 || !ALLOWED_MIME.has(magic.stdout)) throw Error('unsupported_media_type');
    const probe = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=format_name,duration,size',
        '-show_entries', 'stream=codec_type,codec_name,width,height,duration', '-of', 'json', '--', path],
    { timeoutMs: 60000, maxOutputBytes: 65536 });
    if (probe.code !== 0) throw Error('invalid_media');
    let body;
    try { body = JSON.parse(probe.stdout); } catch { throw Error('invalid_media'); }
    const video = Array.isArray(body.streams) ? body.streams.filter(stream => stream.codec_type === 'video') : [];
    const duration = Number(body.format?.duration), size = Number(body.format?.size);
    if (video.length !== 1 || !Number.isFinite(duration) || duration < 0.1 || duration > 600 || size !== expectedSize) throw Error('invalid_media');
    const stream = video[0];
    if (!ALLOWED_VIDEO_CODECS.has(stream.codec_name) || !Number.isInteger(stream.width) || stream.width < 1 || stream.width > 32768
        || !Number.isInteger(stream.height) || stream.height < 1 || stream.height > 32768) throw Error('invalid_media');
    return { mime: magic.stdout, format: String(body.format.format_name || '').slice(0, 120), codec: stream.codec_name,
        duration_seconds: Math.round(duration * 1000) / 1000, width: stream.width, height: stream.height };
}

function clamdCommand(command, { host = 'clamav', port = 3310, timeoutMs = 600000, maxOutputBytes = 8192 } = {}) {
    return new Promise((resolve, reject) => {
        const socket = net.createConnection({ host, port });
        let reply = Buffer.alloc(0), settled = false;
        const finish = (error, value) => {
            if (settled) return;
            settled = true; clearTimeout(timer); socket.destroy();
            error ? reject(error) : resolve(value);
        };
        socket.setNoDelay(true);
        socket.on('connect', () => socket.write(`z${command}\0`));
        socket.on('data', chunk => {
            if (reply.length + chunk.length > maxOutputBytes) return finish(Error('clamd_reply_too_large'));
            reply = Buffer.concat([reply, chunk]);
            const end = reply.indexOf(0);
            if (end !== -1) finish(null, reply.subarray(0, end).toString('utf8'));
        });
        socket.on('error', error => finish(error));
        socket.on('end', () => { if (!settled) finish(Error('clamd_incomplete_reply')); });
        const timer = setTimeout(() => finish(Error('clamd_timeout')), timeoutMs);
        timer.unref();
    });
}

export async function checkClamd(options = {}) {
    const version = await clamdCommand('VERSION', { ...options, timeoutMs: Math.min(options.timeoutMs || 10000, 10000) });
    if (!/^ClamAV(?:\/|\s)/.test(version)) throw Error('clamd_unavailable');
    return { ok: true, version: version.slice(0, 160) };
}

export async function scanWithClamd(path, options = {}) {
    if (!/^\/quarantine\/[a-f0-9-]{36}\.video$/.test(path)) throw Error('invalid_scan_path');
    const [version, answer] = await Promise.all([
        clamdCommand('VERSION', { ...options, timeoutMs: Math.min(options.timeoutMs || 600000, 10000) }),
        clamdCommand(`SCAN ${path}`, options),
    ]);
    if (answer.endsWith(': OK')) return { verdict: 'passed', version: version.slice(0, 160), signature: null };
    const found = /: (.+) FOUND$/.exec(answer);
    if (found) return { verdict: 'flagged', version: version.slice(0, 160), signature: found[1].slice(0, 160) };
    throw Error('clamd_unavailable');
}

export async function uploadTusFile(url, path, expectedSize, {
    fetcher = fetch, chunkBytes = 5242880, timeoutMs = 60000,
} = {}) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || !['upload.videodelivery.net', 'upload.cloudflarestream.com'].includes(parsed.hostname)) throw Error('invalid_upload_url');
    const file = await open(path, 'r');
    try {
        const head = await fetcher(url, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(timeoutMs), headers: { 'Tus-Resumable': '1.0.0' } });
        let offset = Number(head.headers.get('upload-offset')), length = Number(head.headers.get('upload-length'));
        if (head.body) await head.body.cancel();
        if (head.status !== 200 || !Number.isSafeInteger(offset) || offset < 0 || length !== expectedSize || offset > length) throw Error('upload_unavailable');
        while (offset < length) {
            const size = Math.min(chunkBytes, length - offset), buffer = Buffer.allocUnsafe(size);
            const read = await file.read(buffer, 0, size, offset);
            if (read.bytesRead !== size) throw Error('source_changed');
            const patched = await fetcher(url, { method: 'PATCH', redirect: 'manual', signal: AbortSignal.timeout(timeoutMs),
                headers: { 'Tus-Resumable': '1.0.0', 'Content-Type': 'application/offset+octet-stream', 'Upload-Offset': String(offset) }, body: buffer });
            const next = Number(patched.headers.get('upload-offset'));
            if (patched.body) await patched.body.cancel();
            if (patched.status !== 204 || next !== offset + size) throw Error('upload_unconfirmed');
            offset = next;
        }
        return { bytes: offset };
    } finally { await file.close(); }
}
