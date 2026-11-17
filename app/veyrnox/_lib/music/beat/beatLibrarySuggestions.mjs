function distance(a, b) {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 0; i < a.length; i++) {
    const current = [i + 1];
    for (let j = 0; j < b.length; j++) current[j + 1] = Math.min(current[j] + 1, previous[j + 1] + 1, previous[j] + (a[i] === b[j] ? 0 : 1));
    previous = current;
  }
  return previous[b.length];
}
export function suggestBeatCategories(query, sounds) {
  const word = query.toLowerCase().trim().slice(0, 80), scores = new Map();
  for (const sound of sounds) {
    const words = `${sound.category} ${sound.name}`.toLowerCase().split(/\s+/);
    const score = Math.min(...words.map(candidate => distance(word, candidate)));
    scores.set(sound.category, Math.min(scores.get(sound.category) ?? Infinity, score));
  }
  return [...scores].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0])).slice(0, 2).map(([category]) => category);
}
