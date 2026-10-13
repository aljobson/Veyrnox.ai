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

test('the public catalog contains 28 AI-made story series and 170 episodes', () => {
  assert.equal(editorialSeries.length, 28);
  assert.deepEqual(editorialSeries.map((series) => [series.slug, series.episodes.length]), [
    ['mission-pandora-the-last-pilot', 17],
    ['black-dwarf', 9],
    ['hell-phyre', 8],
    ['planet-9', 8],
    ['eve-andromeda-space-commander', 13],
    ['humanoid-space-odyssey', 8],
    ['falcyon', 6],
    ['shifters', 5],
    ['computer-village', 5],
    ['save-the-world', 2],
    ['a-prince-in-disguise', 5],
    ['crown-of-ashen-dragons', 11],
    ['symbols-of-fate', 4],
    ['telensia-city-of-ai', 13],
    ['the-shadow-realm', 13],
    ['void-core', 5],
    ['lilith', 5],
    ['the-gloom', 4],
    ['the-buried-citadel', 6],
    ['jx', 4],
    ['black-genesis', 4],
    ['zotrac-the-bounty-hunter', 2],
    ['star-revolt', 2],
    ['the-signal', 2],
    ['the-first-moon', 3],
    ['age-of-wings', 2],
    ['ark-7', 2],
    ['the-veiled-crown', 2],
  ]);
  const allEpisodes = editorialSeries.flatMap((series) => series.episodes);
  assert.equal(allEpisodes.length, 170);
  assert.equal(new Set(allEpisodes.map((episode) => episode.id)).size, 170);
  assert.ok(allEpisodes.every((episode) => episode.posterUrl?.startsWith('https://i.ytimg.com/vi/') || episode.id.startsWith('mission-pandora-')));

  const [series] = editorialSeries;
  assert.equal(series.slug, 'mission-pandora-the-last-pilot');
  assert.equal(series.title, 'Mission Pandora: The Last Pilot');
  assert.equal(series.episodes.length, 17);
  assert.deepEqual(series.episodes.map((episode) => episode.position), Array.from({ length: 17 }, (_, index) => index + 1));
  assert.equal(new Set(series.episodes.map((episode) => episode.id)).size, 17);
  assert.ok(series.posterUrl.startsWith('https://i.ytimg.com/vi/'));

  const cards = editorialSeriesCards();
  assert.equal(cards.length, 28);
  const [card] = cards;
  assert.equal(card.content_type, 'SERIES');
  assert.equal(card.episode_count, 17);
  assert.equal(card.series_slug, series.slug);
  assert.equal(card.display_name, 'By Mission Pandora');
  assert.equal(card.poster_src, series.posterUrl);
});

test('the 17 YouTube chapter episodes are contiguous and resolve in order', () => {
  const [series] = editorialSeries;
  for (const [index, episode] of series.episodes.entries()) {
    const membership = editorialSeriesForEpisode(episode.id);
    assert.equal(membership.series.slug, series.slug);
    assert.equal(membership.episode.position, index + 1);
    assert.equal(episode.playback.provider, 'youtube');
    assert.equal(episode.playback.videoId, 'g8FtPaZWGnA');
    assert.equal(episode.durationSeconds, episode.playback.endSeconds - episode.playback.startSeconds);
    if (index > 0) assert.equal(episode.playback.startSeconds, series.episodes[index - 1].playback.endSeconds);

    const context = editorialEpisodeContext(series.slug, episode.id);
    assert.equal(context.previousEpisode?.id || null, series.episodes[index - 1]?.id || null);
    assert.equal(context.nextEpisode?.id || null, series.episodes[index + 1]?.id || null);
  }
  assert.equal(series.episodes[0].playback.startSeconds, 0);
  assert.equal(series.episodes.at(-1).playback.endSeconds, 2076);
  assert.equal(editorialEpisodeContext(series.slug, 'missing-episode'), null);
});

test('YouTube chapter embeds use the privacy-enhanced player with fixed boundaries', () => {
  const [episode] = editorialSeries[0].episodes;
  assert.equal(youtubeEmbedUrl(episode.playback), 'https://www.youtube-nocookie.com/embed/g8FtPaZWGnA?start=0&end=68&playsinline=1&rel=0');
  assert.equal(youtubeEmbedUrl({ ...episode.playback, videoId: '../invalid' }), null);
  assert.equal(youtubeEmbedUrl({ ...episode.playback, endSeconds: 0 }), null);
});

test('every multi-video episode uses its verified source video and full duration', () => {
  for (const series of editorialSeries.slice(1)) {
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
  assert.match(player, /Free viewing via YouTube/);
  assert.match(player, /Next episode:/);
  assert.match(policy, /https:\/\/www\.youtube-nocookie\.com/);
  assert.match(policy, /https:\/\/i\.ytimg\.com/);
  assert.match(nextConfig, /hostname: 'i\.ytimg\.com'/);
  assert.match(nextConfig, /source: '\/social-cinema\/series\/:slug', destination: '\/veyrnox\/social-cinema\/series\/:slug'/);
  assert.match(sitemap, /editorialSeries\.map/);
});
