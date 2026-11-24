const SLUG = /^[a-f0-9]{24}$/;

export async function resolveAlbumArtwork(gatewayFetch, album) {
  if (typeof gatewayFetch !== 'function' || !album || typeof album !== 'object' || !SLUG.test(album.slug || '')) return null;
  const endpoint = `/api/v1/music/explore/albums/${album.slug}/artwork`;
  if (album.artwork_url !== endpoint) return null;
  const result = await gatewayFetch(endpoint.slice('/api/v1'.length));
  return typeof result?.url === 'string' && /^https:\/\/[^\s]+$/.test(result.url) ? result.url : null;
}
