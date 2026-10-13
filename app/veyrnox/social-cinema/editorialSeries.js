const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

const missionPandoraEpisode = (position, title, startSeconds, endSeconds) => Object.freeze({
  id: `mission-pandora-${String(position).padStart(2, '0')}`,
  position,
  title,
  description: '',
  durationSeconds: endSeconds - startSeconds,
  playback: Object.freeze({
    provider: 'youtube',
    videoId: 'g8FtPaZWGnA',
    startSeconds,
    endSeconds,
  }),
});

const SERIES = Object.freeze([
  Object.freeze({
    slug: 'mission-pandora-the-last-pilot',
    title: 'Mission Pandora: The Last Pilot',
    season: 1,
    seasonTitle: 'The Last Pilot',
    description: 'Ari, the last pilot on desert planet Kessa, stows aboard Pandora and discovers something beneath Europa’s ice.',
    posterUrl: 'https://i.ytimg.com/vi/g8FtPaZWGnA/maxresdefault.jpg',
    categories: Object.freeze(['sci-fi', 'adventure']),
    creator: Object.freeze({
      name: 'Mission Pandora',
      url: 'https://www.youtube.com/channel/UCNJXg4qt2kp53fzx-4xZOdQ',
    }),
    source: Object.freeze({
      name: 'YouTube',
      url: 'https://www.youtube.com/watch?v=g8FtPaZWGnA',
      method: 'embed',
    }),
    episodes: Object.freeze([
      missionPandoraEpisode(1, 'The Last Pilot', 0, 68),
      missionPandoraEpisode(2, 'Among Strangers', 68, 152),
      missionPandoraEpisode(3, 'Off Course', 152, 240),
      missionPandoraEpisode(4, 'Gods of the Wasteland', 240, 385),
      missionPandoraEpisode(5, 'Not a Passenger', 385, 485),
      missionPandoraEpisode(6, 'The Last Recording', 485, 673),
      missionPandoraEpisode(7, 'Stowaway', 673, 760),
      missionPandoraEpisode(8, 'The Price of a Ticket', 760, 858),
      missionPandoraEpisode(9, 'Kilo', 858, 969),
      missionPandoraEpisode(10, 'Landing', 969, 1080),
      missionPandoraEpisode(11, 'The Camp', 1080, 1200),
      missionPandoraEpisode(12, 'A House Under the Ice', 1200, 1326),
      missionPandoraEpisode(13, 'Stones and Stars', 1326, 1465),
      missionPandoraEpisode(14, 'Debrief', 1465, 1603),
      missionPandoraEpisode(15, 'Hoppers', 1603, 1755),
      missionPandoraEpisode(16, 'The Meeting', 1755, 1892),
      missionPandoraEpisode(17, 'The Old War', 1892, 2076),
    ]),
  }),
]);

export const editorialSeries = SERIES;

export function editorialSeriesBySlug(slug) {
  return SERIES.find((series) => series.slug === String(slug || '').toLowerCase()) || null;
}

export function editorialSeriesForEpisode(id) {
  const episodeId = String(id || '').toLowerCase();
  for (const series of SERIES) {
    const episode = series.episodes.find((item) => item.id === episodeId);
    if (episode) return { series, episode };
  }
  return null;
}

export function editorialEpisodeContext(slug, id) {
  const series = editorialSeriesBySlug(slug);
  if (!series) return null;
  const index = series.episodes.findIndex((episode) => episode.id === String(id || '').toLowerCase());
  if (index < 0) return null;
  return {
    series,
    episode: series.episodes[index],
    previousEpisode: series.episodes[index - 1] || null,
    nextEpisode: series.episodes[index + 1] || null,
  };
}

export function youtubeEmbedUrl(playback) {
  if (playback?.provider !== 'youtube' || !YOUTUBE_VIDEO_ID.test(playback.videoId || '')) return null;
  const start = Number(playback.startSeconds);
  const end = Number(playback.endSeconds);
  if (!Number.isInteger(start) || start < 0 || !Number.isInteger(end) || end <= start) return null;
  const params = new URLSearchParams({ start: String(start), end: String(end), playsinline: '1', rel: '0' });
  return `https://www.youtube-nocookie.com/embed/${playback.videoId}?${params}`;
}

export function editorialSeriesCards(category = '') {
  return SERIES.filter((series) => !category || series.categories.includes(category)).map((series) => ({
    id: `editorial:${series.slug}`,
    content_type: 'SERIES',
    title: series.title,
    synopsis: series.description,
    display_name: `By ${series.creator.name}`,
    categories: [...series.categories],
    episode_count: series.episodes.length,
    competitions: [],
    poster_src: series.posterUrl,
    series_slug: series.slug,
  }));
}
