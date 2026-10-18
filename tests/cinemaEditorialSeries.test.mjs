import english from '../lib/i18n/messages/en.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  editorialEpisodeContext,
  editorialSeries,
  editorialSeriesCards,
  editorialSeriesForEpisode,
  youtubeEmbedUrl,
} from '../app/veyrnox/social-cinema/editorialSeries.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('the public catalog contains only long-form AI story series with at least 6 episodes', () => {
  assert.equal(editorialSeries.length, 9);
  assert.deepEqual(editorialSeries.map((series) => [series.slug, series.episodes.length]), [
    ['black-dwarf', 9],
    ['humanoid-space-odyssey', 8],
    ['the-shadow-realm', 13],
    ['the-buried-citadel', 6],
    ['phoenix-saga', 40],
    ['the-pardaillans', 11],
    ['i-fell-for-my-sisters-best-friend', 6],
    ['rapunzel-2-mage-academy', 10],
    ['a-web-of-love-and-lies', 11],
  ]);
  const allEpisodes = editorialSeries.flatMap((series) => series.episodes);
  assert.equal(allEpisodes.length, 114);
  assert.equal(new Set(allEpisodes.map((episode) => episode.id)).size, 114);
  assert.ok(editorialSeries.every((series) => series.episodes.length >= 6));
  assert.ok(allEpisodes.every((episode) => episode.posterUrl?.startsWith('https://i.ytimg.com/vi/')));
  assert.ok(allEpisodes.every((episode) => episode.durationSeconds >= 480));

  const [series] = editorialSeries;
  assert.equal(series.slug, 'black-dwarf');
  assert.equal(series.title, 'Black Dwarf');
  assert.equal(series.episodes.length, 9);
  assert.ok(series.posterUrl.startsWith('https://i.ytimg.com/vi/'));

  const cards = editorialSeriesCards();
  assert.equal(cards.length, 9);
  const [card] = cards;
  assert.equal(card.content_type, 'SERIES');
  assert.equal(card.episode_count, 9);
  assert.equal(card.series_slug, series.slug);
  assert.equal(card.display_name, 'By Shaun Dougherty');
  assert.equal(card.poster_src, series.posterUrl);
});

test('YouTube embeds use the privacy-enhanced player with fixed boundaries', () => {
  const [episode] = editorialSeries[0].episodes;
  assert.equal(youtubeEmbedUrl(episode.playback), 'https://www.youtube-nocookie.com/embed/O0ekxwm2iX8?start=0&end=1047&playsinline=1&rel=0');
  assert.equal(youtubeEmbedUrl({ ...episode.playback, videoId: '../invalid' }), null);
  assert.equal(youtubeEmbedUrl({ ...episode.playback, endSeconds: 0 }), null);
});

test('every long-form episode uses its verified source video and full duration', () => {
  for (const series of editorialSeries) {
    assert.deepEqual(series.episodes.map((episode) => episode.position), Array.from({ length: series.episodes.length }, (_, index) => index + 1));
    assert.equal(new Set(series.episodes.map((episode) => episode.playback.videoId)).size, series.episodes.length);
    for (const [index, episode] of series.episodes.entries()) {
      assert.equal(episode.playback.provider, 'youtube');
      assert.equal(episode.playback.startSeconds, 0);
      assert.equal(episode.playback.endSeconds, episode.durationSeconds);
      assert.match(youtubeEmbedUrl(episode.playback), new RegExp(`^https://www\\.youtube-nocookie\\.com/embed/${episode.playback.videoId}\\?`));
      const context = editorialEpisodeContext(series.slug, episode.id);
      assert.equal(context.previousEpisode?.id || null, series.episodes[index - 1]?.id || null);
      assert.equal(context.nextEpisode?.id || null, series.episodes[index + 1]?.id || null);
    }
  }
  assert.equal(editorialEpisodeContext(editorialSeries[0].slug, 'missing-episode'), null);
});

test('Social Cinema presents the external series without copying the source video', () => {
  const home = read('app/veyrnox/social-cinema/SocialCinema.js');
  const discovery = read('app/veyrnox/social-cinema/CinemaDiscovery.js');
  const player = read('app/veyrnox/social-cinema/watch/[id]/Player.js');
  const editorial = read('app/veyrnox/social-cinema/editorialSeries.js');
  const policy = read('lib/contentSecurityPolicy.mjs');
  const nextConfig = read('next.config.mjs');
  const sitemap = read('app/sitemap.js');
  assert.doesNotMatch(home, /\['For You'/);
  assert.match(home, /mode=\{section === 1 \? 'voting' : 'series'\}/);
  assert.match(discovery, /editorialSeriesCards\(slug\)/);
  assert.match(discovery, /else if \(mode === 'series'\)/);
  assert.match(player, /youtubeEmbedUrl/);
  assert.match(editorial, /www\.youtube-nocookie\.com/);
  assert.match(player, /t\('cinema.player.rights'\)/);
  assert.match(english['cinema.player.rights'], /Free viewing via YouTube/);
  assert.match(player, /cinema.player.next/);
  assert.match(english['cinema.player.next'], /Next episode:/);
  assert.match(policy, /https:\/\/www\.youtube-nocookie\.com/);
  assert.match(policy, /https:\/\/i\.ytimg\.com/);
  assert.match(nextConfig, /hostname: 'i\.ytimg\.com'/);
  assert.match(nextConfig, /source: '\/social-cinema\/series\/:slug', destination: '\/veyrnox\/social-cinema\/series\/:slug'/);
  assert.match(sitemap, /editorialSeries\.map/);
});
