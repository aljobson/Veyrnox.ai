import { stepSeconds, eventTime } from './beatTime.mjs';
import { eventsAtStep, patternEvents } from './beatEvents.mjs';

// Straight boundaries advance independently of swing and of wrapped song coordinates.
export function createScheduler({ clock, setTimer, clearTimer, isHidden, onEvent, onStep, onEnd = () => {}, getSequence }) {
  let read = getSequence, timer, running = false, generation = 0, nextStepIndex = 0;
  let boundary = 0, skipped = 0, first = true, ended = false, scheduled = [];
  function normalize(sequence) {
    if (sequence.loop) {
      const { start, end } = sequence.loop;
      if (nextStepIndex >= end || nextStepIndex < start) nextStepIndex = start;
    }
  }
  function pass() {
    if (!running || ended) return;
    const now = clock();
    const horizon = now + (isHidden() ? 1.5 : 0.15);
    while (running && !ended) {
      const sequence = read();
      const { doc } = sequence;
      normalize(sequence);
      const duration = stepSeconds(doc.tempo.bpm);
      const straight = first ? boundary : boundary + duration;
      if (!sequence.loop && nextStepIndex >= sequence.endStep) {
        if (straight >= horizon) break;
        ended = true;
        onEnd(straight);
        break;
      }
      const time = eventTime(straight, nextStepIndex, doc.tempo.bpm, doc.swing);
      if (time >= horizon) break;
      if (time < now) skipped++;
      else {
        scheduled.push({ step: nextStepIndex, time });
        onStep(nextStepIndex, time);
        const events = sequence.legacy ? patternEvents(doc).filter((e) => e.step === nextStepIndex)
          : eventsAtStep(doc, nextStepIndex, { editTrackId: sequence.editTrackId });
        for (const event of events) onEvent(event, time);
      }
      boundary = straight; first = false; nextStepIndex++;
    }
    scheduled = scheduled.filter((step) => step.time >= now - 2);
  }
  function tick(token) {
    if (!running || token !== generation) return;
    pass();
    if (!ended && running) timer = setTimer(() => tick(token), 25);
  }
  return {
    // Retain the phase 1 adapter and its timing tests; new callers provide a sequence.
    update(getDoc) { read = () => { const doc = getDoc(); return { doc, legacy: true, startStep: 0, endStep: doc.steps, loop: { start: 0, end: doc.steps } }; }; },
    updateSequence(get) { read = get; },
    start(atTime) {
      this.stop();
      scheduled = []; first = true; ended = false;
      running = true; skipped = 0; nextStepIndex = read().startStep;
      boundary = Math.max(atTime, clock());
      tick(generation);
    },
    stop() { running = false; generation++; clearTimer(timer); },
    refill: pass,
    nearestStepAt(at) {
      if (!running) return null;
      const sequence = read();
      normalize(sequence);
      const { doc } = sequence;
      const straight = first ? boundary : boundary + stepSeconds(doc.tempo.bpm);
      const next = { step: nextStepIndex, time: eventTime(straight, nextStepIndex, doc.tempo.bpm, doc.swing) };
      const candidates = !ended && (sequence.loop || nextStepIndex < sequence.endStep) ? [...scheduled, next] : scheduled;
      return candidates.reduce((best, item) => !best || Math.abs(item.time - at) < Math.abs(best.time - at) ? item : best, null);
    },
    get skipped() { return skipped; },
  };
}
