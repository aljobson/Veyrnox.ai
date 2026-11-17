// Windows and frame numbers share the editor AudioContext clock. Copy only
// intersecting spans; compact checkpoints retain their offset within the take.
export function splitPasses(chunks, windows, { sr, rtt = 0, groupStartSec, groupEndSec, cycle = true, endContextTime = Infinity, maxPasses = 8, compact = false }) {
  const length = groupEndSec - groupStartSec;
  if (!(sr > 0 && length > 0 && length <= 600) || !windows.length) return [];
  const first = windows.find(w => w.fromSec <= groupStartSec + 1e-9 && w.toSec > groupStartSec);
  if (!first) return [];
  const c0 = first.contextTime + groupStartSec - first.fromSec;
  const capacity = Math.round(length * sr), parts = new Map();
  let wi = 0;
  for (const chunk of chunks) {
    const chunkEnd = chunk.frame + chunk.samples.length;
    while (wi < windows.length && Math.round((windows[wi].contextTime + windows[wi].toSec - windows[wi].fromSec + rtt) * sr) <= chunk.frame) wi++;
    for (let j = wi; j < windows.length; j++) {
      const w = windows[j];
      if (Math.round((w.contextTime + rtt) * sr) >= chunkEnd) break;
      const pass = cycle ? Math.round(((w.contextTime - c0) - (w.fromSec - groupStartSec)) / length) : 0;
      if (pass < 0 || pass >= maxPasses) continue;
      const origin = c0 + pass * length, originFrame = Math.round((origin + rtt) * sr);
      const from = Math.max(chunk.frame, originFrame, Math.round((w.contextTime + rtt) * sr));
      const to = Math.min(chunkEnd, originFrame + capacity, Math.round((Math.min(endContextTime, c0 + 600, w.contextTime + w.toSec - w.fromSec) + rtt) * sr));
      if (to <= from) continue;
      if (!parts.has(pass)) parts.set(pass, { spans: [], from: capacity, to: 0 });
      const part = parts.get(pass), offset = from - originFrame;
      part.spans.push({ offset, samples: chunk.samples.subarray(from - chunk.frame, to - chunk.frame) });
      part.from = Math.min(part.from, offset); part.to = Math.max(part.to, to - originFrame);
    }
  }
  return [...parts].sort((a, b) => a[0] - b[0]).map(([pass, part]) => {
    const offset = compact ? part.from : 0, complete = part.to >= capacity - 1;
    const samples = new Float32Array((complete ? capacity : part.to) - offset);
    for (const span of part.spans) samples.set(span.samples, span.offset - offset);
    return { pass, complete, offset, samples };
  });
}
export function capturedSamples(chunks, startFrame, endFrame) {
  const result = new Float32Array(Math.max(0, endFrame - startFrame));
  for (const chunk of chunks) {
    const from = Math.max(startFrame, chunk.frame), to = Math.min(endFrame, chunk.frame + chunk.samples.length);
    if (to > from) result.set(chunk.samples.subarray(from - chunk.frame, to - chunk.frame), from - startFrame);
  }
  return result;
}
