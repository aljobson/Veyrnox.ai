import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const available = ['ffmpeg', 'ffprobe'].every(tool => spawnSync(tool, ['-version']).status === 0);
if (process.env.CI && !available) throw new Error('CI requires ffmpeg and ffprobe for media regression tests');
const checker = fileURLToPath(new URL('../scripts/check-video-enhance-export.mjs', import.meta.url));

// Real synthetic media exercises ffprobe parsing and decoded-audio comparison.
test('export checker accepts preserved media and rejects fidelity regressions', { skip: available ? false : 'Requires ffmpeg and ffprobe' }, async t => {
    const directory = mkdtempSync(join(tmpdir(), 'enhance-check-'));
    const source = join(directory, 'source.mov');
    const ffmpeg = args => execFileSync('ffmpeg', ['-v', 'error', '-y', ...args]);
    const check = result => spawnSync(process.execPath, [checker, source, result], { encoding: 'utf8' });
    try {
        ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=64x64:rate=10', '-f', 'lavfi', '-i',
            'sine=frequency=440:sample_rate=48000', '-t', '0.5', '-c:v', 'mpeg4', '-c:a', 'pcm_s16le', source]);
        await t.test('unchanged frames and audio pass', () => {
            const result = check(source);
            assert.equal(result.status, 0, result.stderr);
            assert.match(result.stdout, /PASS: 5 frames/);
        });
        for (const [name, args, message] of [
            ['missing audio', ['-c:v', 'copy', '-an'], /No source track may disappear/],
            ['changed sample rate', ['-c:v', 'copy', '-c:a', 'pcm_s16le', '-ar', '24000'], /Audio sample rate changed/],
            ['changed channels', ['-c:v', 'copy', '-c:a', 'pcm_s16le', '-ac', '2'], /Audio channel count changed/],
            ['changed samples', ['-c:v', 'copy', '-c:a', 'pcm_s16le', '-af', 'volume=0.5'], /Decoded audio differs/],
            ['dropped frame', ['-vf', 'select=not(eq(n\\,2))', '-fps_mode', 'vfr', '-c:v', 'mpeg4', '-c:a', 'copy'], /preserve every source video frame/],
        ]) {
            await t.test(name, () => {
                const result = join(directory, `${name}.mov`);
                ffmpeg(['-i', source, ...args, result]);
                const report = check(result);
                assert.notEqual(report.status, 0);
                assert.match(report.stderr, message);
            });
        }
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});
