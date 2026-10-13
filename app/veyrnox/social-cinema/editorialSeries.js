const SERIES = Object.freeze([
  Object.freeze({
    slug: 'ai-visual-studies',
    title: 'AI Visual Studies',
    season: 1,
    seasonTitle: 'Quiet Worlds',
    description: 'A four-part anthology of AI-made scenes, moving from open water and coastal light to quiet café moments.',
    posterId: 'b41362d4-b6a0-46ad-b0ab-d4e00ceb8d68',
    categories: Object.freeze(['animation', 'drama']),
    episodes: Object.freeze([
      Object.freeze({
        id: 'b41362d4-b6a0-46ad-b0ab-d4e00ceb8d68',
        position: 1,
        title: 'Late Afternoon Swans (CogVideoX)',
        description: 'Swans glide across a still lake at sunset.',
        durationSeconds: 6,
      }),
      Object.freeze({
        id: '5cc7db34-2b81-4eb2-83bf-7e52ff650b07',
        position: 2,
        title: 'Painting With The Breeze (CogVideoX)',
        description: 'A painter works beside the sea as the breeze moves around them.',
        durationSeconds: 6,
      }),
      Object.freeze({
        id: '6138d6ab-35ba-48f5-934f-f8da387d2d45',
        position: 3,
        title: 'Grey Haired Man in a Cosy Cafe (Veo 3)',
        description: 'A grey-haired man enjoys coffee in warm late-afternoon light.',
        durationSeconds: 8,
      }),
      Object.freeze({
        id: 'c928cfef-ed3a-4560-afbf-ff72927eaa32',
        position: 4,
        title: 'Visual Kei Man Enjoys Lemonade (Veo 3)',
        description: 'A visual-kei character enjoys lemonade in a quiet café.',
        durationSeconds: 8,
      }),
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

export function editorialSeriesCards(category = '') {
  return SERIES.filter((series) => !category || series.categories.includes(category)).map((series) => ({
    id: `editorial:${series.slug}`,
    content_type: 'SERIES',
    title: series.title,
    synopsis: series.description,
    display_name: 'Curated by Social Cinema',
    categories: [...series.categories],
    episode_count: series.episodes.length,
    competitions: [],
    poster_id: series.posterId,
    series_slug: series.slug,
  }));
}
