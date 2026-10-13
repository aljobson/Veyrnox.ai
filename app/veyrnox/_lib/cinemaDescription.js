const DEFAULT_LIMIT = 220;

export function cinemaDescription(value, limit = DEFAULT_LIMIT) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';

  const firstSentence = text.match(/^.*?[.!?](?=\s|$)/u)?.[0];
  const description = firstSentence || text;
  if (description.length <= limit) return description;

  const candidate = description.slice(0, limit + 1);
  const wordBreak = candidate.lastIndexOf(' ');
  const end = wordBreak >= Math.floor(limit * 0.6) ? wordBreak : limit;
  return `${candidate.slice(0, end).trimEnd()}…`;
}
