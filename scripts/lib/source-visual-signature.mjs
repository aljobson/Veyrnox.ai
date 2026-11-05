import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

// ffprobe-only alternative to encoding/exporting raw frames. Same normalized
// pixels as the earlier audit, with one showinfo Adler-32 per sampled frame.
// Keep the method explicit: these hashes are not earlier raw-frame SHA-256s.
export const VISUAL_SIGNATURE_METHOD = 'sha256 of newline-joined ffprobe showinfo Adler-32 checksums; fps=1,scale=32:32:flags=area,format=gray';
export function visualSignature(file) {
  // Public media paths are repository-owned, but filter paths still need quoting.
  if (!/^[a-zA-Z0-9_./-]+$/.test(file)) throw new Error('Unsupported media path');
  // spawnSync exposes stderr without writing the frame ledger into the console.
  const result = probe(file);
  const stderr = result.stderr;
  const frames = [...stderr.matchAll(/\bn:\s*(\d+).*?\bchecksum:([A-F0-9]{8})/g)].map(m => m[2]);
  if (frames.length < 1) throw new Error(`No normalized frames: ${file}`);
  return { frames: frames.length, signature: createHash('sha256').update(frames.join('\n')).digest('hex') };
}
function probe(file) {
  const result = spawnSync('ffprobe', ['-v', 'info', '-threads', '2', '-f', 'lavfi', '-i', `movie=${file}:dec_threads=2,fps=1,scale=32:32:flags=area,format=gray,showinfo`, '-show_frames', '-show_entries', 'frame=pts', '-of', 'csv'], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`ffprobe failed: ${file}: ${result.stderr.slice(-1000)}`);
  return result;
}
