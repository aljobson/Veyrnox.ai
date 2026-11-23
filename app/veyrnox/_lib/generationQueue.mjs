// Timers are injectable so queue ordering and coalescing can be checked without a browser clock.
export function createGenerationQueue({ show, isPresent, schedule = setTimeout, cancel = clearTimeout }) {
  const waiting = [], seen = new Set();
  let timer, active = false;
  function next() {
    const batch = waiting.splice(0, waiting.length > 3 ? waiting.length : 1);
    if (!batch.length) { active = false; show(null); return; }
    active = true;
    const link = batch.some(item => !isPresent(item.job_id));
    const credits = batch.every(item => Number.isFinite(item.credits)) ? batch.reduce((sum, item) => sum + item.credits, 0) : null;
    show({ ...batch[0], count: batch.length, link, credits });
    timer = schedule(next, link ? 10000 : 2800);
  }
  return {
    push(item) {
      if (!item?.job_id || seen.has(item.job_id)) return;
      seen.add(item.job_id);
      if (seen.size > 200) seen.delete(seen.values().next().value);
      waiting.push(item);
      if (!active) next();
    },
    dismiss() { if (active) { cancel(timer); next(); } },
    clear() { cancel(timer); waiting.length = 0; seen.clear(); active = false; show(null); },
  };
}
