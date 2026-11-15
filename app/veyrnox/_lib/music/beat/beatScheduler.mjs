import { stepSeconds } from './beatTime.mjs';
import { patternEvents } from './beatEvents.mjs';

// The straight sixteenth boundary is kept separately from the swung event time.
// Edits affect only steps not yet emitted; no timer callback plays an event at "now".
export function createScheduler({ clock, setTimer, clearTimer, isHidden, onEvent, onStep }) {
  let getDoc, timer, running = false, generation = 0, nextStepIndex = 0, boundary = 0, skipped = 0, first = true;
  let scheduled = [];
  function pass() {
    if (!running) return;
    const now = clock();
    const horizon = now + (isHidden() ? 1.5 : 0.15);
    while (running) {
      const doc = getDoc();
      nextStepIndex %= doc.steps;
      const duration = stepSeconds(doc.tempo.bpm);
      const straight = first ? boundary : boundary + duration;
      const time = straight + (nextStepIndex % 2 ? doc.swing * duration * 0.5 : 0);
      if (time >= horizon) break;
      if (time < now) skipped++;
      else {
        scheduled.push({ step: nextStepIndex, time });
        onStep(nextStepIndex, time);
        for (const event of patternEvents(doc)) if (event.step === nextStepIndex) onEvent(event, time);
      }
      boundary = straight; first = false;
      nextStepIndex = (nextStepIndex + 1) % doc.steps;
    }
    scheduled = scheduled.filter((step) => step.time >= now - 2);
  }
  function tick(token) {
    if (!running || token !== generation) return;
    pass();
    timer = setTimer(() => tick(token), 25);
  }
  return {
    update(read) { getDoc = read; },
    start(atTime) {
      this.stop();
      scheduled = []; first = true;
      running = true; skipped = 0; nextStepIndex = 0; boundary = Math.max(atTime, clock());
      tick(generation);
    },
    stop() { running = false; generation++; clearTimer(timer); },
    refill: pass,
    nearestStepAt(at) {
      if (!running) return null;
      const doc = getDoc();
      const step = nextStepIndex % doc.steps;
      // At slow tempos the nearest future step can sit just beyond the lookahead.
      // Project that next boundary without scheduling extra audio ahead of edits.
      const duration = stepSeconds(doc.tempo.bpm);
      const straight = first ? boundary : boundary + duration;
      const next = { step, time: straight + (step % 2 ? doc.swing * duration * 0.5 : 0) };
      return [...scheduled, next].reduce((best, item) => !best || Math.abs(item.time - at) < Math.abs(best.time - at) ? item : best, null);
    },
    get skipped() { return skipped; },
  };
}
