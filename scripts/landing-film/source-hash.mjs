// One short hash over the files the film's frames are drawn from. The
// landing manifest records the hash the shipped MP4 was rendered from, and
// tests/landingFilm.test.mjs compares the two: change a price or a scene
// without rendering again and the test fails.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const SOURCES = ['film.html', 'prices.js', 'engine.js', 'build.js', 'film.js'];

export function filmSourceHash() {
  const hash = createHash('sha256');
  for (const name of SOURCES) hash.update(readFileSync(new URL(name, import.meta.url)));
  return hash.digest('hex').slice(0, 16);
}
