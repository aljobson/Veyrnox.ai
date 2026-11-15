import { MUSIC_DISCOVER_BEATS } from '../../../../lib/musicDiscover.js';

// Every Discover genre; Create accepts any of their seeds as ?sample=.
export const LAB_GENRES = Object.freeze([...new Set(MUSIC_DISCOVER_BEATS.map((beat) => beat.mood))]);

/** Pick one Discover seed of a random genre. `random` is injectable for tests. */
export function spinGenre(random = Math.random) {
  const genre = LAB_GENRES[Math.floor(random() * LAB_GENRES.length) % LAB_GENRES.length];
  const seeds = MUSIC_DISCOVER_BEATS.filter((beat) => beat.mood === genre);
  return { genre, seed: seeds[Math.floor(random() * seeds.length) % seeds.length] };
}
