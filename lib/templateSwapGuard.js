// A "swap" recipe replaces a person or object in the template's own source clip with the user's photo. The route for a one-photo
// template is Kling image-to-video, which has no video input, so there is nothing to replace and the run returns the photo barely
// animated. The shared video detector only knows explicit video wording, so these prompts passed it. Pure text, no imports: this
// module is on the Worker graph and its size budget is tight.

// Replace/swap/substitute/recast, unless negated ("do not replace my face"), followed by what it is replaced with.
const STRONG = /(?<!\b(?:not|never)\s)(?<!n['’]t\s)\b(?:replac(?:e|ing)|swap(?:ping)?(?:\s+out)?|substitut(?:e|ing)|recast)\b[^.!?\n]{0,140}?\b(?:with|for|to|by|and use|using|in the (?:video|clip)|from the video)\b/i;
// "change"/"switch" are only a swap at the start of a clause ("Change character to <<<image_1>>>"), never "change the scene to" or "Switch to".
const SOFT = /(?:^|[.!?\n;,:])\s*["'“]?\s*(?:(?:but|and|then|just|only|now|please)\s+)*(?:change|switch)\b(?!\s+(?:the\s+)?(?:scene|camera|shot|angle|view|focus|lighting|background|to)\b)[^.!?\n]{0,140}?\b(?:with|for|to|by)\b|^\s*["'“]?\s*character\s*swap/i;

// The photo is placed "in the video" ("<<<image_1>>> is the character in the video"), or the video is edited "with" the photo.
const IN_VIDEO = /(?:<<<\s*image[_\s-]*\d+\s*>>>|@image\s*\d*)[^.!?\n]{0,40}\bin the (?:video|clip)\b|\bthe (?:video|clip)\s+with\s+(?:<<<|@image)/i;
// "replaces"/"replaced" only count next to the photo ("<<<image_1>>> replaces the guy", "replaced by the man from <<<image_1>>>"):
// "the filter is replaced by" or "replaced by open ambience" is ordinary scene writing.
const REPLACES_PHOTO = /(?<!\b(?:not|never|no|without)\b[^.!?\n]{0,40})\breplac(?:es|ed)\b[^.!?\n]{0,80}(?:<<<\s*image|@image)|(?:<<<\s*image[_\s-]*\d+\s*>>>|@image\s*\d*)\s+replac(?:es|ed)\b/i;
// A clause that starts with "Swap" and goes on ("Swap a location and the character <<<image_1>>>"); a bare "swap." is a label.
const LEADING_SWAP = /(?:^|[.!?\n;])\s*["'“]?\s*swap\s+(?!out\b)[^.!?\n\s]/i;

export const swapNeedsSourceVideo = prompt => {
  const text = typeof prompt === 'string' ? prompt : '';
  return STRONG.test(text) || SOFT.test(text) || IN_VIDEO.test(text) || REPLACES_PHOTO.test(text) || LEADING_SWAP.test(text);
};
