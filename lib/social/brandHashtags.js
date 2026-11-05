// Preserve the caption exactly when all tags are present. Never apply implicitly.
export function appendBrandHashtags(caption, hashtags) {
  const existing = new Set(Array.from(caption.matchAll(/(?:^|[^\p{L}\p{N}_#])#([\p{L}\p{N}_]+)/gu), match => match[1].toLowerCase()));
  const missing = [];
  for (const value of hashtags) {
    const tag = value.replace(/^#/, '');
    if (!existing.has(tag.toLowerCase())) { missing.push(`#${tag}`); existing.add(tag.toLowerCase()); }
  }
  return missing.length ? `${caption}${caption && !/\s$/.test(caption) ? ' ' : ''}${missing.join(' ')}` : caption;
}

export function brandHashtagAction(caption, hashtags, networks, networkText) {
  const next = appendBrandHashtags(caption, hashtags);
  return { caption: next, disabled: next === caption, hasVariants: networks.some(network => Boolean(networkText[network])) };
}
