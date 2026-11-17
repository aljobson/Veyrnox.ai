// Windows and frame numbers share the editor AudioContext clock. Round once at
// each pass origin; never infer a pass from repeated scheduler window coordinates.
export function splitPasses(chunks, windows, { sr, rtt = 0, groupStartSec, groupEndSec, cycle = true, endContextTime = Infinity, maxPasses = 8 }) {
  const length = groupEndSec - groupStartSec;
  if (!(sr > 0 && length > 0 && length <= 600) || !windows.length) return [];
  const first = windows.find(w => w.fromSec <= groupStartSec + 1e-9 && w.toSec > groupStartSec);
  if (!first) return [];
  const c0 = first.contextTime + groupStartSec - first.fromSec;
  const capacity = Math.round(length * sr), parts = new Map();
  let wi = 0;
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.samples.length; i++) {
      const frame = chunk.frame + i, t = frame / sr - rtt;
      if (t < c0 - 0.5 / sr || t >= endContextTime || t - c0 >= 600) continue;
      while (wi < windows.length && windows[wi].contextTime + windows[wi].toSec - windows[wi].fromSec <= t + 1e-10) wi++;
      const w = windows[wi];
      if (!w || t < w.contextTime - 0.5 / sr) continue;
      const song = w.fromSec + t - w.contextTime;
      const pass = cycle ? Math.round(((t - c0) - (song - groupStartSec)) / length) : 0;
      if (pass < 0 || pass >= maxPasses || song < groupStartSec - 0.5 / sr || song >= groupEndSec) continue;
      const index = frame - Math.round((c0 + pass * length + rtt) * sr);
      if (index < 0 || index >= capacity) continue;
      if (!parts.has(pass)) parts.set(pass, { samples: new Float32Array(capacity), used: 0 });
      const part = parts.get(pass); part.samples[index] = chunk.samples[i]; part.used = Math.max(part.used, index + 1);
    }
  }
  return [...parts].sort((a, b) => a[0] - b[0]).map(([pass, part]) => ({ pass, complete: part.used >= capacity - 1,
    samples: part.samples.slice(0, part.used >= capacity - 1 ? capacity : part.used) }));
}
export function capturedSamples(chunks, startFrame, endFrame) {
  const result = new Float32Array(Math.max(0, endFrame - startFrame));
  for (const chunk of chunks) {
    const from = Math.max(startFrame, chunk.frame), to = Math.min(endFrame, chunk.frame + chunk.samples.length);
    if (to > from) result.set(chunk.samples.subarray(from - chunk.frame, to - chunk.frame), from - startFrame);
  }
  return result;
}
