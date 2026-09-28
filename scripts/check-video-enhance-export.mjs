import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

// Run against a real browser export; mocks cannot establish A/V timing fidelity.
const [source, result] = process.argv.slice(2);
if (!source || !result) throw new Error('Usage: node scripts/check-video-enhance-export.mjs <source> <export>');
const probe = file => JSON.parse(execFileSync('ffprobe', [
    '-v', 'error', '-show_streams', '-show_frames',
    '-show_entries', 'stream=codec_type,start_time,duration:frame=media_type,best_effort_timestamp_time,duration_time',
    '-of', 'json', file,
], { maxBuffer: 32 * 1024 * 1024 }));
const before = probe(source), after = probe(result);
const videoTimes = data => data.frames.filter(frame => frame.media_type === 'video').map(frame => Number(frame.best_effort_timestamp_time));
const a = videoTimes(before), b = videoTimes(after);
assert.ok(a.length > 1, 'Fixture must have at least two video frames');
assert.equal(b.length, a.length, 'Export must preserve every source video frame');
const tolerance = 0.001; // One millisecond covers container timestamp rounding.
for (let i = 0; i < a.length; i++) assert.ok(Math.abs((a[i] - a[0]) - (b[i] - b[0])) <= tolerance, `Frame ${i} timestamp drift`);
assert.equal(after.streams.length, before.streams.length, 'No source track may disappear');
for (const original of before.streams) {
    const exported = after.streams.find(stream => stream.codec_type === original.codec_type);
    assert.ok(exported, `Missing ${original.codec_type} track`);
    if (original.codec_type === 'video') {
        const duration = (data, stream) => {
            if (Number.isFinite(Number(stream.duration))) return Number(stream.duration);
            // WebM often omits per-stream duration; use its decoded frame boundary.
            const frames = data.frames.filter(frame => frame.media_type === 'video');
            const last = frames.at(-1);
            return Number(last.best_effort_timestamp_time) + Number(last.duration_time) - Number(frames[0].best_effort_timestamp_time);
        };
        assert.ok(Math.abs(duration(after, exported) - duration(before, original)) <= tolerance, 'Video duration drift');
    }
    assert.ok(Math.abs((Number(exported.start_time) - b[0]) - (Number(original.start_time) - a[0])) <= tolerance, `${original.codec_type} start offset drift`);
}
const hasAudio = before.streams.some(stream => stream.codec_type === 'audio');
if (hasAudio) {
    const pcm = file => execFileSync('ffmpeg', [
        '-v', 'error', '-i', file, '-map', '0:a:0', '-f', 's16le', '-',
    ], { maxBuffer: 64 * 1024 * 1024 });
    const original = pcm(source), exported = pcm(result);
    assert.equal(exported.length, original.length, 'Decoded audio byte length differs (padding/sample-count regression)');
    const hash = bytes => createHash('sha256').update(bytes).digest('hex');
    assert.equal(hash(exported), hash(original), 'Decoded audio differs (this check requires a copied-audio fixture)');
}
console.log(`PASS: ${a.length} frames, timestamps/durations within 1ms, ${hasAudio ? 'source audio preserved' : 'no audio track added'}.`);
