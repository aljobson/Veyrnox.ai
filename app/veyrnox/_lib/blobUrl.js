// A local preview address made by URL.createObjectURL(file) starts with "blob:". Anything else is
// refused, so a media element can never be pointed at an address that did not come from a picked file.
export function blobUrl(url) {
  return typeof url === 'string' && url.startsWith('blob:') ? url : undefined;
}
