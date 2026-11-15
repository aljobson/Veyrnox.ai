export function patternEvents(doc) {
  return Object.entries(doc.patterns[doc.currentPattern].rows)
    .flatMap(([pad, hits]) => hits.filter(([step]) => step < doc.steps).map(([step, velocity]) => ({ step, pad, velocity: velocity / 127 })))
    .sort((a, b) => a.step - b.step || a.pad.localeCompare(b.pad));
}
