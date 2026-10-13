const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const youtubePoster = (videoId, quality = 'hqdefault') =>
  `https://i.ytimg.com/vi/${videoId}/${quality}.jpg`;

const youtubeEpisode = (slug, position, title, videoId, durationSeconds) => Object.freeze({
  id: `${slug}-${String(position).padStart(2, '0')}`,
  position,
  title,
  description: '',
  durationSeconds,
  posterUrl: youtubePoster(videoId),
  playback: Object.freeze({
    provider: 'youtube',
    videoId,
    startSeconds: 0,
    endSeconds: durationSeconds,
  }),
});

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
    posterUrl: youtubePoster('g8FtPaZWGnA', 'maxresdefault'),
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
  Object.freeze({
    slug: 'black-dwarf',
    title: 'Black Dwarf',
    season: 1,
    seasonTitle: 'The Black Dwarf Saga',
    description: 'A hyper-advanced civilization deploys its planetary systems as the Black Dwarf, an undead world, chooses its first strike.',
    posterUrl: youtubePoster('O0ekxwm2iX8'),
    categories: Object.freeze(['sci-fi', 'horror']),
    creator: Object.freeze({
      name: 'Shaun Dougherty',
      url: 'https://www.youtube.com/channel/UCwQmLsgP3Rox4ujeWOMWsKg',
    }),
    source: Object.freeze({
      name: 'YouTube',
      url: 'https://www.youtube.com/watch?v=O0ekxwm2iX8',
      method: 'embed',
    }),
    episodes: Object.freeze([
      youtubeEpisode('black-dwarf', 1, 'First Strike', 'O0ekxwm2iX8', 1047),
      youtubeEpisode('black-dwarf', 2, 'Second Sight', 'q4LDuriAjLQ', 1097),
      youtubeEpisode('black-dwarf', 3, 'Third Eye Blind', 'owt4sFyUEkU', 1274),
      youtubeEpisode('black-dwarf', 4, 'Below the Surface', '73z9K6HwUD0', 1040),
      youtubeEpisode('black-dwarf', 5, 'Encounters', 'x7j79uVASEQ', 1156),
      youtubeEpisode('black-dwarf', 6, 'Obsessions', '8w2VR9fR5Tk', 1336),
      youtubeEpisode('black-dwarf', 7, 'Ascension', 'Roa97FnsRQE', 1267),
      youtubeEpisode('black-dwarf', 8, 'Protocol', 'p_yQajuLhNs', 1032),
      youtubeEpisode('black-dwarf', 9, 'Betrayal', 'IPBLoO1VBUc', 1163),
    ]),
  }),
  Object.freeze({
    slug: 'hell-phyre',
    title: 'Hell PHYRE',
    season: 1,
    seasonTitle: 'Season One',
    description: 'Two superpowered vigilantes confront disappearances, buried memories and a growing conspiracy in a near-future New York City.',
    posterUrl: youtubePoster('h4RjtWfGVKw'),
    categories: Object.freeze(['sci-fi', 'action']),
    creator: Object.freeze({
      name: 'Amnesty Sports',
      url: 'https://www.youtube.com/channel/UCKMlEA6wvNNDpGNgf4otB8w',
    }),
    source: Object.freeze({
      name: 'YouTube',
      url: 'https://www.youtube.com/playlist?list=PLaJZIsgrUMQysyHzkzl751YRAi3ZnaxdG',
      method: 'embed',
    }),
    episodes: Object.freeze([
      youtubeEpisode('hell-phyre', 1, 'Emerging Talents', 'h4RjtWfGVKw', 202),
      youtubeEpisode('hell-phyre', 2, 'Shadows & Flames', 'Js6l4xTEWf0', 247),
      youtubeEpisode('hell-phyre', 3, 'Power Absolute', '0auDqZ43LTw', 180),
      youtubeEpisode('hell-phyre', 4, 'The Terror Within', 'MkgQc5oVzwM', 333),
      youtubeEpisode('hell-phyre', 5, 'Distant Echoes', '-3bteraZymU', 330),
      youtubeEpisode('hell-phyre', 6, 'Defend the Mighty', 'vpdjzAkIwmQ', 300),
      youtubeEpisode('hell-phyre', 7, 'Insurance Policy', 'jHEN9xvkk1s', 476),
      youtubeEpisode('hell-phyre', 8, 'Built in a Day', '665aWzgcM0c', 617),
    ]),
  }),
  Object.freeze({
    slug: 'planet-9',
    title: 'Planet 9',
    season: 1,
    seasonTitle: 'The Expedition',
    description: 'Humanity launches its first mission beyond Neptune to find a hidden planet and discovers something that was never supposed to exist.',
    posterUrl: youtubePoster('F6ZP5x6DSTU'),
    categories: Object.freeze(['sci-fi', 'mystery']),
    creator: Object.freeze({
      name: 'Last Sumerian',
      url: 'https://www.youtube.com/channel/UCc7xT-QfNVlhm6d3XdX-Otg',
    }),
    source: Object.freeze({
      name: 'YouTube',
      url: 'https://www.youtube.com/watch?v=F6ZP5x6DSTU',
      method: 'embed',
    }),
    episodes: Object.freeze([
      youtubeEpisode('planet-9', 1, 'Chapter 1', 'F6ZP5x6DSTU', 157),
      youtubeEpisode('planet-9', 2, 'Chapter 2', 'PxhV-C1C3AI', 179),
      youtubeEpisode('planet-9', 3, 'Chapter 3', '6oC1_3eSQFM', 176),
      youtubeEpisode('planet-9', 4, 'Chapter IV', 'UqcDviy5Eng', 179),
      youtubeEpisode('planet-9', 5, 'Welcome Home', '8R3ZsPGe9ho', 169),
      youtubeEpisode('planet-9', 6, 'Chapter 6', '2nZg4F1pPcc', 180),
      youtubeEpisode('planet-9', 7, 'Chapter 7', 'SkIiyHccL8Q', 179),
      youtubeEpisode('planet-9', 8, 'Chapters 8 & 9', '7nsBRiFosW0', 393),
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
