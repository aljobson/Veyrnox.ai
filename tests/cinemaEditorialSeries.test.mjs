import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  editorialEpisodeContext,
  editorialSeries,
  editorialSeriesCards,
  editorialSeriesForEpisode,
} from '../app/veyrnox/social-cinema/editorialSeries.js';
import { cinemaPosterIds } from '../app/veyrnox/social-cinema/cinemaPosters.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('the public catalog leads with one ordered anthology series', () => {
  assert.equal(editorialSeries.length, 1);
  const [series] = editorialSeries;
  assert.equal(series.slug, 'ai-visual-studies');
  assert.deepEqual(series.episodes.map((episode) => episode.position), [1, 2, 3, 4]);
  assert.equal(new Set(series.episodes.map((episode) => episode.id)).size, 4);
  assert.ok(series.episodes.every((episode) => cinemaPosterIds.includes(episode.id)));

  const [card] = editorialSeriesCards();
  assert.equal(card.content_type, 'SERIES');
  assert.equal(card.episode_count, 4);
  assert.equal(card.series_slug, series.slug);
});

test('every anthology episode resolves its series and its next episode', () => {
  const [series] = editorialSeries;
  for (const [index, episode] of series.episodes.entries()) {
    const membership = editorialSeriesForEpisode(episode.id);
    assert.equal(membership.series.slug, series.slug);
    assert.equal(membership.episode.position, index + 1);
    const context = editorialEpisodeContext(series.slug, episode.id);
    assert.equal(context.previousEpisode?.id || null, series.episodes[index - 1]?.id || null);
    assert.equal(context.nextEpisode?.id || null, series.episodes[index + 1]?.id || null);
  }
  assert.equal(editorialEpisodeContext(series.slug, '00000000-0000-0000-0000-000000000000'), null);
});

test('Social Cinema presents series rather than a standalone clip feed', () => {
  const home = read('app/veyrnox/social-cinema/SocialCinema.js');
  const discovery = read('app/veyrnox/social-cinema/CinemaDiscovery.js');
  const player = read('app/veyrnox/social-cinema/watch/[id]/Player.js');
  const nextConfig = read('next.config.mjs');
  const sitemap = read('app/sitemap.js');
  assert.doesNotMatch(home, /\['For You'/);
  assert.match(home, /mode=\{section === 1 \? 'voting' : 'series'\}/);
  assert.match(discovery, /editorialSeriesCards\(slug\)/);
  assert.match(player, /Next episode:/);
  assert.match(nextConfig, /source: '\/social-cinema\/series\/:slug', destination: '\/veyrnox\/social-cinema\/series\/:slug'/);
  assert.match(sitemap, /editorialSeries\.map/);
});
