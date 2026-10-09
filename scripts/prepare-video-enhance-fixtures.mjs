import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

// Synthetic media only. Requires ffmpeg with -display_rotation support.
const directory = resolve(process.argv[2] || '.scratch/video-enhance/fixtures');
mkdirSync(directory, { recursive: true });
const run = args => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
const source = join(directory, 'pattern-audio.mp4');
run(['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '5',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', source]);
run(['-i', source, '-an', '-vf', "select='if(lt(t,2),not(mod(n,3)),1)'",
    '-fps_mode', 'vfr', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(directory, 'vfr-silent.mp4')]);
run(['-display_rotation:v:0', '90', '-i', source, '-c', 'copy', join(directory, 'rotation90.mp4')]);
run(['-i', source, '-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8',
    '-c:a', 'libopus', join(directory, 'opus-rejected.webm')]);
console.log(`Prepared audio, silent variable-frame-rate, rotation and Opus rejection fixtures in ${directory}`);
